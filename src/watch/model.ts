import { downloadTitleStem } from "@/lib/domain/render-jobs";
import type {
  CompiledNode,
  CompiledVideo,
  ResolvedAsset,
} from "@/video";

export const CONTROLS_HIDE_MS = 2500;
export const HTML_WARN_BYTES = 80 * 1024 * 1024;
export const HTML_MAX_BYTES = 400 * 1024 * 1024;
export const HTML_MAX_ASSET_BASE64 = 500_000_000;

const MIN_SHARED_AUDIO_TAGS = 5;
const SLICE_PAD_SEC = 0.5;

export interface Chapter {
  frame: number;
  label: string;
}

export interface KeyTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

export type KeyAction =
  | "toggle"
  | "seek-back"
  | "seek-forward"
  | "fullscreen"
  | "mute"
  | "chapter-prev"
  | "chapter-next";

export interface MediaSlice {
  id: string;
  hash: string;
  kind: "image" | "video" | "audio";
  startFrame: number;
  endFrame: number;
  copyWhole: boolean;
}

export interface WatchMediaName {
  file: string;
  poster?: string;
}

export function chapters(plan: CompiledVideo): Chapter[] {
  const seenRound = new Set<string>();
  const seenPosition = new Set<string>();
  let rounds = 0;
  let positions = 0;
  const marks: Chapter[] = [];
  for (const scene of plan.scenes) {
    if (scene.durationInFrames <= 0) continue;
    if (scene.roundId) {
      if (seenRound.has(scene.roundId)) continue;
      seenRound.add(scene.roundId);
      rounds += 1;
      marks.push({ frame: scene.from, label: `Раунд ${rounds}` });
    } else if (scene.participantId) {
      if (seenPosition.has(scene.participantId)) continue;
      seenPosition.add(scene.participantId);
      positions += 1;
      marks.push({ frame: scene.from, label: `Позиция ${positions}` });
    }
  }
  return marks;
}

/** More than a second into the chapter restarts it. The first chapter goes to frame 0. */
export function previousChapterFrame(
  marks: readonly Chapter[],
  frame: number,
  fps: number,
): number {
  let index = -1;
  for (let i = 0; i < marks.length; i += 1)
    if (marks[i].frame <= frame) index = i;
  if (index < 0) return 0;
  if (frame - marks[index].frame > fps) return marks[index].frame;
  if (index === 0) return 0;
  return marks[index - 1].frame;
}

export function nextChapterFrame(
  marks: readonly Chapter[],
  frame: number,
  durationInFrames: number,
): number {
  const next = marks.find((mark) => mark.frame > frame);
  if (next) return next.frame;
  return Math.max(0, durationInFrames - 1);
}

export function seekBySeconds(
  frame: number,
  deltaSec: number,
  fps: number,
  durationInFrames: number,
): number {
  if (durationInFrames <= 0) return 0;
  const next = frame + Math.round(deltaSec * fps);
  return Math.min(durationInFrames - 1, Math.max(0, next));
}

export function sharedAudioTagCount(plan: CompiledVideo): number {
  const events: { frame: number; delta: number }[] = [];
  for (const cue of plan.audio) {
    if (cue.durationInFrames <= 0) continue;
    events.push({ frame: cue.from, delta: 1 });
    events.push({ frame: cue.from + cue.durationInFrames, delta: -1 });
  }
  events.sort((a, b) => a.frame - b.frame || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    if (current > max) max = current;
  }
  return Math.max(MIN_SHARED_AUDIO_TAGS, max);
}

export function keyAction(key: string, target: KeyTarget): KeyAction | null {
  const tag = target.tagName.toUpperCase();
  if (target.isContentEditable || tag === "TEXTAREA" || tag === "SELECT")
    return null;
  if (tag === "INPUT") {
    const type = (target.type ?? "text").toLowerCase();
    if (type === "range") {
      if (key === "ArrowLeft" || key === "ArrowRight") return null;
    } else if (type !== "button" && type !== "submit" && type !== "checkbox") {
      return null;
    }
  }
  switch (key) {
    case " ":
      return "toggle";
    case "ArrowLeft":
      return "seek-back";
    case "ArrowRight":
      return "seek-forward";
    case "f":
    case "F":
      return "fullscreen";
    case "m":
    case "M":
      return "mute";
    case "PageUp":
      return "chapter-prev";
    case "PageDown":
      return "chapter-next";
    default:
      return null;
  }
}

