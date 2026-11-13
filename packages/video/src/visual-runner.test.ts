import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { compareCliVisualFrame, summarizeCliVisualFrames, cliVisualComparisonPolicy, decodeVisualPng, encodeVisualPng, freezeVisualFixture, parseVisualArguments, verificationDirectory } from "../../../scripts/visual-regression";
import { buildVisualFixtures } from "./visual-fixtures";
import { compareVisualFrame, type RgbaImage, type VisualEnvironment } from "./visual-regression";
const directories: string[] = [];
async function temporary() {
  await mkdir(verificationDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(verificationDirectory, "unit-")); directories.push(directory); return directory;
}
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
describe("visual runner", () => {
  it("requires both explicit acceptance and its reason", () => {
    expect(() => parseVisualArguments(["accept", "--reason", "reviewed"])).toThrow();
    expect(() => parseVisualArguments(["accept", "--confirm"])).toThrow();
    expect(() => parseVisualArguments(["accept", "--confirm", "--reason", "   "])).toThrow();
    expect(parseVisualArguments(["accept", "--confirm", "--reason", "Reviewed transitions"])).toMatchObject({ command: "accept", confirm: true, reason: "Reviewed transitions" });
  });
  it("does not silently accept misspelled or unsafe diagnostic arguments", () => {
    expect(() => parseVisualArguments(["render", "--limit", "0"])).toThrow();
    expect(() => parseVisualArguments(["render", "--limit", "NaN"])).toThrow();
    expect(() => parseVisualArguments(["render", "--filter"])).toThrow();
    expect(() => parseVisualArguments(["render", "--acccept"])).toThrow();
  });
  it("round-trips exact RGBA pixels through lossless PNG including transparent pixels", async () => {
    const data = new Uint8Array([255, 1, 70, 0, 5, 240, 6, 128, 0, 50, 255, 255, 24, 33, 66, 1]), file = path.join(await temporary(), "rgba.png");
    await encodeVisualPng(file, { width: 2, height: 2, data });
    const result = await decodeVisualPng(file);
    expect(result.width).toBe(2); expect(result.height).toBe(2); expect([...result.data]).toEqual([...data]);
  });
  it("freezes actual local artwork, PCM and all compiled fonts with verified hashes", async () => {
    const fixture = buildVisualFixtures().find((f) => f.id === "typography.example.character-picker.wide")!;
    const frozen = await freezeVisualFixture(fixture, await temporary());
    expect(frozen.validation.ready).toBe(true);
    expect(frozen.plan.fonts!.length).toBeGreaterThan(0);
    expect(Object.keys(frozen.files)).toHaveLength(5);
    for (const file of [...Object.values(frozen.files), ...Object.values(frozen.fontFiles!)]) {
      const data = await readFile(path.join(process.cwd(), "storage", file.path));
      expect(data.length).toBe(file.bytes); expect(createHash("sha256").update(data).digest("hex")).toBe(file.hash);
    }
    for (const font of frozen.plan.fonts!) { expect(frozen.fontFiles![font.hash]).toBeDefined(); expect(frozen.fontFiles![font.licenseHash]).toBeDefined(); }
  });
});

const calibrationEnvironment: VisualEnvironment = { platform: "test", arch: "test", node: "22", browser: "bundled", remotion: "4", fontHashes: [], pixelFormat: "rgba", scale: 1, rasterizer: "swangle" };
const calibrationImage = (width = 32): RgbaImage => ({ width, height: 32, data: new Uint8Array(width * 32 * 4).fill(128) });
function calibrated(count = 0, delta = 1, startPixel = 100, insideRoi = false) {
  const actual = calibrationImage(), reference = calibrationImage();
  for (let pixel = startPixel; pixel < startPixel + count; pixel++) actual.data[pixel * 4] += delta;
  return { id: `${count}-${delta}`, actual, reference, environment: calibrationEnvironment, referenceEnvironment: calibrationEnvironment,
    rois: insideRoi ? [{ id: "critical-label", x: 0, y: 0, width: 2, height: 2 }] : [] };
}
describe("fixed CLI quantization calibration with exact static ROIs", () => {
  it("accepts at most four one-LSB pixels outside ROIs and retains raw metrics", () => {
    const result = compareCliVisualFrame(calibrated(4, 1, 100, true));
    expect(result.status).toBe("passed");
    expect(result.metrics).toMatchObject({ changedPixels: 4, changedPixelRatio: 4 / 1024, maxDelta: 1 });
    expect(result.metrics!.psnr).toBeLessThan(Infinity);
    expect(cliVisualComparisonPolicy).toMatchObject({ maxChangedPixels: 4, maxDelta: 1, roiScope: "compiled-static-rects", tracksMotion: false });
  });
  it("rejects five pixels, delta two, and the former high-contrast raster drift", () => {
    expect(compareCliVisualFrame(calibrated(5)).status).toBe("failed");
    expect(compareCliVisualFrame(calibrated(1, 2)).status).toBe("failed");
    expect(compareCliVisualFrame(calibrated(550, 60)).status).toBe("failed");
  });
  it("still fails a single LSB inside an existing ROI without changing its geometry", () => {
    const input = calibrated(1, 1, 0, true), original = structuredClone(input.rois);
    const result = compareCliVisualFrame(input);
    expect(result.status).toBe("failed"); expect(result.regions[0].status).toBe("failed");
    expect(result.regions[0].metrics).toMatchObject({ changedPixels: 1, maxDelta: 1 });
    expect(input.rois).toEqual(original);
  });
  it("does not loosen SDK/project comparison or dimension/environment/missing guards", () => {
    const input = calibrated(1);
    expect(compareVisualFrame(input).status).toBe("failed");
    expect(compareCliVisualFrame({ ...input, reference: calibrationImage(33) }).status).toBe("dimension-mismatch");
    expect(compareCliVisualFrame({ ...input, reference: undefined }).status).toBe("missing-baseline");
    expect(compareCliVisualFrame({ ...input, referenceEnvironment: { ...calibrationEnvironment, browser: "other" } }).status).toBe("environment-mismatch");
  });
  it("reports exact and bounded-noise frames separately and keeps any ROI failure red", () => {
    const result = summarizeCliVisualFrames([compareCliVisualFrame(calibrated()), compareCliVisualFrame(calibrated(4)), compareCliVisualFrame(calibrated(1, 1, 0, true))]);
    expect(result).toMatchObject({ passed: false, exactFrames: 1, boundedNoiseFrames: 1 });
    expect(result.failed).toHaveLength(1);
  });
});
