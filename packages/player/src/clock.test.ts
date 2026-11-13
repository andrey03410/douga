import { describe, expect, it } from "vitest";
import { frameLimit, syncStep, targetFrame } from "./clock";

describe("interactive clock", () => {
  const base = { startedAt: 10_000, fps: 30, durationInFrames: 300 };
  it("follows the server clock and stops at the hold or the end", () => {
    expect(targetFrame({ ...base, now: 9_000 })).toBe(0);
    expect(targetFrame({ ...base, now: 11_000 })).toBe(30);
    expect(targetFrame({ ...base, now: 30_000 })).toBe(299);
    expect(targetFrame({ ...base, now: 30_000, holdFrame: 120 })).toBe(120);
    expect(frameLimit({ durationInFrames: 300, holdFrame: 900 })).toBe(299);
  });
  it("re-seeks only on visible drift and freezes when held or paused", () => {
    expect(syncStep({ current: 30, playing: true, target: 33, limit: 299, paused: false })).toEqual({ type: "none" });
    expect(syncStep({ current: 30, playing: true, target: 40, limit: 299, paused: false })).toEqual({ type: "seek", frame: 40, play: true });
    expect(syncStep({ current: 30, playing: false, target: 31, limit: 299, paused: false })).toEqual({ type: "play" });
    expect(syncStep({ current: 118, playing: true, target: 120, limit: 120, paused: false })).toEqual({ type: "pause", frame: 120 });
    expect(syncStep({ current: 120, playing: false, target: 120, limit: 120, paused: false })).toEqual({ type: "none" });
    expect(syncStep({ current: 50, playing: true, target: 60, limit: 299, paused: true })).toEqual({ type: "pause", frame: 60 });
  });
});
