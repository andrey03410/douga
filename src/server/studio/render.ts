import "server-only";
import { cp, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import type { ResolvedAsset } from "@/video";
import { fileHash, safeFile } from "./assets";
import { verifyEngine } from "./engine";
import { absPath } from "@/lib/storage";
import { StudioError } from "./errors";
import {
  studioJobLimits,
  type StartStudioJobInput,
  type StudioJobResult,
} from "./job-types";
import type { StudioFrozenRevision } from "./types";
export interface RenderAttempt {
  operation: "render";
  jobId: string;
  leaseToken: string;
  directory: string;
  engineId: string;
  frozen: StudioFrozenRevision;
  input: StartStudioJobInput;
}
/** Complete selected source bytes, unchanged offsets and envelope; no original bindings. */
export async function renderStudioAttempt(
  request: RenderAttempt,
): Promise<StudioJobResult> {
  const { frozen, input } = request;
  const directory = absPath(request.directory),
    serveUrl = path.join(directory, "serve");
  await mkdir(directory, { recursive: true });
  await cp(await verifyEngine(request.engineId), serveUrl, { recursive: true });
  const publicDir = path.join(serveUrl, "public");
  await mkdir(publicDir, { recursive: true });
  const sources = new Map<string, string>();
  for (const [key, file] of Object.entries(frozen.files)) {
    for (const [sourcePath, digest, src] of [
      [file.path, file.hash, frozen.manifest[key].src],
      [file.posterPath, file.posterHash, frozen.manifest[key].posterSrc],
    ]) {
      if (!sourcePath || !digest || !src) continue;
      const source = await safeFile(sourcePath);
      if ((await fileHash(source)) !== digest)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      const name = `${digest}${path.extname(source)}`;
      await copyFile(source, path.join(publicDir, name));
      if ((await fileHash(path.join(publicDir, name))) !== digest)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      sources.set(src, name);
    }
  }
  const plan = structuredClone(frozen.plan);
  const rewrite = (asset: ResolvedAsset) => {
    const src = sources.get(asset.src);
    if (!src) throw new StudioError("ASSET_RESOLUTION_FAILED");
    asset.src = src;
    if (asset.posterSrc) {
      const poster = sources.get(asset.posterSrc);
      if (!poster) throw new StudioError("ASSET_RESOLUTION_FAILED");
      asset.posterSrc = poster;
    }
  };
  for (const scene of plan.scenes)
    for (const node of scene.nodes) if (node.media) rewrite(node.media.asset);
  for (const cue of plan.audio) rewrite(cue.asset);
  const inputProps = { plan, assetMode: "static" };
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
  const composition = await selectComposition({
    serveUrl,
    id: "Studio",
    inputProps,
    browserExecutable,
  });
  const scale =
    input.kind === "render"
      ? 1
      : Math.min(
          1,
          (Math.floor(studioJobLimits.previewLongEdge / 32) * 32) /
            Math.max(plan.width, plan.height),
        );
  const fromFrame =
    input.kind === "still"
      ? input.frame
      : input.kind === "render"
        ? 0
        : input.fromFrame;
  const durationFrames =
    input.kind === "still"
      ? 1
      : input.kind === "render"
        ? plan.durationInFrames
        : input.durationFrames;
  const name =
    input.kind === "still"
      ? "frame.png"
      : input.kind === "audio"
        ? "audio.aac"
        : "video.mp4";
  const output = path.join(directory, name);
  const options = {
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    output,
    scale,
    timeoutInMilliseconds: studioJobLimits.frameTimeoutMs,
    mediaCacheSizeInBytes: studioJobLimits.mediaCacheBytes,
    offthreadVideoCacheSizeInBytes: studioJobLimits.mediaCacheBytes,
    logLevel: "error" as const,
  };
  if (input.kind === "still")
    await renderStill({ ...options, frame: fromFrame, imageFormat: "png" });
  else
    await renderMedia({
      ...options,
      outputLocation: output,
      codec: input.kind === "audio" ? "aac" : "h264",
      audioCodec: "aac",
      enforceAudioTrack: true,
      frameRange: [fromFrame, fromFrame + durationFrames - 1],
      concurrency: 1,
      onProgress: ({ progress }) => process.send?.({ progress }),
    });
  const bytes = (await stat(output)).size;
  if (bytes > studioJobLimits.maxOutputBytes)
    throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
  return {
    kind: input.kind,
    resource: {
      jobId: request.jobId,
      name,
      mimeType:
        input.kind === "still"
          ? "image/png"
          : input.kind === "audio"
            ? "audio/aac"
            : "video/mp4",
      bytes,
      hash: await fileHash(output),
    },
    width: input.kind === "audio" ? null : Math.round(plan.width * scale),
    height: input.kind === "audio" ? null : Math.round(plan.height * scale),
    fps: plan.fps,
    fromFrame,
    durationFrames,
    videoCodec:
      input.kind === "clip" || input.kind === "render" ? "h264" : null,
    audioCodec: input.kind === "still" ? null : "aac",
  };
}
