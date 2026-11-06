import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { comparePngImages, readPngImage, writePngImage } from "./image-pixels";
let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "douga-pixels-")); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
const rgba = (width = 4, height = 4) => ({ width, height, data: new Uint8Array(width * height * 4).fill(255) });
it("writes a real black absolute-difference PNG for identical lossless images", async () => {
  const before = path.join(directory, "same-before.png"), after = path.join(directory, "same-after.png"), output = path.join(directory, "same-diff.png");
  await writePngImage(before, rgba()); await writePngImage(after, rgba());
  const result = await comparePngImages({ before, after, output });
  expect(result).toMatchObject({ status: "identical", metrics: { psnr: "Infinity", changedPixelRatio: 0, maxDelta: 0 }, path: output });
  const image = await readPngImage(output);
  expect([...image.data].every((value, i) => value === (i % 4 === 3 ? 255 : 0))).toBe(true);
});
it("detects a small alpha-only change and preserves exact RGBA through PNG", async () => {
  const before = path.join(directory, "alpha-before.png"), after = path.join(directory, "alpha-after.png"), output = path.join(directory, "alpha-diff.png"), image = rgba();
  await writePngImage(before, image); image.data[3] = 0; await writePngImage(after, image);
  expect([...(await readPngImage(after)).data]).toEqual([...image.data]);
  const result = await comparePngImages({ before, after, output });
  expect(result).toMatchObject({ status: "different", metrics: { changedPixelRatio: 1 / 16, maxDelta: 255 } });
  expect((await readPngImage(output)).data[0]).toBe(255);
});
it("reports missing or unequal dimensions as notComparable without a misleading diff", async () => {
  const before = path.join(directory, "dimension-before.png"), after = path.join(directory, "dimension-after.png"), output = path.join(directory, "dimension-diff.png");
  await writePngImage(before, rgba()); await writePngImage(after, rgba(5, 4));
  expect(await comparePngImages({ before, after, output })).toMatchObject({ status: "notComparable", reason: "dimension-mismatch" });
  expect(await comparePngImages({ before, output })).toMatchObject({ status: "notComparable", reason: "missing-after" });
});
it("rejects byte hash corruption and excessive image dimensions", async () => {
  const before = path.join(directory, "hash-before.png"), after = path.join(directory, "hash-after.png"), output = path.join(directory, "hash-diff.png");
  await writePngImage(before, rgba()); await writePngImage(after, rgba());
  const hash = createHash("sha256").update(await readFile(before)).digest("hex");
  expect((await comparePngImages({ before, after, output, beforeHash: hash })).status).toBe("identical");
  await expect(comparePngImages({ before, after, output, beforeHash: "0".repeat(64) })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });
  await expect(writePngImage(output, rgba(2048, 2048))).rejects.toMatchObject({ code: "IMAGE_PIXEL_BUDGET_EXCEEDED" });
});
