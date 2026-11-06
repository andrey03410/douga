import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Actor } from "./actor";
import { actor as freshActor } from "@/server/studio/shared";
import { StudioError } from "@/server/studio/errors";
import { storyboardSchema, startStudioStoryboard } from "@/server/studio/storyboard";
import { studioReviewSchema, applyStudioReviewSchema, reviewStudioVideo, applyStudioReview } from "@/server/studio/review";
import { setStudioContentSchema, setStudioContent } from "@/server/studio/content";
import { studioProjectMetadata } from "@/server/studio/queries";
import { getStudioJob } from "@/server/studio/jobs";
import { readStudioJobResource } from "@/server/studio/inspection";

const projectId = z.string().min(1).max(200);
const response = (value: object): CallToolResult => ({ structuredContent: value as Record<string, unknown>,
  content: [{ type: "text", text: JSON.stringify(value), annotations: { audience: ["assistant"] } }] });
export function registerStoryboardTools(server: McpServer, actor: Actor) {
  function register<S extends z.AnyZodObject>(name: string, description: string, schema: S,
    run: (input: z.infer<S>) => Promise<CallToolResult>, readOnlyHint = true) {
    server.registerTool(name, { description, inputSchema: schema.shape, annotations: { readOnlyHint } }, async (args: Record<string, unknown>) => {
      try { await freshActor(actor.userId); return await run(schema.parse(args)); }
      catch (error) { return { ...response({ error: { code: error instanceof z.ZodError ? "SCHEMA_INVALID" : error instanceof StudioError ? error.code : "OPERATION_FAILED",
        ...(error instanceof StudioError ? { diagnostics: error.diagnostics } : {}) } }), isError: true }; }
    });
  }
  register("video_content_set", "Fill a supported preset with participants (owned asset IDs), picker rounds or authored board actions. Canonical document is built for you. CAS, explicit merge/replace; no commit.",
    setStudioContentSchema.extend({ projectId }), async ({ projectId, ...input }) => {
      const project = await setStudioContent(actor.userId, projectId, input);
      return response({ ...studioProjectMetadata(project), missingInputs: project.missingInputs,
        nextAction: { tool: "video_storyboard", arguments: { projectId, expectedVersion: project.version } } });
    }, false);
  register("video_storyboard", "One semantic contact sheet of an owned draft/revision. No commit/source reconciliation. Returns native PNG when ready, otherwise one durable job and ready nextAction. Long videos use explicit pages; compare pins both origins.",
    storyboardSchema.innerType().extend({ projectId, waitMs: z.number().int().min(0).max(2000).default(0) }), async ({ projectId, waitMs, ...input }) => {
      let job = await startStudioStoryboard(actor.userId, projectId, input);
      const deadline = Date.now() + waitMs;
      while (["queued", "running"].includes(job.status) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(200, deadline - Date.now())));
        job = await getStudioJob(actor.userId, job.id);
      }
      const ready = job.status === "done";
      const result = response({ ...job, nextAction: ready
        ? { tool: "video_review", arguments: { projectId, ...(job.inspection?.origin.version ? { expectedVersion: job.inspection.origin.version } : { revision: job.inspection?.origin.revision }) } }
        : ["failed", "canceled"].includes(job.status) ? null : { tool: "video_job_get", arguments: { jobId: job.id }, then: { tool: "video_job_inspect", arguments: { jobId: job.id } } },
        ...(job.status === "queued" ? { note: "Нужен запущенный studio:worker. Повтор запроса использует это же задание." } : {}) });
      if (ready) {
        const bytes = await readStudioJobResource(actor.userId, job.id);
        result.content.push({ type: "image", mimeType: "image/png", data: bytes.blob, annotations: { audience: ["assistant"] } });
      }
      return result;
    });
  register("video_review", "Pinned actionable review. Quick checks real text/layout and readable windows; deep queues bounded clip/audio samples without committing. Reports coverage and notChecked explicitly; never a beauty score.",
    studioReviewSchema.extend({ projectId }), async ({ projectId, ...input }) => response(await reviewStudioVideo(actor.userId, projectId, input)));
  register("video_review_apply", "Apply selected deterministic suggestions from an exact report to the current draft with CAS/idempotency. Recomputes report and rejects stale or unknown fixes. No ranking/media/content changes, commit or publish.",
    applyStudioReviewSchema.extend({ projectId }), async ({ projectId, ...input }) => {
      const project = await applyStudioReview(actor.userId, projectId, input);
      return response({ ...studioProjectMetadata(project), draftBackupId: project.draftBackupId,
        ...(project.draftBackupId ? { restore: { tool: "video_document_get", arguments: { projectId, reviewBackupId: project.draftBackupId } } } : {}),
        nextAction: { tool: "video_review", arguments: { projectId, expectedVersion: project.version, ...(input.profile ? { profile: input.profile } : {}) } } });
    }, false);
}
