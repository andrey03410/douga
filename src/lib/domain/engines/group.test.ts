import { describe, it, expect } from "vitest";
import { legacyEngine as createEngine, type LegacyEngine as Engine } from "@/test/engine-legacy";
import { plannedScreens } from "./index";
import { decodeGroupAnswer, targetComparisonsPerItem } from "../group-answer";
import { orderCoverage } from "../order-coverage";
import { lookup, pairKey } from "../comparisons";
import type { Comparison, Scheme } from "../types";

/**
 * Phase 18: drive an engine that asks for a ranking of several tracks at once.
 * `value` is the hidden ground truth (lower = better). `answer` decides how the
 * simulated user replies, so the same driver covers the honest ranker and the
 * one who mashes "roughly equal".
 */
function simulate(
  engine: Engine,
  items: string[],
  value: Record<string, number>,
  groupSize: number,
  answer: (group: string[]) => { ranked: string[]; rest: string[] } = (group) => ({
    ranked: [...group].sort((a, b) => value[a] - value[b]),
    rest: [],
  }),
) {
  const log: Comparison[] = [];
  const questions: string[][] = [];
  let guard = 0;
  while (true) {
    if (guard++ > 20000) throw new Error("engine did not terminate");
    const group = engine.nextQuestion(items, log, groupSize);
    if (group === null) break;
    questions.push(group);
    const { ranked, rest } = answer(group);
    log.push(...decodeGroupAnswer(ranked, rest));
  }
  return { log, questions };
}

const VALUE: Record<string, number> = {
  i0: 5, i1: 2, i2: 9, i3: 1, i4: 7, i5: 3, i6: 8, i7: 4,
};
const ITEMS = Object.keys(VALUE);
const EXPECTED = [...ITEMS].sort((a, b) => VALUE[a] - VALUE[b]);

const GROUPED: Scheme[] = ["swiss", "round_robin"];

describe.each(GROUPED)("%s with group ranking", (scheme) => {
  const engine = createEngine(scheme);

  it.each([2, 3, 4, 5])("terminates with groups of %i", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    expect(engine.nextQuestion(ITEMS, log, k)).toBeNull();
    expect(engine.isComplete(ITEMS, log)).toBe(true);
  });

  it.each([2, 3, 4, 5])("asks groups of at most %i, never smaller than a pair", (k) => {
    const { questions } = simulate(engine, ITEMS, VALUE, k);
    for (const q of questions) {
      expect(q.length).toBeGreaterThanOrEqual(2);
      expect(q.length).toBeLessThanOrEqual(k);
      expect(new Set(q).size).toBe(q.length); // no track twice on one screen
      for (const id of q) expect(ITEMS).toContain(id);
    }
  });

  it.each([2, 3, 4, 5])("never asks the same pair twice with groups of %i", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    const keys = log.map((c) => pairKey(c.a, c.b));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each([2, 3, 4, 5])("records no contradictions from consistent answers (k=%i)", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    expect(orderCoverage(ITEMS, log).contradictory).toBe(0);
  });

  // Task 33: engines report screens, not pairs; the service shows
  // max(done + current, plan), so the bar cannot pass 100% by construction.
  // Screen budgets are covered per engine in simulation.test.ts.

  it.each([2, 3, 4, 5])("produces a full strict ranking with groups of %i", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    const order = engine.ranking(ITEMS, log).map((r) => r.id);
    expect(new Set(order).size).toBe(ITEMS.length);
  });

  it.each([2, 3, 4, 5])("is resumable: the same log yields the same question (k=%i)", (k) => {
    const log: Comparison[] = [];
    for (let step = 0; step < 5; step++) {
      const first = engine.nextQuestion(ITEMS, log, k);
      expect(engine.nextQuestion(ITEMS, log, k)).toEqual(first);
      if (!first) break;
      const ranked = [...first].sort((a, b) => VALUE[a] - VALUE[b]);
      log.push(...decodeGroupAnswer(ranked, []));
    }
  });

  it("terminates even if the user calls every group roughly equal", () => {
    const { log } = simulate(engine, ITEMS, VALUE, 4, (group) => ({ ranked: [], rest: group }));
    expect(engine.nextQuestion(ITEMS, log, 4)).toBeNull();
    expect(log.every((c) => c.result === "draw")).toBe(true);
  });

  it("terminates when the user only names a winner and shrugs at the rest", () => {
    const { log } = simulate(engine, ITEMS, VALUE, 5, (group) => {
      const ranked = [...group].sort((a, b) => VALUE[a] - VALUE[b]).slice(0, 1);
      return { ranked, rest: group.filter((id) => !ranked.includes(id)) };
    });
    expect(engine.nextQuestion(ITEMS, log, 5)).toBeNull();
  });

  it("keeps working when the group size changes mid-run", () => {
    const log: Comparison[] = [];
    let sizes = [5, 5, 2, 3, 2];
    let guard = 0;
    while (guard++ < 5000) {
      const k = sizes.length ? sizes.shift()! : 2;
      const group = engine.nextQuestion(ITEMS, log, k);
      if (group === null) break;
      expect(group.length).toBeLessThanOrEqual(k);
      log.push(...decodeGroupAnswer([...group].sort((a, b) => VALUE[a] - VALUE[b]), []));
    }
    expect(engine.isComplete(ITEMS, log)).toBe(true);
    expect(new Set(log.map((c) => pairKey(c.a, c.b))).size).toBe(log.length);
  });
});

