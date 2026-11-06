import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  renderMedia,
  renderStill,
} from "@remotion/renderer";
import { fileHash } from "./assets";
import { StudioError } from "./errors";
import {
  studioJobLimits,
  type StartStudioJobInput,
  type StudioJobResult,
} from "./job-types";
import type { StudioFrozenRevision } from "./types";
import { prepareStudioRender } from "./render-frames";
import { renderStoryboardAttempt } from "./storyboard-render";
import type { StoryboardRenderInput } from "./storyboard-types";
import { measureInspectionPreview } from "./preview-measurements";
export interface RenderAttempt {
  operation: "render";
  jobId: string;
  leaseToken: string;
  directory: string;
  engineId: string;
  frozen: StudioFrozenRevision;
  input: StartStudioJobInput | StoryboardRenderInput;
  compareFrozen?: StudioFrozenRevision;
  inspection?: boolean;
}
/** Complete selected source bytes, unchanged offsets and envelope; no original bindings. */
export async function renderStudioAttempt(
  request: RenderAttempt,
): Promise<StudioJobResult> {
  const { frozen, input } = request;
  if (input.kind === "storyboard") return renderStoryboardAttempt({ ...request, input });
  const { directory, serveUrl, plan, inputProps, browserExecutable, composition } = await prepareStudioRender(request);
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
    ...(request.inspection && input.kind !== "still" ? { measurements: await measureInspectionPreview(output) } : {}),
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
