import type { Scheme } from "../types";
import type { SchemeSettings } from "../scheme-settings";
import { clampGroupSize } from "../group-answer";
import { mergeEngine } from "./merge";
import { swissEngine } from "./swiss";
import { roundRobinEngine } from "./round-robin";
import { insertionEngine } from "./insertion";
import { topKEngine } from "./top-k";
import { tiersEngine } from "./tiers";
import { ratingEngine } from "./rating";
import { bracketEngine } from "./bracket";
import type { Engine } from "./types";

export type { Engine, EngineInput, EngineResult, Question, UnplacedItem } from "./types";

/**
 * Task 33: eight engines behind one input object (Engine v2). Every engine is
 * PURE and RESUMABLE: the next screen and the result follow from the active
 * participants (upload order), the answer log, tiers and settings alone, so a
 * paused run — or a run switched to another algorithm — resumes by replaying.
 */
const ENGINES: Record<Scheme, Engine> = {
  merge: mergeEngine,
  swiss: swissEngine,
  round_robin: roundRobinEngine,
  insertion: insertionEngine,
  top_k: topKEngine,
  tiers: tiersEngine,
  rating: ratingEngine,
  bracket: bracketEngine,
};

export const ENGINE_SCHEMES = Object.keys(ENGINES) as Scheme[];

export function createEngine(scheme: Scheme): Engine {
  return ENGINES[scheme];
}

/** Group size in force for an engine and a field. */
export function engineGroupSize(scheme: Scheme, requested: number, n: number): number {
  return Math.min(clampGroupSize(requested, n), ENGINES[scheme].maxGroupSize);
}

/**
 * Screens the run is expected to take, for the progress bar and the "how long
 * will this take" estimate in the algorithm picker.
 */
export function plannedScreens(
  scheme: Scheme,
  n: number,
  groupSize: number,
  settings?: SchemeSettings,
): number {
  if (n <= 1 && scheme !== "tiers") return 0;
  return ENGINES[scheme].plannedScreens(n, engineGroupSize(scheme, groupSize, n), settings);
}

export {
  mergeEngine,
  swissEngine,
  roundRobinEngine,
  insertionEngine,
  topKEngine,
  tiersEngine,
  ratingEngine,
  bracketEngine,
};
