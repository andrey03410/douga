import { playerPremountFrames } from "@/remotion/premount";
import type { CompiledVideo, ResolvedAsset } from "@/video";

export const CONTROLS_HIDE_MS = 2500;

const MIN_SHARED_AUDIO_TAGS = 5;

export interface Chapter {
  frame: number;
  label: string;
}

export interface KeyInput {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

export interface KeyTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  /** A range that keeps its own arrow keys (volume). */
  nativeArrows?: boolean;
}

export type KeyAction =
  | "toggle"
  | "seek-back"
  | "seek-forward"
  | "fullscreen"
  | "mute"
  | "chapter-prev"
  | "chapter-next";

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

/** The chapter the frame is in; nothing before the first mark. */
export function chapterAt(marks: readonly Chapter[], frame: number): Chapter | null {
  let current: Chapter | null = null;
  for (const mark of marks) if (mark.frame <= frame) current = mark;
  return current;
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
  const premount = playerPremountFrames(plan.fps);
  const events: { frame: number; delta: number }[] = [];
  for (const cue of plan.audio) {
    if (cue.durationInFrames <= 0) continue;
    // A premounted cue holds its tag before its first frame.
    events.push({ frame: Math.max(0, cue.from - premount), delta: 1 });
    events.push({ frame: cue.from + cue.durationInFrames, delta: -1 });
  }
  events.sort((a, b) => a.frame - b.frame || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    if (current > max) max = current;
  }
  // Remotion claims the next cue's tag before it frees the previous one, so a
  // seek from one busy stretch into another briefly holds both sets.
  return Math.max(MIN_SHARED_AUDIO_TAGS, 2 * max);
}

const KEY_ACTIONS: Record<string, KeyAction> = {
  Space: "toggle",
  ArrowLeft: "seek-back",
  ArrowRight: "seek-forward",
  KeyF: "fullscreen",
  KeyM: "mute",
  PageUp: "chapter-prev",
  PageDown: "chapter-next",
};
const REPEATABLE = new Set<KeyAction>([
  "seek-back",
  "seek-forward",
  "chapter-prev",
  "chapter-next",
]);

/** Physical keys, so F and M also work in the Russian layout. */
export function keyAction(key: KeyInput, target: KeyTarget): KeyAction | null {
  if (key.ctrlKey || key.metaKey || key.altKey) return null;
  const tag = target.tagName.toUpperCase();
  if (target.isContentEditable || tag === "TEXTAREA" || tag === "SELECT")
    return null;
  if (tag === "INPUT") {
    const type = (target.type ?? "text").toLowerCase();
    if (type === "range") {
      if (target.nativeArrows && key.code.startsWith("Arrow")) return null;
      // Natively up and down would move the seek bar by a single frame.
      if (key.code === "ArrowUp") return "seek-forward";
      if (key.code === "ArrowDown") return "seek-back";
    } else if (type !== "button" && type !== "submit" && type !== "checkbox") {
      return null;
    }
  }
  const action = KEY_ACTIONS[key.code] ?? null;
  if (action && key.repeat && !REPEATABLE.has(action)) return null;
  return action;
}

export function controlsHidden(input: {
  playing: boolean;
  loading: boolean;
  /** The pointer rests on the panel or focus is inside it. */
  pinned: boolean;
  idleMs: number;
}): boolean {
  if (!input.playing || input.loading || input.pinned) return false;
  return input.idleMs >= CONTROLS_HIDE_MS;
}

export function formatClock(frame: number, fps: number): string {
  const total = Math.max(0, Math.floor(frame / fps));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** First scene, all cards open and no answer yet; otherwise 60% into it. */
export function coverFrame(plan: CompiledVideo): number {
  const scene = plan.scenes.find((s) => s.durationInFrames > 0);
  if (!scene) return 0;
  const last = scene.durationInFrames - 1;
  const { timerStartFrame, answerStartFrame } = scene.phases;
  const local =
    timerStartFrame !== undefined
      ? timerStartFrame
      : answerStartFrame !== undefined
        ? answerStartFrame - 1
        : Math.floor(scene.durationInFrames * 0.6);
  return scene.from + Math.min(last, Math.max(0, local));
}

const fetchable = (src: string) => src.startsWith("/") || /^https?:\/\//.test(src);

export interface UpcomingMedia {
  /** Sound to fetch into the HTTP cache before its cue mounts. */
  sounds: string[];
  /** Stills and posters to decode ahead, from any source including blob URLs. */
  stills: string[];
}

/**
 * What to load before the playhead reaches it. Sound counts only when it starts after
 * `afterFrame`: a cue that already plays is streamed by its own tag. Stills are
 * decoded in place, so a scene already on screen counts too. Video streams and is
 * never listed.
 */
export function upcomingMedia(
  plan: CompiledVideo,
  afterFrame: number,
  horizonFrames: number,
): UpcomingMedia {
  const end = afterFrame + horizonFrames;
  const sounds = new Set<string>();
  const stills = new Set<string>();
  for (const cue of plan.audio)
    if (cue.durationInFrames > 0 && cue.from > afterFrame && cue.from <= end)
      sounds.add(cue.asset.src);
  for (const scene of plan.scenes) {
    const sceneEnd = scene.from + scene.durationInFrames;
    if (scene.durationInFrames <= 0 || sceneEnd <= afterFrame || scene.from > end) continue;
    for (const node of scene.nodes) {
      const asset = node.media?.asset;
      if (!asset) continue;
      if (asset.kind === "image") stills.add(asset.src);
      if (asset.posterSrc) stills.add(asset.posterSrc);
    }
  }
  return { sounds: [...sounds].filter(fetchable), stills: [...stills] };
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

