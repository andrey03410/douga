import { createEngine } from "@/lib/domain/engines";
import type { Comparison, Pair, RankedItem, Scheme } from "@/lib/domain/types";

/**
 * Task 33 moved engines to one input object (Engine v2). The pre-33 engine
 * tests keep their assertions verbatim through this view of the old
 * positional API — the regression proof that merge, swiss and round_robin
 * behave exactly as before.
 */
export interface LegacyEngine {
  scheme: Scheme;
  maxGroupSize: number;
  nextQuestion(items: string[], log: Comparison[], groupSize: number, bonus?: number): string[] | null;
  nextPair(items: string[], log: Comparison[]): Pair | null;
  isComplete(items: string[], log: Comparison[], bonus?: number): boolean;
  ranking(items: string[], log: Comparison[]): RankedItem[];
  partialRanking(items: string[], log: Comparison[]): RankedItem[] | null;
}

export function legacyEngine(scheme: Scheme): LegacyEngine {
  const engine = createEngine(scheme);
  const ask = (items: string[], comparisons: Comparison[], groupSize: number, bonusOpponents = 0) => {
    const q = engine.next({ items, comparisons, groupSize, bonusOpponents });
    return q && q.kind !== "tier" ? q.items : null;
  };
  return {
    scheme,
    maxGroupSize: engine.maxGroupSize,
    nextQuestion: ask,
    nextPair(items, log) {
      const q = ask(items, log, 2);
      return q ? { a: q[0], b: q[1] } : null;
    },
    isComplete: (items, log, bonus = 0) => ask(items, log, 2, bonus) === null,
    ranking: (items, log) => engine.result({ items, comparisons: log, groupSize: 2 }).placed,
    partialRanking: (items, log) =>
      engine.partial ? engine.result({ items, comparisons: log, groupSize: 2 }).placed : null,
  };
}
