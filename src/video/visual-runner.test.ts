import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodeVisualPng, encodeVisualPng, freezeVisualFixture, parseVisualArguments, verificationDirectory } from "../../scripts/visual-regression";
import { buildVisualFixtures } from "./visual-fixtures";
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
