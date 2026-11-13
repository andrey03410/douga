import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { create, type Font } from "fontkit";
import { getFontFace, typographyFontAssets, type TypographyFontAsset } from "@douga/video/font-manifest";
import type { TextMeasureProvider, TextMeasurement } from "@douga/video/typography-types";
import { StudioError } from "./errors";
import { absPath } from "@/lib/storage";
import type { StudioFile } from "./types";

const FONT_DIRECTORY = path.resolve("public/fonts/typography-v1");
const CACHE_ENTRIES = 2048;
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Only catalog files are ever opened. A different directory is used by integrity tests. */
export async function createTypographyMeasureText(
  options: { directory?: string } = {},
): Promise<TextMeasureProvider> {
  const directory = options.directory ?? FONT_DIRECTORY;
  const resources = new Map<string, Font>();
  const faces = new Map<string, { asset: TypographyFontAsset; font: Font }>();
  for (const asset of typographyFontAssets) {
    let resource = resources.get(asset.src);
    if (!resource) {
      const data = await readFile(path.join(directory, path.basename(asset.src)));
      if (data.length !== asset.bytes || digest(data) !== asset.hash)
        throw new StudioError("FONT_HASH_MISMATCH");
      const parsed = create(data);
      if (!("layout" in parsed)) throw new StudioError("FONT_FORMAT_INVALID");
      resource = parsed;
      resources.set(asset.src, resource);
    }
    faces.set(asset.id, { asset, font: resource.getVariation({ wght: asset.weight }) });
  }
  const cache = new Map<string, TextMeasurement>();
  return (text, style) => {
    const id = `${style.font}-${style.weight}-${style.italic ? "italic" : "normal"}`;
    const primary = faces.get(id);
    if (!primary) throw new StudioError("TEXT_FONT_FACE_UNSUPPORTED");
    const key = JSON.stringify([id, style.fontSize, style.letterSpacing, style.language, text]);
    const cached = cache.get(key);
    if (cached) return { ...cached, fonts: [...cached.fonts], missing: [...cached.missing] };
    const fallbackId = `${style.font === "noto-serif-jp" ? "noto-serif-jp" : "noto-sans-jp"}-${style.weight}-normal`;
    const fallback = faces.get(fallbackId)!;
    const segments: { face: typeof primary; text: string }[] = [];
    const missing = new Set<string>();
    let count = 0;
    for (const { segment } of graphemes.segment(text)) {
      count++;
      // Variation selectors and ZWJ modify adjacent glyphs and have no standalone glyph.
      const chars = [...segment].filter((char) => !/[\u200c\u200d\ufe00-\ufe0f]/u.test(char));
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
let provider: Promise<TextMeasureProvider> | undefined;
export function getTypographyMeasureText(): Promise<TextMeasureProvider> {
  provider ??= createTypographyMeasureText().catch((error) => { provider = undefined; throw error; });
  return provider;
}

/** Read either exact frozen bytes or the closed, pinned public catalog. Never fetch a URL. */
export async function readTypographyResource(
  face: TypographyFontAsset,
  kind: "font" | "license",
  files: Record<string, StudioFile> = {},
): Promise<Buffer> {
  const resourceHash = kind === "font" ? face.hash : face.licenseHash;
  const bytes = kind === "font" ? face.bytes : face.licenseBytes;
  const frozen = files[resourceHash];
  let data: Buffer;
  if (frozen) {
    const { safeFile } = await import("./assets");
    data = await readFile(await safeFile(frozen.path));
  } else {
    const known = getFontFace(face.id);
    if (!known || (kind === "font" ? known.hash : known.licenseHash) !== resourceHash)
      throw new StudioError("FONT_RESOURCE_UNAVAILABLE");
    data = await readFile(path.join(FONT_DIRECTORY, path.basename(kind === "font" ? known.src : known.license)));
  }
  if (data.length !== bytes || digest(data) !== resourceHash)
    throw new StudioError(frozen ? "SNAPSHOT_HASH_MISMATCH" : "FONT_HASH_MISMATCH");
  return data;
}

/** A per-revision ledger contains each physical font/license once, even across weights. */
export async function freezeTypographyFonts(
  fonts: TypographyFontAsset[] | undefined,
  directory: string,
): Promise<Record<string, StudioFile>> {
  const files: Record<string, StudioFile> = {};
  for (const face of fonts ?? []) {
    for (const kind of ["font", "license"] as const) {
      const hash = kind === "font" ? face.hash : face.licenseHash;
      if (!files[hash]) {
        const data = await readTypographyResource(face, kind);
        const relative = `${directory}/fonts/${hash}.${kind === "font" ? "ttf" : "txt"}`;
        await mkdir(path.dirname(absPath(relative)), { recursive: true });
        await writeFile(absPath(relative), data);
        files[hash] = { path: relative, hash, bytes: data.length };
      }
      const src = `/api/studio/media?path=${encodeURIComponent(files[hash].path)}`;
      if (kind === "font") face.src = src;
      else face.license = src;
    }
  }
  await verifyTypographyFonts(fonts, files);
  return files;
}

export async function verifyTypographyFonts(
  fonts: readonly TypographyFontAsset[] | undefined,
  files: Record<string, StudioFile> = {},
): Promise<void> {
  for (const face of fonts ?? []) {
    if (!files[face.hash] || !files[face.licenseHash])
      throw new StudioError("FONT_RESOURCE_UNAVAILABLE");
    await readTypographyResource(face, "font", files);
    await readTypographyResource(face, "license", files);
  }
}
