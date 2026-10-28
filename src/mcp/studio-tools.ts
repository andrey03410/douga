import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Actor } from "./actor";
import { can } from "@/lib/domain/permissions";
import { prisma } from "@/lib/db";
import * as sdk from "@/video";
import * as studio from "@/server/studio";
import { actor as freshActor } from "@/server/studio/shared";
import { listArts } from "@/server/arts";

const id = z.string().min(1).max(200);
const project = z.object({ projectId: id }).strict();
const job = z.object({ jobId: id }).strict();
const displayLimitation =
  "Content is requested explicitly and marked for the assistant. The client can still display tool/resource content; image, audio and video display/playback depends on the external client. video:// URIs require this authenticated MCP connection and are not public HTTP URLs.";
const createSchema = studio.createStudioProjectFromPresetSchema
  .partial({ presetId: true })
  .extend({
    document: z.unknown().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.document !== undefined) === (v.presetId !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Supply exactly one of document or presetId",
      });
    if (
      v.document !== undefined &&
      [v.title, v.sourceId, v.roundCount, v.cardsPerRound].some(
        (x) => x !== undefined,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Factory options require presetId",
      });
  });
/** MCP accepts object shapes; parse the complete schema again in the handler so
 * refinements and strict unknown-field checks stay authoritative. */
function rawShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodEffects) return rawShape(schema.innerType());
  if (schema instanceof z.ZodObject) return schema.shape;
  throw new Error("MCP registration requires an object schema");
}
const text = (data: unknown, content = false): CallToolResult => ({
  structuredContent:
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { data },
  content: [
    {
      type: "text",
      text: JSON.stringify(data),
      ...(content ? { annotations: { audience: ["assistant" as const] } } : {}),
    },
  ],
});
function failure(e: unknown): CallToolResult {
  const detail =
    e instanceof z.ZodError
      ? {
          code: "SCHEMA_INVALID",
          issues: e.issues.map((i) => ({
            path: i.path,
            code: i.code,
            message: i.message,
          })),
        }
      : e instanceof studio.StudioError
        ? { code: e.code, diagnostics: e.diagnostics }
        : { code: "OPERATION_FAILED" };
  return { ...text({ error: detail }), isError: true };
}
const examples = () => ({
  items: [
    {
      id: "top",
      document: sdk.createVideoDocument({
        kind: "top",
        title: "Top",
        participants: [{ id: "one", label: "Item", rank: 1 }],
      }),
    },
    {
      id: "picker-groups",
      document: sdk.createVideoDocument({
        kind: "picker",
        presetId: "picker.two-groups.vertical",
        roundCount: 1,
      }),
    },
  ],
  clientDisplayLimitation: displayLimitation,
});
const schemas = () => ({
  document: sdk.getVideoDocumentJsonSchema(),
  preset: zodToJsonSchema(sdk.videoPresetSchema, {
    definitions: { VideoNode: sdk.videoNodeSchema },
    $refStrategy: "root",
  }),
  patch: zodToJsonSchema(studio.patchStudioDraftSchema),
  services: {
    create: zodToJsonSchema(createSchema),
    draft: zodToJsonSchema(studio.saveStudioDraftSchema),
    patch: zodToJsonSchema(studio.patchStudioDraftSchema),
    presetApply: zodToJsonSchema(studio.applyStudioPresetSchema),
    commit: zodToJsonSchema(studio.commitStudioDraftSchema),
    restore: zodToJsonSchema(studio.restoreStudioRevisionSchema),
    presetSave: zodToJsonSchema(studio.saveStudioPresetSchema),
    jobStart: zodToJsonSchema(studio.startStudioJobSchema),
    importStart: zodToJsonSchema(studio.startStudioImportSchema),
    assetInspect: zodToJsonSchema(studio.inspectStudioAssetSchema),
    timeline: zodToJsonSchema(studio.studioTimelineSchema),
    runtimeConstraints: [
      "create: exactly one of document/presetId",
      "draft: exactly one of document/text",
      "presetSave: exactly one of document/preset",
      "Canonical preset rejects catalog personal metadata",
      "SDK refinements and semantic/ownership validation remain authoritative",
    ],
  },
});

