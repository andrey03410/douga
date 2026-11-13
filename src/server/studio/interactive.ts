import "server-only";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  INTERACTIVE_SNAPSHOT_FORMAT,
  interactiveSnapshotHash,
  type AssetManifest,
  type CompiledVideo,
  type InteractiveSnapshot,
  type InteractiveSnapshotFile,
  type InteractiveSnapshotScene,
} from "@douga/video";
import { compiledMediaUsages } from "@douga/video/compiled-media";
import { runtimeFontAssets } from "@douga/node";
import { REMOTION_VERSION } from "@douga/render/version";
import { StudioError } from "./errors";
import { freezeStudioProject } from "./revisions";
import { getStudioProject } from "./projects";
import { releaseSnapshotIfFree } from "./snapshots";
import { safeFile } from "./assets";
import { jobDirectory } from "./jobs";
import { startStudioStoryboard } from "./storyboard";
import { streamStudioFile, studioMimeType } from "./http-media";
import { actor, hash, owned, receipt, replay, requestHash, type Db } from "./shared";
import type { StudioFrozenRevision } from "./types";
import type { StudioJobResult } from "./job-types";

/** Version of the @douga/* packages contract a host links against. */
export const DOUGA_PACKAGES_VERSION = "douga-packages@1";
const FONT_DIRECTORY = path.resolve("public/fonts/typography-v1");
const PUBLIC_FILE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;
const INDEX_LIMIT = 16;

export const publishInteractiveSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type PublishInteractiveInput = z.input<typeof publishInteractiveSchema>;

export interface InteractivePublicationView {
  projectId: string;
  token: string;
  revision: number;
  title: string;
  status: "preparing" | "ready";
  /** Scene stills: absent while the storyboard job runs, or when it failed. */
  stills: "pending" | "ready" | "missing";
  scenes: number;
  manifestUrl: string;
  createdAt: string;
  updatedAt: string;
  updated: boolean;
}

