import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createMeasureText, runtimeFontAssets } from "./measure-text";

const dir = path.resolve("public/fonts/typography-v1");
const style = { font: "arimo", weight: 400, italic: false, fontSize: 40, letterSpacing: 0, language: "ru" } as never;

describe("@douga/node measureText", () => {
  it("measures with a subset of the catalog and the Japanese fallback when present", async () => {
    const only = (fonts: string[]) => createMeasureText({
      load: async (asset) => (fonts.includes(asset.font) ? readFile(path.join(dir, path.basename(asset.src))) : null),
    });
    const latin = await only(["arimo"]);
    expect(latin("Привет", style).width).toBeGreaterThan(50);
    expect(latin("光", style).missing).toEqual(["光"]);
    const withJp = await only(["arimo", "noto-sans-jp"]);
    expect(withJp("光", style)).toMatchObject({ missing: [], fonts: ["noto-sans-jp-400-normal"] });
    expect(() => latin("x", { ...(style as object), font: "rubik" } as never)).toThrow("TEXT_FONT_FACE_UNSUPPORTED");
  });

  it("refuses a file whose bytes are not the pinned ones", async () => {
    await expect(createMeasureText({ load: async () => new Uint8Array([1, 2, 3]) })).rejects.toThrow("FONT_HASH_MISMATCH");
  });

  it("adds the Japanese fallback of each family kind", () => {
    const fonts = new Set(runtimeFontAssets(["arimo", "noto-serif-jp"]).map((a) => a.font));
    expect([...fonts].sort()).toEqual(["arimo", "noto-sans-jp", "noto-serif-jp"]);
  });
});
