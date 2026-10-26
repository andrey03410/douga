import { z } from "zod";
const common = {
  expectedVersion: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
};
const frame = z.number().int().nonnegative().max(2_147_483_647);
export const startStudioJobSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("still"), frame }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("clip"),
      fromFrame: frame,
      durationFrames: frame.positive(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("audio"),
      fromFrame: frame,
      durationFrames: frame.positive(),
    })
    .strict(),
  z.object({ ...common, kind: z.literal("render") }).strict(),
]);
export type StartStudioJobInput = z.infer<typeof startStudioJobSchema>;
export type StudioJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "canceled";
export interface StudioJobResult {
  kind: "still" | "clip" | "audio" | "render";
  resource: {
    jobId: string;
    name: string;
    mimeType: string;
    bytes: number;
    hash: string;
  };
  width: number | null;
  height: number | null;
  fps: number;
  fromFrame: number;
  durationFrames: number;
  videoCodec: "h264" | null;
  audioCodec: "aac" | null;
}
export interface StudioJobView {
  id: string;
  projectId: string | null;
  snapshotId: string | null;
  kind: StartStudioJobInput["kind"];
  status: StudioJobStatus;
  progress: number;
  attempts: number;
  error: string | null;
  revision: number | null;
  revisionId: string | null;
  snapshotHash: string | null;
  engineId: string;
  result: StudioJobResult | null;
  createdAt: string;
  updatedAt: string;
}
export const studioJobLimits = Object.freeze({
  previewSeconds: 15,
  previewLongEdge: 720,
  maxActivePerAccount: 4,
  maxResultBytesPerAccount: 512 * 1024 * 1024,
  maxInputBytes: 2 * 1024 * 1024 * 1024,
  maxAttempts: 3,
  leaseMs: 30_000,
  heartbeatMs: 5_000,
  previewTimeoutMs: 20 * 60_000,
  renderTimeoutMs: 4 * 60 * 60_000,
  childHeapMiB: 2048,
  mediaCacheBytes: 256 * 1024 * 1024,
  frameTimeoutMs: 60_000,
  maxOutputBytes: 512 * 1024 * 1024,
});
