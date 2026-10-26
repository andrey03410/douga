import type { CSSProperties } from "react";
import { spring } from "remotion";
import type {
  CompiledAnimation,
  CompiledAudio,
  CompiledMedia,
  CompiledNode,
  CompiledScene,
  Rect,
  Window,
} from "../video/types";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const inWindows = (windows: Window[], frame: number): boolean =>
  windows.some(({ from, to }) => frame >= from && frame < to);

function animationValue(
  animation: CompiledAnimation,
  frame: number,
  fps: number,
): number {
  const keys = animation.keyframes;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  const next = keys.findIndex((key) => key.frame > frame);
  const a = keys[next - 1],
    b = keys[next];
  const t = (frame - a.frame) / (b.frame - a.frame);
  let progress = t;
  switch (animation.easing) {
    case "easeIn":
      progress = t * t;
      break;
    case "easeOut":
      progress = 1 - (1 - t) ** 2;
      break;
    case "easeInOut":
      progress = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      break;
    case "spring":
      progress = spring({
        fps,
        frame: frame - a.frame,
        durationInFrames: b.frame - a.frame,
        config: { damping: 14 },
      });
      break;
  }
  return a.value + (b.value - a.value) * progress;
}

/** Input frame is scene-local; keyframes alone use node-local time. */
export function evaluateNode(node: CompiledNode, frame: number, fps: number) {
  const state = {
    x: 0,
    y: 0,
    opacity: node.opacity,
    rotate: node.rotate,
    scale: node.scale,
  };
  for (const animation of node.animation) {
    if (!animation.keyframes.length) continue;
    const value = animationValue(animation, frame - node.from, fps);
    if (animation.property === "opacity" || animation.property === "scale")
      state[animation.property] *= value;
    else state[animation.property] += value;
  }
  const visible =
    frame >= node.from &&
    frame < node.from + node.durationInFrames &&
    inWindows(node.visible, frame);
  return {
    ...state,
    opacity: clamp(state.opacity),
    visible,
    labelVisible: visible && inWindows(node.labelWindows ?? [], frame),
    answer:
      visible &&
      !!node.answer &&
      node.answerFrom !== undefined &&
      frame >= node.answerFrom,
    countdown: Math.max(
      0,
      Math.ceil(
        ((node.timerFrames ?? node.durationInFrames) - (frame - node.from)) /
          fps,
      ),
    ),
  };
}

/** Exact source frame for both live footage and the held card still. */
export function mediaFrameAt(node: CompiledNode, frame: number): number {
  const media = node.media;
  if (!media) return 0;
  const active = node.activeWindow;
  const elapsed = active
    ? frame >= active.from && frame < active.to
      ? frame - active.from
      : Math.max(0, active.to - active.from - 1)
    : Math.max(0, frame - node.from);
  const source =
    media.offsetFrames +
    (media.loopFrames === null
      ? elapsed
      : elapsed % Math.max(1, media.loopFrames));
  return Math.min(source, media.freezeAtFrame ?? Infinity);
}

/** All cue and policy windows are composition-absolute, including inside a Loop. */
export function audioVolumeAt(
  cue: CompiledAudio,
  compositionFrame: number,
): number {
  const frame = compositionFrame - cue.from;
  if (
    frame < 0 ||
    frame >= cue.durationInFrames ||
    inWindows(cue.muteWindows, compositionFrame)
  )
    return 0;
  const fadeIn = cue.fadeInFrames ? clamp(frame / cue.fadeInFrames) : 1;
  const fadeOut = cue.fadeOutFrames
    ? clamp((cue.durationInFrames - frame) / cue.fadeOutFrames)
    : 1;
  const duck =
    cue.role === "music" && inWindows(cue.duckWindows, compositionFrame)
      ? cue.duckVolume
      : 1;
  return cue.volume * fadeIn * fadeOut * duck;
}

