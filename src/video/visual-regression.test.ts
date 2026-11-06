import { describe, expect, it } from "vitest";
import { compareVisualFrame, summarizeVisualSuite, type VisualEnvironment } from "./visual-regression";
const environment: VisualEnvironment = { platform: "test", arch: "test", node: "22", browser: "test", remotion: "4", fontHashes: ["font"], pixelFormat: "rgba", scale: 1 };
const image = (width = 10, height = 10) => ({ width, height, data: new Uint8Array(width * height * 4).fill(255) });
const compare = (actual = image(), reference: ReturnType<typeof image> | undefined = image()) => compareVisualFrame({ id: "label", actual, reference, environment, referenceEnvironment: environment });
describe("visual pixel regression", () => {
  it("reports exact identity with infinite PSNR and black diff", () => {
    const result = compare();
    expect(result.status).toBe("passed");
    expect(result.metrics).toMatchObject({ psnr: Infinity, changedPixelRatio: 0, maxDelta: 0 });
    expect([...result.diff!.data].filter((_, i) => i % 4 !== 3).every((n) => n === 0)).toBe(true);
  });
  it("detects a vanished small label even when whole-frame PSNR is high", () => {
    const actual = image(100, 100), reference = image(100, 100);
    actual.data[0] = 0;
    const result = compareVisualFrame({ id: "small", actual, reference, environment, referenceEnvironment: environment, rois: [{ id: "label", x: 0, y: 0, width: 1, height: 1 }], tolerance: { maxChangedPixelRatio: 0.001, maxDelta: 255 } });
    expect(result.metrics!.psnr).toBeGreaterThan(40);
    expect(result.metrics!.changedPixelRatio).toBe(1 / 10000);
    expect(result.regions[0].status).toBe("failed");
    expect(result.status).toBe("failed");
    expect(result.diff!.data[0]).toBe(255);
  });
  it("treats alpha as a pixel channel", () => {
    const actual = image(); actual.data[3] = 0;
    expect(compare(actual).metrics!.maxDelta).toBe(255);
    expect(compare(actual).status).toBe("failed");
  });
  it("rejects dimension mismatch and missing reference separately", () => {
    expect(compare(image(11)).status).toBe("dimension-mismatch");
    expect(compareVisualFrame({ id: "missing", actual: image(), environment }).status).toBe("missing-baseline");
  });
  it("rejects incompatible environment before pixel comparison", () => {
    expect(compareVisualFrame({ id: "env", actual: image(), reference: image(), environment, referenceEnvironment: { ...environment, browser: "other" } }).status).toBe("environment-mismatch");
  });
  it("does not excuse pixels when only engine provenance changes", () => {
    const actual = image(); actual.data[0] = 0;
    expect(compareVisualFrame({ id: "engine", actual, reference: image(), environment, referenceEnvironment: environment, engineId: "new", referenceEngineId: "old" }).status).toBe("failed");
  });
  it("fails a suite with one mandatory failure or no checked frames", () => {
    expect(summarizeVisualSuite([compare(), compare(image(11))]).passed).toBe(false);
    expect(summarizeVisualSuite([compare()]).passed).toBe(true);
    expect(summarizeVisualSuite([]).passed).toBe(false);
  });
  it("rejects malformed buffers and out-of-bounds ROI rather than ignoring them", () => {
    expect(() => compare({ width: 10, height: 10, data: new Uint8Array(3) })).toThrow();
    expect(() => compareVisualFrame({ id: "roi", actual: image(), reference: image(), environment, referenceEnvironment: environment, rois: [{ id: "bad", x: 9, y: 0, width: 2, height: 1 }] })).toThrow();
  });
});
