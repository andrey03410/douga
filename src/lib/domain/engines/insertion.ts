import { computeScores } from "../comparisons";
import { MAX_GROUP_SIZE, clampGroupSize } from "../group-answer";
import type { Comparison, RankedItem } from "../types";
import { PairIndex, placeAmong } from "./pair-index";
import type { Engine } from "./types";

/**
 * Task 33: k-ary insertion. Participants join a growing ordered list one by one
 * in upload order. A screen shows the newcomer and up to k-1 evenly spread
 * pivots of its current window; ranking that group drops the newcomer into the
 * right gap, so each screen splits the window into k parts instead of two.
 *
 * Answers already in the log (from another algorithm, or from pivots of an
 * earlier screen) narrow the window before anything is asked, which is what
 * makes switching to insertion mid-run cheap. A draw places the newcomer below
 * (stable). Intransitive history — the newcomer beat someone placed above a
 * participant it lost to — resolves in favour of its highest win.
 */

/** Pivot offsets (0-based in the window) for a window of m items and c pivots. */
function pivotOffsets(m: number, c: number): number[] {
  const out: number[] = [];
  for (let j = 1; j <= c; j++) out.push(Math.floor((j * m) / (c + 1)));
  return out;
}

/** Narrow [lo, hi) with every known answer of x against list[lo..hi). */
function narrow(
  x: string,
  list: readonly string[],
  lo: number,
  hi: number,
  idx: PairIndex,
): [number, number] {
  let newLo = lo;
  let newHi = hi;
  for (let i = lo; i < hi; i++) {
    const r = idx.get(x, list[i]);
    if (r === "a") newHi = Math.min(newHi, i);
    else if (r === "b" || r === "draw") newLo = Math.max(newLo, i + 1);
  }
  if (newLo > newHi) newLo = newHi; // contradiction: trust the highest win
  return [newLo, newHi];
}

export type SearchStep =
  | { position: number; question?: undefined }
  | { position?: undefined; question: string[] };

/**
 * Where does x go in `list`, restricted to positions lo..hi? Either a final
 * position or the next screen to ask.
 */
export function insertionSearch(
  x: string,
  list: readonly string[],
  idx: PairIndex,
  groupSize: number,
  lo = 0,
  hi = list.length,
): SearchStep {
  [lo, hi] = narrow(x, list, lo, hi, idx);
  if (lo >= hi) return { position: lo };
  const m = hi - lo;
  const k = Math.max(2, groupSize);
  const c = Math.min(k - 1, m);
  const pivots = pivotOffsets(m, c).map((o) => list[lo + o]);
  return { question: placeAmong(x, pivots, String(list.length)) };
}

/**
 * Insert `pending` into `base` in order. Returns the list built so far and the
 * next screen, or the finished list with `question: null`.
 */
export function insertionStep(
  base: readonly string[],
  pending: readonly string[],
  idx: PairIndex,
  groupSize: number,
): { list: string[]; question: string[] | null; inserted: number } {
  const list = [...base];
  let inserted = 0;
  for (const x of pending) {
    if (list.includes(x)) {
      inserted++;
      continue;
    }
    const step = insertionSearch(x, list, idx, groupSize);
    if (step.question) return { list, question: step.question, inserted };
    list.splice(step.position, 0, x);
    inserted++;
  }
  return { list, question: null, inserted };
}

/** Worst-case screens to place one newcomer into a list of m (no prior answers). */
export function insertScreens(m: number, groupSize: number): number {
  const k = Math.max(2, groupSize);
  let screens = 0;
  let window = m;
  while (window > 0) {
    screens++;
    const c = Math.min(k - 1, window);
    const offsets = pivotOffsets(window, c);
    let worst = offsets[0];
    for (let j = 1; j < offsets.length; j++)
      worst = Math.max(worst, offsets[j] - offsets[j - 1] - 1);
    worst = Math.max(worst, window - offsets[offsets.length - 1] - 1);
    window = worst;
  }
  return screens;
}

/** Worst-case screens to insert participants into a list growing from `from` to `from + count`. */
export function insertionPlan(from: number, count: number, groupSize: number): number {
  let total = 0;
  for (let m = from; m < from + count; m++) total += insertScreens(m, groupSize);
  return total;
}

export function toRanked(order: string[], comparisons: Comparison[]): RankedItem[] {
  const scores = computeScores(order, comparisons);
  return order.map((id, i) => ({ id, rank: i + 1, score: scores.get(id) ?? 0 }));
}

export const insertionEngine: Engine = {
  scheme: "insertion",
  maxGroupSize: MAX_GROUP_SIZE,
  // The list built so far is a real, strict partial top.
  partial: true,

  next({ items, comparisons, groupSize }) {
    const k = clampGroupSize(groupSize, items.length);
    const { question } = insertionStep([], items, new PairIndex(comparisons), k);
    return question ? { kind: "rank", items: question } : null;
  },

  result({ items, comparisons, groupSize }) {
    const k = clampGroupSize(groupSize, items.length);
    const { list } = insertionStep([], items, new PairIndex(comparisons), k);
    const placed = new Set(list);
    return {
      placed: toRanked(list, comparisons),
      unplaced: items.filter((id) => !placed.has(id)).map((id) => ({ id })),
    };
  },

  plannedScreens(n, groupSize) {
    if (n <= 1) return 0;
    return insertionPlan(0, n, clampGroupSize(groupSize, n));
  },
};