export function registerStudioTools(server: McpServer, actor: Actor): void {
  const uid = actor.userId;
  function register<S extends z.ZodTypeAny>(
    name: string,
    description: string,
    schema: S,
    fn: (input: z.infer<S>) => Promise<unknown> | unknown,
    content = false,
  ) {
    server.registerTool(
      name,
      { description, inputSchema: z.object(rawShape(schema)).strict() },
      async (args) => {
        try {
          return text(await fn(schema.parse(args)), content);
        } catch (e) {
          return failure(e);
        }
      },
    );
  }
  register(
    "video_capabilities",
    "Discover Studio SDK v1, authorization, resource budgets and external-client modality limits. Neutral metadata.",
    z.object({}),
    async () => {
      const user = await freshActor(uid);
      return {
        apiVersion: 1,
        schemaVersion: 1,
        compilerVersion: "1.0.0",
        protocol: {
          transport: "stdio",
          latest: LATEST_PROTOCOL_VERSION,
          supported: SUPPORTED_PROTOCOL_VERSIONS,
        },
        permissions: { author: true, render: can(user.role, "render:run") },
        limits: {
          jobs: studio.studioJobLimits,
          document: studio.videoResourceLimits,
          inspection: studio.studioInspectionLimits,
        },
        canonical:
          "VideoDocument JSON; TypeScript builders emit the same model",
        editing:
          "CAS expectedVersion differs from revision. Reuse idempotencyKey on retry; keys are account-wide and action-specific.",
        ordinaryResponses:
          "Neutral IDs, versions and counts. Explicit document/inspection calls carry content.",
        clientDisplayLimitation: displayLimitation,
      };
    },
  );
  register(
    "video_schema_get",
    "Get canonical SDK/service JSON schemas. Runtime refinements, CAS and ownership checks also apply.",
    z.object({
      name: z
        .enum(["document", "preset", "patch", "services"])
        .default("document"),
    }),
    async ({ name }) => {
      await freshActor(uid);
      return schemas()[name];
    },
    true,
  );
  register(
    "video_examples",
    "Explicit complete validated JSON examples; may display source content in the client.",
    z.object({}),
    async () => {
      await freshActor(uid);
      return examples();
    },
    true,
  );
  register(
    "video_preset_list",
    "Bounded built-in/personal preset catalog summaries. video_preset_get reads a complete canonical template.",
    studio.studioPageSchema,
    (input) => studio.listStudioPresetSummaries(uid, input),
  );
  register(
    "video_preset_get",
    "Explicit media-free canonical preset; catalog personal metadata is omitted for strict SDK compatibility.",
    z.object({ presetId: id }),
    async ({ presetId }) => ({
      preset: await studio.getStudioPreset(uid, presetId),
      clientDisplayLimitation: displayLimitation,
    }),
    true,
  );
  register(
    "video_preset_save",
    "Save media-free personal design: document conservatively extracts generic text; explicit canonical preset preserves generic copy. Exactly one content field. Neutral result; preset_get explicitly reads design.",
    studio.saveStudioPresetSchema,
    async (input) => {
      const p = await studio.saveStudioPreset(uid, input);
      return {
        id: p.id,
        version: p.version,
        kind: p.kind,
        output: p.output,
        skeleton: p.skeleton,
        personal: true,
      };
    },
  );
  register(
    "video_project_list",
    "Bounded neutral SQL summaries without loading documents/plans/drafts. Individual get/write reconciles source ranking.",
    studio.studioPageSchema,
    (input) => studio.listStudioProjectSummaries(uid, input),
  );
  register(
    "video_project_create",
    "Create SDK project from exactly one document or owned/built-in presetId. Preset uses its round/card/group skeleton. sourceId attaches owned tournament ranks. Neutral result.",
    createSchema,
    async (input) => {
      const { document, ...options } = input;
      const created = options.presetId
        ? await studio.createStudioProjectFromPreset(uid, {
            ...options,
            presetId: options.presetId,
          })
        : await studio.createStudioProject(uid, {
            document,
            idempotencyKey: input.idempotencyKey,
          });
      return studio.studioProjectMetadata(created);
    },
  );
  register(
    "video_project_get",
    "Get current neutral project metadata and validation counts; reconciles source changes. video_document_get explicitly reads content.",
    project,
    async ({ projectId }) =>
      studio.studioProjectMetadata(
        await studio.getStudioProject(uid, projectId),
      ),
  );
  register(
    "video_publish",
    "Publish the latest saved studio revision, or move the existing public link onto it. Returns an absolute watch URL. Does not render MP4 and ignores unsaved draft edits.",
    project.merge(studio.publishStudioProjectSchema),
    async ({ projectId, ...input }) => {
      const row = await studio.publishStudioProject(uid, projectId, input);
      return {
        url: studio.publicWatchUrl(row.token),
        revision: row.revision,
        updated: row.updated,
        projectId: row.projectId,
      };
    },
  );
  register(
    "video_unpublish",
    "Remove the public watch link for a studio project. Publishing again creates a new link.",
    project.merge(studio.unpublishStudioProjectSchema),
    async ({ projectId, ...input }) =>
      studio.unpublishStudioProject(uid, projectId, input),
  );
  register(
    "video_publication_get",
    "Read the current public watch link for a studio project. publication is null when nothing is published.",
    project,
    async ({ projectId }) => {
      const row = await studio.getStudioPublication(uid, projectId);
      return {
        publication: row
          ? {
              url: studio.publicWatchUrl(row.token),
              revision: row.revision,
              projectId: row.projectId,
            }
          : null,
      };
    },
  );
  register(
    "video_document_get",
    "Explicit content read (can contain answers). Assistant audience is a hint; client may display it.",
    project
      .extend({
        section: z
          .enum(["head", "draft", "source", "settings", "scenes", "bindings"])
          .default("head"),
        revision: z.number().int().positive().optional(),
      })
      .refine(
        (input) => input.section !== "draft" || input.revision === undefined,
        "Historical revisions contain saved documents, not drafts",
      ),
    async ({ projectId, section, revision }) => {
      const current = await studio.getStudioProject(uid, projectId);
      let document: unknown =
        section === "draft"
          ? (current.draft?.document ?? null)
          : current.document;
      if (revision) {
        const row = await prisma.studioRevision.findFirst({
          where: { projectId, revision },
          select: { documentJson: true },
        });
        if (!row) throw new studio.StudioError("NOT_FOUND");
        document = JSON.parse(row.documentJson);
      }
      return {
        projectId,
        version: current.version,
        revision: revision ?? current.revision,
        ...(section === "head" || section === "draft"
          ? {
              document,
              ...(section === "draft"
                ? { text: current.draft?.text ?? null }
                : {}),
            }
          : { [section]: (document as sdk.VideoDocument)[section] }),
        clientDisplayLimitation: displayLimitation,
      };
    },
    true,
  );
  // Service schema supplies both fields, and service validation retains its XOR refinement.
  register(
    "video_draft_replace",
    "Replace editor draft with exactly one document or raw JSON text. Invalid text is retained for repair. CAS/idempotency enforced.",
    z
      .object({ projectId: id, ...rawShape(studio.saveStudioDraftSchema) })
      .strict(),
    async (args) => {
      const { projectId, ...input } = args;
      return studio.studioProjectMetadata(
        await studio.saveStudioDraft(
          uid,
          projectId,
          studio.saveStudioDraftSchema.parse(input),
        ),
      );
    },
  );
  register(
    "video_draft_patch",
    "Semantic stable-ID set/unset patch against schema-valid draft when present, otherwise committed head. Collections require replacement.",
    project.merge(studio.patchStudioDraftSchema),
    async ({ projectId, ...input }) =>
      studio.studioProjectMetadata(
        await studio.patchStudioDraft(uid, projectId, input),
      ),
  );
  register(
    "video_preset_apply",
    "Apply design/output as a draft preserving source counts, questions, answers, media and bindings. CAS required; commit separately.",
    project.merge(studio.applyStudioPresetSchema),
    async ({ projectId, ...input }) =>
      studio.studioProjectMetadata(
        await studio.applyStudioPreset(uid, projectId, input),
      ),
  );
  register(
    "video_project_validate",
    "Explicit structured current draft/head diagnostics using shared service validation.",
    project,
    async ({ projectId }) =>
      (await studio.getStudioProject(uid, projectId)).validation,
    true,
  );
  register(
    "video_timeline_get",
    "Explicit existing compiled timeline, bounded scene pages and recommended absolute frames. Shows current last-good preview origin/staleness or owned revision plan selected from job.revision. Does not recompile in MCP.",
    project.merge(studio.studioTimelineSchema),
    ({ projectId, ...input }) =>
      studio.getStudioTimeline(uid, projectId, input),
    true,
  );
  register(
    "video_draft_commit",
    "Commit valid draft using expectedVersion and optional account-wide idempotencyKey.",
    project.merge(studio.commitStudioDraftSchema),
    async ({ projectId, ...input }) =>
      studio.studioProjectMetadata(
        await studio.commitStudioDraft(uid, projectId, input),
      ),
  );
  register(
    "video_revision_restore",
    "Restore history as a new editable revision reconciled to current source.",
    project.merge(studio.restoreStudioRevisionSchema),
    async ({ projectId, ...input }) =>
      studio.studioProjectMetadata(
        await studio.restoreStudioRevision(uid, projectId, input),
      ),
  );
  register(
    "video_history_list",
    "Bounded neutral saved revision history. Explicit video_document_get(revision) reads a historical document.",
    project.merge(studio.studioPageSchema),
    ({ projectId, ...input }) =>
      studio.listStudioHistorySummaries(uid, projectId, input),
  );
  register(
    "video_source_list",
    "Discover owned authorial tournament/top sources by title without knowing IDs. Bounded summaries; source_get explicitly reads rankings.",
    studio.studioPageSchema,
    (input) => studio.listStudioSources(uid, input),
    true,
  );
  register(
    "video_source_get",
    "Explicit authoritative stable-ID ranks, bindings and fingerprint without filesystem paths. Create using presetId + sourceId.",
    z.object({ sourceId: id }).merge(studio.studioPageSchema),
    ({ sourceId, ...input }) => studio.getStudioSource(uid, sourceId, input),
    true,
  );
  register(
    "video_asset_list",
    "Owned media metadata and resource IDs without absolute paths. Bounded pagination.",
    studio.studioPageSchema.extend({
      kind: z.enum(["image", "audio", "video"]).optional(),
      query: z.string().max(200).optional(),
    }),
    async ({ query, ...input }) => {
      await freshActor(uid);
      if (
        input.cursor &&
        !(await prisma.art.findFirst({
          where: { id: input.cursor, userId: uid },
        }))
      )
        throw new studio.StudioError("NOT_FOUND");
      const page = await listArts(uid, { ...input, q: query });
      return {
        items: page.arts.map((a) => ({
          id: a.id,
          kind: a.kind,
          label: a.label,
          durationSec: a.durationSec,
          hasAudio: a.hasAudio,
          bytes: a.sizeBytes,
          uri: `video://asset/${a.id}`,
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
  server.registerTool(
    "video_asset_inspect",
    {
      description:
        "Explicit owned original inspection. mode:auto|image|audio|clip, fromSec and durationSec<=15. content=true returns PNG/AAC; clip returns an owned resource URI. No raw paths; clips encode on resources/read.",
      inputSchema: studio.inspectStudioAssetSchema.extend({ assetId: id }),
    },
    async ({ assetId, ...input }) => {
      try {
        const result = await studio.inspectStudioAsset(uid, assetId, input);
        const output = text(
          { ...result.metadata, clientDisplayLimitation: displayLimitation },
          true,
        );
        if (result.data && (result.type === "image" || result.type === "audio"))
          output.content.push({
            type: result.type!,
            mimeType: result.metadata.mimeType,
            data: result.data,
            annotations: { audience: ["assistant"] },
          });
        return output;
      } catch (e) {
        return failure(e);
      }
    },
  );
  // Registration uses a union of fields, while the service enforces the exact strict variant.
  const variants = studio.startStudioJobSchema.options;
  const jobShape = Object.assign({}, ...variants.map((option) => option.shape));
  register(
    "video_job_start",
    "Enqueue still(frame), clip/audio(fromFrame,durationFrames), or final render(admin). Full strict variant schemas: video_schema_get(services). Shared frozen plan and durable queue. Poll job_get; inspect explicitly.",
    z
      .object({
        projectId: id,
        ...jobShape,
        kind: z.union([
          variants[0].shape.kind,
          variants[1].shape.kind,
          variants[2].shape.kind,
          variants[3].shape.kind,
        ]),
        frame: variants[0].shape.frame.optional(),
        fromFrame: variants[1].shape.fromFrame.optional(),
        durationFrames: variants[1].shape.durationFrames.optional(),
      })
      .strict(),
    async ({ projectId, ...input }) =>
      studio.startStudioJob(
        uid,
        projectId,
        studio.startStudioJobSchema.parse(input),
      ),
  );
  register(
    "video_import_start",
    "Enqueue durable HTTP(S) media import to owned pool. Loopback/LAN targets are refused (BLOCKED_HOST); the download itself runs in the worker. Poll/cancel through video_job_*.",
    studio.startStudioImportSchema,
    (input) => studio.startStudioImport(uid, input),
  );
  register(
    "video_job_get",
    "Neutral durable job status/result metadata; never inline media or paths.",
    job,
    ({ jobId }) => studio.getStudioJob(uid, jobId),
  );
  register(
    "video_job_cancel",
    "Cancel only an owned queued/running job. A canceled attempt cannot publish.",
    job,
    ({ jobId }) => studio.cancelStudioJob(uid, jobId),
  );
  server.registerTool(
    "video_job_inspect",
    {
      description:
        "Explicit completed result: real image/audio or owned video:// links for clips/finals. Client support varies. 12 MiB inline/read budget.",
      inputSchema: job,
    },
    async ({ jobId }) => {
      try {
        const result = await studio.getStudioJob(uid, jobId);
        const artifact = await studio.getStudioJobArtifact(uid, jobId);
        const output = text(
          {
            jobId,
            status: result.status,
            uri: `video://job/${jobId}`,
            mimeType: artifact.mimeType,
            bytes: artifact.bytes,
            hash: artifact.hash,
            clientDisplayLimitation: displayLimitation,
          },
          true,
        );
        if (/^(image|audio)\//.test(artifact.mimeType)) {
          const resource = await studio.readStudioJobResource(uid, jobId);
          output.content.push({
            type: artifact.mimeType.startsWith("image/") ? "image" : "audio",
            data: resource.blob,
            mimeType: resource.mimeType,
            annotations: { audience: ["assistant"] },
          });
        }
        // Text URI + resources/read works on protocols predating resource_link.
        return output;
      } catch (e) {
        return failure(e);
      }
    },
  );
  for (const name of ["document", "preset", "patch", "services"] as const)
    server.registerResource(
      `video-${name}-schema`,
      `video://schema/${name}`,
      {
        mimeType: "application/json",
        annotations: { audience: ["assistant"] },
      },
      async (uri) => {
        await freshActor(uid);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(schemas()[name]),
            },
          ],
        };
      },
    );
  server.registerResource(
    "video-examples",
    "video://examples",
    { mimeType: "application/json", annotations: { audience: ["assistant"] } },
    async (uri) => {
      await freshActor(uid);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(examples()),
          },
        ],
      };
    },
  );
  server.registerResource(
    "video-job",
    new ResourceTemplate("video://job/{jobId}", { list: undefined }),
    {
      description:
        "Owned completed bytes with fresh permission/hash checks; 12 MiB resource budget",
      annotations: { audience: ["assistant"] },
    },
    async (_uri, vars) => {
      try {
        return {
          contents: [
            await studio.readStudioJobResource(uid, String(vars.jobId)),
          ],
        };
      } catch (e) {
        throw new Error(
          e instanceof studio.StudioError ? e.code : "RESOURCE_UNAVAILABLE",
        );
      }
    },
  );
  for (const [name, template] of [
    [
      "video-asset-fragment",
      "video://asset/{assetId}{?mode,fromSec,durationSec}",
    ],
    ["video-asset-frame", "video://asset/{assetId}/frame/{fromSec}"],
    ["video-asset", "video://asset/{assetId}"],
  ])
    server.registerResource(
      name,
      new ResourceTemplate(template, { list: undefined }),
      {
        description:
          "Owned bounded PNG frame, AAC sound excerpt or MP4 original clip. Optional mode/fromSec/durationSec query; fresh permission and range checks.",
        annotations: { audience: ["assistant"] },
      },
      async (uri, vars) => {
        try {
          const allowed = new Set(["mode", "fromSec", "durationSec"]);
          for (const key of uri.searchParams.keys())
            if (!allowed.has(key) || uri.searchParams.getAll(key).length !== 1)
              throw new studio.StudioError("SCHEMA_INVALID");
          const options = studio.inspectStudioAssetSchema.parse({
            ...(vars.fromSec && !uri.searchParams.has("mode")
              ? { mode: "image" }
              : {}),
            ...(uri.searchParams.has("mode")
              ? { mode: uri.searchParams.get("mode") }
              : {}),
            ...(vars.fromSec && !uri.searchParams.has("fromSec")
              ? { fromSec: Number(vars.fromSec) }
              : {}),
            ...(uri.searchParams.has("fromSec")
              ? { fromSec: Number(uri.searchParams.get("fromSec")) }
              : {}),
            ...(uri.searchParams.has("durationSec")
              ? { durationSec: Number(uri.searchParams.get("durationSec")) }
              : {}),
          });
          const result = await studio.readStudioAssetResource(
            uid,
            decodeURIComponent(uri.pathname.split("/")[1]),
            options,
          );
          return { contents: [{ ...result, uri: uri.href }] };
        } catch (e) {
          throw new Error(
            e instanceof studio.StudioError ? e.code : "RESOURCE_UNAVAILABLE",
          );
        }
      },
    );
}
