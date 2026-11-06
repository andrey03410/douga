import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { videoDocumentSchema } from "@/video";
import { selectStoryboard, matchStoryboard } from "@/video/storyboard";
import { actor, owned, canonical, hash, requestHash, replay, receipt } from "./shared";
import { view } from "./projects";
import { evaluate, runtime, cleanupDirectory, fileHash, safeFile } from "./assets";
import { prepareStudioEngine } from "./engine";
import { freezeTypographyFonts, verifyTypographyFonts } from "./typography-fonts";
import { StudioError } from "./errors";
import { assertStudioJobQuota, jobDirectory, jobView, ownedJob } from "./jobs";
import { activeJobStatuses, studioJobLimits, type StudioJobView } from "./job-types";
import type { StudioFrozenRevision, StudioValidation } from "./types";
import type { CompiledVideo } from "@/video/types";
import { compareStoryboardDocuments } from "@/video/storyboard-diff";
import type { InspectionJobInput, InspectionOrigin, InspectionSummary, StoryboardRenderInput } from "./storyboard-types";

const key = z.string().min(1).max(4096);
export const storyboardSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
  mode: z.enum(["overview", "scene", "compare"]).default("overview"),
  sceneId: key.optional(), segmentId: key.optional(),
  page: z.number().int().min(0).max(20000).default(0),
  pageSize: z.number().int().min(1).max(24).default(12),
  compareRevision: z.number().int().positive().optional(),
  compareJobId: key.optional(),
  sourceJobId: key.optional(),
  pixelDiff: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.pixelDiff !== undefined && v.mode !== "compare" && !v.sourceJobId)
    ctx.addIssue({ code: "custom", message: "pixelDiff requires compare mode", path: ["pixelDiff"] });
  if (v.mode === "compare" && v.pageSize < (v.pixelDiff ? 3 : 2))
    ctx.addIssue({ code: "custom", message: "Compare pageSize must fit a complete pair or pixel triple", path: ["pageSize"] });
  if (v.mode === "scene" && !v.sceneId && !v.sourceJobId) ctx.addIssue({ code: "custom", message: "sceneId required", path: ["sceneId"] });
  if (v.sourceJobId ? !!v.compareRevision || !!v.compareJobId : v.mode === "compare" ? Number(!!v.compareRevision) + Number(!!v.compareJobId) !== 1 : !!v.compareRevision || !!v.compareJobId)
    ctx.addIssue({ code: "custom", message: "Compare requires one origin; continuation uses the source job's pinned origins" });
});
export type StoryboardInput = z.input<typeof storyboardSchema>;
const originInput = z.object({ expectedVersion: z.number().int().positive().optional(), revision: z.number().int().positive().optional() }).strict();

