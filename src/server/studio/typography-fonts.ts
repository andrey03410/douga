import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createMeasureText } from "@douga/node";
import { getFontFace, typographyFontAssets, type TypographyFontAsset } from "@douga/video/font-manifest";
import type { TextMeasureProvider } from "@douga/video/typography-types";
import { StudioError } from "./errors";
import { absPath } from "@/lib/storage";
import type { StudioFile } from "./types";

const FONT_DIRECTORY = path.resolve("public/fonts/typography-v1");
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Only catalog files are ever opened. A different directory is used by integrity tests. */
export async function createTypographyMeasureText(
  options: { directory?: string } = {},
): Promise<TextMeasureProvider> {
  const directory = options.directory ?? FONT_DIRECTORY;
  return createMeasureText({
    load: (asset) => readFile(path.join(directory, path.basename(asset.src))),
    fail: (code) => {
      throw new StudioError(code);
    },
  });
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
