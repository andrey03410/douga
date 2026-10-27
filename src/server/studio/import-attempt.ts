import "server-only";
import { randomUUID } from "node:crypto";
import { stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { absPath } from "@/lib/storage";
import { probeUrl, downloadMedia } from "@/lib/ytdlp";
import { preparePoolArtFromFile } from "@/server/arts";
import { assertPublicUrl } from "@/server/media-url";
import { fileHash } from "./assets";
import { filesUnder } from "./engine";
import { StudioError } from "./errors";
import {
  studioJobLimits,
  startStudioImportSchema,
  type StartStudioImportInput,
} from "./job-types";
import type { PreparedStudioImport } from "./imports";
export interface ImportAttempt {
  operation: "import";
  jobId: string;
  leaseToken: string;
  directory: string;
  input: StartStudioImportInput;
  maxBytes: number;
}

export async function importStudioAttempt(
  request: ImportAttempt,
): Promise<PreparedStudioImport> {
  const input = startStudioImportSchema.parse(request.input);
  const dir = absPath(request.directory);
  await mkdir(dir, { recursive: true });
  // yt-dlp's max-filesize does not cap unknown-size/fragmented downloads. Bound
  // the complete attempt, including normalization and staging copies, as well.
  let checking = false;
  const diskGuard = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      let size = 0;
      for (const file of await filesUnder(dir))
        size += (await stat(file).catch(() => ({ size: 0 }))).size;
      if (size > studioJobLimits.importMaxTemporaryBytes) {
        process.send?.({ error: "INPUT_BUDGET_EXCEEDED" });
        if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
        else process.exit(1);
      }
    } finally {
      checking = false;
    }
  }, 1000);
  try {
    // Same SSRF guard as at enqueue: DNS may point elsewhere by now. A blocked
    // host is terminal; an unresolvable one is a transient import failure.
    await assertPublicUrl(new URL(input.url)).catch((e: Error) => {
      throw new StudioError(
        e.message === "BLOCKED_HOST" ? "BLOCKED_HOST" : "IMPORT_FAILED",
      );
    });
    const probe = await probeUrl(input.url, input.mode, input.quality ?? 1080);
    if (
      probe.durationSec &&
      probe.durationSec > studioJobLimits.importMaxDurationSec
    )
      throw new StudioError("IMPORT_DURATION_EXCEEDED");
    if (probe.estimatedBytes && probe.estimatedBytes > request.maxBytes)
      throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
    const downloaded = await downloadMedia({
      url: input.url,
      mode: input.mode,
      quality: input.quality ?? 1080,
      dir: path.join(dir, "download"),
      maxBytes: request.maxBytes,
      onProgress: (n) => process.send?.({ progress: 0.05 + n * 0.7 }),
    });
    if ((await stat(downloaded.filePath)).size > request.maxBytes)
      throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
    // Normalize generic extractor files too; stream selectors alone do not
    // guarantee H.264/AAC or apply a height cap to direct URLs.
    const normalized = path.join(
      dir,
      input.mode === "video" ? "normalized.mp4" : "normalized.m4a",
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpegPath!,
        [
          "-nostdin",
          "-y",
          "-i",
          downloaded.filePath,
          "-t",
          String(studioJobLimits.importMaxDurationSec + 1),
          ...(input.mode === "video"
            ? [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-vf",
                `scale=-2:trunc(min(ih\\,${input.quality ?? 1080})/2)*2`,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
              ]
            : ["-vn"]),
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          normalized,
        ],
        { stdio: "ignore" },
      );
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new StudioError("IMPORT_MEDIA_INVALID")),
      );
    });
    const art = await preparePoolArtFromFile({
      id: randomUUID(),
      sourcePath: normalized,
      directory: `${request.directory}/pool`,
      kind: input.mode,
      label: probe.title?.slice(0, 500) ?? null,
    });
    if (art.durationSec! > studioJobLimits.importMaxDurationSec)
      throw new StudioError("IMPORT_DURATION_EXCEEDED");
    if (art.sizeBytes > request.maxBytes)
      throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
    return {
      art,
      result: {
        kind: "import",
        asset: {
          id: art.id,
          kind: input.mode,
          bytes: art.sizeBytes,
          hash: await fileHash(absPath(art.filePath)),
          mimeType: input.mode === "video" ? "video/mp4" : "audio/mp4",
          durationSec: art.durationSec!,
          hasAudio: art.hasAudio,
          hasVideo: input.mode === "video",
          poster: Boolean(art.posterPath),
        },
      },
    };
  } finally {
    clearInterval(diskGuard);
  }
}
