import { describe, it, expect } from "vitest";
import {
  MAX_GROUP_SIZE,
  clampGroupSize,
  decodeGroupAnswer,
  targetComparisonsPerItem,
  validateGroupAnswer,
} from "./group-answer";
import { plannedScreens } from "./engines";

describe("clampGroupSize", () => {
  it("keeps a sane size as is", () => {
    expect(clampGroupSize(3, 20)).toBe(3);
    expect(clampGroupSize(7, 20)).toBe(7);
  });

  it("never goes below a pair and never above the cap", () => {
    expect(clampGroupSize(1, 20)).toBe(2);
    expect(clampGroupSize(0, 20)).toBe(2);
    expect(clampGroupSize(99, 20)).toBe(MAX_GROUP_SIZE);
  });

  it("cannot ask for more tracks than the tournament has", () => {
    expect(clampGroupSize(5, 3)).toBe(3);
    expect(clampGroupSize(5, 2)).toBe(2);
  });

  it("survives a one-track tournament and garbage input", () => {
    expect(clampGroupSize(5, 1)).toBe(2);
    expect(clampGroupSize(Number.NaN, 20)).toBe(2);
  });
});

describe("targetComparisonsPerItem", () => {
  it("is ceil(log2 n) — the same budget the pairwise Swiss spends today", () => {
    expect(targetComparisonsPerItem(8)).toBe(3);
    expect(targetComparisonsPerItem(16)).toBe(4);
    expect(targetComparisonsPerItem(201)).toBe(8);
  });

  it("is zero when there is nothing to compare", () => {
    expect(targetComparisonsPerItem(1)).toBe(0);
    expect(targetComparisonsPerItem(0)).toBe(0);
  });

  it("asks for one comparison on two items", () => {
    expect(targetComparisonsPerItem(2)).toBe(1);
  });
});

describe("decodeGroupAnswer", () => {
  it("turns a fully ranked group into a strict order", () => {
    expect(decodeGroupAnswer(["a", "b", "c"], [])).toEqual([
      { a: "a", b: "b", result: "a" },
      { a: "a", b: "c", result: "a" },
      { a: "b", b: "c", result: "a" },
    ]);
  });

  it("puts everything ranked above the equal tail and draws the tail", () => {
    // ranked 2 of 5 -> 7 ordered pairs + 3 draws, all ten recorded
    const pairs = decodeGroupAnswer(["a", "b"], ["c", "d", "e"]);
    expect(pairs).toHaveLength(10);
    expect(pairs.filter((p) => p.result === "draw")).toEqual([
      { a: "c", b: "d", result: "draw" },
      { a: "c", b: "e", result: "draw" },
      { a: "d", b: "e", result: "draw" },
    ]);
    expect(pairs.filter((p) => p.result === "a")).toHaveLength(7);
  });

  it("reproduces today's pair screen", () => {
    expect(decodeGroupAnswer(["a", "b"], [])).toEqual([{ a: "a", b: "b", result: "a" }]);
    expect(decodeGroupAnswer([], ["a", "b"])).toEqual([{ a: "a", b: "b", result: "draw" }]);
    expect(decodeGroupAnswer(["a"], ["b"])).toEqual([{ a: "a", b: "b", result: "a" }]);
  });

  it("never contradicts itself: no pair appears twice", () => {
    const pairs = decodeGroupAnswer(["a", "b"], ["c", "d", "e"]);
    const keys = pairs.map((p) => [p.a, p.b].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every pair of the group exactly once", () => {
    const group = ["a", "b", "c", "d", "e"];
    const pairs = decodeGroupAnswer(["a", "b"], ["c", "d", "e"]);
    expect(pairs).toHaveLength((group.length * (group.length - 1)) / 2);
  });
});

describe("validateGroupAnswer", () => {
  const question = ["a", "b", "c"];

  it("accepts an answer covering exactly the asked group", () => {
    expect(validateGroupAnswer(question, ["a", "b"], ["c"])).toBeNull();
    expect(validateGroupAnswer(question, [], ["a", "b", "c"])).toBeNull();
  });

  it("rejects an answer that drops or invents a track", () => {
    expect(validateGroupAnswer(question, ["a", "b"], [])).toBe("GROUP_MISMATCH");
    expect(validateGroupAnswer(question, ["a", "b", "c"], ["d"])).toBe("GROUP_MISMATCH");
  });

  it("rejects duplicates", () => {
    expect(validateGroupAnswer(question, ["a", "a"], ["b", "c"])).toBe("GROUP_MISMATCH");
    expect(validateGroupAnswer(question, ["a", "b"], ["b"])).toBe("GROUP_MISMATCH");
  });
});

describe("plannedScreens", () => {
  it("matches the agreed table for 201 tracks", () => {
    expect(plannedScreens("swiss", 201, 2)).toBe(808); // ~800 today
    expect(plannedScreens("swiss", 201, 3)).toBe(268);
    expect(plannedScreens("swiss", 201, 5)).toBe(82);
    expect(plannedScreens("swiss", 201, 7)).toBe(58);
  });

  it("falls to the pairwise plan when the group is a pair", () => {
    // 8 items, 3 comparisons each -> 12 screens, exactly today's rounds*floor(n/2)
    expect(plannedScreens("swiss", 8, 2)).toBe(12);
  });

  it("counts round-robin by pairs covered per screen", () => {
    expect(plannedScreens("round_robin", 8, 2)).toBe(28);
    expect(plannedScreens("round_robin", 8, 4)).toBe(Math.ceil(28 / 6));
  });

  it("ignores the group size for merge, which only asks pairs", () => {
    expect(plannedScreens("merge", 8, 5)).toBe(plannedScreens("merge", 8, 2));
  });

  it("is zero when there is nothing to ask", () => {
    expect(plannedScreens("swiss", 1, 3)).toBe(0);
    expect(plannedScreens("round_robin", 1, 3)).toBe(0);
    expect(plannedScreens("merge", 1, 2)).toBe(0);
  });
});
