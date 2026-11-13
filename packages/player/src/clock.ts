/** Pure timing of the interactive player: the game's server clock drives the frame. */

/** Frames of drift tolerated before the player is re-seeked (0.2 s at 30 fps). */
export const DRIFT_FRAMES = 6;

export interface ClockInput {
  /** Server time now, ms. */
  now: number;
  /** Server time when frame 0 of the plan plays, ms. */
  startedAt: number;
  fps: number;
  durationInFrames: number;
  /** Stop here and wait for the game. */
  holdFrame?: number | null;
}

/** The last frame the player may show now. */
export function frameLimit({ durationInFrames, holdFrame }: Pick<ClockInput, "durationInFrames" | "holdFrame">): number {
  const last = Math.max(0, durationInFrames - 1);
  return holdFrame === undefined || holdFrame === null ? last : Math.max(0, Math.min(holdFrame, last));
}

/** The frame every viewer should see right now. */
export function targetFrame(input: ClockInput): number {
  const elapsed = Math.floor(((input.now - input.startedAt) * input.fps) / 1000);
  return Math.max(0, Math.min(elapsed, frameLimit(input)));
}

export type SyncStep =
  | { type: "none" }
  | { type: "seek"; frame: number; play: boolean }
  | { type: "play" }
  | { type: "pause"; frame: number };

/** What to do with a player at `current` frame so that it shows `target`. */
export function syncStep(state: {
  current: number;
  playing: boolean;
  target: number;
  limit: number;
  paused: boolean;
}): SyncStep {
  const { current, playing, target, limit, paused } = state;
  const still = paused || target >= limit;
  if (still) {
    if (playing || current !== target) return { type: "pause", frame: target };
    return { type: "none" };
  }
  if (Math.abs(current - target) > DRIFT_FRAMES) return { type: "seek", frame: target, play: true };
  if (!playing) return { type: "play" };
  return { type: "none" };
}
