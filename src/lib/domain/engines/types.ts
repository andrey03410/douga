import type { Comparison, RankedItem, Scheme } from "../types";
import type { SchemeSettings } from "../scheme-settings";

/** One screen the person answers. */
export type Question =
  /** Order the group best-first (the classic group screen). */
  | { kind: "rank"; items: string[] }
  /** Choose the single best; the rest stay uncompared among themselves. */
  | { kind: "pick"; items: string[] }
  /** Put one participant into a tier. */
  | { kind: "tier"; item: string };

/**
 * Everything an engine may look at. Engines are pure and resumable: the next
 * screen and the result follow from this input alone, so a paused run resumes
 * by replaying the log.
 */
export interface EngineInput {
  /** Active participants in upload order (excluded ones are left out). */
  items: string[];
  comparisons: Comparison[];
  /** Requested group size; engines clamp it to the field and their cap. */
  groupSize: number;
  /** Extra opponents bought by "one more round" (swiss, rating). */
  bonusOpponents?: number;
  settings?: SchemeSettings;
  /** Latest tier of each participant (tiers only). */
  tiers?: ReadonlyMap<string, number>;
}

export interface UnplacedItem {
  id: string;
  /** Tier index for tiers. */
  tier?: number;
  /** Bracket round (1-based) the participant went out in. */
  stage?: number;
}

export interface EngineResult {
  /** Strict places, best first. Provisional while the run is incomplete. */
  placed: RankedItem[];
  /** Participants without a place (outside top K, tier only, knocked out). */
  unplaced: UnplacedItem[];
}

export interface Engine {
  scheme: Scheme;
  /** Largest group one screen may show (2 = pairs only). */
  maxGroupSize: number;
  /** Interim standings mean something before the run completes. */
  partial: boolean;
  next(input: EngineInput): Question | null;
  result(input: EngineInput): EngineResult;
  /** Screens the run is expected to take; drives the estimate and progress bar. */
  plannedScreens(n: number, groupSize: number, settings?: SchemeSettings): number;
}
