import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { create, type Font } from "fontkit";
import { typographyFontAssets, type TypographyFontAsset } from "@douga/video/font-manifest";
import type { TextMeasureProvider, TextMeasurement } from "@douga/video/typography-types";

const CACHE_ENTRIES = 2048;
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export type MeasureFailure = "FONT_HASH_MISMATCH" | "FONT_FORMAT_INVALID" | "TEXT_FONT_FACE_UNSUPPORTED";

export interface MeasureTextOptions {
  /** Bytes of a catalog font file, or null when this host does not carry it. */
  load: (asset: TypographyFontAsset) => Promise<Uint8Array | null>;
  /** Throws the host's error type. */
  fail?: (code: MeasureFailure) => never;
}

/**
 * Text measurement with the pinned catalog fonts (Fontkit). Only catalog faces are
 * opened and every file is checked against its SHA-256. A host may carry a subset of
 * the catalog (an interactive snapshot carries the faces its document can use).
 */
export async function createMeasureText(options: MeasureTextOptions): Promise<TextMeasureProvider> {
  const fail = options.fail ?? ((code: MeasureFailure): never => { throw new Error(code); });
  const resources = new Map<string, Font | null>();
  const faces = new Map<string, { asset: TypographyFontAsset; font: Font }>();
  for (const asset of typographyFontAssets) {
    let resource = resources.get(asset.src);
    if (resource === undefined) {
      const data = await options.load(asset);
      if (data) {
        if (data.length !== asset.bytes || sha256(data) !== asset.hash) fail("FONT_HASH_MISMATCH");
        const parsed = create(Buffer.from(data));
        if (!("layout" in parsed)) fail("FONT_FORMAT_INVALID");
        resource = parsed as Font;
      } else resource = null;
      resources.set(asset.src, resource);
    }
    if (resource) faces.set(asset.id, { asset, font: resource.getVariation({ wght: asset.weight }) });
  }
  const cache = new Map<string, TextMeasurement>();
  return (text, style) => {
    const id = `${style.font}-${style.weight}-${style.italic ? "italic" : "normal"}`;
    const primary = faces.get(id);
    if (!primary) return fail("TEXT_FONT_FACE_UNSUPPORTED");
    const key = JSON.stringify([id, style.fontSize, style.letterSpacing, style.language, text]);
    const cached = cache.get(key);
    if (cached) return { ...cached, fonts: [...cached.fonts], missing: [...cached.missing] };
    const fallbackId = `${style.font === "noto-serif-jp" ? "noto-serif-jp" : "noto-sans-jp"}-${style.weight}-normal`;
    const fallback = faces.get(fallbackId) ?? primary;
    const segments: { face: typeof primary; text: string }[] = [];
    const missing = new Set<string>();
    let count = 0;
    for (const { segment } of graphemes.segment(text)) {
      count++;
      // Variation selectors and ZWJ modify adjacent glyphs and have no standalone glyph.
      const chars = [...segment].filter((char) => !/[‌‍︀-️]/u.test(char));
      const covers = (face: typeof primary) => chars.every((char) => face.font.hasGlyphForCodePoint(char.codePointAt(0)!));
      const wholeFace = covers(primary) ? primary : covers(fallback) ? fallback : undefined;
      for (const char of chars)
        if (!primary.font.hasGlyphForCodePoint(char.codePointAt(0)!) && !fallback.font.hasGlyphForCodePoint(char.codePointAt(0)!)) missing.add(char);
      // A base and combining mark can have complementary coverage. Never measure
      // the base with .notdef merely because no single font covers that cluster.
      for (const part of wholeFace ? [segment] : [...segment]) {
        const face = wholeFace ?? (primary.font.hasGlyphForCodePoint(part.codePointAt(0)!) ? primary : fallback.font.hasGlyphForCodePoint(part.codePointAt(0)!) ? fallback : primary);
        const previous = segments.at(-1);
        if (previous?.face.asset.id === face.asset.id) previous.text += part;
        else segments.push({ face, text: part });
      }
    }
    let width = 0;
    const used = new Set<string>();
    for (const segment of segments) {
      const run = segment.face.font.layout(segment.text);
      width += run.positions.reduce((sum, position) => sum + position.xAdvance, 0) * style.fontSize / segment.face.font.unitsPerEm;
      used.add(segment.face.asset.id);
    }
    width += Math.max(0, count - 1) * style.letterSpacing;
    const measured = { width, fonts: [...used], missing: [...missing] };
    // Bound both count and retained text bytes. Very long authored strings are measured once.
    if (text.length <= 2048) {
      if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, measured);
    }
    return { ...measured, fonts: [...measured.fonts], missing: [...measured.missing] };
  };
}

/** Faces a document's families can use at runtime, plus the Japanese fallback of each kind. */
export function runtimeFontAssets(fonts: Iterable<string>): TypographyFontAsset[] {
  const wanted = new Set(fonts);
  for (const font of [...wanted]) wanted.add(font === "noto-serif-jp" ? "noto-serif-jp" : "noto-sans-jp");
  return typographyFontAssets.filter((asset) => wanted.has(asset.font));
}

/** Loader for files named `<sha256>.ttf` in one directory (a host's snapshot store). */
export function loadByHash(resolve: (hash: string) => string | null) {
  return async (asset: TypographyFontAsset) => {
    const file = resolve(asset.hash);
    if (!file) return null;
    try {
      return await readFile(file);
    } catch {
      return null;
    }
  };
}
