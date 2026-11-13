import type { CSSProperties } from "react";
import type { CompiledScene } from "@douga/video/types";
import { clamp01, wipeMask } from "./motion-frame";
type Transition = CompiledScene["transition"];
export const isAdjacentTransition = (type: Transition["type"]) =>
  !["none", "fade", "slide"].includes(type);
/** Outgoing is a held last frame. All new transitions occupy incoming time only. */
export function transitionLayers(
  t: Transition,
  frame: number,
  duration: number,
  width: number,
  height: number,
) {
  const length = Math.min(t.durationInFrames, duration);
  const progress = length <= 1 ? 1 : clamp01(frame / (length - 1));
  const active =
    isAdjacentTransition(t.type) && length > 0 && frame >= 0 && frame < length;
  const incoming: CSSProperties = { opacity: 1 },
    outgoing: CSSProperties = { opacity: 1 };
  let overlay: CSSProperties | undefined;
  if (!active) return { active, progress: 1, incoming, outgoing, overlay };
  const p = progress,
    q = 1 - p,
    d = t.direction ?? "left";
  const vertical = d === "up" || d === "down",
    sign = d === "right" || d === "down" || d === "out" ? 1 : -1;
  const axis = vertical ? "Y" : "X",
    distance = vertical ? height : width;
  switch (t.type) {
    case "crossfade":
      incoming.opacity = p;
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
    case "wipe":
      incoming.clipPath = wipeMask(p, d);
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
    case "zoom":
      incoming.transform = `scale(${d === "out" ? 1 + 0.8 * q : 0.2 + 0.8 * p})`;
      incoming.opacity = p;
      outgoing.transform = `scale(${1 + 0.2 * p})`;
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
    case "push":
      incoming.transform = `translate${axis}(${-sign * q * distance}px)`;
      outgoing.transform = `translate${axis}(${sign * p * distance}px)`;
      break;
    case "flash":
      incoming.opacity = p < 0.5 ? 0 : 1;
      outgoing.opacity = p < 0.5 ? 1 : 0;
      overlay = {
        background: t.color ?? "#ffffff",
        opacity: Math.sin(p * Math.PI),
      };
      break;
    case "iris":
      incoming.clipPath = `circle(${p * 72}% at 50% 50%)`;
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
    case "split":
      incoming.clipPath = vertical
        ? `inset(${q * 50}% 0 ${q * 50}% 0)`
        : `inset(0 ${q * 50}% 0 ${q * 50}%)`;
      outgoing.transform = `scale${vertical ? "Y" : "X"}(${1 + 0.12 * p})`;
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
    case "blur":
      incoming.filter = `blur(${q * 24}px)`;
      incoming.opacity = p;
      outgoing.filter = `blur(${p * 24}px)`;
      outgoing.opacity = q === 0 ? 0 : 1;
      break;
  }
  return { active, progress, incoming, outgoing, overlay };
}
