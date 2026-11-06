import type { CompiledMotion } from "../video/motion-types";
import type { Rect } from "../video/types";
export { transitionLayers, isAdjacentTransition } from "./motion-transition";
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const TAU = Math.PI * 2;

/** Returns visual reveal amount; one-frame effects are completed immediately. */
export function motionProgress(motion: CompiledMotion, frame: number): number {
  const t =
    motion.durationInFrames === 1
      ? frame >= motion.from
        ? 1
        : 0
      : clamp01((frame - motion.from) / (motion.durationInFrames - 1));
  const eased =
    motion.profile === "snappy"
      ? 1 - (1 - t) ** 3
      : motion.profile === "cinematic"
        ? t * t * t * (t * (t * 6 - 15) + 10)
        : t * t * (3 - 2 * t);
  return motion.channel === "exit" ? 1 - eased : eased;
}
export interface MotionState {
  x: number;
  y: number;
  rotate: number;
  rotateX: number;
  rotateY: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blur: number;
  brightness: number;
  glow: number;
  outline: number;
  shimmer: number;
  spotlight: number;
  strike: number;
  masks: string[];
}
const neutral = (): MotionState => ({
  x: 0,
  y: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  blur: 0,
  brightness: 1,
  glow: 0,
  outline: 0,
  shimmer: -1,
  spotlight: 0,
  strike: 0,
  masks: [],
});

/** Pure IR evaluation. Text fragments are handled in MotionText, without IR expansion. */
export function evaluateMotion(
  motions: CompiledMotion[],
  frame: number,
  fps: number,
  rect: Rect,
): MotionState {
  const s = neutral();
  for (const m of motions) {
    if (frame < m.window.from || frame >= m.window.to) continue;
    if ((m.channel === "loop" || m.channel === "emphasis") && frame < m.from)
      continue;
    if (m.channel === "emphasis" && frame >= m.from + m.durationInFrames)
      continue;
    const p = motionProgress(m, frame),
      q = 1 - p,
      a = m.intensity;
    const phase = ((frame - m.from) % m.durationInFrames) / m.durationInFrames;
    const wave = Math.sin(phase * TAU),
      pulse = Math.sin(p * Math.PI);
    const distance = Math.min(rect.width, rect.height) * 0.35 * a;
    const sign =
      m.direction === "right" || m.direction === "down" || m.direction === "out"
        ? 1
        : -1;
    switch (m.name) {
      case "fade":
        s.opacity *= p;
        break;
      case "pop":
        s.opacity *= p;
        s.scale *= 0.65 + 0.35 * p + Math.sin(p * Math.PI) * 0.22 * a;
        break;
      case "slide-up":
        s.y += distance * q;
        s.opacity *= p;
        break;
      case "slide-down":
        s.y -= distance * q;
        s.opacity *= p;
        break;
      case "slide-left":
        s.x += distance * q;
        s.opacity *= p;
        break;
      case "slide-right":
        s.x -= distance * q;
        s.opacity *= p;
        break;
      case "zoom-in":
        s.scale *= 1 - 0.6 * q;
        s.opacity *= p;
        break;
      case "zoom-out":
        s.scale *= 1 + 0.7 * q * a;
        s.opacity *= p;
        break;
      case "flip-x":
        s.rotateX += 90 * q * sign;
        s.opacity *= p;
        break;
      case "flip-y":
        s.rotateY += 90 * q * sign;
        s.opacity *= p;
        break;
      case "tilt":
        s.rotate += 18 * q * sign * a;
        s.y += distance * 0.3 * q;
        s.opacity *= p;
        break;
      case "blur-reveal":
        s.blur += 24 * q * a;
        s.opacity *= p;
        break;
      case "wipe-reveal":
        s.masks.push(wipeMask(p, m.direction));
        break;
      case "iris":
        s.masks.push(`circle(${p * 72}% at 50% 50%)`);
        break;
      case "elastic":
        s.scaleX *= Math.max(0.05, 1 - q * Math.cos(p * Math.PI * 4));
        s.scaleY *= 1 + q * Math.sin(p * Math.PI * 4) * 0.3 * a;
        s.opacity *= p;
        break;
      case "spin":
        s.rotate += 240 * q * sign * a;
        s.scale *= 0.2 + 0.8 * p;
        s.opacity *= p;
        break;
      case "float":
        s.y += wave * 12 * a;
        break;
      case "breathe":
        s.scale *= 1 + (1 - Math.cos(phase * TAU)) * 0.025 * a;
        break;
      case "sway":
        s.rotate += wave * 4 * a;
        break;
      case "drift":
        s.x += wave * 20 * a;
        s.y += Math.sin(phase * TAU * 2) * 5 * a;
        break;
      case "ken-burns":
        s.scale *= 1 + 0.12 * a * (0.5 - 0.5 * Math.cos(phase * TAU));
        s.x += wave * rect.width * 0.025 * a;
        break;
      case "shimmer":
        s.shimmer = phase;
        break;
      case "orbit":
        s.x += (Math.cos(phase * TAU) - 1) * 14 * a;
        s.y += wave * 14 * a;
        break;
      case "pulse":
        s.scale *= 1 + 0.16 * pulse * a;
        break;
      case "bounce":
        s.y -= Math.abs(Math.sin(p * Math.PI * 2)) * 24 * a * (1 - p);
        break;
      case "shake":
        s.x += Math.sin(p * Math.PI * 8) * 18 * pulse * a;
        break;
      case "nudge":
        s.x += sign * 24 * pulse * a;
        break;
      case "glow":
        s.glow += 28 * pulse * a;
        break;
      case "outline":
        s.outline += 5 * pulse * a;
        break;
      case "stamp":
        s.scale *= 1 + 0.5 * (1 - p) * pulse * a;
        s.rotate -= 12 * pulse * (1 - p) * a;
        s.brightness += 0.4 * pulse;
        break;
      case "spotlight":
        s.spotlight = pulse * a;
        break;
      case "flash":
        s.brightness += 2 * pulse * a;
        break;
      case "strike":
        s.strike = pulse;
        break;
      case "wiggle":
        s.rotate += Math.sin(p * Math.PI * 6) * 12 * pulse * a;
        s.scaleX *= 1 + 0.08 * pulse * a;
        break;
      // Text effects have per-fragment timing and masks in MotionText.
      default:
        break;
    }
    if (
      m.profile === "bouncy" &&
      m.channel !== "loop" &&
      !m.name.startsWith("text-")
    )
      s.scale *= 1 + 0.08 * Math.sin(p * Math.PI * 3) * (1 - p);
  }
  s.opacity = clamp01(s.opacity);
  s.scale = Math.max(0.01, Math.min(4, s.scale));
  return s;
}
export function wipeMask(p: number, direction: string): string {
  const rest = (1 - clamp01(p)) * 100;
  return direction === "up"
    ? `inset(${rest}% 0 0 0)`
    : direction === "down"
      ? `inset(0 0 ${rest}% 0)`
      : direction === "right"
        ? `inset(0 0 0 ${rest}%)`
        : `inset(0 ${rest}% 0 0)`;
}
export function timerState(elapsed: number, duration: number, fps: number) {
  return {
    remaining: clamp01(1 - elapsed / Math.max(1, duration)),
    value: Math.max(0, Math.ceil((duration - elapsed) / fps)),
  };
}
export function progressAt(
  frame: number,
  timing: { from: number; durationInFrames: number },
) {
  return clamp01((frame - timing.from) / Math.max(1, timing.durationInFrames));
}
