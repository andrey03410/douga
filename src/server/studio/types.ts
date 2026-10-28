import { z } from "zod";
import type {
  AssetManifest,
  CompiledVideo,
  Diagnostic,
  VideoDocument,
  VideoPreset,
} from "@/video";
import { videoPatchOperationSchema } from "@/video";
import { videoResourceLimits } from "@/video/resource-limits";
import { studioJobLimits } from "./job-types";
const key = z.string().min(1).max(200);
export const inspectStudioAssetSchema = z
  .object({
    content: z.boolean().default(false),
    mode: z.enum(["auto", "image", "audio", "clip"]).default("auto"),
    fromSec: z
      .number()
      .finite()
      .min(0)
      .max(videoResourceLimits.maxDurationSeconds)
      .default(0),
    durationSec: z
      .number()
      .finite()
      .positive()
      .max(studioJobLimits.previewSeconds)
      .optional(),
  })
  .strict();
export type InspectStudioAssetInput = z.input<typeof inspectStudioAssetSchema>;
export const mutationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: key.optional(),
  })
  .strict();
export const createStudioProjectSchema = z
  .object({ document: z.unknown(), idempotencyKey: key.optional() })
  .strict();
export const createStudioProjectFromPresetSchema = z
  .object({
    presetId: key,
    title: z.string().max(200).optional(),
    sourceId: key.optional(),
    roundCount: z
      .number()
      .int()
      .min(0)
      .max(videoResourceLimits.maxExpandedScenes)
      .optional(),
    cardsPerRound: z
      .number()
      .int()
      .min(1)
      .max(videoResourceLimits.maxExpandedNodes)
      .optional(),
    idempotencyKey: key.optional(),
  })
  .strict();
export type CreateStudioProjectFromPresetInput = z.infer<
  typeof createStudioProjectFromPresetSchema
>;
export const saveStudioDraftSchema = mutationSchema
  .extend({
    document: z.unknown().optional(),
    text: z.string().max(2_000_000).optional(),
  })
  .refine(
    (v) => (v.text !== undefined) !== (v.document !== undefined),
    "Supply exactly one of document or text",
  );
export const commitStudioDraftSchema = mutationSchema;
export const patchStudioDraftSchema = mutationSchema.extend({
  operations: z.array(videoPatchOperationSchema).min(1).max(1000),
});
export const applyStudioPresetSchema = mutationSchema.extend({
  presetId: key,
});
export type PatchStudioDraftInput = z.infer<typeof patchStudioDraftSchema>;
export type ApplyStudioPresetInput = z.infer<typeof applyStudioPresetSchema>;
export const restoreStudioRevisionSchema = mutationSchema.extend({
  revision: z.number().int().positive(),
});
export const freezeStudioProjectSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    revision: z.number().int().positive().optional(),
    idempotencyKey: key.optional(),
  })
  .strict();
export const deleteStudioResourceSchema = z
  .object({
    idempotencyKey: key.optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export const publishStudioProjectSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: key.optional(),
  })
  .strict();
export type PublishStudioProjectInput = z.infer<
  typeof publishStudioProjectSchema
>;
export const unpublishStudioProjectSchema = deleteStudioResourceSchema;
export type UnpublishStudioProjectInput = z.infer<
  typeof unpublishStudioProjectSchema
>;
export type DeleteStudioResourceInput = z.infer<
  typeof deleteStudioResourceSchema
>;
export const saveStudioPresetSchema = z
  .object({
    document: z.unknown().optional(),
    preset: z.unknown().optional(),
    name: z.string().trim().min(1).max(200),
    idempotencyKey: key.optional(),
  })
  .strict()
  .refine(
    (input) => (input.document !== undefined) !== (input.preset !== undefined),
    "Supply exactly one of document or preset",
  );
export type CreateStudioProjectInput = z.infer<
  typeof createStudioProjectSchema
>;
export type SaveStudioDraftInput = z.infer<typeof saveStudioDraftSchema>;
export type CommitStudioDraftInput = z.infer<typeof commitStudioDraftSchema>;
export type RestoreStudioRevisionInput = z.infer<
  typeof restoreStudioRevisionSchema
>;
export type FreezeStudioProjectInput = z.infer<
  typeof freezeStudioProjectSchema
>;
export type SaveStudioPresetInput = z.infer<typeof saveStudioPresetSchema>;
export interface StudioValidation {
  ready: boolean;
  diagnostics: Diagnostic[];
}
export interface StudioProjectView {
  id: string;
  title: string;
  kind: "top" | "picker";
  version: number;
  revision: number;
  document: VideoDocument;
  draft: { text: string; document: unknown | null } | null;
  validation: StudioValidation;
  plan: CompiledVideo | null;
  previewStale: boolean;
  previewRevision: number | null;
  previewVersion: number | null;
  sourceVersion: string | null;
}
export interface StudioFile {
  path: string;
  hash: string;
  bytes: number;
  posterPath?: string;
  posterHash?: string;
  posterBytes?: number;
}
export interface StudioRuntime {
  compilerVersion: "1.0.0";
  schemaVersion: 1;
  fontFamily: string;
  remotionVersion: string;
}
/** Paths are storage-relative and server-only. URL manifests are safe for authenticated viewers. */
export interface StudioFrozenRevision {
  snapshotId: string;
  projectId: string;
  revisionId: string;
  revision: number;
  sourceVersion: string | null;
  document: VideoDocument;
  resolvedDocument: VideoDocument;
  manifest: AssetManifest;
  files: Record<string, StudioFile>;
  plan: CompiledVideo;
  validation: StudioValidation;
  runtime: StudioRuntime;
  hash: string;
}
export interface StudioRevisionView {
  id: string;
  revision: number;
  reason: string;
  document: VideoDocument;
  sourceVersion: string | null;
  validation: StudioValidation;
  createdAt: string;
}
export type StudioPresetView = VideoPreset & { personal?: boolean };
export const studioManifestModeSchema = z.enum(["url", "file"]);
export type StudioManifestMode = z.infer<typeof studioManifestModeSchema>;
