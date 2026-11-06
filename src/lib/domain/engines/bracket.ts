import { MAX_GROUP_SIZE, clampGroupSize } from "../group-answer";
import type { Comparison, RankedItem } from "../types";
import { PairIndex } from "./pair-index";
import type { Engine, Question, UnplacedItem } from "./types";

/**
 * Task 33: "Олимпийская сетка". Each round splits its participants (upload
 * order) into consecutive groups of at most k, sizes differing by at most one.
 * One participant per group goes through: whoever directly beat everyone else
 * in it, otherwise a "pick the best" screen asks. A lone participant gets a bye.
 * Once at most k remain, the final is ranked as a whole.
 *
 * Only finalists get strict places (plus third and fourth for pairs with the
 * third-place match); everyone else is reported with the round they went out
 * in, without a place — a knockout says nothing about who is fifth.
 */

function split(list: string[], k: number): string[][] {
  const groups = Math.ceil(list.length / k);
  const base = Math.floor(list.length / groups);
  const extra = list.length % groups;
  const out: string[][] = [];
  let at = 0;
  for (let g = 0; g < groups; g++) {
    const size = base + (g < extra ? 1 : 0);
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out;
}

/** Order a fully (or partly) answered group: points inside it, then upload order. */
function orderWithin(group: string[], idx: PairIndex, upload: Map<string, number>): string[] {
  const pts = new Map(group.map((id) => [id, 0]));
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++) {
      const r = idx.get(group[i], group[j]);
      if (r === "a") pts.set(group[i], pts.get(group[i])! + 1);
      else if (r === "b") pts.set(group[j], pts.get(group[j])! + 1);
      else if (r === "draw") {
        pts.set(group[i], pts.get(group[i])! + 0.5);
        pts.set(group[j], pts.get(group[j])! + 0.5);
      }
    }
  return [...group].sort((a, b) => {
    const d = pts.get(b)! - pts.get(a)!;
    if (d) return d;
    const h = idx.get(a, b);
    if (h === "a") return -1;
    if (h === "b") return 1;
    return upload.get(a)! - upload.get(b)!;
  });
}

const allKnown = (group: string[], idx: PairIndex) =>
  group.every((a, i) => group.slice(i + 1).every((b) => idx.has(a, b)));

interface BracketState {
  question: Question | null;
  placed: string[];
  unplaced: UnplacedItem[];
}

function run(items: string[], comparisons: Comparison[], groupSize: number, thirdPlace: boolean): BracketState {
  const idx = new PairIndex(comparisons);
  const k = clampGroupSize(groupSize, items.length);
  const upload = new Map(items.map((id, i) => [id, i]));
  const stageOf = new Map<string, number>();
  let round = items;
  let roundNo = 1;
  let lastLosers: string[] = [];
  const pending = (q: Question): BracketState => ({
    question: q,
    placed: [],
    unplaced: items.map((id) => ({ id, ...(stageOf.has(id) ? { stage: stageOf.get(id) } : {}) })),
  });
  while (round.length > k) {
    const winners: string[] = [];
    const losers: string[] = [];
    for (const group of split(round, k)) {
      if (group.length === 1) {
        winners.push(group[0]);
        continue;
      }
      let w = group.find((a) => group.every((b) => b === a || idx.beats(a, b)));
      if (!w) {
        // Still in it: no loss and no draw inside the group. Earlier answers
        // (another algorithm, a noisy pick) can leave several or none.
        const alive = group.filter((a) =>
          group.every((b) => {
            const r = idx.get(a, b);
            return b === a || (r !== "b" && r !== "draw");
          }),
        );
        if (alive.length >= 2) return pending({ kind: "pick", items: alive });
        w = alive[0] ?? orderWithin(group, idx, upload)[0];
      }
      winners.push(w);
      for (const id of group) if (id !== w) losers.push(id);
    }
    for (const id of losers) stageOf.set(id, roundNo);
    lastLosers = losers;
    round = winners;
    roundNo++;
  }
  const finalists = round;
  if (finalists.length >= 2 && !allKnown(finalists, idx))
    return pending({ kind: "rank", items: finalists });
  const placed = finalists.length >= 2 ? orderWithin(finalists, idx, upload) : [...finalists];
  if (thirdPlace && k === 2 && finalists.length === 2 && roundNo > 1) {
    if (lastLosers.length === 2 && !idx.has(lastLosers[0], lastLosers[1]))
      return pending({ kind: "rank", items: lastLosers });
    if (lastLosers.length >= 1 && lastLosers.length <= 2) {
      placed.push(...orderWithin(lastLosers, idx, upload));
      for (const id of lastLosers) stageOf.delete(id);
    }
  }
  const placedSet = new Set(placed);
  return {
    question: null,
    placed,
    unplaced: items
      .filter((id) => !placedSet.has(id))
      .map((id) => ({ id, ...(stageOf.has(id) ? { stage: stageOf.get(id) } : {}) })),
  };
}

export function bracketPlannedScreens(n: number, groupSize: number, thirdPlace: boolean): number {
  if (n <= 1) return 0;
  const k = clampGroupSize(groupSize, n);
  let m = n;
  let screens = 0;
  let rounds = 0;
  while (m > k) {
    const groups = Math.ceil(m / k);
    const base = Math.floor(m / groups);
    // groups of one (only when base is 1 and there is no extra) are byes
    screens += base >= 2 ? groups : m % groups;
    m = groups;
    rounds++;
  }
  if (m >= 2) screens++;
  if (thirdPlace && k === 2 && rounds > 0) screens++;
  return screens;
}

function scores(order: string[], comparisons: Comparison[]): RankedItem[] {
  const idx = new PairIndex(comparisons);
  return order.map((id, i) => {
    let s = 0;
    for (const other of order) {
      const r = idx.get(id, other);
      if (r === "a") s += 1;
      else if (r === "draw") s += 0.5;
    }
    return { id, rank: i + 1, score: s };
  });
}

export const bracketEngine: Engine = {
  scheme: "bracket",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: false,

  next({ items, comparisons, groupSize, settings }) {
    return run(items, comparisons, groupSize, settings?.thirdPlace ?? false).question;
  },

  result({ items, comparisons, groupSize, settings }) {
    const state = run(items, comparisons, groupSize, settings?.thirdPlace ?? false);
    return { placed: scores(state.placed, comparisons), unplaced: state.unplaced };
  },

  plannedScreens: (n, groupSize, settings) =>
    bracketPlannedScreens(n, groupSize, settings?.thirdPlace ?? false),
};
