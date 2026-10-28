import { downloadTitleStem } from "@/lib/domain/render-jobs";
import type { CompiledVideo, ResolvedAsset } from "@/video";

export const HTML_WARN_BYTES = 80 * 1024 * 1024;
export const HTML_MAX_BYTES = 400 * 1024 * 1024;
export const HTML_MAX_ASSET_BASE64 = 500_000_000;

const SLICE_PAD_SEC = 0.5;

/**
 * How the offline file uses a source: a still image, the muted picture of a video
 * node, or a sound cue (which may come from a video file). StudioVideo never plays
 * a video node's own sound, so picture and sound are cut separately.
 */
export type SliceRole = "still" | "visual" | "audio";

export interface MediaSlice {
  id: string;
  hash: string;
  role: SliceRole;
  startFrame: number;
  endFrame: number;
  /** The untouched source file is embedded; nothing is encoded. */
  whole: boolean;
}

interface Usage {
  hash: string;
  role: SliceRole;
  startFrame: number;
  endFrame: number;
  sourceFrames: number;
}

function sourceFrames(asset: ResolvedAsset, fps: number): number {
  if (asset.durationSec == null) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(asset.durationSec * fps));
}

function nodeWindow(media: NonNullable<CompiledVideo["scenes"][number]["nodes"][number]["media"]>, durationInFrames: number) {
  const length = media.loopFrames ?? durationInFrames;
  let end = media.offsetFrames + Math.max(1, length);
  if (media.freezeAtFrame != null) end = Math.max(end, media.freezeAtFrame + 1);
  return { start: media.offsetFrames, end };
}

function cueWindow(cue: CompiledVideo["audio"][number]) {
  const length = cue.loopFrames ?? cue.durationInFrames;
  return { start: cue.offsetFrames, end: cue.offsetFrames + Math.max(1, length) };
}

function nodeRole(asset: ResolvedAsset): SliceRole {
  return asset.kind === "image" ? "still" : asset.kind === "audio" ? "audio" : "visual";
}

function usages(plan: CompiledVideo): Usage[] {
  const found: Usage[] = [];
  const push = (asset: ResolvedAsset, role: SliceRole, start: number, end: number) => {
    if (!asset.hash) return;
    found.push({
      hash: asset.hash,
      role,
      startFrame: start,
      endFrame: end,
      sourceFrames: sourceFrames(asset, plan.fps),
    });
  };
  for (const cue of plan.audio) {
    const { start, end } = cueWindow(cue);
    push(cue.asset, "audio", start, end);
  }
  for (const scene of plan.scenes)
    for (const node of scene.nodes) {
      if (!node.media) continue;
      const { start, end } = nodeWindow(node.media, node.durationInFrames);
      push(node.media.asset, nodeRole(node.media.asset), start, end);
    }
  return found;
}

const wholeSlice = (digest: string, role: SliceRole, source: number): MediaSlice => ({
  id: `whole:${digest}`,
  hash: digest,
  role,
  startFrame: 0,
  endFrame: Number.isFinite(source) ? source : 0,
  whole: true,
});

/** Windows of each source per role, padded by half a second and merged when close. */
export function mediaSlices(plan: CompiledVideo): MediaSlice[] {
  const pad = Math.round(SLICE_PAD_SEC * plan.fps);
  const grouped = new Map<string, Usage[]>();
  for (const usage of usages(plan)) {
    const key = `${usage.role}:${usage.hash}`;
    grouped.set(key, [...(grouped.get(key) ?? []), usage]);
  }
  const slices = new Map<string, MediaSlice>();
  const add = (slice: MediaSlice) => {
    if (!slices.has(slice.id)) slices.set(slice.id, slice);
  };
  for (const list of grouped.values()) {
    const { hash: digest, role, sourceFrames: source } = list[0];
    if (role === "still" || !Number.isFinite(source)) {
      add(wholeSlice(digest, role, source));
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
      if (range.start < pad && source - range.end < pad) {
        add(wholeSlice(digest, role, source));
        continue;
      }
      const startFrame = Math.max(0, range.start - pad);
      const endFrame = Math.min(source, range.end + pad);
      add({
        id: `${role}:${digest}:${startFrame}:${endFrame}`,
        hash: digest,
        role,
        startFrame,
        endFrame,
        whole: false,
      });
    }
  }
  return [...slices.values()];
}

function sliceFor(
  slices: readonly MediaSlice[],
  hash: string,
  role: SliceRole,
  window: { start: number; end: number },
): MediaSlice {
  const match =
    slices.find(
      (slice) =>
        slice.hash === hash &&
        slice.role === role &&
        !slice.whole &&
        slice.startFrame <= window.start &&
        slice.endFrame >= window.end,
    ) ?? slices.find((slice) => slice.hash === hash && slice.whole);
  if (!match) throw new Error("SLICE_NOT_FOUND");
  return match;
}

export const posterSliceId = (digest: string) => `poster:${digest}`;

/** Sources whose poster frame the plan shows while their video loads. */
export function posterHashes(plan: CompiledVideo): string[] {
  const found = new Set<string>();
  const add = (asset: ResolvedAsset) => {
    if (asset.posterSrc && asset.hash) found.add(asset.hash);
  };
  for (const cue of plan.audio) add(cue.asset);
  for (const scene of plan.scenes)
    for (const node of scene.nodes) if (node.media) add(node.media.asset);
  return [...found];
}

/** Point the asset at its slice; returns the offset inside the slice. */
function retarget(asset: ResolvedAsset, slice: MediaSlice, offsetFrames: number, fps: number) {
  asset.src = `slice:${slice.id}`;
  if (asset.posterSrc) asset.posterSrc = `slice:${posterSliceId(slice.hash)}`;
  if (slice.whole) return offsetFrames;
  asset.durationSec = (slice.endFrame - slice.startFrame) / fps;
  return offsetFrames - slice.startFrame;
}

/** The plan the offline file plays: every source points at an embedded slice. */
export function applySlices(plan: CompiledVideo): CompiledVideo {
  const slices = mediaSlices(plan);
  const next = structuredClone(plan);
  for (const cue of next.audio) {
    if (!cue.asset.hash) continue;
    const slice = sliceFor(slices, cue.asset.hash, "audio", cueWindow(cue));
    cue.offsetFrames = retarget(cue.asset, slice, cue.offsetFrames, next.fps);
  }
  for (const scene of next.scenes)
    for (const node of scene.nodes) {
      const media = node.media;
      if (!media?.asset.hash) continue;
      const window = nodeWindow(media, node.durationInFrames);
      const slice = sliceFor(slices, media.asset.hash, nodeRole(media.asset), window);
      media.offsetFrames = retarget(media.asset, slice, media.offsetFrames, next.fps);
      if (media.freezeAtFrame != null && !slice.whole)
        media.freezeAtFrame -= slice.startFrame;
    }
  return next;
}

/** True when a media source is not one of the embedded files: it would reach for the network. */
export function offlineMediaUnresolved(
  plan: CompiledVideo,
  embedded: ReadonlySet<string>,
): boolean {
  const external = (src: string | undefined) =>
    !!src && !(src.startsWith("slice:") && embedded.has(src.slice("slice:".length)));
  return (
    plan.audio.some((cue) => external(cue.asset.src) || external(cue.asset.posterSrc)) ||
    plan.scenes.some((scene) =>
      scene.nodes.some(
        (node) =>
          !!node.media &&
          (external(node.media.asset.src) || external(node.media.asset.posterSrc)),
      ),
    )
  );
}

export function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
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
