import { afterAll, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedTypography } from "@douga/video/typography-types";
import { createTypographyMeasureText, getTypographyMeasureText } from "./typography-fonts";

const style = (overrides: Partial<ResolvedTypography> = {}) => ({
  font: "arimo", weight: 400, italic: false, fontSize: 100, letterSpacing: 0,
  ...overrides,
}) as ResolvedTypography;
const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

describe("pinned typography measurement", () => {
  it("shapes actual proportional and monospace faces instead of character estimates", async () => {
    const measure = await getTypographyMeasureText();
    expect(measure("WWW", style()).width).toBeGreaterThan(measure("iii", style()).width * 3);
    expect(measure("AV", style()).width).toBeLessThan(measure("A", style()).width + measure("V", style()).width);
    const mono = style({ font: "roboto-mono" });
    expect(measure("WWW", mono).width).toBeCloseTo(measure("iii", mono).width, 5);
    expect(measure("AV", style({ fontSize: 50 })).width).toBeCloseTo(measure("AV", style()).width / 2, 5);
    expect(measure("abc", style({ letterSpacing: 2 })).width).toBeCloseTo(measure("abc", style()).width + 4, 5);
  });
  it("selects pinned Japanese fallback and reports characters absent from all faces", async () => {
    const measure = await getTypographyMeasureText();
    const jp = measure("Ария 東京", style());
    expect(jp.fonts).toEqual(["arimo-400-normal", "noto-sans-jp-400-normal"]);
    expect(jp.missing).toEqual([]);
    expect(jp.width).toBeGreaterThan(200);
    expect(measure("東京", style({ font: "noto-serif-jp", weight: 700 })).fonts).toEqual(["noto-serif-jp-700-normal"]);
    expect(measure("a\u{10ffff}", style()).missing).toEqual(["\u{10ffff}"]);
  });
  it("keeps fallback coverage when a grapheme needs characters from two fonts", async () => {
    const measure = await getTypographyMeasureText();
    const cluster = measure("東\u0302", style());
    expect(cluster.fonts).toEqual(["noto-sans-jp-400-normal", "arimo-400-normal"]);
    expect(cluster.missing).toEqual([]);
    expect(cluster.width).toBeCloseTo(measure("東", style()).width, 5);
  });
  it("uses real weight/italic faces and refuses unsupported synthetic faces", async () => {
    const measure = await getTypographyMeasureText();
    expect(measure("Привет", style({ weight: 700, italic: true })).fonts).toEqual(["arimo-700-italic"]);
    expect(() => measure("text", style({ font: "manrope", italic: true }))).toThrow("TEXT_FONT_FACE_UNSUPPORTED");
  });
  it("fails closed when bundled font bytes do not match the pinned hash", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "douga-fonts-"));
    directories.push(directory);
    await cp("public/fonts/typography-v1", directory, { recursive: true });
    const file = path.join(directory, "arimo-normal.ttf");
    const data = await readFile(file);
    data[100] ^= 1;
    await writeFile(file, data);
    await expect(createTypographyMeasureText({ directory })).rejects.toThrow("FONT_HASH_MISMATCH");
  });
});

describe("frozen typography resources", () => {
  it("copies only selected bytes and licenses, sharing variable files across weights", async () => {
    const { freezeTypographyFonts, verifyTypographyFonts } = await import("./typography-fonts");
    const { typographyFontAssets } = await import("@douga/video/font-manifest");
    const { absPath } = await import("@/lib/storage");
    const directory = `studio-font-test/${Date.now()}`;
    directories.push(absPath(directory));
    const fonts = structuredClone(typographyFontAssets.filter((face) => face.font === "arimo" && face.style === "normal"));
    const files = await freezeTypographyFonts(fonts, directory);
    expect(Object.keys(files)).toHaveLength(2);
    expect(fonts[0].src).toMatch(/^\/api\/studio\/media\?path=/);
    expect(fonts[0].src).toEqual(fonts[1].src);
    expect(fonts[0].license).toMatch(/^\/api\/studio\/media\?path=/);
    await expect(verifyTypographyFonts(fonts, files)).resolves.toBeUndefined();
    const file = Object.values(files).find((file) => file.path.endsWith(".ttf"))!;
    const bytes = await readFile(absPath(file.path));
    bytes[100] ^= 1;
    await writeFile(absPath(file.path), bytes);
    await expect(verifyTypographyFonts(fonts, files)).rejects.toThrow("SNAPSHOT_HASH_MISMATCH");
  });
});
