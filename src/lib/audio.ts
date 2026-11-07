// Server-only media service. Uses the bundled ffmpeg binary (ffmpeg-static) so no
// system ffmpeg is required. Decodes PCM for RMS analysis, probes stream layout,
// extracts video posters and finds the loudest snippet.
import "server-only";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { selectActiveSnippet, type Snippet } from "./domain/rms";
import { captureMediaProbe } from "./media-probe";

const FFMPEG = ffmpegPath as unknown as string;
/** Low sample rate is plenty for energy analysis and keeps decoding fast. */
const ANALYSIS_RATE = 8000;

function run(args: string[], input?: Buffer, timeoutMs?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), timeoutMs) : null;
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code ?? signal}: ${Buffer.concat(err).toString()}`));
    });
    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

export interface MediaInfo {
  durationSec: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

/**
 * Probe a media file's stream layout via ffmpeg stderr. Cover art embedded in
 * audio files shows up as an "attached pic" video stream and is not counted.
 * Capture is deadline/byte bounded; ordinary missing/unreadable inputs retain
 * the legacy null/false metadata fallback, while limit errors stay actionable.
 */
export async function probeMediaInfo(inputPath: string): Promise<MediaInfo> {
  const proc = spawn(FFMPEG, ["-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] });
  const text = await captureMediaProbe(proc);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const durationSec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  const streams = text.split("\n").filter((l) => /Stream #\d+/.test(l));
  return {
    durationSec,
    hasAudio: streams.some((l) => /:\s*Audio:/.test(l)),
    hasVideo: streams.some((l) => /:\s*Video:/.test(l) && !l.includes("attached pic")),
  };
}

/** Extract a poster frame (jpg). Seeks ~0.5s in; falls back to the first frame. */
export async function extractPoster(inputPath: string, outputPath: string): Promise<void> {
  const wrote = async () =>
    ((await stat(outputPath).catch(() => null))?.size ?? 0) > 0;
  try {
    await run(["-y", "-ss", "0.5", "-i", inputPath, "-frames:v", "1", "-q:v", "3", outputPath]);
    if (await wrote()) return;
  } catch {
    // very short video: 0.5s seek lands past the end -> retry from frame 0
  }
  await run(["-y", "-i", inputPath, "-frames:v", "1", "-q:v", "3", outputPath]);
}

/**
 * Task 33: a small JPEG of a picture participant for the compare grid. The
 * first frame only (GIFs are served as is by the caller, they keep moving).
 */
export async function makeThumbnail(inputPath: string, outputPath: string, width = 480): Promise<void> {
  await run([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale='min(${width},iw)':-2`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    outputPath,
  ], undefined, 30_000); // a stuck decoder must not hold a thumbnail slot forever
}

/** Decode a file to mono float32 PCM at ANALYSIS_RATE for RMS analysis. */
export async function decodePcm(
  inputPath: string,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const raw = await run([
    "-i",
    inputPath,
    "-ac",
    "1",
    "-ar",
    String(ANALYSIS_RATE),
    "-f",
    "f32le",
    "-",
  ]);
  const samples = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    Math.floor(raw.byteLength / 4),
  );
  return { samples, sampleRate: ANALYSIS_RATE };
}

/** Compute the most active snippet of `windowSec` seconds in a track. */
export async function findActiveSnippet(
  inputPath: string,
  windowSec: number,
): Promise<Snippet> {
  const { samples, sampleRate } = await decodePcm(inputPath);
  return selectActiveSnippet(samples, sampleRate, windowSec);
}