/** Reads the exact draft/revision. In particular, never calls getStudioProject/reconcileSource. */
export async function loadInspectionProject(userId: string, projectId: string,
  raw: z.input<typeof originInput> = {}, directory?: string) {
  const input = originInput.parse(raw);
  const current = await view(await owned(userId, projectId));
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) throw new StudioError("VERSION_CONFLICT");
  let value = current.draft ? current.draft.document : current.document;
  let revisionId = "draft";
  if (input.revision !== undefined) {
    const revision = await prisma.studioRevision.findUnique({ where: { projectId_revision: { projectId, revision: input.revision } } });
    if (!revision) throw new StudioError("NOT_FOUND");
    // History owns its saved plan and resource ledger. Re-evaluating bindings here
    // would follow today's track cover/pool bytes and silently rewrite the past.
    const validation = JSON.parse(revision.validationJson) as StudioValidation;
    if (!validation.ready || validation.diagnostics.some(d => d.severity === "error") || !revision.assetsJson || !revision.planJson)
      throw new StudioError("VALIDATION_FAILED", validation.diagnostics);
    const parsed = videoDocumentSchema.safeParse(JSON.parse(revision.documentJson));
    const assets = JSON.parse(revision.assetsJson) as Pick<StudioFrozenRevision,
      "resolvedDocument" | "manifest" | "files" | "fontFiles" | "runtime">;
    const plan = JSON.parse(revision.planJson) as CompiledVideo;
    if (!parsed.success || !assets.resolvedDocument || !assets.manifest || !assets.files || !assets.runtime ||
      !plan || !Array.isArray(plan.scenes) || !plan.scenes.length || !Number.isFinite(plan.fps) || plan.fps <= 0 ||
      !Number.isInteger(plan.durationInFrames) || plan.durationInFrames <= 0)
      throw new StudioError("VALIDATION_FAILED", validation.diagnostics);
    // Check pinned revision references, including the OLD cover Art row. Looking
    // through track.coverArtId would authorize the replacement instead of A.
    const references = await prisma.studioAssetReference.findMany({
      where: { projectId, scope: `revision:${input.revision}` },
      include: { art: { select: { userId: true } }, track: { select: { tournament: { select: { userId: true } } } }, tournament: { select: { userId: true } } },
    });
    for (const reference of references)
      if ((reference.artId && reference.art?.userId !== userId) ||
        (reference.trackId && reference.track?.tournament.userId !== userId) ||
        (reference.tournamentId && reference.tournament?.userId !== userId)) throw new StudioError("ASSET_NOT_FOUND");
    for (const [key, file] of Object.entries(assets.files)) {
      if (assets.manifest[key]?.hash !== file.hash || await fileHash(await safeFile(file.path)) !== file.hash)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      if (file.posterPath && await fileHash(await safeFile(file.posterPath)) !== file.posterHash)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    }
    if (Object.keys(assets.manifest).some(key => !assets.files[key])) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    await verifyTypographyFonts(plan.fonts, assets.fontFiles);
    const origin: InspectionOrigin = { projectId, version: null, revision: input.revision,
      documentHash: hash(canonical(parsed.data)),
      contentHash: hash(canonical({ document: parsed.data,
        assets: Object.entries(assets.manifest).map(([key, asset]) => [key, asset.hash]),
        fonts: plan.fonts?.map(font => font.hash) ?? [] })),
      format: { width: plan.width, height: plan.height, fps: plan.fps } };
    const content = { projectId, revisionId: revision.id, revision: revision.revision,
      sourceVersion: revision.sourceVersion, document: parsed.data, ...assets, plan, validation };
    const frozen: StudioFrozenRevision = { ...content, snapshotId: randomUUID(), hash: hash(canonical(content)) };
    return { ...assets, fontFiles: assets.fontFiles ?? {}, validation, plan, document: parsed.data, origin, frozen, projectVersion: current.version, pinned: false };
  }
  const parsed = videoDocumentSchema.safeParse(value);
  if (!parsed.success) throw new StudioError("VALIDATION_FAILED", [{ severity: "error", code: "SCHEMA_INVALID", path: "document", message: "Текущий документ не проходит схему. Исправьте JSON; старое превью не используется." }]);
  const evaluated = await evaluate(userId, parsed.data, directory);
  if (!evaluated.plan || !evaluated.resolvedDocument || evaluated.validation.diagnostics.some(d => d.severity === "error" && d.code !== "TEXT_OVERFLOW"))
    throw new StudioError("VALIDATION_FAILED", evaluated.validation.diagnostics.slice(0, 100));
  const after = await owned(userId, projectId);
  if (input.revision === undefined && after.version !== current.version) throw new StudioError("VERSION_CONFLICT");
  const origin: InspectionOrigin = {
    projectId, version: input.revision === undefined ? current.version : null,
    revision: input.revision ?? null, documentHash: hash(canonical(parsed.data)),
    contentHash: hash(canonical({ document: parsed.data,
      assets: Object.entries(evaluated.manifest).map(([key, a]) => [key, a.hash]),
      fonts: evaluated.plan.fonts?.map(f => f.hash) ?? [] })),
    format: { width: evaluated.plan.width, height: evaluated.plan.height, fps: evaluated.plan.fps },
  };
  const content = { projectId, revisionId, revision: input.revision ?? 0,
    sourceVersion: parsed.data.source.version ?? null, document: parsed.data,
    resolvedDocument: evaluated.resolvedDocument, manifest: evaluated.manifest,
    files: evaluated.files, fontFiles: evaluated.fontFiles, plan: evaluated.plan,
    validation: evaluated.validation, runtime };
  const frozen: StudioFrozenRevision = { ...content, snapshotId: randomUUID(), hash: hash(canonical(content)) };
  return { ...evaluated, plan: evaluated.plan, document: parsed.data, origin, frozen, projectVersion: current.version, pinned: false };
}

