import { MAX_GROUP_SIZE, clampGroupSize } from "../group-answer";
import { DEFAULT_TIERS } from "../scheme-settings";
import type { Comparison } from "../types";
import { insertionPlan, insertionStep, toRanked } from "./insertion";
import { PairIndex } from "./pair-index";
import type { Engine, EngineInput, Question, UnplacedItem } from "./types";

/**
 * Task 33: "Корзины" — a tier pass first, then (optionally) a strict order
 * inside the top `rankTop` tiers by insertion.
 *
 * The tier order is the person's own statement: anyone in S is above anyone
 * in A, it is not re-checked by comparisons. "Не участвует" is an exclusion
 * handled by the service, so such participants never reach the engine.
 */

function tiersOf(input: EngineInput) {
  const names = input.settings?.tiers ?? DEFAULT_TIERS;
  const rankTop = Math.min(input.settings?.rankTop ?? 0, names.length);
  const tierOf = new Map<string, number>();
  for (const id of input.items) {
    const t = input.tiers?.get(id);
    if (t !== undefined && Number.isInteger(t) && t >= 0 && t < names.length) tierOf.set(id, t);
  }
  return { names, rankTop, tierOf };
}

function run(input: EngineInput) {
  const { names, rankTop, tierOf } = tiersOf(input);
  const untiered = input.items.find((id) => !tierOf.has(id));
  const idx = new PairIndex(input.comparisons);
  const k = clampGroupSize(input.groupSize, input.items.length);
  const ordered: string[][] = [];
  let question: Question | null = untiered ? { kind: "tier", item: untiered } : null;
  for (let t = 0; t < rankTop; t++) {
    const members = input.items.filter((id) => tierOf.get(id) === t);
    const step = insertionStep([], members, idx, k);
    ordered.push(step.list);
    if (!question && step.question) question = { kind: "rank", items: step.question };
    if (step.question) break; // lower tiers wait for this one
  }
  return { names, rankTop, tierOf, ordered, question };
}

export function tiersPlannedScreens(n: number, groupSize: number, tiers: number, rankTop: number): number {
  if (n <= 0) return 0;
  const k = clampGroupSize(groupSize, n);
  const perTier = Math.ceil(n / Math.max(1, tiers));
  return n + Math.min(rankTop, tiers) * insertionPlan(0, perTier, k);
}

export const tiersEngine: Engine = {
  scheme: "tiers",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: false,

  next(input) {
    return run(input).question;
  },

  result(input) {
    const { rankTop, tierOf, ordered } = run(input);
    // Strict places only for a complete prefix of ordered top tiers.
    const placedOrder: string[] = [];
    for (let t = 0; t < rankTop; t++) {
      const members = input.items.filter((id) => tierOf.get(id) === t);
      const list = ordered[t] ?? [];
      if (list.length !== members.length || members.some((id) => !tierOf.has(id))) break;
      if (input.items.some((id) => !tierOf.has(id))) break;
      placedOrder.push(...list);
    }
    const placed = new Set(placedOrder);
    const unplaced: UnplacedItem[] = input.items
      .filter((id) => !placed.has(id))
      .map((id) => (tierOf.has(id) ? { id, tier: tierOf.get(id) } : { id }));
    return { placed: toRanked(placedOrder, input.comparisons as Comparison[]), unplaced };
  },

  plannedScreens(n, groupSize, settings) {
    const tiers = settings?.tiers?.length ?? DEFAULT_TIERS.length;
    return tiersPlannedScreens(n, groupSize, tiers, settings?.rankTop ?? 0);
  },
};
