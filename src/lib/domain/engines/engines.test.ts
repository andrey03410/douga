import { describe, it, expect } from "vitest";
import { legacyEngine as createEngine, type LegacyEngine as Engine } from "@/test/engine-legacy";
import { swissRounds } from "./swiss";
import { mergeWorstCaseComparisons } from "./merge";
import type { Comparison } from "../types";

/**
 * Drive an engine to completion. `value` defines a hidden ground-truth order
 * (lower value = better). Returns the recorded log and the engine's final order.
 */
function simulate(engine: Engine, items: string[], value: Record<string, number>) {
  const log: Comparison[] = [];
  let guard = 0;
  while (true) {
    if (guard++ > 100000) throw new Error("engine did not terminate");
    const pair = engine.nextPair(items, log);
    if (pair === null) break;
    const va = value[pair.a];
    const vb = value[pair.b];
    const result = va === vb ? "draw" : va < vb ? "a" : "b";
    log.push({ a: pair.a, b: pair.b, result });
  }
  return { log, order: engine.ranking(items, log).map((r) => r.id) };
}

const VALUE: Record<string, number> = {
  i0: 5,
  i1: 2,
  i2: 9,
  i3: 1,
  i4: 7,
  i5: 3,
  i6: 8,
  i7: 4,
};
const ITEMS = Object.keys(VALUE);
const EXPECTED = [...ITEMS].sort((a, b) => VALUE[a] - VALUE[b]); // best->worst

describe.each(["merge", "swiss", "round_robin"] as const)("%s engine", (scheme) => {
  const engine = createEngine(scheme);

  it("terminates and reports completion", () => {
    const { log } = simulate(engine, ITEMS, VALUE);
    expect(engine.isComplete(ITEMS, log)).toBe(true);
    expect(engine.nextPair(ITEMS, log)).toBeNull();
  });

  it("produces a full strict ranking of all items", () => {
    const { order } = simulate(engine, ITEMS, VALUE);
    expect(order.length).toBe(ITEMS.length);
    expect(new Set(order).size).toBe(ITEMS.length);
  });

  it("is resumable: replay yields the same next pair", () => {
    const log: Comparison[] = [];
    for (let step = 0; step < 5; step++) {
      const a = engine.nextPair(ITEMS, log);
      const b = engine.nextPair(ITEMS, log); // same inputs -> same question
      expect(b).toEqual(a);
      if (!a) break;
      const result = VALUE[a.a] < VALUE[a.b] ? "a" : "b";
      log.push({ a: a.a, b: a.b, result });
    }
  });
});

describe("merge engine correctness & efficiency", () => {
  const engine = createEngine("merge");

  it("recovers the exact ground-truth order", () => {
    const { order } = simulate(engine, ITEMS, VALUE);
    expect(order).toEqual(EXPECTED);
  });

  it("uses on the order of N*log2(N) comparisons", () => {
    const { log } = simulate(engine, ITEMS, VALUE);
    const n = ITEMS.length;
    expect(log.length).toBeLessThanOrEqual(Math.ceil(n * Math.log2(n)));
  });

  it("never exceeds the worst-case estimate (progress bar stays <= 100%)", () => {
    const { log } = simulate(engine, ITEMS, VALUE);
    expect(log.length).toBeLessThanOrEqual(mergeWorstCaseComparisons(ITEMS.length));
  });

  it("has no provisional ranking", () => {
    expect(engine.partialRanking(ITEMS, [])).toBeNull();
  });

  it("places draws adjacently as equals (stable)", () => {
    const items = ["a", "b", "c"];
    // a and b are equal, both beat c
    const value = { a: 1, b: 1, c: 2 };
    const { order } = simulate(engine, items, value);
    expect(order.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(order[2]).toBe("c");
  });
});

describe("round_robin engine", () => {
  const engine = createEngine("round_robin");

  it("asks exactly N*(N-1)/2 comparisons", () => {
    const { log } = simulate(engine, ITEMS, VALUE);
    const n = ITEMS.length;
    expect(log.length).toBe((n * (n - 1)) / 2);
  });

  it("recovers the ground-truth order under a consistent total order", () => {
    const { order } = simulate(engine, ITEMS, VALUE);
    expect(order).toEqual(EXPECTED);
  });
});

describe("mergeWorstCaseComparisons", () => {
  it("matches the known formula for powers of two and beyond", () => {
    expect(mergeWorstCaseComparisons(1)).toBe(0);
    expect(mergeWorstCaseComparisons(2)).toBe(1); // 2*1 - 2 + 1
    expect(mergeWorstCaseComparisons(4)).toBe(5); // 4*2 - 4 + 1
    expect(mergeWorstCaseComparisons(8)).toBe(17); // 8*3 - 8 + 1
  });
  it("is tighter than the naive n*log2(n)", () => {
    for (const n of [5, 8, 16, 32]) {
      expect(mergeWorstCaseComparisons(n)).toBeLessThanOrEqual(Math.ceil(n * Math.log2(n)));
    }
  });
});

describe("partial ranking (provisional standings)", () => {
  it.each(["swiss", "round_robin"] as const)("%s exposes points-based standings", (scheme) => {
    const engine = createEngine(scheme);
    const log: Comparison[] = [{ a: "i0", b: "i1", result: "a" }];
    const partial = engine.partialRanking(ITEMS, log);
    expect(partial).not.toBeNull();
    expect(partial!.length).toBe(ITEMS.length);
    expect(partial![0].id).toBe("i0"); // winner leads
  });
});

describe("swiss rounds", () => {
  it("uses ceil(log2 n) rounds", () => {
    expect(swissRounds(8)).toBe(3);
    expect(swissRounds(16)).toBe(4);
    expect(swissRounds(2)).toBe(1);
    expect(swissRounds(1)).toBe(0);
  });

  it("completes within rounds*floor(n/2) comparisons", () => {
    const engine = createEngine("swiss");
    const { log } = simulate(engine, ITEMS, VALUE);
    const n = ITEMS.length;
    expect(log.length).toBeLessThanOrEqual(swissRounds(n) * Math.floor(n / 2));
  });
});

describe("edge cases", () => {
  it.each(["merge", "swiss", "round_robin"] as const)(
    "%s handles a single item",
    (scheme) => {
      const engine = createEngine(scheme);
      expect(engine.nextPair(["only"], [])).toBeNull();
      expect(engine.isComplete(["only"], [])).toBe(true);
      expect(engine.ranking(["only"], [])).toEqual([
        { id: "only", rank: 1, score: 0 },
      ]);
    },
  );

  it.each(["merge", "swiss", "round_robin"] as const)(
    "%s handles two items",
    (scheme) => {
      const engine = createEngine(scheme);
      const first = engine.nextPair(["a", "b"], []);
      expect(first).not.toBeNull();
      const log: Comparison[] = [{ a: "a", b: "b", result: "a" }];
      expect(engine.isComplete(["a", "b"], log)).toBe(true);
      expect(engine.ranking(["a", "b"], log)[0].id).toBe("a");
    },
  );
});