describe("round_robin with group ranking", () => {
  const engine = createEngine("round_robin");

  it.each([2, 3, 4, 5])("still covers every pair exactly once with groups of %i", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    const n = ITEMS.length;
    expect(log.length).toBe((n * (n - 1)) / 2);
  });

  it.each([3, 4, 5])("recovers the ground-truth order with groups of %i", (k) => {
    const { log } = simulate(engine, ITEMS, VALUE, k);
    expect(engine.ranking(ITEMS, log).map((r) => r.id)).toEqual(EXPECTED);
  });

  it("halves the screens once the group is bigger than a pair", () => {
    const [pairs, ...grouped] = [2, 3, 4, 5].map(
      (k) => simulate(engine, ITEMS, VALUE, k).questions.length,
    );
    expect(pairs).toBe(28); // every pair, one screen each
    // Greedy cannot reach the theoretical floor (a screen only holds tracks that
    // have all not met), but it always at least halves the pairwise cost.
    for (const screens of grouped) expect(screens).toBeLessThanOrEqual(pairs / 2);
  });
});

describe("swiss with group ranking", () => {
  const engine = createEngine("swiss");

  it("gives every track its planned number of opponents", () => {
    const { log } = simulate(engine, ITEMS, VALUE, 3);
    const target = targetComparisonsPerItem(ITEMS.length);
    for (const id of ITEMS) {
      const opponents = new Set(
        log.filter((c) => c.a === id || c.b === id).map((c) => (c.a === id ? c.b : c.a)),
      );
      expect(opponents.size).toBeGreaterThanOrEqual(target);
    }
  });

  it("does not starve the odd track left over by an uneven group", () => {
    // 7 tracks in groups of 5 always leaves two out of the first screen
    const seven = ITEMS.slice(0, 7);
    const { log, questions } = simulate(engine, seven, VALUE, 5);
    const target = targetComparisonsPerItem(seven.length);
    const leftOut = seven.filter((id) => !questions[0].includes(id));
    expect(leftOut.length).toBe(2);
    for (const id of leftOut) {
      const opponents = new Set(
        log.filter((c) => c.a === id || c.b === id).map((c) => (c.a === id ? c.b : c.a)),
      );
      expect(opponents.size).toBeGreaterThanOrEqual(target);
    }
  });

  it.each([2, 3, 4, 5])("stays inside the advertised screen estimate (k=%i)", (k) => {
    const { questions } = simulate(engine, ITEMS, VALUE, k);
    expect(questions.length).toBeLessThanOrEqual(plannedScreens("swiss", ITEMS.length, k));
  });

  it("has more to ask when the user buys another round", () => {
    const { log } = simulate(engine, ITEMS, VALUE, 3);
    expect(engine.nextQuestion(ITEMS, log, 3)).toBeNull();
    expect(engine.nextQuestion(ITEMS, log, 3, 2)).not.toBeNull();
    expect(engine.isComplete(ITEMS, log)).toBe(true);
    expect(engine.isComplete(ITEMS, log, 2)).toBe(false);
  });

  it("runs dry once every pair is settled, however many rounds are bought", () => {
    const log: Comparison[] = [];
    let guard = 0;
    while (guard++ < 500) {
      const group = engine.nextQuestion(ITEMS, log, 3, 999);
      if (!group) break;
      log.push(...decodeGroupAnswer([...group].sort((a, b) => VALUE[a] - VALUE[b]), []));
    }
    expect(log.length).toBe((ITEMS.length * (ITEMS.length - 1)) / 2);
    expect(engine.nextQuestion(ITEMS, log, 3, 999)).toBeNull();
  });

  it("spends the same budget per track as the pairwise plan", () => {
    // 8 tracks, 3 opponents each -> 12 pairs, exactly today's rounds*floor(n/2)
    const { log } = simulate(engine, ITEMS, VALUE, 2);
    expect(log.length).toBe(12);
  });
});

