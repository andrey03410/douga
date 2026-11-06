/**
 * npx tsx --tsconfig tsconfig.mcp.json scripts/visual-regression.ts render|check|accept
 * Baselines are reviewed source artifacts. Actuals, frozen inputs and reports stay in storage.
 */
import path from "node:path";
import { release } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";
import { ensureBrowser } from "@remotion/renderer";
import { VERSION } from "remotion";
import { buildVisualFixtures, visualFixtureCoverage, visualFixtureMedia, visualFixtureVersion, type VisualFixture } from "../src/video/visual-fixtures";
import { compareVisualFrame, summarizeVisualSuite, type RgbaImage, type VisualEnvironment, type VisualFrameResult, type VisualRegion } from "../src/video/visual-regression";
import { compileVideo } from "../src/video/compiler";
import { getTypographyMeasureText, freezeTypographyFonts } from "../src/server/studio/typography-fonts";
import { prepareStudioEngine } from "../src/server/studio/engine";
import { renderStudioFrames } from "../src/server/studio/render-frames";
import type { StudioFrozenRevision } from "../src/server/studio/types";
import { runtime } from "../src/server/studio/assets";

const root = process.cwd();
export const baselineDirectory = path.join(root, ".ai/features/32-storyboard-reference/baselines");
export const verificationDirectory = path.join(root, "storage/verification/32-storyboard");
const storageRelative = (absolute: string) => path.relative(path.join(root, "storage"), absolute);
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const json = (value: unknown) => JSON.stringify(value, (_key, value) => value === Infinity ? "Infinity" : value, 2);
interface FrameRecord {
  id: string; fixtureId: string; frame: number; fixtureHash: string; pngHash: string; file: string;
  width: number; height: number; environment: VisualEnvironment; engineId: string;
  rois: VisualRegion[]; reasons: VisualFixture["frames"];
}
interface RunManifest {
  version: 1; fixtureVersion: number; catalogHash: string; coverage: ReturnType<typeof visualFixtureCoverage>;
  fixtureIds: string[]; fixtureCoverage: { id: string; sampling: VisualFixture["sampling"] }[]; selectedFixtureIds: string[]; complete: boolean; frames: FrameRecord[];
  accepted?: { reason: string; at: string };
}
export function parseVisualArguments(args: string[]) {
  const command = args.shift();
  if (!["render", "check", "accept"].includes(command ?? "")) throw new Error("Usage: visual-regression.ts render|check|accept [--filter text] [--limit count] [--reason text --confirm]");
  let filter: string | undefined, limit: number | undefined, reason: string | undefined, confirm = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === "--confirm") confirm = true;
    else if (arg === "--filter" || arg === "--limit" || arg === "--reason") {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--filter") filter = value;
      else if (arg === "--reason") reason = value.trim();
      else { limit = Number(value); if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer"); }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (command === "accept" && (!confirm || !reason)) throw new Error("accept requires --confirm and a nonempty --reason after image review");
  return { command, filter, limit, reason, confirm };
}
function processBytes(executable: string, args: string[], input?: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] }), output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", (chunk) => output.push(chunk)); child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`Media process failed (${code}): ${Buffer.concat(errors).toString().slice(-1200)}`)));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
export async function decodeVisualPng(file: string): Promise<RgbaImage> {
  const png = await readFile(file);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length < 24) throw new Error("INVALID_PNG");
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (width <= 0 || height <= 0 || width * height > 1920 * 1920) throw new Error("INVALID_PNG_DIMENSIONS");
  const data = await processBytes(ffmpeg!, ["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], png);
  if (data.length !== width * height * 4) throw new Error("INVALID_DECODED_RGBA");
  return { width, height, data };
}
export async function encodeVisualPng(file: string, image: RgbaImage) {
  await mkdir(path.dirname(file), { recursive: true });
  const png = await processBytes(ffmpeg!, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], image.data);
  await writeFile(file, png);
}
async function environment(browserExecutable: string): Promise<VisualEnvironment> {
  const version = (await processBytes(browserExecutable, ["--version"])).toString().trim();
  return { platform: process.platform, arch: process.arch, node: process.versions.node, osVersion: release(), ffmpeg: sha256(await readFile(ffmpeg!)), colorSpace: "srgb", browser: `${version};binary-sha256=${sha256(await readFile(browserExecutable))}`, remotion: VERSION, fontHashes: [], pixelFormat: "rgba", scale: 1, rasterizer: "swangle" };
}
function pixelRegions(plan: StudioFrozenRevision["plan"], frame: number): VisualRegion[] {
  const regions: VisualRegion[] = [];
  for (const scene of plan.scenes.filter((s) => frame >= s.from && frame < s.from + s.durationInFrames)) {
    for (const node of scene.nodes) {
      if (!(node.text || node.label || node.type === "timer" || node.type === "badge")) continue;
      const x = Math.max(0, Math.floor(node.rect.x)), y = Math.max(0, Math.floor(node.rect.y));
      const width = Math.min(plan.width - x, Math.ceil(node.rect.width)), height = Math.min(plan.height - y, Math.ceil(node.rect.height));
      if (width > 0 && height > 0) regions.push({ id: node.id, x, y, width, height });
    }
  }
  return regions;
}
export async function freezeVisualFixture(fixture: VisualFixture, directory: string): Promise<StudioFrozenRevision> {
  const document = structuredClone(fixture.document), manifest = structuredClone(fixture.manifest), files: StudioFrozenRevision["files"] = {};
  for (const media of visualFixtureMedia()) {
    const file = path.join(directory, "inputs", media.filename);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, media.data);
    manifest[media.id].hash = sha256(media.data);
    manifest[media.id].src = `fixture:${media.id}`;
    files[media.id] = { path: storageRelative(file), hash: sha256(media.data), bytes: media.data.length };
  }
  const result = compileVideo(document, manifest, { measureText: await getTypographyMeasureText() });
  if (!result.ready) throw new Error(`FIXTURE_NOT_RENDERABLE:${fixture.id}:${json(result.diagnostics)}`);
  const fontFiles = await freezeTypographyFonts(result.plan.fonts, storageRelative(path.join(directory, "inputs")));
  const hash = sha256(json({ document, manifest, files, fonts: result.plan.fonts }));
  return { snapshotId: fixture.id, projectId: `fixture-${fixture.id}`, revisionId: fixture.id, revision: 1, sourceVersion: null, document, resolvedDocument: structuredClone(document), manifest, files, fontFiles, plan: result.plan, validation: { ready: result.ready, diagnostics: result.diagnostics }, runtime, hash };
}
function catalog(fixtures: VisualFixture[]) {
  return { fixtureVersion: visualFixtureVersion, catalogHash: sha256(json(fixtures)), coverage: visualFixtureCoverage(fixtures), fixtureIds: fixtures.map((f) => f.id), fixtureCoverage: fixtures.map((f) => ({ id: f.id, sampling: f.sampling })) };
}
export async function renderVisualFixtures(options: ReturnType<typeof parseVisualArguments>) {
  const fixtures = buildVisualFixtures(), full = catalog(fixtures);
  const selected = fixtures.filter((f) => !options.filter || f.id.includes(options.filter)).slice(0, options.limit);
  if (!selected.length) throw new Error("NO_MATCHING_FIXTURES");
  // Golden frames use Remotion's tested bundled browser rather than a mutable
  // system installation. The override is local to this call, never process.env.
  const browser = await ensureBrowser({ chromeMode: "headless-shell" });
  if (!("path" in browser)) throw new Error(`BROWSER_UNAVAILABLE:${browser.type}`);
  const browserExecutable = browser.path;
  const env = await environment(browserExecutable), engineId = await prepareStudioEngine();
  const run: RunManifest = { version: 1, ...full, selectedFixtureIds: selected.map((f) => f.id), complete: false, frames: [] };
  await mkdir(verificationDirectory, { recursive: true });
  await writeFile(path.join(verificationDirectory, "actual-manifest.json"), json(run));
  for (const [index, fixture] of selected.entries()) {
    const directory = path.join(verificationDirectory, "actual", fixture.id), frozen = await freezeVisualFixture(fixture, directory);
    const frames = [...new Set(fixture.frames.map((f) => f.frame))].sort((a, b) => a - b);
    const rendered: { frame: number; path: string }[] = [];
    for (let offset = 0; offset < frames.length; offset += 64) rendered.push(...await renderStudioFrames({ directory: storageRelative(path.join(directory, "render")), engineId, frozen, frames: frames.slice(offset, offset + 64), scale: 1, rasterizer: "swangle", browserExecutable }));
    if (rendered.length !== frames.length || frames.some((frame) => !rendered.some((r) => r.frame === frame))) throw new Error(`INCOMPLETE_RENDER:${fixture.id}`);
    const frameEnvironment = { ...env, fontHashes: [...new Set((frozen.plan.fonts ?? []).map((f) => f.hash))].sort() };
    for (const frame of rendered) {
      const file = path.join("actual", fixture.id, `${frame.frame}.png`), png = await readFile(frame.path), destination = path.join(verificationDirectory, file);
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, png);
      const image = await decodeVisualPng(destination);
      if (image.width !== frozen.plan.width || image.height !== frozen.plan.height) throw new Error(`FULL_RESOLUTION_REQUIRED:${fixture.id}`);
      run.frames.push({ id: `${fixture.id}@${frame.frame}`, fixtureId: fixture.id, frame: frame.frame, fixtureHash: sha256(json(fixture)), pngHash: sha256(png), file, width: image.width, height: image.height, environment: frameEnvironment, engineId, rois: pixelRegions(frozen.plan, frame.frame), reasons: fixture.frames.filter((f) => f.frame === frame.frame) });
    }
    await writeFile(path.join(verificationDirectory, "actual-manifest.json"), json(run));
    await rm(path.join(directory, "render"), { recursive: true, force: true });
    console.log(`[${index + 1}/${selected.length}] ${fixture.id}: ${frames.length} frames`);
  }
  run.complete = selected.length === fixtures.length;
  await writeFile(path.join(verificationDirectory, "actual-manifest.json"), json(run));
  return { fixtures: selected.length, frames: run.frames.length, complete: run.complete, manifest: path.join(verificationDirectory, "actual-manifest.json") };
}
async function readManifest(file: string): Promise<RunManifest> { return JSON.parse(await readFile(file, "utf8")); }
function artifactPath(directory: string, file: string) {
  const resolved = path.resolve(directory, file);
  if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error("INVALID_ARTIFACT_PATH");
  return resolved;
}
async function readVerified(directory: string, record: FrameRecord) {
  const file = artifactPath(directory, record.file);
  if (sha256(await readFile(file)) !== record.pngHash) throw new Error(`ARTIFACT_HASH_MISMATCH:${record.id}`);
  return decodeVisualPng(file);
}
export async function checkVisualFixtures(options: ReturnType<typeof parseVisualArguments>) {
  const actual = await readManifest(path.join(verificationDirectory, "actual-manifest.json"));
  let reference: RunManifest | undefined;
  try { reference = await readManifest(path.join(baselineDirectory, "manifest.json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const expected = buildVisualFixtures(), full = catalog(expected), current = new Map(expected.map((f) => [f.id, sha256(json(f))]));
  const selectedIds = expected.filter((f) => !options.filter || f.id.includes(options.filter)).slice(0, options.limit).map((f) => f.id);
  if (!selectedIds.length) throw new Error("NO_MATCHING_FIXTURES");
  const results: (VisualFrameResult & { actual?: string; reference?: string; diffFile?: string; reason?: string })[] = [];
  for (const fixtureId of selectedIds) {
    const fixture = expected.find((f) => f.id === fixtureId)!;
    for (const frame of [...new Set(fixture.frames.map((f) => f.frame))]) {
      const id = `${fixtureId}@${frame}`, a = actual.frames.find((f) => f.id === id), r = reference?.frames.find((f) => f.id === id);
      if (!a) { results.push({ id, status: "failed", mandatory: true, regions: [], reason: "missing-actual" }); continue; }
      if (a.fixtureHash !== current.get(fixtureId) || (r && r.fixtureHash !== a.fixtureHash)) { results.push({ id, status: "failed", mandatory: true, regions: [], reason: "fixture-mismatch", actual: a.file, reference: r?.file }); continue; }
      let referenceImage: RgbaImage | undefined;
      try { if (r) referenceImage = await readVerified(baselineDirectory, r); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const result = compareVisualFrame({ id, actual: await readVerified(verificationDirectory, a), reference: referenceImage, environment: a.environment, referenceEnvironment: r?.environment, engineId: a.engineId, referenceEngineId: r?.engineId, rois: r?.rois ?? a.rois });
      const diffFile = result.diff ? path.join("diff", fixtureId, `${frame}.png`) : undefined;
      if (result.diff && diffFile) await encodeVisualPng(path.join(verificationDirectory, diffFile), result.diff);
      const { diff: _diff, ...compact } = result;
      results.push({ ...compact, actual: a.file, reference: r?.file, diffFile });
    }
  }
  const summary = summarizeVisualSuite(results), complete = selectedIds.length === expected.length && actual.complete && actual.catalogHash === full.catalogHash;
  const report = { version: 1, ...full, complete, selectionPassed: summary.passed, ...summary, passed: complete && summary.passed, results };
  await writeFile(path.join(verificationDirectory, "report.json"), json(report));
  const rows = results.map((r) => `<tr><td>${r.id}<br>${r.status}${r.reason ? `: ${r.reason}` : ""}<br>PSNR ${r.metrics?.psnr ?? "—"}<br>changed ${r.metrics?.changedPixelRatio ?? "—"}<br>max Δ ${r.metrics?.maxDelta ?? "—"}<br>ROI failures: ${r.regions.filter((region) => region.status !== "passed").map((region) => region.id).join(", ")}</td>${[r.reference ? path.relative(verificationDirectory, artifactPath(baselineDirectory, r.reference)) : undefined, r.actual, r.diffFile].map((src) => `<td>${src ? `<a href="${src}"><img src="${src}" loading="lazy" width="320"></a>` : "absent"}</td>`).join("")}</tr>`);
  await writeFile(path.join(verificationDirectory, "report.html"), `<!doctype html><meta charset="utf-8"><title>Douga visual regression</title><style>body{font:14px sans-serif;background:#171b24;color:white}td{border:1px solid #777;padding:8px;vertical-align:top}img{max-height:300px;object-fit:contain}a{color:#9cf}</style><h1>Визуальная регрессия: ${report.passed ? "PASS" : "FAIL"}</h1><p>Полнота: ${complete}; выборка: ${selectedIds.length}/${expected.length}; успешная выборка: ${report.selectionPassed}. Точный RGBA, масштаб 1.</p><table><tr><th>Кадр</th><th>Reference</th><th>Actual</th><th>Absolute difference</th></tr>${rows.join("")}</table>`);
  return report;
}
export async function acceptVisualFixtures(reason: string, confirm: boolean) {
  if (!confirm || !reason.trim()) throw new Error("ACCEPT_CONFIRMATION_REQUIRED");
  const actual = await readManifest(path.join(verificationDirectory, "actual-manifest.json")), expected = catalog(buildVisualFixtures());
  if (!actual.complete || actual.catalogHash !== expected.catalogHash || actual.fixtureIds.length !== actual.selectedFixtureIds.length) throw new Error("ACCEPT_REQUIRES_COMPLETE_CURRENT_RUN");
  const fixtureFrames = buildVisualFixtures().flatMap((f) => [...new Set(f.frames.map((frame) => frame.frame))].map((frame) => `${f.id}@${frame}`));
  if (actual.frames.length !== fixtureFrames.length || fixtureFrames.some((id) => !actual.frames.some((f) => f.id === id))) throw new Error("ACCEPT_REQUIRES_ALL_FRAMES");
  const frames: FrameRecord[] = [];
  for (const record of actual.frames) {
    await readVerified(verificationDirectory, record);
    const file = path.join("frames", record.fixtureId, `${record.frame}.png`), target = artifactPath(baselineDirectory, file);
    await mkdir(path.dirname(target), { recursive: true }); await copyFile(artifactPath(verificationDirectory, record.file), target);
    frames.push({ ...record, file });
  }
  const accepted: RunManifest = { ...actual, frames, accepted: { reason: reason.trim(), at: new Date().toISOString() } };
  await writeFile(path.join(baselineDirectory, "manifest.json"), json(accepted));
  return { accepted: frames.length, reason: reason.trim() };
}
async function main() {
  const options = parseVisualArguments(process.argv.slice(2));
  if (options.command === "render") console.log(json(await renderVisualFixtures(options)));
  else if (options.command === "accept") console.log(json(await acceptVisualFixtures(options.reason!, options.confirm)));
  else { const report = await checkVisualFixtures(options); console.log(json({ passed: report.passed, selectionPassed: report.selectionPassed, complete: report.complete, total: report.total, failed: report.failed, report: path.join(verificationDirectory, "report.html") })); if (!report.passed) process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : "VISUAL_REGRESSION_FAILED"); process.exitCode = 1; });
