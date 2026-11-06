import {
  MAX_GROUP_SIZE,
  clampGroupSize,
  decodeGroupAnswer,
  targetComparisonsPerItem,
} from "../group-answer";
import type { SchemeSettings } from "../scheme-settings";
import type { Comparison, RankedItem } from "../types";
import { PairIndex } from "./pair-index";
import type { Engine } from "./types";

/**
 * Task 33: "Рейтинг" — Bradley–Terry strengths (the model behind Elo) fitted
 * to every answer, so beating a strong opponent weighs more than beating a weak
 * one. Screens group participants of close strength that have met the fewest
 * opponents. The plan is a number of distinct opponents per participant:
 * fast / normal / precise = 1×, 2×, 3× ceil(log2 n), plus "one more round".
 *
 * Fitting: minorization–maximization (Hunter, 2004). A phantom opponent of
 * strength 1 gives everyone one virtual draw, otherwise an unbeaten
 * participant's strength runs off to infinity and the ratings stop meaning
 * anything.
 */

const ACCURACY = { fast: 1, normal: 2, precise: 3 } as const;
const ITERATIONS = 200;

export function ratingTarget(n: number, settings?: SchemeSettings): number {
  if (n <= 1) return 0;
  const m = ACCURACY[settings?.accuracy ?? "normal"];
  return Math.min(n - 1, m * targetComparisonsPerItem(n));
}

/** Strength per participant (geometric scale, phantom = 1). */
export function btStrengths(items: string[], comparisons: Comparison[]): Map<string, number> {
  const idx = new PairIndex(comparisons);
  const active = new Set(items);
  const wins = new Map(items.map((id) => [id, 0.5])); // half of the phantom draw
  const games = new Map<string, string[]>(items.map((id) => [id, []]));
  for (const [a, b, r] of idx.pairs()) {
    if (!active.has(a) || !active.has(b)) continue;
    games.get(a)!.push(b);
    games.get(b)!.push(a);
    if (r === "a") wins.set(a, wins.get(a)! + 1);
    else if (r === "b") wins.set(b, wins.get(b)! + 1);
    else {
      wins.set(a, wins.get(a)! + 0.5);
      wins.set(b, wins.get(b)! + 0.5);
    }
  }
  let p = new Map(items.map((id) => [id, 1]));
  for (let it = 0; it < ITERATIONS; it++) {
    const next = new Map<string, number>();
    let delta = 0;
    for (const id of items) {
      const pi = p.get(id)!;
      let denom = 1 / (pi + 1); // the phantom
      for (const o of games.get(id)!) denom += 1 / (pi + p.get(o)!);
      const v = wins.get(id)! / denom;
      next.set(id, v);
      delta = Math.max(delta, Math.abs(v - pi) / pi);
    }
    p = next;
    if (delta < 1e-9) break;
  }
  return p;
}

export const toElo = (strength: number) => Math.round(1500 + 400 * Math.log10(strength));

function ranked(items: string[], comparisons: Comparison[]): RankedItem[] {
  const p = btStrengths(items, comparisons);
  const idx = new PairIndex(comparisons);
  const order = new Map(items.map((id, i) => [id, i]));
  const wins = new Map(items.map((id) => [id, 0]));
  for (const [a, b, r] of idx.pairs()) {
    if (r === "a" && wins.has(a)) wins.set(a, wins.get(a)! + 1);
    if (r === "b" && wins.has(b)) wins.set(b, wins.get(b)! + 1);
  }
  const sorted = [...items].sort((a, b) => {
    const d = p.get(b)! - p.get(a)!;
    if (Math.abs(d) > 1e-12) return d;
    const h2h = idx.get(a, b);
    if (h2h === "a") return -1;
    if (h2h === "b") return 1;
    const w = wins.get(b)! - wins.get(a)!;
    if (w) return w;
    return order.get(a)! - order.get(b)!;
  });
  return sorted.map((id, i) => ({ id, rank: i + 1, score: toElo(p.get(id)!) }));
}

const SIMULATE_UP_TO = 24;

/** Screens of a run where upload order is the truth. */
function dryRun(n: number, k: number, settings?: SchemeSettings): number {
  const items = Array.from({ length: n }, (_, i) => `p${i}`);
  const order = new Map(items.map((id, i) => [id, i]));
  const log: Comparison[] = [];
  let screens = 0;
  for (;;) {
    const q = ratingEngine.next({ items, comparisons: log, groupSize: k, settings });
    if (!q || q.kind === "tier" || screens > n * n) break;
    screens++;
    const idx = new PairIndex(log);
    const ranked = [...q.items].sort((a, b) => order.get(a)! - order.get(b)!);
    log.push(...decodeGroupAnswer(ranked, []).filter((p) => !idx.has(p.a, p.b)));
  }
  return screens;
}

export const ratingEngine: Engine = {
  scheme: "rating",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: true,

  next({ items, comparisons, groupSize, bonusOpponents = 0, settings }) {
    const n = items.length;
    if (n < 2) return null;
    const k = clampGroupSize(groupSize, n);
    const target = Math.min(n - 1, ratingTarget(n, settings) + Math.max(0, bonusOpponents));
    const idx = new PairIndex(comparisons);
    const active = new Set(items);
    const count = new Map(
      items.map((id) => [id, [...idx.opponentsOf(id)].filter((o) => active.has(o)).length]),
    );
    const p = btStrengths(items, comparisons);
    const order = new Map(items.map((id, i) => [id, i]));
    const byNeed = [...items].sort(
      (a, b) =>
        count.get(a)! - count.get(b)! || p.get(b)! - p.get(a)! || order.get(a)! - order.get(b)!,
    );
    const seed = byNeed.find((id) => count.get(id)! < target);
    if (seed === undefined) return null;
    const ls = Math.log(p.get(seed)!);
    const near = items
      .filter((id) => id !== seed)
      .sort(
        (a, b) =>
          Math.abs(Math.log(p.get(a)!) - ls) - Math.abs(Math.log(p.get(b)!) - ls) ||
          count.get(a)! - count.get(b)! ||
          order.get(a)! - order.get(b)!,
      );
    const group = [seed];
    for (const c of near) {
      if (group.length === k) break;
      if (group.every((g) => !idx.has(g, c))) group.push(c);
    }
    return group.length >= 2 ? { kind: "rank", items: group } : null;
  },

  result({ items, comparisons }) {
    return { placed: ranked(items, comparisons), unplaced: [] };
  },

  // Groups of close strength cannot always be filled with fresh opponents, so
  // measured runs take ~5% (pairs) to ~35% (groups) more than the ideal pass
  // count; the estimate includes that instead of promising the floor.
  // On small fields the plan approaches "everyone meets almost everyone",
  // where greedy groups shrink to pairs; there a dry run is cheap and exact.
  plannedScreens(n, groupSize, settings) {
    if (n <= 1) return 0;
    const k = clampGroupSize(groupSize, n);
    if (n <= SIMULATE_UP_TO) return dryRun(n, k, settings);
    const ideal = Math.ceil(ratingTarget(n, settings) / (k - 1)) * Math.ceil(n / k);
    return Math.ceil(ideal * (k === 2 ? 1.06 : 1.35));
  },
};
