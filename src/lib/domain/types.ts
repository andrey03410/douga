// Framework-agnostic domain types for the tournament engine.

export const SCHEMES = [
  "merge",
  "swiss",
  "round_robin",
  "insertion",
  "top_k",
  "tiers",
  "rating",
  "bracket",
] as const;
export type Scheme = (typeof SCHEMES)[number];

export const COMPARISON_RESULTS = ["a", "b", "draw"] as const;
export type ComparisonResult = (typeof COMPARISON_RESULTS)[number];

export const TOURNAMENT_STATUSES = ["draft", "in_progress", "completed"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** A recorded 1-vs-1 outcome. `result` is oriented relative to (a, b). */
export interface Comparison {
  a: string;
  b: string;
  result: ComparisonResult;
}

export interface Pair {
  a: string;
  b: string;
}

export interface RankedItem {
  id: string;
  rank: number; // 1-based, strictly increasing (no shared places)
  score: number; // wins=1, draw=0.5, loss=0 (display/tiebreak metric)
}

export interface Progress {
  completed: number;
  estimatedTotal: number;
}

export function isScheme(value: unknown): value is Scheme {
  return typeof value === "string" && (SCHEMES as readonly string[]).includes(value);
}

export function isComparisonResult(value: unknown): value is ComparisonResult {
  return (
    typeof value === "string" &&
    (COMPARISON_RESULTS as readonly string[]).includes(value)
  );
}