function summaryOf(input: InspectionJobInput): InspectionSummary { return input.summary; }
export function inspectionInput(value: string): InspectionJobInput | undefined {
  const parsed = JSON.parse(value);
  return parsed?.inspectionVersion === 1 ? parsed as InspectionJobInput : undefined;
}
export function inspectionSummary(value: string): InspectionSummary | undefined {
  const input = inspectionInput(value);
  return input ? summaryOf(input) : undefined;
}

/** Reads one immutable inspection root for storyboard, review and deep sampling. */
export async function loadPinnedInspectionProject(userId: string, projectId: string, sourceJobId: string,
  assertions: { expectedVersion?: number; revision?: number } = {}): Promise<{
    prepared: Awaited<ReturnType<typeof loadInspectionProject>>; engineId: string;
    summary: InspectionSummary; input: InspectionJobInput;
  }> {
  const expected = originInput.parse(assertions), current = await owned(userId, projectId);
  const source = await ownedJob(userId, sourceJobId);
  let saved: InspectionJobInput | undefined;
  try { saved = inspectionInput(source.inputJson); } catch { /* Explicit refusal below. */ }
  if (source.projectId !== projectId || !["storyboard", "clip", "audio"].includes(source.kind) ||
    !saved || saved.render.kind !== source.kind) throw new StudioError("INSPECTION_SOURCE_NOT_FOUND");
  const verifyPinned = async (frozen: StudioFrozenRevision, origin: InspectionOrigin) => {
    if (!frozen || !origin || frozen.projectId !== projectId || origin.projectId !== projectId) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    const { snapshotId: _, hash: expected, ...content } = frozen;
    if (hash(canonical(content)) !== expected || origin.documentHash !== hash(canonical(frozen.document)) ||
      origin.contentHash !== hash(canonical({ document: frozen.document,
        assets: Object.entries(frozen.manifest).map(([key, asset]) => [key, asset.hash]), fonts: frozen.plan.fonts?.map(font => font.hash) ?? [] })))
      throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    for (const file of Object.values(frozen.files)) {
      if (await fileHash(await safeFile(file.path)) !== file.hash ||
        file.posterPath && await fileHash(await safeFile(file.posterPath)) !== file.posterHash) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    }
    await verifyTypographyFonts(frozen.plan.fonts, frozen.fontFiles);
  };
  await verifyPinned(saved.frozen, saved.origin);
  if (canonical(saved.summary.origin) !== canonical(saved.origin)) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
  if (expected.expectedVersion !== undefined && expected.expectedVersion !== saved.origin.version ||
    expected.revision !== undefined && expected.revision !== saved.origin.revision) throw new StudioError("VERSION_CONFLICT");
  if (saved.compareFrozen || saved.summary.compareOrigin) {
    if (!saved.compareFrozen || !saved.summary.compareOrigin) throw new StudioError("COMPARISON_NOT_FOUND");
    await verifyPinned(saved.compareFrozen, saved.summary.compareOrigin);
  }
  const frozen = saved.frozen;
  const prepared: Awaited<ReturnType<typeof loadInspectionProject>> = { document: frozen.document,
    resolvedDocument: frozen.resolvedDocument, plan: frozen.plan, manifest: frozen.manifest, files: frozen.files,
    fontFiles: frozen.fontFiles ?? {}, validation: frozen.validation, origin: saved.origin, frozen,
    projectVersion: current.version, pinned: true };
  return { prepared, engineId: source.engineId, summary: saved.summary, input: saved };
}

