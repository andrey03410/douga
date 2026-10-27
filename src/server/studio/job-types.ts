import { z } from "zod";
const common = {
  expectedVersion: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
};
const frame = z.number().int().nonnegative().max(2_147_483_647);
/** Job states that still own a worker slot; shared by light modules (account deletion). */
export const activeJobStatuses = ["queued", "running"];

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
export const startStudioImportSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(4096)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "HTTP(S) URL without credentials required")
      // Pass on exactly the URL the SSRF guard judges: yt-dlp (Python urlparse)
      // reads e.g. `http://a.com\\@127.0.0.1/` as host 127.0.0.1, WHATWG as a.com.
      .transform((value) => new URL(value).href),
    mode: z.enum(["audio", "video"]),
    quality: z
      .union([z.literal(480), z.literal(720), z.literal(1080)])
      .optional(),
    idempotencyKey: common.idempotencyKey,
  })
  .strict();
export type StartStudioImportInput = z.infer<typeof startStudioImportSchema>;
export interface StudioImportResult {
  kind: "import";
  asset: {
    id: string;
    kind: "audio" | "video";
    bytes: number;
    hash: string;
    mimeType: "audio/mp4" | "video/mp4";
    durationSec: number;
    hasAudio: boolean;
    hasVideo: boolean;
    poster: boolean;
  };
}
export type StudioJobOutput = StudioJobResult | StudioImportResult;
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
  kind: StartStudioJobInput["kind"] | "import";
  status: StudioJobStatus;
  progress: number;
  attempts: number;
  error: string | null;
  revision: number | null;
  revisionId: string | null;
  snapshotHash: string | null;
  engineId: string;
  result: StudioJobOutput | null;
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
  importTimeoutMs: 20 * 60_000,
  importMaxDurationSec: 2 * 60 * 60,
  importMaxTemporaryBytes: 2 * 1024 * 1024 * 1024,
  renderTimeoutMs: 4 * 60 * 60_000,
  childHeapMiB: 2048,
  mediaCacheBytes: 256 * 1024 * 1024,
  frameTimeoutMs: 60_000,
  maxOutputBytes: 512 * 1024 * 1024,
});
