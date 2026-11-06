import { registerTypographyTools } from "./typography-tools";
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
import { readFile } from "node:fs/promises";
import { getStudioRecipePreview } from "@/server/studio/recipe-preview";

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
function manualTopExample() {
  const participants = [1, 2, 3].map((rank) => ({
    id: `p${rank}`,
    label: `Позиция ${rank}`,
    rank,
    media: { audio: `audio-${rank}`, visual: `visual-${rank}` },
  }));
  const document = sdk.createVideoDocument({
    kind: "top",
    title: "Свой топ",
    participants,
  });
  document.bindings = Object.fromEntries(
    participants.flatMap((p) => [
      [
        p.media.audio,
        { kind: "pool" as const, assetId: `art-${p.media.audio}` },
      ],
      [
        p.media.visual,
        { kind: "pool" as const, assetId: `art-${p.media.visual}` },
      ],
    ]),
  );
  document.settings = {
    ...document.settings,
    top: { ...document.settings.top, snippet: { mode: "active" } },
  };
  return sdk.parseVideoDocument(document);
}

function segmentRecipe(
  id: "rank-reveal" | "segment-intro" | "participant-summary" | "staircase",
): sdk.VideoDocument {
  const participants: sdk.Participant[] = [1, 2, 3].map((rank) => ({
    id: `p${rank}`,
    label: `Композиция ${rank}`,
    rank,
    comment: `Почему место ${rank}`,
    album: "Эпизод 1",
    score: 4 - rank,
    media: { visual: `visual-${rank}`, audio: `audio-${rank}` },
  }));
  const doc = sdk.createVideoDocument({
    kind: "top",
    title: "OST: Эпизод 1",
    participants,
  });
  doc.bindings = Object.fromEntries(
    participants.flatMap((p) =>
      Object.values(p.media!).map((key) => [
        key,
        { kind: "pool" as const, assetId: `art-${key}` },
      ]),
    ),
  );
  const common: Pick<
    sdk.VideoSegment,
    "id" | "kind" | "title" | "subtitle" | "poster" | "participantIds"
  > = {
    id: "episode-1",
    kind: "top",
    title: "Эпизод 1",
    subtitle: "Любимые композиции",
    poster: "visual-1",
    participantIds: participants.map((p) => p.id),
  };
  const card: sdk.VideoNode = {
    id: "participant-card",
    type: "card",
    participantId: "$participant",
    rect: { x: 0, y: 0, width: 1, height: 0.85 },
    style: { playSound: false },
    label: { bind: "participant.label" },
  };
  let scenes: sdk.VideoScene[];
  if (id === "segment-intro")
    scenes = [
      {
        id: "intro",
        block: "custom",
        duration: { sec: 3 },
        nodes: [
          {
            id: "poster",
            type: "image",
            asset: "$segment.poster",
            style: { blur: 18 },
            opacity: 0.35,
          },
          {
            id: "title",
            type: "text",
            text: { bind: "segment.title" },
            rect: { x: 0.1, y: 0.25, width: 0.8, height: 0.2 },
          },
          {
            id: "subtitle",
            type: "text",
            text: { bind: "segment.subtitle" },
            rect: { x: 0.1, y: 0.5, width: 0.8, height: 0.15 },
          },
          {
            id: "count",
            type: "text",
            text: { bind: "segment.count", suffix: " места" },
            rect: { x: 0.1, y: 0.7, width: 0.8, height: 0.1 },
          },
        ],
      },
    ];
  else if (id === "rank-reveal")
    scenes = [
      {
        id: "reveal",
        block: "custom",
        repeat: "participants",
        duration: { sec: 4 },
        nodes: [
          {
            id: "rank",
            type: "text",
            text: { bind: "participant.rank", prefix: "Место " },
            rect: { x: 0.1, y: 0.05, width: 0.8, height: 0.15 },
          },
          {
            ...card,
            rect: { x: 0.2, y: 0.25, width: 0.6, height: 0.5 },
            timing: { at: { sec: 1 } },
            style: { playSound: false },
          },
          {
            id: "comment",
            type: "text",
            text: { bind: "participant.comment" },
            rect: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 },
            timing: { at: { sec: 1 } },
          },
          {
            id: "audio",
            type: "audio",
            asset: "$participant.audio",
            role: "primary",
            timing: { at: { sec: 1 } },
          },
        ],
      },
    ];
  else {
    const set: sdk.VideoNode = {
      id: "participants",
      type: "container",
      repeat: "participants",
      selection: id === "staircase" ? "revealed" : "segment",
      layout: { type: "grid", columns: 3, padding: 40, gap: 24 },
      children: [
        card,
        {
          id: "rank-label",
          type: "text",
          text: { bind: "participant.rank", prefix: "#" },
          rect: { x: 0, y: 0.87, width: 1, height: 0.13 },
        },
      ],
    };
    scenes = [
      {
        id: "overview",
        block: "custom",
        ...(id === "staircase" ? { repeat: "participants" as const } : {}),
        duration: { sec: 3 },
        nodes: [set],
      },
    ];
  }
  return sdk.parseVideoDocument({
    ...doc,
    schemaVersion: 2,
    scenes: [],
    segments: [{ ...common, scenes }],
  });
}

