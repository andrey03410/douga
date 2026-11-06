import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { VERSION } from "remotion";
import { compareVisualFrame, type RgbaImage, type VisualEnvironment } from "@/video/visual-regression";
import { StudioError } from "./errors";

const MAX_PIXELS = 1920 * 1920, MAX_PNG_BYTES = 12 * 1024 * 1024;
export interface ImagePixelComparison {
  status: "identical" | "different" | "notComparable";
  metrics?: { psnr: number | "Infinity"; changedPixelRatio: number; maxDelta: number };
  reason?: string;
  path?: string;
}
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS)
    throw new StudioError("IMAGE_PIXEL_BUDGET_EXCEEDED");
}
/** Bound input, decoded output, stderr and wall time; no shell or external resource access. */
function transcode(args: string[], input: Uint8Array, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg!, ["-v", "error", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new StudioError("IMAGE_PROCESS_TIMEOUT")); }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maximum) { child.kill("SIGKILL"); reject(new StudioError("IMAGE_PIXEL_BUDGET_EXCEEDED")); } else chunks.push(chunk); });
    child.stderr.on("data", () => { /* Drain bounded process diagnostics without retaining private content. */ });
    child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new StudioError("IMAGE_PROCESS_FAILED")); });
    child.once("close", (code) => { clearTimeout(timer); if (code !== 0) reject(new StudioError("IMAGE_PROCESS_FAILED")); else resolve(Buffer.concat(chunks)); });
    child.stdin.end(input);
  });
}
export async function readPngImage(file: string, expectedHash?: string): Promise<RgbaImage> {
  if ((await stat(file)).size > MAX_PNG_BYTES) throw new StudioError("IMAGE_PIXEL_BUDGET_EXCEEDED");
  const png = await readFile(file);
  if (expectedHash && createHash("sha256").update(png).digest("hex") !== expectedHash) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new StudioError("IMAGE_FORMAT_INVALID");
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20); dimensions(width, height);
  const data = await transcode(["-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], png, width * height * 4);
  if (data.length !== width * height * 4) throw new StudioError("IMAGE_FORMAT_INVALID");
  return { width, height, data };
}
export async function writePngImage(file: string, image: RgbaImage) {
  dimensions(image.width, image.height);
  if (image.data.length !== image.width * image.height * 4) throw new StudioError("IMAGE_FORMAT_INVALID");
  const png = await transcode(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], image.data, MAX_PNG_BYTES);
  await writeFile(file, png);
}
/** Measured differences between arbitrary content are descriptive, never a quality verdict. */
export async function comparePngImages(input: { before?: string; after?: string; output: string; beforeHash?: string; afterHash?: string }): Promise<ImagePixelComparison> {
  if (!input.before || !input.after) return { status: "notComparable", reason: !input.before ? "missing-before" : "missing-after" };
  const before = await readPngImage(input.before, input.beforeHash), after = await readPngImage(input.after, input.afterHash);
  if (before.width !== after.width || before.height !== after.height) return { status: "notComparable", reason: "dimension-mismatch" };
  // Both PNGs come from this same worker/engine invocation. Font/content changes
  // are expected authored differences, rather than incompatible test environments.
  const environment: VisualEnvironment = { platform: process.platform, arch: process.arch, node: process.versions.node,
    browser: "same-studio-worker", remotion: VERSION, fontHashes: [], pixelFormat: "rgba", scale: 1 };
  const comparison = compareVisualFrame({ id: "authored-pair", actual: after, reference: before, environment, referenceEnvironment: environment });
  if (!comparison.metrics || !comparison.diff) return { status: "notComparable", reason: comparison.status };
  await writePngImage(input.output, comparison.diff);
  return { status: comparison.metrics.changedPixels === 0 ? "identical" : "different", path: input.output,
    metrics: { psnr: comparison.metrics.psnr === Infinity ? "Infinity" : comparison.metrics.psnr,
      changedPixelRatio: comparison.metrics.changedPixelRatio, maxDelta: comparison.metrics.maxDelta } };
}
