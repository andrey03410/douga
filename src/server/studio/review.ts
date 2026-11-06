import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { compileVideo, patchVideoDocument } from "@/video";
import { reviewVideo, type VideoReviewReport } from "@/video/video-review";
import { selectStoryboard } from "@/video/storyboard";
import { loadInspectionProject, loadPinnedInspectionProject, enqueueInspection } from "./storyboard";
import { canonical, hash, owned, replay, requestHash } from "./shared";
import { transformStudioDraft } from "./projects";
import { getTypographyMeasureText } from "./typography-fonts";
import { prepareStudioEngine } from "./engine";
import { jobView } from "./jobs";
import { StudioError } from "./errors";
import type { StudioProjectView } from "./types";

const profileSchema = z.object({
  safeArea: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }).strict().optional(),
  minReadableSec: z.number().min(.1).max(30).optional(),
  charactersPerSecond: z.number().min(1).max(100).optional(),
}).strict();
export const studioReviewSchema = z.object({
  expectedVersion: z.number().int().positive().optional(), revision: z.number().int().positive().optional(),
  sourceJobId: z.string().min(1).max(4096).optional(),
  mode: z.enum(["quick", "deep"]).default("quick"),
  sceneId: z.string().min(1).max(4096).optional(),
  segmentId: z.string().min(1).max(200).optional(),
  frame: z.number().int().min(0).max(2_147_483_647).optional(),
  profile: profileSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.number().int().min(0).max(100000).default(0),
}).strict();
export const applyStudioReviewSchema = z.object({
  expectedVersion: z.number().int().positive(), reportId: z.string().regex(/^[a-f0-9]{64}$/),
  suggestionIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  profile: profileSchema.optional(), idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
const reportIdentity = (origin: unknown, profile: unknown) => hash(canonical({ origin, profile: profile ?? {}, version: 1 }));

async function effectiveSuggestions(prepared: Awaited<ReturnType<typeof loadInspectionProject>>,
  candidates: VideoReviewReport["suggestions"], profile: z.infer<typeof profileSchema> | undefined) {
  const verified: VideoReviewReport["suggestions"] = [];
  const measureText = candidates.length ? await getTypographyMeasureText() : undefined;
  const oldErrors = new Set(prepared.validation.diagnostics.filter(d => d.severity === "error").map(d => `${d.code}:${d.path}:${d.nodeId ?? ""}`));
  for (const suggestion of candidates) {
    const document = patchVideoDocument(prepared.document, suggestion.operations);
    if (canonical(document) === canonical(prepared.document)) continue;
    const result = compileVideo(document, prepared.manifest, { measureText });
    if (result.diagnostics.some(d => d.severity === "error" && !oldErrors.has(`${d.code}:${d.path}:${d.nodeId ?? ""}`))) continue;
    const after = reviewVideo(result.plan, result.diagnostics, document, profile);
    if (suggestion.issueIds.some(id => after.issues.some(i => i.id === id))) continue;
    verified.push(suggestion);
  }
  return verified;
}

export async function reviewStudioVideo(userId: string, projectId: string, raw: z.input<typeof studioReviewSchema> = {}) {
  const input = studioReviewSchema.parse(raw);
  if (input.mode !== "deep" && (input.sceneId !== undefined || input.segmentId !== undefined || input.frame !== undefined))
    throw new StudioError("REVIEW_SCOPE_REQUIRES_DEEP");
  const pinned = input.sourceJobId ? await loadPinnedInspectionProject(userId, projectId, input.sourceJobId,
    { expectedVersion: input.expectedVersion, revision: input.revision }) : undefined;
  if (pinned && pinned.input.render.kind !== "storyboard") throw new StudioError("INSPECTION_SOURCE_INVALID");
  const prepared = pinned?.prepared ?? await loadInspectionProject(userId, projectId, { expectedVersion: input.expectedVersion, revision: input.revision });
  const originArguments = input.sourceJobId ? { sourceJobId: input.sourceJobId }
    : prepared.origin.revision ? { revision: prepared.origin.revision } : { expectedVersion: prepared.origin.version };
  const report = reviewVideo(prepared.plan, prepared.validation.diagnostics, prepared.document, input.profile);
  const reportId = reportIdentity(prepared.origin, input.profile);
  const issues = report.issues.slice(input.cursor, input.cursor + input.limit);
  const issueIds = new Set(issues.map(i => i.id));
  const candidates = report.suggestions.filter(s => s.issueIds.some(id => issueIds.has(id)));
  const suggestions = await effectiveSuggestions(prepared, candidates.slice(0, 20), input.profile);
  const returnedIssues = issues.map(issue => ({ ...issue,
    suggestionIds: issue.suggestionIds?.filter(id => suggestions.some(s => s.id === id)) }));
  const jobs = input.mode === "deep" ? await deepReviewJobs(userId, projectId, prepared, input, pinned?.engineId) : [];
  const firstSuggestion = suggestions.find(s => s.issueIds.some(id => report.issues.some(i => i.id === id && i.severity !== "info")));
  const nextAction = firstSuggestion && prepared.origin.version !== null
    ? { tool: "video_review_apply", arguments: { projectId, expectedVersion: prepared.origin.version, reportId,
      suggestionIds: [firstSuggestion.id], ...(input.profile ? { profile: input.profile } : {}) }, title: firstSuggestion.title }
    : issues[0]?.nextAction?.type === "clip" && input.mode !== "deep"
      ? { tool: "video_review", arguments: { projectId, mode: "deep", sceneId: issues[0].sceneId,
        segmentId: issues[0].segmentId, frame: issues[0].frame,
        ...originArguments }, title: "Проверить этот момент в движении" }
    : issues[0]?.nextAction?.type === "text_inspect" && !input.sourceJobId && prepared.origin.revision === null
      ? { tool: "video_text_inspect", arguments: { projectId, expectedVersion: prepared.projectVersion,
        ...(issues[0].nodeId ? { nodeId: issues[0].nodeId } : {}) }, title: "Посмотреть измерения текста" }
      : !report.issues.some(i => i.severity !== "info") && input.mode === "quick"
        ? { tool: "video_review", arguments: { projectId, ...originArguments, mode: "deep" }, title: "Проверить движение и звук выбранных окон" }
      : { tool: "video_storyboard", arguments: { projectId, ...originArguments,
        ...(issues[0]?.sceneId ? { mode: "scene", sceneId: issues[0].sceneId } : {}) }, title: "Посмотреть ключевые состояния" };
  const completed = jobs.filter(j => j.status === "done");
  return {
    projectId, reportId, origin: prepared.origin, ready: prepared.validation.ready, sourceJobId: input.sourceJobId,
    checked: "static-plan" as const, coverage: report.coverage,
    checks: report.checks.map(c => ({ ...c, id: c.code })),
    totalIssues: report.issues.length, issues: returnedIssues, suggestions,
    counts: { errors: report.issues.filter(i => i.severity === "error").length,
      warnings: report.issues.filter(i => i.severity === "warning").length, suggestions: suggestions.length },
    suggestionsPending: Math.max(0, candidates.length - 20),
    nextCursor: input.cursor + issues.length < report.issues.length ? input.cursor + issues.length : null,
    nextAction,
    deep: { requested: input.mode === "deep", scope: { sceneId: input.sceneId, segmentId: input.segmentId, frame: input.frame },
      blockedReason: input.mode === "deep" && !prepared.validation.ready ? "VALIDATION_FAILED" : null,
      jobs: jobs.map(j => ({ id: j.id, kind: j.kind, status: j.status,
      inspect: { tool: "video_job_inspect", arguments: { jobId: j.id } }, measurements: j.result && "measurements" in j.result ? j.result.measurements : undefined })),
      sampledScenes: [...new Set(completed.flatMap(j => j.inspection?.selection.tiles.map(t => t.sceneId) ?? []))],
      totalScenes: prepared.plan.scenes.length,
      assessment: "Клипы проверяют рендер и декодирование выбранных окон. Плавность и художественное качество требуют просмотра; звук — прослушивания." },
  };
}

async function deepReviewJobs(userId: string, projectId: string, prepared: Awaited<ReturnType<typeof loadInspectionProject>>,
  input: z.infer<typeof studioReviewSchema>, pinnedEngineId?: string) {
  if (!prepared.validation.ready) return [];
  const selection = selectStoryboard(prepared.plan, { pageSize: 24 });
  const scoped = input.sceneId !== undefined || input.segmentId !== undefined || input.frame !== undefined;
  const scenes = prepared.plan.scenes.filter(scene =>
    (input.sceneId === undefined || scene.id === input.sceneId)
    && (input.segmentId === undefined || scene.segmentId === input.segmentId)
    && (input.frame === undefined || (scene.from <= input.frame && input.frame < scene.from + scene.durationInFrames)));
  if (scoped && !scenes.length) throw new StudioError("REVIEW_SCENE_NOT_FOUND");
  if (input.sceneId && !input.segmentId && scenes.length > 1) throw new StudioError("REVIEW_SCENE_AMBIGUOUS");
  const chosen = [...new Set([0, Math.floor(scenes.length / 2), scenes.length - 1])]
    .filter(i => i >= 0 && scenes[i]).flatMap(i => selectStoryboard(prepared.plan,
      { sceneId: scenes[i].id, segmentId: scenes[i].segmentId, pageSize: 1 }).tiles);
  const engine = pinnedEngineId ?? await prepareStudioEngine();
  const jobs = [];
  // Leave one account slot free for another storyboard. Each clip includes audio.
  for (const tile of chosen) {
    const scene = prepared.plan.scenes.find(s => s.id === tile.sceneId && s.segmentId === tile.segmentId)!;
    const durationFrames = Math.min(scene.durationInFrames, prepared.plan.fps * 15);
    const focus = input.frame ?? tile.frame;
    const fromFrame = Math.max(scene.from, Math.min(focus - prepared.plan.fps * 2, scene.from + scene.durationInFrames - durationFrames));
    try {
      const one = { ...selection, tiles: [tile], scenesCovered: 1, remainingScenes: Math.max(0, selection.totalScenes - 1) };
      jobs.push(await enqueueInspection(userId, projectId, prepared, engine, { kind: "clip", fromFrame, durationFrames }, { origin: prepared.origin, selection: one },
        input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}));
    } catch (error) {
      if (error instanceof StudioError && error.code === "JOB_QUOTA_EXCEEDED") break;
      throw error;
    }
  }
  return jobs;
}

export async function applyStudioReview(userId: string, projectId: string, raw: z.input<typeof applyStudioReviewSchema>) {
  const input = applyStudioReviewSchema.parse(raw);
  await owned(userId, projectId);
  const mutation = { expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey,
    identity: { action: "review", reportId: input.reportId, suggestionIds: input.suggestionIds, profile: input.profile } };
  const previous = await replay<StudioProjectView>(prisma, userId, input.idempotencyKey, requestHash(`transform:${projectId}`, mutation));
  if (previous) return previous;
  const prepared = await loadInspectionProject(userId, projectId, { expectedVersion: input.expectedVersion });
  if (reportIdentity(prepared.origin, input.profile) !== input.reportId) throw new StudioError("REVIEW_STALE");
  const report: VideoReviewReport = reviewVideo(prepared.plan, prepared.validation.diagnostics, prepared.document, input.profile);
  const requested = [...new Set(input.suggestionIds)];
  const suggestions = requested.map(id => report.suggestions.find(s => s.id === id));
  if (suggestions.some(s => !s)) throw new StudioError("SUGGESTION_NOT_FOUND");
  const operations = suggestions.flatMap(s => s!.operations);
  const document = patchVideoDocument(prepared.document, operations);
  if (canonical(document) === canonical(prepared.document)) throw new StudioError("REVIEW_FIX_INEFFECTIVE");
  const verification = compileVideo(document, prepared.manifest, { measureText: await getTypographyMeasureText() });
  const priorErrors = new Set(prepared.validation.diagnostics.filter(d => d.severity === "error").map(d => `${d.code}:${d.path}:${d.nodeId ?? ""}`));
  const addedErrors = verification.diagnostics.filter(d => d.severity === "error" && !priorErrors.has(`${d.code}:${d.path}:${d.nodeId ?? ""}`));
  if (addedErrors.length) throw new StudioError("REVIEW_FIX_INVALID", addedErrors);
  const rechecked = reviewVideo(verification.plan, verification.diagnostics, document, input.profile);
  const selectedIssues = new Set(suggestions.flatMap(s => s!.issueIds));
  if (rechecked.issues.some(i => selectedIssues.has(i.id))) throw new StudioError("REVIEW_FIX_INEFFECTIVE");
  // CAS and the atomic receipt are checked again by the common draft writer.
  return transformStudioDraft(userId, projectId, mutation, () => document);
}
