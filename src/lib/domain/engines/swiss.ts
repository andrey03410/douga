import type { Comparison } from "../types";
import { computeScores, opponentCounts, pairKey, playedPairs, rankByScore } from "../comparisons";
import {
  MAX_GROUP_SIZE,
  clampGroupSize,
  targetComparisonsPerItem,
} from "../group-answer";
import type { Engine } from "./types";

/** Number of Swiss rounds for n players: ceil(log2 n), at least 1. */
export function swissRounds(n: number): number {
  if (n <= 1) return 0;
  return Math.max(1, Math.ceil(Math.log2(n)));
}

/**
 * Phase 18 rewrote the scheduler. It used to replay every round from scratch:
 * sort by points at the start of a round, pair adjacently. With a group size the
 * user can change mid-run that replay reconstructs a schedule that was never
 * shown, so the next group is now derived from the state of the log instead:
 *
 *   1. candidates sorted by (opponents faced asc, points desc, upload order asc)
 *   2. the seed is the first candidate still short of its planned opponents
 *   3. fill up to k with candidates that have not met anyone already picked
 *
 * Two consequences worth knowing. Points now update inside a round, so the order
 * of questions differs slightly from the old pairing even at k=2. And a track
 * left out of an uneven group is the one with the fewest opponents, so it heads
 * the next group automatically — no more byes that quietly cost a comparison.
 */
function nextGroup(
  items: string[],
  comparisons: Comparison[],
  groupSize: number,
  bonusOpponents = 0,
): string[] | null {
  const n = items.length;
  if (n < 2) return null;

  const k = clampGroupSize(groupSize, n);
  // "One more round" raises the bar by a round's worth of opponents; stored in
  // opponents rather than rounds so the goalposts survive a change of k.
  const target = targetComparisonsPerItem(n) + Math.max(0, bonusOpponents);
  const played = playedPairs(comparisons);
  const counts = opponentCounts(items, comparisons);
  const points = computeScores(items, comparisons);
  const originalIndex = new Map(items.map((id, i) => [id, i]));

  const order = [...items].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    const pa = points.get(a) ?? 0;
    const pb = points.get(b) ?? 0;
    if (pa !== pb) return pb - pa;
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });

  const seed = order.find((id) => (counts.get(id) ?? 0) < target);
  if (seed === undefined) return null; // every track met its planned opponents

  const group = [seed];
  for (const candidate of order) {
    if (group.length === k) break;
    if (group.includes(candidate)) continue;
    if (group.every((picked) => !played.has(pairKey(picked, candidate)))) {
      group.push(candidate);
    }
  }

  // The seed is short of `target <= n-1` opponents, so a fresh one always
  // exists; the guard is here so an unforeseen state ends the run instead of
  // looping forever on a group of one.
  return group.length >= 2 ? group : null;
}

/** Swiss plan: each pass over the field costs ceil(n/k) screens and gives every track k-1 comparisons. */
export function swissPlannedScreens(n: number, groupSize: number): number {
  if (n <= 1) return 0;
  const k = clampGroupSize(groupSize, n);
  const rounds = Math.ceil(targetComparisonsPerItem(n) / (k - 1));
  return rounds * Math.ceil(n / k);
}

export const swissEngine: Engine = {
  scheme: "swiss",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: true,

  next({ items, comparisons, groupSize, bonusOpponents = 0 }) {
    const group = nextGroup(items, comparisons, groupSize, bonusOpponents);
    return group ? { kind: "rank", items: group } : null;
  },

  // Points-based standings are meaningful at any point.
  result({ items, comparisons }) {
    return { placed: rankByScore(items, comparisons), unplaced: [] };
  },

  plannedScreens: swissPlannedScreens,
};
