import "server-only";
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import { absPath } from "@/lib/storage";
import { renderStudioFrames } from "./render-frames";
import { fileHash, cleanupDirectory } from "./assets";
import { studioJobLimits, type StudioJobResult } from "./job-types";
import { StudioError } from "./errors";
import type { RenderAttempt } from "./render";
import type { StoryboardFrameArtifact, StoryboardRenderInput } from "./storyboard-types";
import type { StoryboardSheetProps } from "@/remotion/StoryboardSheet";

export async function renderStoryboardAttempt(request: RenderAttempt & { input: StoryboardRenderInput }): Promise<StudioJobResult> {
  const { tiles, summary } = request.input;
  if (!tiles.length || tiles.length > 24) throw new StudioError("STORYBOARD_BUDGET_EXCEEDED");
  const directory = absPath(request.directory);
  const rendered = new Map<string, string>();
  for (const source of [0, 1]) {
    const needed = tiles.filter(t => !t.missing && (t.source ?? 0) === source);
    if (!needed.length) continue;
    const frozen = source === 0 ? request.frozen : request.compareFrozen;
    if (!frozen) throw new StudioError("COMPARISON_NOT_FOUND");
    const frames = await renderStudioFrames({ directory: `${request.directory}/source-${source}`,
      engineId: request.engineId, frozen, frames: needed.map(t => t.frame),
      scale: Math.min(1, 720 / Math.max(frozen.plan.width, frozen.plan.height)) });
    for (const frame of frames) rendered.set(`${source}:${frame.frame}`, frame.path);
  }
  const firstSource = tiles.some(t => !t.missing && (t.source ?? 0) === 0) ? 0 : 1;
  const serveUrl = path.join(directory, `source-${firstSource}`, "serve");
  const frames: StoryboardFrameArtifact[] = [];
  const sheetTiles: StoryboardSheetProps["tiles"] = [];
  for (const [index, tile] of tiles.entries()) {
    let name: string | undefined;
    if (!tile.missing) {
      const source = rendered.get(`${tile.source ?? 0}:${tile.frame}`);
      if (!source) throw new StudioError("FRAME_MISSING");
      name = `tile-${index}.png`;
      await copyFile(source, path.join(directory, name));
      await copyFile(source, path.join(serveUrl, "public", name));
      frames.push({ id: String(index), name, bytes: (await stat(source)).size,
        hash: await fileHash(source), frame: tile.frame, sceneId: tile.sceneId, state: tile.state,
        ...(tile.side ? { side: tile.side } : {}) });
    }
    const side = tile.side === "before" ? "До · " : tile.side === "after" ? "После · " : "";
    sheetTiles.push({ src: name, label: `${side}${tile.label}`, state: tile.state,
      metadata: `${Math.floor(tile.timeSec / 60)}:${(tile.timeSec % 60).toFixed(2).padStart(5, "0")} · кадр ${tile.frame}`, missing: tile.missing });
  }
  const ratio = summary.origin.format.width / summary.origin.format.height;
  const compare = tiles.some(t => t.side);
  const columns = Math.min(tiles.length, compare ? 4 : ratio < 1 ? 4 : 3);
  const tileWidth = Math.floor((1560 - (columns - 1) * 14) / columns);
  const tileHeight = Math.round(tileWidth / ratio);
  const width = 1600, height = 118 + Math.ceil(tiles.length / columns) * (tileHeight + 80 + 14);
  const inputProps: StoryboardSheetProps = { width, height, columns, tileWidth, tileHeight,
    title: compare ? "Раскадровка · до / после" : "Раскадровка",
    subtitle: `Страница ${summary.selection.page + 1} из ${summary.selection.totalPages} · сцен ${summary.selection.scenesCovered}/${summary.selection.totalScenes} · ${summary.origin.revision ? `ревизия ${summary.origin.revision}` : `версия ${summary.origin.version}`}`,
    tiles: sheetTiles };
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
  const composition = await selectComposition({ serveUrl, id: "StoryboardSheet", inputProps: { ...inputProps }, browserExecutable });
  const output = path.join(directory, "storyboard.png");
  await renderStill({ serveUrl, composition, inputProps: { ...inputProps }, browserExecutable,
    frame: 0, imageFormat: "png", output, logLevel: "error", timeoutInMilliseconds: studioJobLimits.frameTimeoutMs });
  const bytes = (await stat(output)).size;
  if (bytes > 12 * 1024 * 1024) throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
  for (const source of [0, 1]) await cleanupDirectory(`${request.directory}/source-${source}`);
  return { kind: "storyboard", resource: { jobId: request.jobId, name: "storyboard.png", mimeType: "image/png", bytes, hash: await fileHash(output) },
    storageBytes: bytes + frames.reduce((sum, frame) => sum + frame.bytes, 0),
    width, height, fps: summary.origin.format.fps, fromFrame: 0, durationFrames: 1,
    videoCodec: null, audioCodec: null, storyboard: { summary, frames, partial: false } };
}
