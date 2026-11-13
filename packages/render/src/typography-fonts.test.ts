import { afterEach, describe, expect, it, vi } from "vitest";
import { typographyFontAssets } from "@douga/video/font-manifest";
import { loadTypographyFonts, typographyFontSource } from "./typography-fonts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function browserFonts(load: (source: string) => Promise<void>) {
  const registered = new Set<Face>();
  class Face {
    status = "unloaded";
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors,
    ) {}
    async load() {
      this.status = "loading";
      await load(this.source);
      this.status = "loaded";
      return this;
    }
  }
  vi.stubGlobal("FontFace", Face);
  vi.stubGlobal("document", {
    fonts: { add: (face: Face) => registered.add(face) },
  });
  return registered;
}

describe("typography font readiness", () => {
  it("waits for every required face and registers the correct real weight/style before resolving", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registered = browserFonts(async (source) => {
      if (source.includes("italic")) await pending;
    });
    const fonts = [typographyFontAssets[0], typographyFontAssets[3]];
    let done = false;
    const loading = loadTypographyFonts(fonts).then(() => {
      done = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);
    expect([...registered].map((face) => face.descriptors.style)).toEqual([
      "normal",
    ]);
    release();
    await loading;
    expect(
      [...registered].map((face) => [
        face.family,
        face.descriptors.weight,
        face.descriptors.style,
      ]),
    ).toEqual([
      ["Douga Arimo", "400", "normal"],
      ["Douga Arimo", "700", "italic"],
    ]);
    await loadTypographyFonts(fonts);
    expect(registered.size).toBe(2);
  });

  it("surfaces failed fonts so the Player cannot wait forever or paint a fallback", async () => {
    const registered = browserFonts(async () => {
      throw new Error("missing font");
    });
    await expect(
      loadTypographyFonts([typographyFontAssets[0]]),
    ).rejects.toThrow(/arimo-400-normal.*missing font/);
    expect(registered.size).toBe(0);
  });

  it("bounds a font request that never settles", async () => {
    vi.useFakeTimers();
    browserFonts(() => new Promise(() => {}));
    const loading = loadTypographyFonts([typographyFontAssets[0]], "url", 100);
    const result = loading.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBeInstanceOf(Error);
    expect(((await result) as Error).message).toMatch(/timed out/);
  });

  it("rewrites only packaged static font paths and preserves offline data, blob and HTTP sources", () => {
    for (const src of [
      "data:font/ttf;base64,AAAA",
      "blob:https://douga.test/face",
      "https://douga.test/face.ttf",
      "/api/studio/font?id=1",
    ])
      expect(typographyFontSource(src, "static")).toBe(src);
    expect(
      typographyFontSource("/fonts/typography-v1/arimo-normal.ttf", "url"),
    ).toBe("/fonts/typography-v1/arimo-normal.ttf");
    expect(
      typographyFontSource("/fonts/typography-v1/arimo-normal.ttf", "static"),
    ).toBe("/fonts/typography-v1/arimo-normal.ttf");
    expect(
      typographyFontSource("fonts/typography-v1/arimo-normal.ttf", "static"),
    ).toBe("/fonts/typography-v1/arimo-normal.ttf");
    expect(typographyFontSource("abc123.ttf", "static")).toBe("/abc123.ttf");
  });
});