export function videoExamples() {
  return {
    items: [
      ...(["top", "picker", "board"] as const).map(kind => {
        const recipe = sdk.getVideoRecipe(`recipe.${kind === "board" ? "board-clear" : "clean"}.${kind}.wide`)!;
        return { id: `guided-${kind}`, document: recipe.example, contentForm: recipe.contentForm,
          note: "Создайте проект по recipe.preset.id и заполните contentForm своими assetId через video_content_set. Демонстрационные медиа не подставляются." };
      }),
      ...sdk.typographyExamples.map((example, index) => ({ id: ["typography-ost", "typography-picker-jp", "typography-board-labels", "typography-rich-title"][index], document: example.document, standInManifest: example.manifest })),
      ...sdk.motionExamples(),
      ...(
        [
          "tier",
          "kmk",
          "smash-pass",
          "blind-rank",
          "draft",
          "sort-quiz",
          "alignment",
          "budget-draft",
        ] as const
      ).map((family) => ({
        id: `board-${family}`,
        document: sdk.createVideoDocument({
          kind: "board",
          presetId: `board.${family}.vertical`,
        }),
      })),
      ...(
        [
          "rank-reveal",
          "segment-intro",
          "participant-summary",
          "staircase",
        ] as const
      ).map((id) => ({ id, document: segmentRecipe(id) })),
      {
        id: "top",
        document: sdk.createVideoDocument({
          kind: "top",
          title: "Top",
          participants: [{ id: "one", label: "Item", rank: 1 }],
        }),
      },
      {
        id: "top-manual",
        document: manualTopExample(),
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
  };
}
const examples = (id?: string) => {
  const result = videoExamples();
  if (!id) return result;
  const item = result.items.find((item) => item.id === id);
  if (!item) throw new studio.StudioError("NOT_FOUND");
  return { ...result, items: [item] };
};
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
    contentSet: zodToJsonSchema(studio.setStudioContentSchema),
    storyboard: zodToJsonSchema(studio.storyboardSchema),
    review: zodToJsonSchema(studio.studioReviewSchema),
    reviewApply: zodToJsonSchema(studio.applyStudioReviewSchema),
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
    "Discover Studio SDK v1/v2, authorization, resource budgets and external-client modality limits. Neutral metadata.",
    z.object({}),
    async () => {
      const user = await freshActor(uid);
      return {
        apiVersion: 1,
        schemaVersion: 2,
        supportedSchemaVersions: [1, 2],
        compilerVersion: "1.0.0",
        guidedAuthoring: { recipes: 33, styles: 6, gallery: "/studio/recipes", content: "video_content_set", storyboard: "video_storyboard", review: "video_review", apply: "video_review_apply", pageSize: { default: 12, max: 24 }, async: true, originPinned: true },
        typography: { catalogVersion: 1, fonts: 7, styles: 12, themes: 6, inspect: "video_text_inspect", gallery: "/studio/typography" },
        motion: {
          catalogVersion: sdk.motionCatalog.version,
          count: sdk.motionCatalog.entries.length,
          list: "video_motion_list",
          get: "video_motion_get",
          examples: "video_examples",
          gallery: "/studio/motion",
          profiles: ["smooth", "snappy", "bouncy", "cinematic"],
          intensities: ["subtle", "normal", "bold"],
        },
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
  const category = z.enum([
    "effect",
    "choreography",
    "transition",
    "backdrop",
    "widget",
  ]);
  register(
    "video_motion_list",
    "Bounded motion catalog summaries, optionally filtered by category. Cursor is the last category:name key. Use get for explicit fragments.",
    z
      .object({
        category: category.optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().max(200).optional(),
      })
      .strict(),
    async ({ category, limit, cursor }) => {
      await freshActor(uid);
      const entries = sdk.motionCatalog.entries.filter(
        (entry) => !category || entry.category === category,
      );
      const key = (entry: { category: string; name: string }) =>
        `${entry.category}:${entry.name}`;
      const index = cursor
        ? entries.findIndex((entry) => key(entry) === cursor)
        : -1;
      if (cursor && index === -1) throw new studio.StudioError("NOT_FOUND");
      const items = entries
        .slice(index + 1, index + 1 + limit)
        .map(({ example: _fragment, ...summary }) => summary);
      return {
        version: sdk.motionCatalog.version,
        total: entries.length,
        items,
        nextCursor:
          index + 1 + limit < entries.length ? key(items.at(-1)!) : null,
      };
    },
  );
  register(
    "video_motion_get",
    "Explicit motion metadata and labeled authoring fragment. Category is required for ambiguous names such as flash. Complete documents are in video_examples.",
    z.object({ name: id, category: category.optional() }).strict(),
    async ({ name, category }) => {
      await freshActor(uid);
      const canonical = name === "flip" ? "flip-y" : name;
      const matches = sdk.motionCatalog.entries.filter(
        (entry) =>
          entry.name === canonical &&
          (!category || entry.category === category),
      );
      if (matches.length > 1)
        throw new studio.StudioError("MOTION_CATEGORY_REQUIRED", [
          {
            severity: "error",
            code: "MOTION_CATEGORY_REQUIRED",
            path: "category",
            message: `Укажите category: ${matches.map((entry) => entry.category).join(" или ")}`,
          },
        ]);
      const entry = matches[0];
      if (!entry) throw new studio.StudioError("NOT_FOUND");
      return {
        version: sdk.motionCatalog.version,
        entry,
        exampleKind: "authoring-fragment",
        completeExampleId:
          entry.category === "choreography"
            ? `motion-choreography-${entry.name}`
            : entry.category === "effect"
              ? "motion-effect-text-slam"
              : "motion-widget-backdrop-transition-sampler",
        completeExampleNote:
          "Whole-document recipe for this category; entry.example is the selected technique fragment.",
      };
    },
    true,
  );
  registerTypographyTools(server, actor);
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
    "Explicit complete validated JSON examples, optionally one id. Motion stand-in manifests are compiler inputs; replace pool bindings with owned assets before saving.",
    z.object({ id: id.optional() }),
    async ({ id }) => {
      await freshActor(uid);
      return examples(id);
    },
    true,
  );
  const presetListSchema = studio.studioPageSchema.extend({ recipes: z.boolean().default(false),
    kind: z.enum(["top", "picker", "board"]).optional(), format: z.enum(["wide", "vertical", "square"]).optional(),
    style: z.enum(sdk.videoRecipeStyles).optional(), query: z.string().max(500).optional(), preview: z.boolean().default(true) }).strict();
  async function addRecipeImages(output: CallToolResult, ids: string[]) {
    const delivered: string[] = [], states: { recipeId: string; status: string }[] = [];
    for (const recipeId of ids) {
      try {
        const artifact = await getStudioRecipePreview(uid, recipeId);
        if (artifact.bytes > 4 * 1024 * 1024) { states.push({ recipeId, status: "byteLimit" }); continue; }
        output.content.push({ type: "image", mimeType: "image/png", data: (await readFile(artifact.path)).toString("base64"), annotations: { audience: ["assistant"] } });
        delivered.push(recipeId); states.push({ recipeId, status: "ready" });
      } catch (e) { if (!(e instanceof studio.StudioError && e.code === "PREVIEW_NOT_READY")) throw e;
        states.push({ recipeId, status: "notReady" }); }
    }
    if (output.structuredContent) {
      output.structuredContent.previewOrder = delivered;
      output.structuredContent.previews = states;
      const main = output.content.find(c => c.type === "text");
      if (main?.type === "text") main.text = JSON.stringify(output.structuredContent);
    }
    return output;
  }
  server.registerTool("video_preset_list", { description: "Catalog or recipes:true guided selection (up to 3), with one recommendation, content forms and real reference images. Filter kind/format/style/query. Canonical templates: preset_get.", inputSchema: presetListSchema.shape }, async args => {
    try {
      const input = presetListSchema.parse(args);
      if (!input.recipes) return text(await studio.listStudioPresetSummaries(uid, { limit: input.limit, cursor: input.cursor }));
      if (input.cursor) throw new studio.StudioError("INVALID_CURSOR");
      const selected = await studio.selectStudioRecipes(uid, { kind: input.kind, format: input.format, style: input.style, query: input.query, limit: Math.min(3, input.limit) });
      const output = text({ ...selected, previewOrder: selected.items.map(r => r.id), gallery: "/studio/recipes" }, true);
      return input.preview ? await addRecipeImages(output, selected.items.map(r => r.id)) : output;
    } catch (e) { return failure(e); }
  });
  const presetGetSchema = z.object({ presetId: id, preview: z.boolean().default(true) }).strict();
  server.registerTool("video_preset_get", { description: "Canonical preset; recipe IDs also return a short semantic content form, valid example and native reference image. No project mutation.", inputSchema: presetGetSchema.shape }, async args => {
    try {
      const { presetId, preview } = presetGetSchema.parse(args);
      const recipe = sdk.getVideoRecipe(presetId);
      const output = text({ preset: await studio.getStudioPreset(uid, presetId),
        ...(recipe ? { recipe, nextAction: { tool: "video_project_create", arguments: { presetId } } } : {}), clientDisplayLimitation: displayLimitation }, true);
      return recipe && preview ? await addRecipeImages(output, [presetId]) : output;
    } catch (e) { return failure(e); }
  });
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
          .enum([
            "head",
            "draft",
            "source",
            "settings",
            "scenes",
            "segments",
            "bindings",
          ])
          .default("head"),
        revision: z.number().int().positive().optional(),
        reviewBackupId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .refine(
        (input) => (input.section !== "draft" || input.revision === undefined)
          && (!input.reviewBackupId || (input.revision === undefined && ["head", "draft"].includes(input.section))),
        "Historical revisions contain saved documents, not drafts",
      ),
    async ({ projectId, section, revision, reviewBackupId }) => {
      if (reviewBackupId) {
        const backup = await studio.getStudioReviewBackup(uid, projectId, reviewBackupId);
        const current = await prisma.studioProject.findFirst({ where: { id: projectId, userId: uid }, select: { version: true } });
        if (!current) throw new studio.StudioError("NOT_FOUND");
        return { ...backup, restore: { tool: "video_draft_replace", arguments: { projectId, expectedVersion: current.version, document: backup.document } }, clientDisplayLimitation: displayLimitation };
      }
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
        "Explicit completed result: real image/audio or owned video:// links for clips/finals. Optional frameId reads one storyboard tile at preview resolution. 12 MiB inline/read budget.",
      inputSchema: job.extend({ frameId: z.string().regex(/^\d{1,3}$/).optional() }),
    },
    async ({ jobId, frameId }) => {
      try {
        const result = await studio.getStudioJob(uid, jobId);
        const artifact = frameId === undefined ? await studio.getStudioJobArtifact(uid, jobId) : await studio.getStoryboardFrame(uid, jobId, frameId);
        const output = text(
          {
            jobId,
            status: result.status,
            ...(frameId === undefined ? { uri: `video://job/${jobId}` } : { frameId }),
            mimeType: artifact.mimeType,
            bytes: artifact.bytes,
            hash: artifact.hash,
            clientDisplayLimitation: displayLimitation,
          },
          true,
        );
        if (/^(image|audio)\//.test(artifact.mimeType)) {
          if (artifact.bytes > 12 * 1024 * 1024) throw new studio.StudioError("INSPECTION_BYTE_LIMIT");
          const resource = frameId === undefined ? await studio.readStudioJobResource(uid, jobId)
            : { blob: (await readFile(artifact.path)).toString("base64") };
          output.content.push({
            type: artifact.mimeType.startsWith("image/") ? "image" : "audio",
            data: resource.blob,
            mimeType: artifact.mimeType,
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