export function controlsHidden(input: {
  playing: boolean;
  loading: boolean;
  idleMs: number;
}): boolean {
  if (!input.playing || input.loading) return false;
  return input.idleMs >= CONTROLS_HIDE_MS;
}

export function watchMediaPath(token: string, fileName: string): string {
  return `/api/watch/${encodeURIComponent(token)}/media/${encodeURIComponent(fileName)}`;
}

export function rewritePlanMedia(
  plan: CompiledVideo,
  names: Record<string, WatchMediaName>,
  token: string,
): CompiledVideo {
  const next = structuredClone(plan);
  const apply = (asset: ResolvedAsset) => {
    if (!asset.hash) throw new Error("PUBLIC_MEDIA_HASH_MISSING");
    const name = names[asset.hash];
    if (!name) throw new Error("PUBLIC_MEDIA_UNKNOWN");
    asset.src = watchMediaPath(token, name.file);
    if (asset.posterSrc) {
      if (!name.poster) throw new Error("PUBLIC_POSTER_UNKNOWN");
      asset.posterSrc = watchMediaPath(token, name.poster);
    }
  };
  for (const cue of next.audio) apply(cue.asset);
  for (const scene of next.scenes)
    for (const node of scene.nodes) if (node.media) apply(node.media.asset);
  return next;
}

interface Usage {
  hash: string;
  kind: "image" | "video" | "audio";
  startFrame: number;
  endFrame: number;
  sourceFrames: number;
}

function sourceFrames(asset: ResolvedAsset, fps: number): number {
  if (asset.durationSec == null) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(asset.durationSec * fps));
}

function usages(plan: CompiledVideo): Usage[] {
  const found: Usage[] = [];
  const push = (
    asset: ResolvedAsset,
    startFrame: number,
    endFrame: number,
  ) => {
    if (!asset.hash) return;
    const end = asset.kind === "image" ? sourceFrames(asset, plan.fps) : endFrame;
    found.push({
      hash: asset.hash,
      kind: asset.kind,
      startFrame: asset.kind === "image" ? 0 : startFrame,
      endFrame: end,
      sourceFrames: sourceFrames(asset, plan.fps),
    });
  };
  for (const cue of plan.audio) {
    const length = cue.loopFrames ?? cue.durationInFrames;
    push(cue.asset, cue.offsetFrames, cue.offsetFrames + Math.max(1, length));
  }
  for (const scene of plan.scenes)
    for (const node of scene.nodes) {
      const media = node.media;
      if (!media) continue;
      const length = media.loopFrames ?? node.durationInFrames;
      let end = media.offsetFrames + Math.max(1, length);
      if (media.freezeAtFrame != null)
        end = Math.max(end, media.freezeAtFrame + 1);
      push(media.asset, media.offsetFrames, end);
    }
  return found;
}

