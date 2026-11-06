import { MAX_GROUP_SIZE, clampGroupSize } from "../group-answer";
import type { Comparison } from "../types";
import { insertionPlan, insertionSearch, insertionStep, toRanked, insertScreens } from "./insertion";
import { PairIndex, stableHash } from "./pair-index";
import type { Engine, Question } from "./types";

/**
 * Task 33: "Лучшие K" — strict places only for the K best.
 *
 * 1. The first K participants (upload order) form the top by insertion.
 * 2. Filter: the threshold is the K-th of the top. A candidate who lost (or
 *    drew) directly to the threshold or to anyone pushed out of the top earlier
 *    is out: K participants are above it through that chain. Candidates with no
 *    answer against the threshold go on a "pick the best" screen together with
 *    it — one click usually clears the whole screen.
 * 3. A candidate who beat the threshold is inserted into the top (window above
 *    the threshold) and the old threshold is pushed out.
 *
 * Growing K replays the same log with the bigger top; every old answer is
 * reused wherever it applies.
 */

interface TopKState {
  top: string[];
  out: Set<string>;
  question: Question | null;
}

function run(items: string[], comparisons: Comparison[], groupSize: number, K: number): TopKState {
  const idx = new PairIndex(comparisons);
  const k = clampGroupSize(groupSize, items.length);
  const size = Math.min(K, items.length);
  const filled = insertionStep([], items.slice(0, size), idx, k);
  const top = filled.list;
  if (filled.question) return { top, out: new Set(), question: { kind: "rank", items: filled.question } };

  const pushed: string[] = []; // fell out of the top; all below it
  const out = new Set<string>();
  let pending = items.slice(size);
  let guard = 0;
  while (pending.length) {
    if (guard++ > items.length * 4 + 10) break; // each pass removes someone; defensive
    const threshold = top[size - 1];
    const undecided: string[] = [];
    let inserted = false;
    for (const c of pending) {
      const vsThreshold = idx.get(c, threshold);
      const lostToPushed = pushed.some((p) => {
        const r = idx.get(c, p);
        return r === "b" || r === "draw";
      });
      if (vsThreshold === "b" || vsThreshold === "draw" || lostToPushed) {
        out.add(c);
        continue;
      }
      if (vsThreshold === "a") {
        const step = insertionSearch(c, top, idx, k, 0, size - 1);
        if (step.question) return { top, out, question: { kind: "rank", items: step.question } };
        top.splice(step.position, 0, c);
        const dropped = top.pop()!;
        pushed.push(dropped);
        out.add(dropped);
        inserted = true;
        break; // the threshold moved: classify the rest again
      }
      undecided.push(c);
    }
    pending = pending.filter((c) => !out.has(c) && !top.includes(c));
    if (inserted) continue;
    if (!undecided.length) break;
    const group = undecided.slice(0, Math.max(1, k - 1));
    const at = stableHash(threshold + group.join()) % (group.length + 1);
    return {
      top,
      out,
      question: { kind: "pick", items: [...group.slice(0, at), threshold, ...group.slice(at)] },
    };
  }
  return { top, out, question: null };
}

export function topKPlannedScreens(n: number, groupSize: number, K: number): number {
  if (n <= 1) return 0;
  const k = clampGroupSize(groupSize, n);
  const size = Math.min(K, n);
  const fill = insertionPlan(0, size, k);
  if (n <= size) return fill;
  const filter = Math.ceil((n - size) / (k - 1));
  // Expected entries into the top from a random order: K·ln(n/K).
  const entries = Math.ceil(size * Math.log(n / size));
  return fill + filter + entries * (1 + insertScreens(Math.max(0, size - 1), k));
}

export const topKEngine: Engine = {
  scheme: "top_k",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: true,

  next({ items, comparisons, groupSize, settings }) {
    return run(items, comparisons, groupSize, settings?.k ?? 10).question;
  },

  result({ items, comparisons, groupSize, settings }) {
    const { top } = run(items, comparisons, groupSize, settings?.k ?? 10);
    const placed = new Set(top);
    return {
      placed: toRanked(top, comparisons),
      unplaced: items.filter((id) => !placed.has(id)).map((id) => ({ id })),
    };
  },

  plannedScreens: (n, groupSize, settings) => topKPlannedScreens(n, groupSize, settings?.k ?? 10),
};