async function copyFrozen(frozen: StudioFrozenRevision, directory: string) {
  const result = structuredClone(frozen);
  await mkdir(absPath(directory), { recursive: true });
  if (result.plan.fonts?.length && !Object.keys(result.fontFiles ?? {}).length)
    result.fontFiles = await freezeTypographyFonts(result.plan.fonts, `${directory}/typography`);
  for (const file of [...Object.values(result.files), ...Object.values(result.fontFiles ?? {})]) {
    for (const part of ["", "poster"] as const) {
      const sourcePath = part ? file.posterPath : file.path;
      const digest = part ? file.posterHash : file.hash;
      if (!sourcePath || !digest) continue;
      const source = await safeFile(sourcePath);
      if (await fileHash(source) !== digest) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      const destination = `${directory}/${digest}${path.extname(source)}`;
      await copyFile(source, absPath(destination));
      if (part) file.posterPath = destination; else file.path = destination;
    }
  }
  const { snapshotId: _, hash: __, ...content } = result;
  result.hash = hash(canonical(content));
  return result;
}

/** One durable operation for an entire page; cached retries return current job status. */
export async function startStudioStoryboard(userId: string, projectId: string, raw: StoryboardInput = {}): Promise<StudioJobView> {
  let input = storyboardSchema.parse(raw);
  await owned(userId, projectId);
  const request = requestHash(`storyboard:${projectId}`, input);
  const previous = await replay<{ jobId: string }>(prisma, userId, input.idempotencyKey, request);
  if (previous && !input.sourceJobId) return jobView(await ownedJob(userId, previous.jobId));
  let prepared: Awaited<ReturnType<typeof loadInspectionProject>>, engineId: string;
  let comparison: { frozen: StudioFrozenRevision; origin: InspectionOrigin } | undefined;
  if (input.sourceJobId) {
    const pinned = await loadPinnedInspectionProject(userId, projectId, input.sourceJobId,
      { expectedVersion: input.expectedVersion, revision: input.revision });
    const saved = pinned.input;
    if (saved.render.kind !== "storyboard") throw new StudioError("INSPECTION_SOURCE_NOT_FOUND");
    const scope = saved.summary.scope;
    input = { ...input, mode: raw.mode ?? scope?.mode ?? (saved.compareFrozen ? "compare" : "overview"),
      sceneId: raw.sceneId ?? scope?.sceneId, segmentId: raw.segmentId ?? scope?.segmentId, pageSize: raw.pageSize ?? scope?.pageSize ?? input.pageSize,
      pixelDiff: raw.pixelDiff ?? scope?.pixelDiff };
    if (input.mode === "scene" && !input.sceneId) throw new StudioError("INSPECTION_SCOPE_INVALID");
    if (input.mode === "compare") {
      if (!saved.compareFrozen || !saved.summary.compareOrigin) throw new StudioError("COMPARISON_NOT_FOUND");
      comparison = { frozen: saved.compareFrozen, origin: saved.summary.compareOrigin };
    }
    prepared = pinned.prepared;
    engineId = pinned.engineId;
    if (previous) return jobView(await ownedJob(userId, previous.jobId));
  } else {
    prepared = await loadInspectionProject(userId, projectId, { expectedVersion: input.expectedVersion, revision: input.revision });
    engineId = await prepareStudioEngine();
  }
  if (input.pixelDiff !== undefined && input.mode !== "compare") throw new StudioError("PIXEL_DIFF_REQUIRES_COMPARE");
  if (input.mode === "compare" && input.pageSize < (input.pixelDiff ? 3 : 2)) throw new StudioError("STORYBOARD_BUDGET_EXCEEDED");
  const options = { mode: input.sceneId ? "scene" as const : "overview" as const, sceneId: input.sceneId, segmentId: input.segmentId, page: input.page, pageSize: input.pageSize };
  if (input.compareJobId) {
    const other = await ownedJob(userId, input.compareJobId);
    const previousInput = inspectionInput(other.inputJson);
    if (other.projectId !== projectId || !previousInput) throw new StudioError("COMPARISON_NOT_FOUND");
    comparison = { frozen: previousInput.frozen, origin: previousInput.origin };
  } else if (input.compareRevision) {
    const before = await loadInspectionProject(userId, projectId, { revision: input.compareRevision });
    comparison = { frozen: before.frozen, origin: before.origin };
  }
  let selection = selectStoryboard(prepared.plan, options);
  let tiles: StoryboardRenderInput["tiles"] = selection.tiles.map(t => ({ ...t, source: 0 }));
  if (comparison) {
    const matches = matchStoryboard(comparison.frozen.plan, prepared.plan, { ...options, pageSize: Math.floor(input.pageSize / (input.pixelDiff ? 3 : 2)) });
    tiles = matches.pairs.flatMap(pair => [
      { ...(pair.before ?? pair.after!), id: `${pair.id}:before`, side: "before" as const, source: 1, missing: !pair.before },
      { ...(pair.after ?? pair.before!), id: `${pair.id}:after`, side: "after" as const, source: 0, missing: !pair.after },
      ...(input.pixelDiff ? [{ ...(pair.after ?? pair.before!), id: `${pair.id}:diff`, side: "diff" as const, source: 2, missing: !pair.before || !pair.after }] : []),
    ]);
    selection = { ...selection, tiles, totalScenes: matches.totalScenes, totalTiles: matches.totalPairs * (input.pixelDiff ? 3 : 2), totalPages: matches.totalPages,
      scenesCovered: matches.scenesCovered, remainingScenes: matches.remainingScenes };
  }
  if (!tiles.length) throw new StudioError("STORYBOARD_EMPTY");
  const summary: InspectionSummary = { origin: prepared.origin, selection,
    scope: { mode: comparison ? "compare" : input.sceneId ? "scene" : "overview", pageSize: input.pageSize,
      ...(input.sceneId ? { sceneId: input.sceneId } : {}), ...(input.segmentId ? { segmentId: input.segmentId } : {}),
      ...(input.pixelDiff !== undefined ? { pixelDiff: input.pixelDiff } : {}) },
    ...(comparison ? { compareOrigin: comparison.origin,
      comparison: compareStoryboardDocuments({ document: comparison.frozen.document, plan: comparison.frozen.plan,
        manifest: comparison.frozen.manifest, diagnostics: comparison.frozen.validation.diagnostics },
      { document: prepared.document, plan: prepared.plan, manifest: prepared.manifest, diagnostics: prepared.validation.diagnostics }) } : {}),
    ...(!prepared.validation.ready ? { diagnostic: { ready: false as const, codes: [...new Set(prepared.validation.diagnostics.filter(d => d.severity === "error").map(d => d.code))] } } : {}) };
  const render: StoryboardRenderInput = { kind: "storyboard", tiles, summary };
  return enqueueInspection(userId, projectId, prepared, engineId, render, summary,
    { key: input.idempotencyKey, request, comparison, sourceJobId: input.sourceJobId });
}

