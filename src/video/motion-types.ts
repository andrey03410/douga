import type { BoardEvent, CompiledMedia, Time, Window } from "./types";
export const motionNames = [
  "fade",
  "pop",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "flip-x",
  "flip-y",
  "tilt",
  "blur-reveal",
  "wipe-reveal",
  "iris",
  "elastic",
  "spin",
  "float",
  "breathe",
  "sway",
  "drift",
  "ken-burns",
  "shimmer",
  "orbit",
  "pulse",
  "bounce",
  "shake",
  "nudge",
  "glow",
  "outline",
  "stamp",
  "spotlight",
  "flash",
  "strike",
  "wiggle",
  "text-words",
  "text-lines",
  "text-letters",
  "text-wipe",
  "text-counter",
  "text-slam",
] as const;
export type MotionName = (typeof motionNames)[number];
export type MotionChannel = "enter" | "exit" | "loop" | "emphasis";
export type MotionProfile = "smooth" | "snappy" | "bouncy" | "cinematic";
export type MotionIntensity = "subtle" | "normal" | "bold";
export type MotionDirection = "up" | "down" | "left" | "right" | "in" | "out";
export const choreographyNames = [
  "versus-impact",
  "picker-cascade",
  "winner-spotlight",
  "rank-reveal",
  "podium-finale",
  "board-place",
  "board-swap",
  "title-reveal",
  "cinematic-pan",
  "round-intro",
] as const;
export type ChoreographyName = (typeof choreographyNames)[number];
export type MotionEvent =
  | "scene.start"
  | "card.reveal"
  | "timer.start"
  | "answer.reveal"
  | BoardEvent["event"];
export type MotionAnchor =
  | Time
  | {
      event: MotionEvent;
      offset?: Time;
      cardId?: string;
      actionId?: string;
      slotId?: string;
    };
export type MotionSpec =
  | MotionName
  | "flip"
  | {
      name: MotionName | "flip";
      duration?: Time;
      delay?: Time;
      intensity?: MotionIntensity;
      direction?: MotionDirection;
      at?: MotionAnchor;
    };
export interface MotionSettings {
  duration?: Time;
  profile?: MotionProfile;
  intensity?: MotionIntensity;
  enter?: MotionSpec | null;
  exit?: MotionSpec | null;
  loop?: MotionSpec | null;
  emphasis?: MotionSpec | null;
  stagger?: {
    interval: Time;
    order?: "forward" | "reverse" | "center" | "rows";
  } | null;
  choreography?: ChoreographyName | null;
}
/** All timing is scene-local; intensity is a finite multiplier (0.5/1/1.5). */
export interface CompiledMotion {
  name: MotionName;
  channel: MotionChannel;
  from: number;
  durationInFrames: number;
  profile: MotionProfile;
  intensity: number;
  direction: MotionDirection;
  /** Restricts effects to the same semantic visibility window as the node. */
  window: Window;
  /** Text is split by the renderer, never expanded into IR nodes. */
  fragments?: number;
}
export const backdropNames = [
  "art-blur",
  "gradient-flow",
  "light-orbs",
  "particles",
  "vignette",
] as const;
export interface BackdropSettings {
  preset: (typeof backdropNames)[number];
  source?: "current-card" | "round" | "asset";
  asset?: string;
  colors?: string[];
  blur?: number;
  dim?: number;
  motion?: boolean;
  intensity?: MotionIntensity;
  particles?: number;
}
export interface CompiledBackdrop {
  preset: BackdropSettings["preset"];
  source: NonNullable<BackdropSettings["source"]>;
  colors: string[];
  blur: number;
  dim: number;
  motion: boolean;
  intensity: number;
  particles: number;
  /** Crossfade starts at `from` and fits inside the layer window. No hidden future media. */
  layers: {
    from: number;
    to: number;
    fadeInFrames: number;
    media: CompiledMedia;
  }[];
}
export interface TimerSettings {
  variant?: "digits" | "ring" | "segments" | "bar";
  color?: string;
  trackColor?: string;
  strokeWidth?: number;
  showValue?: boolean;
  warningSec?: number;
}
export interface VersusSettings {
  variant?: "clean" | "neon" | "slash" | "impact";
  color?: string;
}
export interface BadgeSettings {
  kind: "rank" | "round" | "winner" | "label";
  color?: string;
}
export interface ProgressSettings {
  scope?: "scene" | "video";
  color?: string;
  trackColor?: string;
  strokeWidth?: number;
}
export const transitionNames = [
  "none",
  "fade",
  "slide",
  "wipe",
  "zoom",
  "push",
  "flash",
  "iris",
  "split",
  "blur",
  "crossfade",
] as const;
export type TransitionName = (typeof transitionNames)[number];
