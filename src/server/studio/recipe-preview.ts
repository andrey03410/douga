import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { z } from "zod";
import { absPath, STORAGE_ROOT } from "@/lib/storage";
import { getVideoRecipe } from "@/video/recipes";
import {
  buildVisualFixtures,
  visualFixtureMedia,
  type VisualFixture,
} from "@/video/visual-fixtures";
import { applyVideoRecipe, RecipeApplyError } from "@/video/recipe-apply";
import { getStudioPreset } from "./queries";
import { compileVideo } from "@/video/compiler";
import { actor, hash, owned } from "./shared";
import { safeFile } from "./assets";
import { getTypographyMeasureText } from "./typography-fonts";
import { loadInspectionProject } from "./storyboard";
import { StudioError } from "./errors";

const mediaDirectory = "studio-recipe-media/v1";
const baselineDirectory = path.resolve(
  ".ai/features/32-storyboard-reference/baselines",
);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(200);
const tryInput = z
  .object({
    projectId: key,
    expectedVersion: z.number().int().positive(),
    mode: z.enum(["preserve", "replace"]).optional(),
  })
  .strict();
export type TryStudioRecipeInput = z.input<typeof tryInput>;
let fixtureCatalog: Map<string, VisualFixture> | undefined;
let knownMedia: ReturnType<typeof recipeMediaCatalog> | undefined;
function recipeMediaCatalog() {
  return new Map(
    visualFixtureMedia().map((media) => {
      const filename = `${hash(Buffer.from(media.data))}${path.extname(media.filename)}`;
      return [
        filename,
        {
          ...media,
          filename,
          hash: filename.slice(0, 64),
          mimeType: filename.endsWith(".svg") ? "image/svg+xml" : "audio/wav",
        },
      ];
    }),
  );
}
function mediaCatalog() {
  return (knownMedia ??= recipeMediaCatalog());
}
function recipe(id: string) {
  const result = getVideoRecipe(key.parse(id));
  if (!result) throw new StudioError("NOT_FOUND");
  return result;
}
function fixture(recipeId: string) {
  fixtureCatalog ??= new Map(
    buildVisualFixtures().map((item) => [item.id, item]),
  );
  const result = fixtureCatalog.get(`preset.${recipeId}`);
  if (!result) throw new StudioError("PREVIEW_NOT_READY");
  return structuredClone(result);
}
let materializing: Promise<void> | undefined;
async function materializeMedia() {
  if (materializing) return materializing;
  materializing = (async () => {
    const directory = absPath(mediaDirectory);
    await mkdir(directory, { recursive: true });
    const actualDirectory = await realpath(directory),
      storage = await realpath(STORAGE_ROOT);
    if (!actualDirectory.startsWith(`${storage}${path.sep}`))
      throw new StudioError("ASSET_PATH_INVALID");
    for (const media of mediaCatalog().values()) {
      const target = path.join(directory, media.filename);
      try {
        if (hash(await readFile(target)) !== media.hash)
          throw new StudioError("ASSET_HASH_MISMATCH");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, media.data, { flag: "wx" });
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
      }
    }
  })();
  try {
    await materializing;
  } catch (error) {
    materializing = undefined;
    throw error;
  }
}
/** Shared synthetic files are immutable and addressable only by this catalog's hashes. */
export async function getStudioRecipeMedia(userId: string, filename: string) {
  await actor(userId);
  const media = mediaCatalog().get(filename);
  if (!media || path.basename(filename) !== filename)
    throw new StudioError("NOT_FOUND");
  await materializeMedia();
  const file = await safeFile(`${mediaDirectory}/${filename}`);
  if (hash(await readFile(file)) !== media.hash)
    throw new StudioError("ASSET_HASH_MISMATCH");
  return { path: file, mimeType: media.mimeType, hash: media.hash };
}
/** Native player plan; its source is the same populated fixture as visual regression. */
export async function getStudioRecipePlan(userId: string, recipeId: string) {
  await actor(userId);
  recipe(recipeId);
  const sample = fixture(recipeId);
  await materializeMedia();
  for (const media of mediaCatalog().values()) {
    const asset = sample.manifest[media.id];
    if (!asset) continue;
    asset.src = `/api/studio/recipes/media/${media.filename}`;
    asset.hash = media.hash;
  }
  const result = compileVideo(sample.document, sample.manifest, {
    measureText: await getTypographyMeasureText(),
  });
  return { recipeId, document: sample.document, ...result };
}
/** Try-on is read-only and pinned to the exact authoring draft, never last-good. */
export async function tryStudioRecipe(
  userId: string,
  recipeId: string,
  raw: TryStudioRecipeInput,
) {
  const input = tryInput.parse(raw);
  await actor(userId);
  const selected = recipe(recipeId);
  const prepared = await loadInspectionProject(userId, input.projectId, {
    expectedVersion: input.expectedVersion,
  });
  if (prepared.document.kind !== selected.kind)
    throw new StudioError("PRESET_KIND_MISMATCH");
  let basePreset;
  if (prepared.document.preset) {
    try {
      const candidate = await getStudioPreset(
        userId,
        prepared.document.preset.id,
      );
      if (candidate.version === prepared.document.preset.version)
        basePreset = candidate;
    } catch (error) {
      if (!(error instanceof StudioError) || error.code !== "NOT_FOUND")
        throw error;
    }
  }
  let document;
  try {
    document = applyVideoRecipe(prepared.document, selected.preset, {
      mode: input.mode,
      basePreset,
    });
  } catch (error) {
    if (error instanceof RecipeApplyError) throw new StudioError(error.code);
    throw error;
  }
  const result = compileVideo(document, prepared.manifest, {
    measureText: await getTypographyMeasureText(),
  });
  if ((await owned(userId, input.projectId)).version !== input.expectedVersion)
    throw new StudioError("VERSION_CONFLICT");
  return { recipeId, origin: prepared.origin, ...result };
}
const baselineFrameSchema = z.object({
  fixtureId: z.string(),
  frame: z.number().int().nonnegative(),
  file: z.string(),
  pngHash: digest,
  width: z.number().int().positive().max(1920),
  height: z.number().int().positive().max(1920),
  reasons: z.array(z.object({ reason: z.string() }).passthrough()).optional(),
});
const baselineManifestSchema = z.object({
  version: z.literal(1),
  accepted: z.object({ reason: z.string().min(1), at: z.string().min(1) }),
  frames: z.array(baselineFrameSchema).max(50000),
});
/** Only accepted, path-confined, byte-verified PNGs may become a native image preview. */
export async function getStudioRecipePreview(userId: string, recipeId: string) {
  await actor(userId);
  recipe(recipeId);
  try {
    const raw = await readFile(
      path.join(baselineDirectory, "manifest.json"),
      "utf8",
    );
    if (Buffer.byteLength(raw) > 64 * 1024 * 1024)
      throw new Error("MANIFEST_TOO_LARGE");
    const manifest = baselineManifestSchema.parse(JSON.parse(raw));
    const candidates = manifest.frames.filter(
      (frame) => frame.fixtureId === `preset.${recipeId}`,
    );
    // Prefer a stable mid-scene frame over an intentionally empty entrance frame.
    const record =
      candidates.find(frame => frame.reasons?.some(reason => reason.reason.endsWith(":representative")))
      ?? candidates.find((frame) => frame.frame >= 30) ?? candidates[0];
    if (!record) throw new Error("MISSING_RECIPE_BASELINE");
    const expectedFile = `frames/${record.fixtureId}/${record.frame}.png`;
    if (
      record.file !== expectedFile ||
      path.basename(record.file) !== `${record.frame}.png`
    )
      throw new Error("INVALID_BASELINE_PATH");
    const root = await realpath(baselineDirectory),
      file = await realpath(path.resolve(baselineDirectory, record.file));
    if (!file.startsWith(`${root}${path.sep}`))
      throw new Error("INVALID_BASELINE_PATH");
    const png = await readFile(file);
    if (
      png.length > 12 * 1024 * 1024 ||
      png.length < 24 ||
      !png
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      hash(png) !== record.pngHash ||
      png.readUInt32BE(16) !== record.width ||
      png.readUInt32BE(20) !== record.height
    )
      throw new Error("INVALID_BASELINE_PNG");
    return {
      recipeId,
      path: file,
      mimeType: "image/png" as const,
      hash: record.pngHash,
      frame: record.frame,
      width: record.width,
      height: record.height,
      bytes: png.length,
      src: `/api/studio/recipes/${encodeURIComponent(recipeId)}/preview`,
    };
  } catch (error) {
    if (error instanceof StudioError && error.code !== "PREVIEW_NOT_READY")
      throw error;
    throw new StudioError("PREVIEW_NOT_READY");
  }
}