export function mediaSlices(plan: CompiledVideo): MediaSlice[] {
  const pad = Math.round(SLICE_PAD_SEC * plan.fps);
  const grouped = new Map<string, Usage[]>();
  for (const usage of usages(plan)) {
    const list = grouped.get(usage.hash) ?? [];
    list.push(usage);
    grouped.set(usage.hash, list);
  }
  const slices: MediaSlice[] = [];
  for (const [digest, list] of grouped) {
    const kind = list[0].kind;
    const source = list[0].sourceFrames;
    if (kind === "image" || !Number.isFinite(source)) {
      slices.push({
        id: `whole:${digest}`,
        hash: digest,
        kind,
        startFrame: 0,
        endFrame: Number.isFinite(source) ? source : list[0].endFrame,
        copyWhole: true,
      });
      continue;
    }
    const ranges = list
      .map((usage) => ({
        start: Math.max(0, usage.startFrame),
        end: Math.max(usage.startFrame + 1, usage.endFrame),
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number }[] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range.start - last.end < plan.fps)
        last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    for (const range of merged) {
      const unusedHead = range.start;
      const unusedTail = source - range.end;
      if (unusedHead < pad && unusedTail < pad) {
        slices.push({
          id: `whole:${digest}`,
          hash: digest,
          kind,
          startFrame: 0,
          endFrame: source,
          copyWhole: true,
        });
        continue;
      }
      const startFrame = Math.max(0, range.start - pad);
      const endFrame = Math.min(source, range.end + pad);
      slices.push({
        id: `${digest}:${startFrame}:${endFrame}`,
        hash: digest,
        kind,
        startFrame,
        endFrame,
        copyWhole: false,
      });
    }
  }
  return slices;
}

function sliceFor(
  slices: readonly MediaSlice[],
  hash: string,
  startFrame: number,
  endFrame: number,
): MediaSlice {
  const match = slices.find(
    (slice) =>
      slice.hash === hash &&
      (slice.copyWhole ||
        (slice.startFrame <= startFrame && slice.endFrame >= endFrame)),
  );
  if (!match) throw new Error("SLICE_NOT_FOUND");
  return match;
}

function retarget(
  asset: ResolvedAsset,
  slice: MediaSlice,
  offsetFrames: number,
  fps: number,
): number {
  asset.src = `slice:${slice.id}`;
  if (asset.posterSrc) asset.posterSrc = `slice:poster:${asset.hash}`;
  if (!slice.copyWhole)
    asset.durationSec = (slice.endFrame - slice.startFrame) / fps;
  return slice.copyWhole ? offsetFrames : offsetFrames - slice.startFrame;
}

export function applySlices(plan: CompiledVideo): CompiledVideo {
  const slices = mediaSlices(plan);
  const next = structuredClone(plan);
  for (const cue of next.audio) {
    if (!cue.asset.hash) continue;
    const length = cue.loopFrames ?? cue.durationInFrames;
    const slice = sliceFor(
      slices,
      cue.asset.hash,
      cue.offsetFrames,
      cue.offsetFrames + Math.max(1, length),
    );
    cue.offsetFrames = retarget(cue.asset, slice, cue.offsetFrames, next.fps);
  }
  for (const scene of next.scenes)
    for (const node of scene.nodes) retargetNode(node, slices, next.fps);
  return next;
}

function retargetNode(
  node: CompiledNode,
  slices: readonly MediaSlice[],
  fps: number,
) {
  const media = node.media;
  if (!media?.asset.hash) return;
  const length = media.loopFrames ?? node.durationInFrames;
  let end = media.offsetFrames + Math.max(1, length);
  if (media.freezeAtFrame != null) end = Math.max(end, media.freezeAtFrame + 1);
  const slice = sliceFor(slices, media.asset.hash, media.offsetFrames, end);
  const shift = slice.copyWhole ? 0 : slice.startFrame;
  media.offsetFrames = retarget(media.asset, slice, media.offsetFrames, fps);
  if (media.freezeAtFrame != null && !slice.copyWhole)
    media.freezeAtFrame -= shift;
}

export function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

export function htmlByteSize(input: {
  skeletonBytes: number;
  bundleBytes: number;
  fontBase64Chars: number;
  assets: { bytes: number; wrapperBytes: number }[];
}): number {
  return (
    input.skeletonBytes +
    input.bundleBytes +
    input.fontBase64Chars +
    input.assets.reduce(
      (sum, asset) => sum + base64Length(asset.bytes) + asset.wrapperBytes,
      0,
    )
  );
}

export function htmlExportLimit(
  bytes: number,
  largestAssetBase64: number,
): "ok" | "warn" | "refuse" {
  if (bytes >= HTML_MAX_BYTES || largestAssetBase64 >= HTML_MAX_ASSET_BASE64)
    return "refuse";
  if (bytes >= HTML_WARN_BYTES) return "warn";
  return "ok";
}

function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function htmlContentDisposition(
  ownerId: string,
  title: string | null | undefined,
): string {
  const id = ownerId.replace(/[^A-Za-z0-9_-]/g, "");
  const fallback = `attachment; filename="${id ? `douga-${id}` : "douga"}.html"`;
  const stem = downloadTitleStem(title);
  return stem
    ? `${fallback}; filename*=UTF-8''${encodeExtValue(`${stem}.html`)}`
    : fallback;
}