interface Row {
  projectId: string;
  userId: string;
  token: string;
  revision: number;
  snapshotId: string;
  stillJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function interactiveBaseUrl(): string {
  return (process.env.DOUGA_PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function interactiveManifestUrl(token: string): string {
  return `${interactiveBaseUrl()}/api/interactive/${encodeURIComponent(token)}/manifest`;
}

async function stillState(db: Db, row: Pick<Row, "stillJobId">) {
  if (!row.stillJobId) return { stills: "missing" as const, job: null };
  const job = await db.studioJob.findUnique({ where: { id: row.stillJobId } });
  if (!job) return { stills: "missing" as const, job: null };
  if (job.status === "queued" || job.status === "running") return { stills: "pending" as const, job };
  if (job.status === "done" && job.resultJson && job.leaseToken) return { stills: "ready" as const, job };
  return { stills: "missing" as const, job: null };
}

async function frozenOf(db: Db, snapshotId: string): Promise<StudioFrozenRevision> {
  const snapshot = await db.studioSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  return JSON.parse(snapshot.payloadJson) as StudioFrozenRevision;
}

async function present(db: Db, row: Row, updated: boolean): Promise<InteractivePublicationView> {
  const frozen = await frozenOf(db, row.snapshotId);
  const { stills } = await stillState(db, row);
  return {
    projectId: row.projectId,
    token: row.token,
    revision: row.revision,
    title: frozen.document.title,
    status: stills === "pending" ? "preparing" : "ready",
    stills,
    scenes: frozen.plan.interaction?.scenes.length ?? 0,
    manifestUrl: interactiveManifestUrl(row.token),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updated,
  };
}

async function lockProject(db: Db, userId: string, projectId: string) {
  const locked = await db.$executeRaw`
    UPDATE "StudioProject" SET "id" = "id" WHERE "id" = ${projectId} AND "userId" = ${userId}
  `;
  if (locked !== 1) throw new StudioError("NOT_FOUND");
}

export async function getInteractivePublication(
  userId: string,
  projectId: string,
): Promise<InteractivePublicationView | null> {
  await owned(userId, projectId);
  const row = await prisma.studioInteractivePublication.findUnique({ where: { projectId } });
  return row ? present(prisma, row, false) : null;
}

export async function listInteractivePublications(userId: string) {
  await actor(userId);
  const rows = await prisma.studioInteractivePublication.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(rows.map((row) => present(prisma, row, false)));
}

/** Test seam: integration tests skip the storyboard engine. */
export const interactiveTestHooks: { stills: boolean } = { stills: true };

/** Stills of interactive scenes come from one storyboard page of the frozen revision. */
async function startStills(userId: string, projectId: string, revision: number): Promise<string | null> {
  if (!interactiveTestHooks.stills) return null;
  try {
    const job = await startStudioStoryboard(userId, projectId, { revision, pageSize: 24 });
    return job.id;
  } catch (error) {
    // No stills is a degraded snapshot, not a failed publication.
    console.warn("Interactive stills were not started", error instanceof StudioError ? error.code : error);
    return null;
  }
}

/** Publish the latest saved revision as an interactive snapshot, or move the link onto it. */
export async function publishInteractive(
  userId: string,
  projectId: string,
  raw: PublishInteractiveInput = {},
): Promise<InteractivePublicationView> {
  const input = publishInteractiveSchema.parse(raw);
  const request = requestHash(`interactive-publish:${projectId}`, input);
  const replayed = await replay<InteractivePublicationView>(prisma, userId, input.idempotencyKey, request);
  if (replayed) return replayed;
  const project = await getStudioProject(userId, projectId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== project.version)
    throw new StudioError("VERSION_CONFLICT");
  if (!project.document?.interactive) throw new StudioError("INTERACTIVE_LAYER_MISSING");
  const existing = await prisma.studioInteractivePublication.findUnique({ where: { projectId } });
  if (existing && existing.revision === project.revision) {
    // Same revision: only the stills can be redone (their job failed, was cancelled or deleted).
    if ((await stillState(prisma, existing)).stills === "missing") {
      const stillJobId = await startStills(userId, projectId, existing.revision);
      await prisma.studioInteractivePublication.updateMany({
        where: { projectId, snapshotId: existing.snapshotId },
        data: { stillJobId },
      });
    }
    const fresh = await prisma.studioInteractivePublication.findUnique({ where: { projectId } });
    if (!fresh) throw new StudioError("NOT_FOUND");
    const same = await present(prisma, fresh, false);
    await prisma.$transaction(async (db) => {
      if (!(await replay(db, userId, input.idempotencyKey, request)))
        await receipt(db, userId, input.idempotencyKey, request, same);
    });
    return same;
  }
  const internalKey = input.idempotencyKey
    ? `interactive-freeze:${hash(`${userId}:${input.idempotencyKey}:${project.revision}`)}`
    : undefined;
  const frozen = await freezeStudioProject(userId, projectId, {
    expectedVersion: project.version,
    revision: project.revision,
    idempotencyKey: internalKey,
  });
  if (!frozen.resolvedDocument.interactive || !frozen.plan.interaction) {
    await prisma.$transaction((db) => releaseSnapshotIfFree(frozen.snapshotId, db));
    throw new StudioError("INTERACTIVE_LAYER_MISSING");
  }
  let result: InteractivePublicationView;
  let stale = false;
  try {
    result = await prisma.$transaction(async (db) => {
      await lockProject(db, userId, projectId);
      const again = await replay<InteractivePublicationView>(db, userId, input.idempotencyKey, request);
      if (again) return again;
      await owned(userId, projectId, db);
      const current = await db.studioInteractivePublication.findUnique({ where: { projectId } });
      // A slower publish of an older revision never moves the link back.
      if (current && current.revision > frozen.revision) {
        stale = true;
        return present(db, current, false);
      }
      let row: Row;
      if (current) {
        row = await db.studioInteractivePublication.update({
          where: { id: current.id },
          data: { snapshotId: frozen.snapshotId, revision: frozen.revision, stillJobId: null },
        });
        if (current.snapshotId !== frozen.snapshotId) await releaseSnapshotIfFree(current.snapshotId, db);
      } else {
        row = await db.studioInteractivePublication.create({
          data: {
            projectId,
            userId,
            token: randomBytes(16).toString("base64url"),
            snapshotId: frozen.snapshotId,
            revision: frozen.revision,
          },
        });
      }
      return present(db, row, Boolean(current));
    });
  } finally {
    await prisma.$transaction(async (db) => {
      const released = await releaseSnapshotIfFree(frozen.snapshotId, db);
      if (released && internalKey) await db.studioMutation.deleteMany({ where: { userId, key: internalKey } });
    });
  }
  if (stale) return result;
  const stillJobId = await startStills(userId, projectId, frozen.revision);
  // Only onto the snapshot these stills were drawn from: a newer publish or an unpublish wins.
  await prisma.studioInteractivePublication.updateMany({
    where: { projectId, snapshotId: frozen.snapshotId },
    data: { stillJobId },
  });
  const row = await prisma.studioInteractivePublication.findUnique({ where: { projectId } });
  if (!row) throw new StudioError("NOT_FOUND");
  const view = await present(prisma, row, result.updated);
  await prisma.$transaction(async (db) => {
    if (!(await replay(db, userId, input.idempotencyKey, request)))
      await receipt(db, userId, input.idempotencyKey, request, view);
  });
  return view;
}

export async function unpublishInteractive(
  userId: string,
  projectId: string,
): Promise<{ removed: boolean; projectId: string }> {
  await owned(userId, projectId);
  return prisma.$transaction(async (db) => {
    await lockProject(db, userId, projectId);
    const row = await db.studioInteractivePublication.findUnique({ where: { projectId } });
    if (!row) return { removed: false, projectId };
    await db.studioInteractivePublication.delete({ where: { id: row.id } });
    await releaseSnapshotIfFree(row.snapshotId, db);
    return { removed: true, projectId };
  });
}

// ---- Snapshot by token -------------------------------------------------------------

interface SnapshotIndex {
  snapshot: InteractiveSnapshot;
  /** Public file name → stored absolute-or-storage path and its hash. */
  files: Map<string, { path: string; hash: string; absolute?: boolean }>;
}

const indexes = new Map<string, SnapshotIndex>();

const extOf = (file: string) => path.extname(file).toLowerCase() || ".bin";

/** Families a document can draw text with at runtime: the plan's faces plus their fallbacks. */
function planFamilies(plan: CompiledVideo): string[] {
  return [...new Set((plan.fonts ?? []).map((face) => face.font))];
}

async function buildIndex(row: Row): Promise<SnapshotIndex> {
  const frozen = await frozenOf(prisma, row.snapshotId);
  const files = new Map<string, { path: string; hash: string; absolute?: boolean }>();
  const listed: InteractiveSnapshotFile[] = [];
  const add = (name: string, entry: { path: string; hash: string; absolute?: boolean }, file: InteractiveSnapshotFile) => {
    if (files.has(name)) return;
    files.set(name, entry);
    listed.push(file);
  };

  // Media: manifest src becomes `<hash><ext>`, the name every host stores it under.
  const byHash = new Map(Object.values(frozen.files).map((file) => [file.hash, file]));
  const manifest: AssetManifest = structuredClone(frozen.manifest);
  for (const asset of Object.values(manifest)) {
    const file = asset.hash ? byHash.get(asset.hash) : undefined;
    if (!file) throw new StudioError("SNAPSHOT_MEDIA_UNKNOWN");
    const name = `${file.hash}${extOf(file.path)}`;
    add(name, { path: file.path, hash: file.hash }, { hash: file.hash, ext: extOf(file.path), bytes: file.bytes, kind: asset.kind });
    asset.src = name;
    if (asset.posterSrc) {
      if (!file.posterHash || !file.posterPath) throw new StudioError("SNAPSHOT_MEDIA_UNKNOWN");
      const poster = `${file.posterHash}${extOf(file.posterPath)}`;
      add(poster, { path: file.posterPath, hash: file.posterHash }, {
        hash: file.posterHash, ext: extOf(file.posterPath), bytes: file.posterBytes ?? 0, kind: "poster",
      });
      asset.posterSrc = poster;
    }
  }
  // The compiled plan also points at media the manifest does not list (built-in sounds).
  for (const usage of compiledMediaUsages(frozen.plan)) {
    if (usage.asset.hash && !byHash.has(usage.asset.hash) && !manifest[usage.asset.id])
      throw new StudioError("SNAPSHOT_MEDIA_UNKNOWN");
  }

  // Fonts: whole catalog faces of the plan's families, so new text measures and draws.
  const runtimeFonts: InteractiveSnapshot["runtimeFonts"] = [];
  for (const face of runtimeFontAssets(planFamilies(frozen.plan))) {
    runtimeFonts.push({ faceId: face.id, hash: face.hash });
    add(`${face.hash}.ttf`, { path: path.join(FONT_DIRECTORY, path.basename(face.src)), hash: face.hash, absolute: true }, {
      hash: face.hash, ext: ".ttf", bytes: face.bytes, kind: "font",
    });
    add(`${face.licenseHash}.txt`, { path: path.join(FONT_DIRECTORY, path.basename(face.license)), hash: face.licenseHash, absolute: true }, {
      hash: face.licenseHash, ext: ".txt", bytes: face.licenseBytes, kind: "font",
    });
  }

  // Stills: one storyboard frame per compiled scene the page covered.
  const stillByScene = new Map<string, string>();
  const { stills, job } = await stillState(prisma, row);
  if (stills === "pending") throw new StudioError("SNAPSHOT_NOT_READY");
  if (job?.resultJson && job.leaseToken) {
    const result = JSON.parse(job.resultJson) as StudioJobResult;
    for (const frame of result.storyboard?.frames ?? []) {
      if (frame.side || stillByScene.has(frame.sceneId) || frame.name !== path.basename(frame.name)) continue;
      const stored = `${jobDirectory(row.userId, job.id)}/attempts/${job.leaseToken}/${frame.name}`;
      add(`${frame.hash}.png`, { path: stored, hash: frame.hash }, { hash: frame.hash, ext: ".png", bytes: frame.bytes, kind: "still" });
      stillByScene.set(frame.sceneId, frame.hash);
    }
  }

  const plan = frozen.plan;
  const sceneById = new Map(plan.scenes.map((scene) => [scene.id, scene]));
  const scenes: InteractiveSnapshotScene[] = (plan.interaction?.scenes ?? []).map((scene) => {
    const compiled = sceneById.get(scene.id);
    const still = stillByScene.get(scene.id);
    return {
      id: scene.id,
      sourceSceneId: scene.sourceSceneId,
      ...(scene.segmentId ? { segmentId: scene.segmentId } : {}),
      title: [compiled?.segmentTitle, scene.participantId ?? scene.sourceSceneId].filter(Boolean).join(" · "),
      from: scene.from,
      to: scene.to,
      holds: scene.holds,
      choices: scene.choices.map((choice) => ({
        choiceId: choice.choiceId,
        ...(choice.cardId ? { cardId: choice.cardId } : {}),
        ...(choice.participantId ? { participantId: choice.participantId } : {}),
        ...(choice.label ? { label: choice.label } : {}),
      })),
      uses: scene.uses,
      ...(still ? { still } : {}),
    };
  });
  const layer = frozen.resolvedDocument.interactive!;
  const content: Omit<InteractiveSnapshot, "hash"> = {
    format: INTERACTIVE_SNAPSHOT_FORMAT,
    version: 1,
    contract: 1,
    engine: { remotion: REMOTION_VERSION, compilerVersion: plan.compilerVersion, packages: DOUGA_PACKAGES_VERSION },
    project: { id: row.projectId, title: frozen.document.title, revision: row.revision },
    document: frozen.resolvedDocument,
    manifest,
    files: listed,
    runtimeFonts,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    durationInFrames: plan.durationInFrames,
    scenes,
    segments: (plan.segments ?? []).map((segment) => ({
      id: segment.id,
      title: segment.title ?? segment.id,
      from: segment.from,
      to: segment.to,
    })),
    sample: layer.sample ?? {},
  };
  return { snapshot: { ...content, hash: await interactiveSnapshotHash(content) }, files };
}

async function indexByToken(token: string): Promise<SnapshotIndex | null> {
  if (!token || token.length > 64) return null;
  const row = await prisma.studioInteractivePublication.findUnique({ where: { token } });
  if (!row) return null;
  const key = `${row.snapshotId}:${row.stillJobId ?? ""}`;
  const cached = indexes.get(key);
  if (cached) return cached;
  const index = await buildIndex(row);
  if (indexes.size >= INDEX_LIMIT) indexes.delete(indexes.keys().next().value!);
  indexes.set(key, index);
  return index;
}

const publicJson = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
  });

/** GET /api/interactive/<token>/manifest */
export async function interactiveManifestResponse(token: string): Promise<Response> {
  try {
    const index = await indexByToken(token);
    if (!index) return publicJson({ error: "SNAPSHOT_NOT_FOUND" }, 404);
    return publicJson(index.snapshot);
  } catch (error) {
    if (error instanceof StudioError && error.code === "SNAPSHOT_NOT_READY")
      return publicJson({ error: "SNAPSHOT_NOT_READY" }, 409);
    console.error("Interactive manifest failed", error);
    return publicJson({ error: "INTERNAL_ERROR" }, 500);
  }
}

/** GET|HEAD /api/interactive/<token>/files/<hash><ext> */
export async function interactiveFileResponse(token: string, fileName: string, req: Request): Promise<Response> {
  const name = fileName.toLowerCase();
  if (!PUBLIC_FILE.test(name)) return new Response(null, { status: 404 });
  try {
    const file = (await indexByToken(token))?.files.get(name);
    if (!file) return new Response(null, { status: 404 });
    return await streamStudioFile(req, {
      path: file.absolute ? file.path : await safeFile(file.path),
      mimeType: name.endsWith(".ttf") ? "font/ttf" : name.endsWith(".txt") ? "text/plain; charset=utf-8" : studioMimeType(name),
      hash: file.hash,
      immutable: true,
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
