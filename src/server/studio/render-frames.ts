import "server-only";
import { cp, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { compiledMediaUsages, type ResolvedAsset } from "@/video";
import { absPath } from "@/lib/storage";
import { fileHash, safeFile } from "./assets";
import { verifyEngine } from "./engine";
import { verifyTypographyFonts } from "./typography-fonts";
import { StudioError } from "./errors";
import { studioJobLimits } from "./job-types";
import type { StudioFrozenRevision } from "./types";

/** Prepares exactly the same sources and typography for all render surfaces. */
export async function prepareStudioRender(request: { directory: string; engineId: string; frozen: StudioFrozenRevision; browserExecutable?: string }) {
  const { frozen } = request;
  const directory = absPath(request.directory), serveUrl = path.join(directory, "serve");
  await mkdir(directory, { recursive: true });
  await cp(await verifyEngine(request.engineId), serveUrl, { recursive: true });
  const publicDir = path.join(serveUrl, "public");
  await mkdir(publicDir, { recursive: true });
  const sources = new Map<string, string>();
  for (const [key, file] of Object.entries(frozen.files)) {
    for (const [sourcePath, digest, src] of [
      [file.path, file.hash, frozen.manifest[key].src],
      [file.posterPath, file.posterHash, frozen.manifest[key].posterSrc],
    ]) {
      if (!sourcePath || !digest || !src) continue;
      const source = await safeFile(sourcePath);
      if (await fileHash(source) !== digest) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      const name = `${digest}${path.extname(source)}`;
      await copyFile(source, path.join(publicDir, name));
      if (await fileHash(path.join(publicDir, name)) !== digest) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      sources.set(src, name);
    }
  }
  const plan = structuredClone(frozen.plan);
  await verifyTypographyFonts(plan.fonts, frozen.fontFiles);
  for (const face of plan.fonts ?? []) {
    const file = frozen.fontFiles![face.hash], source = await safeFile(file.path), name = `${face.hash}.ttf`;
    await copyFile(source, path.join(publicDir, name));
    if (await fileHash(path.join(publicDir, name)) !== face.hash) throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    face.src = name;
  }
  const rewritten = new WeakSet<ResolvedAsset>();
  const rewrite = (asset: ResolvedAsset) => {
    if (rewritten.has(asset)) return;
    rewritten.add(asset);
    const src = sources.get(asset.src);
    if (!src) throw new StudioError("ASSET_RESOLUTION_FAILED");
    asset.src = src;
    if (asset.posterSrc) {
      const poster = sources.get(asset.posterSrc);
      if (!poster) throw new StudioError("ASSET_RESOLUTION_FAILED");
      asset.posterSrc = poster;
    }
  };
  for (const usage of compiledMediaUsages(plan)) rewrite(usage.asset);
  const inputProps = { plan, assetMode: "static" };
  const browserExecutable = request.browserExecutable ?? process.env.REMOTION_BROWSER_EXECUTABLE;
  const composition = await selectComposition({ serveUrl, id: "Studio", inputProps, browserExecutable });
  return { directory, serveUrl, publicDir, plan, inputProps, browserExecutable, composition };
}

export async function renderStudioFrames(request: { directory: string; engineId: string; frozen: StudioFrozenRevision; frames: number[]; scale?: number; rasterizer?: "swangle"; browserExecutable?: string }) {
  if (!request.frames.length || request.frames.length > 64 || request.frames.some(f => !Number.isInteger(f) || f < 0 || f >= request.frozen.plan.durationInFrames)) throw new StudioError("FRAME_RANGE_INVALID");
  const prepared = await prepareStudioRender(request);
  const browser = await openBrowser("chrome", { browserExecutable: prepared.browserExecutable, logLevel: "error",
    ...(request.rasterizer ? { chromiumOptions: { gl: request.rasterizer } } : {}) });
  const frames: { frame: number; path: string }[] = [];
  try {
    for (const frame of [...new Set(request.frames)]) {
      const output = path.join(prepared.directory, `frame-${frame}.png`);
      await renderStill({ ...prepared, output, frame, imageFormat: "png", scale: request.scale ?? 1,
        puppeteerInstance: browser, logLevel: "error", timeoutInMilliseconds: studioJobLimits.frameTimeoutMs,
        mediaCacheSizeInBytes: studioJobLimits.mediaCacheBytes });
      frames.push({ frame, path: output });
    }
    return frames;
  } finally { await browser.close({ silent: true }); }
}
