import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { probeMediaInfo } from "@/lib/audio";
import { MediaProbeError, mediaProbeLimits } from "@/lib/media-probe";
import { actor } from "./shared";
import { safeFile } from "./assets";
import { getStudioJobArtifact } from "./jobs";
import { studioJobLimits } from "./job-types";
import {
  inspectStudioAssetSchema,
  type InspectStudioAssetInput,
} from "./types";
import { StudioError } from "./errors";

export const studioInspectionLimits = Object.freeze({
  maxInlineBytes: 12 * 1024 * 1024,
  longEdge: studioJobLimits.previewLongEdge,
  audioSeconds: studioJobLimits.previewSeconds,
  timeoutMs: 30_000,
  probe: mediaProbeLimits,
});
const execute = promisify(execFile);
/** No caller path is accepted. Clips are encoded only when their resource is read. */
export function inspectStudioAsset(
  userId: string,
  assetId: string,
  input: InspectStudioAssetInput = {},
) {
  return inspect(userId, assetId, input, false);
}
export async function readStudioAssetResource(
  userId: string,
  assetId: string,
  input: InspectStudioAssetInput = {},
) {
  const result = await inspect(
    userId,
    assetId,
    { ...input, content: true },
    true,
  );
  if (!result.data) throw new StudioError("INSPECTION_FAILED");
  return {
    uri: result.metadata.uri,
    mimeType: result.metadata.mimeType,
    blob: result.data,
  };
}
async function inspect(
  userId: string,
  assetId: string,
  raw: InspectStudioAssetInput,
  includeClip: boolean,
) {
  const input = inspectStudioAssetSchema.parse(raw);
  await actor(userId);
  const art = await prisma.art.findFirst({ where: { id: assetId, userId } });
  if (!art) throw new StudioError("NOT_FOUND");
  let path: string;
  try {
    path = await safeFile(art.filePath);
  } catch (e) {
    if (e instanceof StudioError) throw e;
    throw new StudioError("ASSET_FILE_MISSING");
  }
  const info = await probeMediaInfo(path).catch((error) => {
    if (error instanceof MediaProbeError) throw new StudioError(error.code);
    throw error;
  });
  if (!info.hasVideo && !info.hasAudio)
    throw new StudioError("ASSET_MEDIA_INVALID");
  const mode =
    input.mode === "auto"
      ? art.kind === "audio"
        ? "audio"
        : "image"
      : input.mode;
  if (
    (mode === "audio" && !info.hasAudio) ||
    (mode === "clip" && (art.kind !== "video" || !info.hasVideo)) ||
    (mode === "image" && !info.hasVideo)
  )
    throw new StudioError("ASSET_KIND_MISMATCH");
  if (
    (art.kind === "image" && input.fromSec !== 0) ||
    (mode === "image" && input.durationSec !== undefined) ||
    (info.durationSec !== null &&
      (input.fromSec >= info.durationSec ||
        (input.durationSec !== undefined &&
          input.fromSec + input.durationSec > info.durationSec + 0.001)))
  )
    throw new StudioError("ASSET_RANGE_INVALID");
  const durationSec =
    mode === "image"
      ? undefined
      : (input.durationSec ??
        Math.min(
          studioJobLimits.previewSeconds,
          info.durationSec === null
            ? studioJobLimits.previewSeconds
            : info.durationSec - input.fromSec,
        ));
  const mimeType =
    mode === "image"
      ? "image/png"
      : mode === "audio"
        ? "audio/aac"
        : "video/mp4";
  const params = new URLSearchParams({
    mode,
    fromSec: String(input.fromSec),
    ...(durationSec === undefined ? {} : { durationSec: String(durationSec) }),
  });
  const metadata = {
    id: art.id,
    kind: art.kind,
    label: art.label,
    bytes: art.sizeBytes,
    ...info,
    mimeType,
    preview: { mode, fromSec: input.fromSec, durationSec },
    uri:
      mode === "image"
        ? `video://asset/${art.id}/frame/${input.fromSec}`
        : `video://asset/${art.id}?${params}`,
  };
  if (!input.content || (mode === "clip" && !includeClip)) return { metadata };
  try {
    const scale = `scale=w='min(${studioInspectionLimits.longEdge},iw)':h='min(${studioInspectionLimits.longEdge},ih)':force_original_aspect_ratio=decrease`;
    const args =
      mode === "image"
        ? ["-frames:v", "1", "-vf", scale, "-f", "image2pipe", "-c:v", "png"]
        : mode === "audio"
          ? ["-t", String(durationSec), "-vn", "-c:a", "aac", "-f", "adts"]
          : [
              "-t",
              String(durationSec),
              "-map",
              "0:v:0",
              "-map",
              "0:a:0?",
              "-vf",
              `${scale}:force_divisible_by=2`,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-movflags",
              "frag_keyframe+empty_moov",
              "-f",
              "mp4",
            ];
    const result = await execute(
      ffmpeg!,
      [
        "-v",
        "error",
        "-ss",
        String(input.fromSec),
        "-i",
        path,
        ...args,
        "pipe:1",
      ],
      {
        encoding: "buffer",
        maxBuffer: studioInspectionLimits.maxInlineBytes,
        timeout: studioInspectionLimits.timeoutMs,
      },
    );
    await actor(userId);
    if (
      !(await prisma.art.findFirst({
        where: { id: assetId, userId },
        select: { id: true },
      }))
    )
      throw new StudioError("NOT_FOUND");
    return {
      metadata,
      data: result.stdout.toString("base64"),
      type: mode === "clip" ? ("video" as const) : mode,
    };
  } catch (e) {
    if (e instanceof StudioError) throw e;
    throw new StudioError("INSPECTION_FAILED");
  }
}
/** Server-only artifact boundary: ownership/hash verification precedes bounded bytes. */
export async function readStudioJobResource(userId: string, jobId: string) {
  const artifact = await getStudioJobArtifact(userId, jobId);
  if (artifact.bytes > studioInspectionLimits.maxInlineBytes)
    throw new StudioError("INSPECTION_BYTE_LIMIT");
  const bytes = await readFile(artifact.path);
  return {
    uri: `video://job/${jobId}`,
    name: artifact.name,
    mimeType: artifact.mimeType,
    blob: bytes.toString("base64"),
  };
}
