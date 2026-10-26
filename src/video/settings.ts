import type { Settings, Time } from "./types";
export const DEFAULT_SETTINGS: Settings = {
  background: "#101522",
  card: {
    fit: "cover",
    orientation: "landscape",
    offsetSec: 0,
    loop: true,
    playSound: false,
    volume: 1,
    borderRadius: 18,
    background: "#252d40",
    color: "#ffffff",
    borderColor: "#5a6a88",
    borderWidth: 2,
    fontSize: 36,
  },
  labels: { mode: "always", showRank: true, delaySec: 0 },
  layout: { type: "grid", padding: 24, gap: 20 },
  top: {
    order: "descending",
    durationSec: 5,
    snippet: { mode: "manual", startSec: 0 },
  },
  picker: {
    leadSec: 0.5,
    revealSec: 2,
    timerSec: 5,
    answerSec: 2.5,
    hideAfterReveal: false,
    answerMode: "inline",
    staggerSec: 0.15,
    showPrompt: true,
  },
};
export function mergeSettings(...layers: (Settings | undefined)[]): Settings {
  const result: Settings = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(layer) as (keyof Settings)[]) {
      const value = layer[key];
      if (value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        const previous = result.top?.snippet;
        (result as any)[key] = { ...((result[key] as object) ?? {}), ...value };
        if (key === "top" && layer.top?.snippet)
          result.top!.snippet = { ...previous, ...layer.top.snippet };
      } else (result as any)[key] = value;
    }
  }
  return result;
}
export function frames(t: Time | undefined, fps: number, fallback = 0): number {
  return t ? ("frame" in t ? t.frame : Math.round(t.sec * fps)) : fallback;
}