describe("merge only asks pairs", () => {
  const engine = createEngine("merge");

  it("declares a maximum group size of two", () => {
    expect(engine.maxGroupSize).toBe(2);
  });

  it("ignores a larger group size and keeps asking pairs", () => {
    const q = engine.nextQuestion(ITEMS, [], 5);
    expect(q).not.toBeNull();
    expect(q!.length).toBe(2);
  });

  it("still recovers the exact order", () => {
    const { log } = simulate(engine, ITEMS, VALUE, 5);
    expect(engine.ranking(ITEMS, log).map((r) => r.id)).toEqual(EXPECTED);
  });
});

describe("group edge cases", () => {
  it.each(["merge", "swiss", "round_robin"] as const)("%s asks nothing about one track", (scheme) => {
    expect(createEngine(scheme).nextQuestion(["only"], [], 5)).toBeNull();
  });

  it.each(["merge", "swiss", "round_robin"] as const)("%s asks one pair about two tracks", (scheme) => {
    const engine = createEngine(scheme);
    expect(engine.nextQuestion(["a", "b"], [], 5)).toEqual(["a", "b"]);
    const log = decodeGroupAnswer(["a", "b"], []);
    expect(engine.nextQuestion(["a", "b"], log, 5)).toBeNull();
  });

  it.each(["swiss", "round_robin"] as const)(
    "%s clamps the group to the number of tracks",
    (scheme) => {
      const three = ["a", "b", "c"];
      const q = createEngine(scheme).nextQuestion(three, [], 7);
      expect(q).toEqual(three);
    },
  );

  it.each(["swiss", "round_robin"] as const)("%s never re-asks a settled pair (%s)", (scheme) => {
    const engine = createEngine(scheme);
    const items = ["a", "b", "c", "d"];
    const log = decodeGroupAnswer(["a", "b"], []);
    let guard = 0;
    let current: string[] | null = log.length ? engine.nextQuestion(items, log, 4) : null;
    while (current && guard++ < 100) {
      // every pair on screen must still be unanswered
      for (let i = 0; i < current.length; i++)
        for (let j = i + 1; j < current.length; j++)
          expect(lookup(log, current[i], current[j])).toBeUndefined();
      log.push(...decodeGroupAnswer([...current], []));
      current = engine.nextQuestion(items, log, 4);
    }
    expect(current).toBeNull();
  });
});
