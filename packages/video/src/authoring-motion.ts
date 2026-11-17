import type { MotionCatalogEntry } from "./motion-catalog";
const effects = new Set(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "blur-reveal", "wipe-reveal", "ken-burns", "shimmer", "glow", "outline", "spotlight", "text-words", "text-lines", "text-wipe"]);
const choreographies = new Set(["picker-cascade", "winner-spotlight", "rank-reveal", "podium-finale", "board-place", "board-swap", "title-reveal", "cinematic-pan", "round-intro"]);
/** The compatibility catalog remains intact; ordinary discovery starts with restrained building blocks. */
export function isAuthoringMotion(entry: Pick<MotionCatalogEntry, "category" | "name">): boolean {
  if (entry.category === "effect") return effects.has(entry.name);
  if (entry.category === "choreography") return choreographies.has(entry.name);
  if (entry.category === "transition") return ["crossfade", "wipe", "luma-wipe"].includes(entry.name);
  return true;
}