export async function enqueueInspection(userId: string, projectId: string,
  prepared: Awaited<ReturnType<typeof loadInspectionProject>>, engineId: string,
  render: InspectionJobInput["render"], summary: InspectionSummary,
  options: { key?: string; request?: string; comparison?: { frozen: StudioFrozenRevision; origin: InspectionOrigin }; sourceJobId?: string } = {}) {
  const cacheKey = requestHash("inspection-cache", { projectId, origin: prepared.origin,
    engineId, render, comparison: options.comparison?.origin });
  const key = `inspect:${cacheKey}`;
  const cached = await prisma.studioMutation.findUnique({ where: { userId_key: { userId, key } } });
  if (cached) {
    const old = await prisma.studioJob.findFirst({ where: { id: JSON.parse(cached.resultJson).jobId, userId, projectId, status: { in: ["queued", "running", "done"] } } });
    if (old) {
      if (options.key && options.request) await prisma.$transaction(async db => {
        if (!await replay(db, userId, options.key, options.request!)) await receipt(db, userId, options.key, options.request!, { jobId: old.id });
      });
      return jobView(old);
    }
  }
  const user = await actor(userId);
  await assertStudioJobQuota(userId, user.role);
  if (await prisma.studioJob.count({ where: { userId, status: { in: activeJobStatuses } } }) >= studioJobLimits.maxActivePerAccount) throw new StudioError("JOB_QUOTA_EXCEEDED");
  const id = randomUUID(), directory = jobDirectory(userId, id);
  let saved = false;
  try {
    const frozen = await copyFrozen(prepared.frozen, `${directory}/inputs`);
    const compareFrozen = options.comparison ? await copyFrozen(options.comparison.frozen, `${directory}/before-inputs`) : undefined;
    const wrapper: InspectionJobInput = { inspectionVersion: 1, frozen, ...(compareFrozen ? { compareFrozen } : {}), origin: prepared.origin, summary, render, cacheKey };
    if ([...Object.values(frozen.files), ...Object.values(frozen.fontFiles ?? {}), ...Object.values(compareFrozen?.files ?? {}), ...Object.values(compareFrozen?.fontFiles ?? {})].reduce((n, f) => n + f.bytes + (f.posterBytes ?? 0), 0) > studioJobLimits.maxInputBytes) throw new StudioError("INPUT_BUDGET_EXCEEDED");
    return await prisma.$transaction(async db => {
      const current = await owned(userId, projectId, db);
      if (options.sourceJobId && (await ownedJob(userId, options.sourceJobId, db)).projectId !== projectId)
        throw new StudioError("INSPECTION_SOURCE_NOT_FOUND");
      if (!prepared.pinned && prepared.origin.revision === null && current.version !== prepared.projectVersion) throw new StudioError("VERSION_CONFLICT");
      if (options.key && options.request) {
        const replayed = await replay<{ jobId: string }>(db, userId, options.key, options.request);
        if (replayed) return jobView(await ownedJob(userId, replayed.jobId, db), db);
      }
      const cache = await db.studioMutation.findUnique({ where: { userId_key: { userId, key } } });
      if (cache) {
        const row = await db.studioJob.findFirst({ where: { id: JSON.parse(cache.resultJson).jobId, userId, projectId, status: { in: ["queued", "running", "done"] } } });
        if (row) {
          if (options.key && options.request) await receipt(db, userId, options.key, options.request, { jobId: row.id });
          return jobView(row, db);
        }
      }
      const freshUser = await actor(userId, db);
      await assertStudioJobQuota(userId, freshUser.role, db);
      if (await db.studioJob.count({ where: { userId, status: { in: activeJobStatuses } } }) >= studioJobLimits.maxActivePerAccount) throw new StudioError("JOB_QUOTA_EXCEEDED");
      const row = await db.studioJob.create({ data: { id, userId, projectId, kind: render.kind, engineId, inputJson: JSON.stringify(wrapper) } });
      await db.studioMutation.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, requestHash: cacheKey, resultJson: JSON.stringify({ jobId: id }) }, update: { requestHash: cacheKey, resultJson: JSON.stringify({ jobId: id }) } });
      if (options.key && options.request) await receipt(db, userId, options.key, options.request, { jobId: id });
      saved = true;
      return jobView(row, db);
    });
  } finally { if (!saved) await cleanupDirectory(directory); }
}

export async function getStoryboardFrame(userId: string, jobId: string, frameId: string) {
  const job = await ownedJob(userId, jobId);
  if (!/^\d{1,3}$/.test(frameId)) throw new StudioError("NOT_FOUND");
  if (job.status !== "done" || !job.resultJson || !job.leaseToken) throw new StudioError("RESULT_NOT_READY");
  const result = JSON.parse(job.resultJson) as import("./job-types").StudioJobResult;
  const frame = result.storyboard?.frames.find(f => f.id === frameId);
  if (!frame || frame.name !== path.basename(frame.name)) throw new StudioError("NOT_FOUND");
  const file = await safeFile(`${jobDirectory(userId, jobId)}/attempts/${job.leaseToken}/${frame.name}`);
  if (await fileHash(file) !== frame.hash) throw new StudioError("RESULT_HASH_MISMATCH");
  return { path: file, mimeType: "image/png", name: frame.name, bytes: frame.bytes, hash: frame.hash };
}
