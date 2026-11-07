import type { Comparison } from "./types";

/**
 * Phase 18: one screen can ask for a ranking of several tracks instead of a
 * single pair. A group answer is still stored as plain pairwise rows, so every
 * engine, score and tiebreak keeps working — this module is the translation.
 */

export const MIN_GROUP_SIZE = 2;
/** Seven three-minute tracks is already past what anyone can hold in memory. */
export const MAX_GROUP_SIZE = 7;

/** Clamp a requested group size to what is sane and what the tournament has. */
export function clampGroupSize(size: number, itemCount: number): number {
  const requested = Number.isFinite(size) ? Math.floor(size) : MIN_GROUP_SIZE;
  const cap = Math.min(MAX_GROUP_SIZE, Math.max(MIN_GROUP_SIZE, itemCount));
  return Math.min(Math.max(requested, MIN_GROUP_SIZE), cap);
}

/**
 * Comparisons each track should collect before the plan is done: ceil(log2 n),
 * exactly the budget today's pairwise Swiss spends over ceil(log2 n) rounds.
 * Deliberately independent of the group size, so changing it mid-run does not
 * move the goalposts.
 */
export function targetComparisonsPerItem(n: number): number {
  if (n <= 1) return 0;
  return Math.ceil(Math.log2(n));
}

/**
 * Expand one screen into pairwise rows. `ranked` is best-first; `rest` holds the
 * tracks the user declined to separate — they lose to everything ranked and draw
 * with each other. Every pair of the group is covered exactly once, and the
 * result is a strict weak order, so a screen can never contradict itself.
 */
export function decodeGroupAnswer(ranked: string[], rest: string[]): Comparison[] {
  const out: Comparison[] = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      out.push({ a: ranked[i], b: ranked[j], result: "a" });
    }
    for (const loser of rest) out.push({ a: ranked[i], b: loser, result: "a" });
  }
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      out.push({ a: rest[i], b: rest[j], result: "draw" });
    }
  }
  return out;
}

/**
 * An answer must cover exactly the group that was asked — no dropped, invented
 * or duplicated tracks. Returns an error code, or null when the answer is sound.
 */
export function validateGroupAnswer(
  question: string[],
  ranked: string[],
  rest: string[],
): "GROUP_MISMATCH" | null {
  const answered = [...ranked, ...rest];
  if (answered.length !== question.length) return "GROUP_MISMATCH";
  const seen = new Set(answered);
  if (seen.size !== answered.length) return "GROUP_MISMATCH";
  for (const id of question) if (!seen.has(id)) return "GROUP_MISMATCH";
  return null;
}

/**
 * Task 33: a "pick the best" screen. The winner beats every other participant
 * on the screen; the others are NOT compared among themselves — unlike the
 * "roughly equal" tail of a ranked screen, nothing is said about them.
 */
export function decodePickAnswer(winner: string, others: string[]): Comparison[] {
  return others
    .filter((id) => id !== winner)
    .map((id) => ({ a: winner, b: id, result: "a" as const }));
}

/** A pick answer must name one participant of the screen. */
export function validatePickAnswer(question: string[], winner: string): "GROUP_MISMATCH" | null {
  return question.includes(winner) ? null : "GROUP_MISMATCH";
}