/** Crop selects a source rectangle; fit then places that rectangle in the node. */
export function mediaLayout(
  media: CompiledMedia,
  rect: Rect,
): { viewport: CSSProperties; source: CSSProperties } {
  const crop = media.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const intrinsicWidth = media.asset.width,
    intrinsicHeight = media.asset.height;
  if (!intrinsicWidth || !intrinsicHeight) {
    return {
      viewport: { position: "absolute", inset: 0, overflow: "hidden" },
      source: media.crop
        ? {
            position: "absolute",
            width: `${100 / crop.width}%`,
            height: `${100 / crop.height}%`,
            left: `${(-100 * crop.x) / crop.width}%`,
            top: `${(-100 * crop.y) / crop.height}%`,
            maxWidth: "none",
          }
        : { width: "100%", height: "100%", objectFit: media.fit },
    };
  }
  const selectedWidth = intrinsicWidth * crop.width,
    selectedHeight = intrinsicHeight * crop.height;
  const scale = (media.fit === "contain" ? Math.min : Math.max)(
    rect.width / selectedWidth,
    rect.height / selectedHeight,
  );
  const width = media.fit === "fill" ? rect.width : selectedWidth * scale;
  const height = media.fit === "fill" ? rect.height : selectedHeight * scale;
  return {
    viewport: {
      position: "absolute",
      left: (rect.width - width) / 2,
      top: (rect.height - height) / 2,
      width,
      height,
      overflow: "hidden",
    },
    source: {
      position: "absolute",
      width: width / crop.width,
      height: height / crop.height,
      left: (-crop.x * width) / crop.width || 0,
      top: (-crop.y * height) / crop.height || 0,
      maxWidth: "none",
    },
  };
}

export function transitionAt(
  transition: CompiledScene["transition"],
  frame: number,
  duration: number,
  width: number,
) {
  const length = Math.min(transition.durationInFrames, duration / 2);
  if (transition.type === "none" || length <= 0) return { opacity: 1, x: 0 };
  const enter = clamp(frame / length),
    exit = clamp((duration - frame) / length);
  return transition.type === "fade"
    ? { opacity: Math.min(enter, exit), x: 0 }
    : { opacity: 1, x: (1 - enter) * width - (1 - exit) * width };
}

/** Separate answer scenes reuse the original reveal's last frame, even if it looped. */
export function answerCardFrames(
  scene: CompiledScene,
  scenes: CompiledScene[],
): Record<string, number> {
  if (scene.kind !== "answer") return {};
  const previous = [...scenes]
    .reverse()
    .find(
      (candidate) =>
        candidate.from < scene.from &&
        candidate.roundId === scene.roundId &&
        candidate.kind === "picker",
    );
  return Object.fromEntries(
    scene.nodes
      .filter(
        (node) => node.type === "card" && node.media?.asset.kind === "video",
      )
      .map((node) => {
        const original = previous?.nodes.find(
          (candidate) =>
            candidate.cardId === node.cardId &&
            candidate.participantId === node.participantId,
        );
        return [
          node.id,
          original?.activeWindow
            ? mediaFrameAt(original, original.activeWindow.to - 1)
            : (node.media!.freezeAtFrame ?? node.media!.offsetFrames),
        ];
      }),
  );
}

/** Conservative Arial-bold line estimate; leaves room for wide Cyrillic glyphs. */
export function fitTextSize(
  text: string,
  width: number,
  height: number,
  requested: number,
): number {
  const fits = (size: number) => {
    const capacity = Math.max(1, Math.floor(width / (size * 0.72)));
    let lines = 0;
    for (const paragraph of text.split("\n")) {
      let used = 0;
      lines++;
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (used && used + 1 + word.length > capacity) {
          lines++;
          used = 0;
        }
        const length = word.length;
        lines += Math.floor((length - 1) / capacity);
        used = (used ? used + 1 : 0) + (length % capacity || capacity);
      }
    }
    return lines * size * 1.15 <= height;
  };
  if (fits(requested)) return requested;
  let low = Math.min(1, requested),
    high = requested;
  for (let attempt = 0; attempt < 12; attempt++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.floor(low * 10) / 10;
}
