import { describe, it, expect } from "vitest";
import { createEngine, plannedScreens, ENGINE_SCHEMES } from "./index";
import type { EngineInput, Question } from "./types";
import { decodeGroupAnswer, decodePickAnswer } from "../group-answer";
import { defaultSchemeSettings, type SchemeSettings } from "../scheme-settings";
import { lookup, pairKey } from "../comparisons";
import type { Comparison, Scheme } from "../types";

/**
 * Task 33: every engine is driven against a hidden total order. The oracle
 * answers each kind of screen the way an honest person would; a noisy oracle
 * flips some answers to prove nothing loops on intransitive input.
 */

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function shuffled<T>(xs: T[], rnd: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Run {
  log: Comparison[];
  tiers: Map<string, number>;
  questions: Question[];
  /** Fresh pairs each screen wrote, in question order (0 for tier screens). */
  written: number[];
  input: EngineInput;
}

function drive(
  scheme: Scheme,
  items: string[],
  truth: string[],
  k: number,
  settings: SchemeSettings,
  opts: { noise?: number; seed?: number; start?: Run; maxScreens?: number } = {},
): Run {
  const engine = createEngine(scheme);
  const rank = new Map(truth.map((id, i) => [id, i]));
  const rnd = prng(opts.seed ?? 7);
  const log = opts.start ? [...opts.start.log] : [];
  const tiers = opts.start ? new Map(opts.start.tiers) : new Map<string, number>();
  const questions: Question[] = [];
  const written: number[] = [];
  const tierCount = settings.tiers?.length ?? 5;
  const noisy = () => (opts.noise ?? 0) > 0 && rnd() < (opts.noise ?? 0);
  const input = (): EngineInput => ({
    items,
    comparisons: log,
    groupSize: k,
    bonusOpponents: 0,
    settings,
    tiers,
  });
  let guard = 0;
  while (true) {
    if (guard++ > 20000) throw new Error(`${scheme} did not terminate`);
    if (opts.maxScreens !== undefined && questions.length >= opts.maxScreens) break;
    const q = engine.next(input());
    if (!q) break;
    questions.push(q);
    if (q.kind === "tier") {
      const honest = Math.min(
        tierCount - 1,
        Math.floor((rank.get(q.item)! * tierCount) / items.length),
      );
      tiers.set(q.item, noisy() ? Math.floor(rnd() * tierCount) : honest);
      written.push(0);
      continue;
    }
    const byTruth = [...q.items].sort((a, b) => rank.get(a)! - rank.get(b)!);
    const answer = noisy() ? shuffled(q.items, rnd) : byTruth;
    const fresh = (rows: Comparison[]) =>
      rows.filter((p) => lookup(log, p.a, p.b) === undefined);
    const rows =
      q.kind === "pick"
        ? fresh(decodePickAnswer(answer[0], answer.slice(1)))
        : fresh(decodeGroupAnswer(answer, []));
    log.push(...rows);
    written.push(rows.length);
  }
  return { log, tiers, questions, written, input: input() };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const truthFor = (items: string[], seed: number) => shuffled(items, prng(seed));

function spearman(a: string[], b: string[]): number {
  const pos = new Map(b.map((id, i) => [id, i]));
  const n = a.length;
  if (n < 2) return 1;
  const d2 = a.reduce((s, id, i) => s + (i - pos.get(id)!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const SIZES = [1, 2, 3, 5, 8, 13, 30];
const GROUPS = [2, 3, 5, 7];

function settingsFor(scheme: Scheme, n: number): SchemeSettings {
  const base = defaultSchemeSettings(scheme);
  if (scheme === "top_k") return { ...base, k: Math.max(1, Math.min(10, Math.ceil(n / 3))) };
  if (scheme === "tiers") return { ...base, rankTop: base.tiers!.length };
  return base;
}

describe("engine registry", () => {
  it("knows all eight schemes", () => {
    expect([...ENGINE_SCHEMES].sort()).toEqual(
      ["bracket", "insertion", "merge", "rating", "round_robin", "swiss", "tiers", "top_k"].sort(),
    );
  });
});

describe.each(ENGINE_SCHEMES)("%s under simulation", (scheme) => {
  it.each(GROUPS)("terminates with valid screens for every field size (k=%i)", (k) => {
    for (const n of SIZES) {
      const items = ids(n);
      const truth = truthFor(items, n * 31 + k);
      const settings = settingsFor(scheme, n);
      const run = drive(scheme, items, truth, k, settings);
      const engine = createEngine(scheme);
      const kk = Math.min(k, engine.maxGroupSize);
      for (const q of run.questions) {
        if (q.kind === "tier") {
          expect(items).toContain(q.item);
          continue;
        }
        expect(q.items.length).toBeGreaterThanOrEqual(2);
        expect(q.items.length).toBeLessThanOrEqual(Math.max(2, kk));
        expect(new Set(q.items).size).toBe(q.items.length);
        for (const id of q.items) expect(items).toContain(id);
      }
      const result = engine.result(run.input);
      const placed = result.placed.map((r) => r.id);
      expect(new Set(placed).size).toBe(placed.length);
      expect(result.placed.map((r) => r.rank)).toEqual(placed.map((_, i) => i + 1));
      const all = [...placed, ...result.unplaced.map((u) => u.id)].sort();
      expect(all).toEqual([...items].sort());
    }
  });

  it("is resumable: the same input yields the same screen", () => {
    const items = ids(13);
    const truth = truthFor(items, 99);
    const settings = settingsFor(scheme, 13);
    const engine = createEngine(scheme);
    for (const stop of [0, 3, 7]) {
      const run = drive(scheme, items, truth, 3, settings, { maxScreens: stop });
      expect(engine.next(run.input)).toEqual(engine.next({ ...run.input }));
    }
  });

  it("never asks a screen whose every pair is already answered", () => {
    const items = ids(30);
    const truth = truthFor(items, 5);
    const run = drive(scheme, items, truth, 5, settingsFor(scheme, 30));
    let at = 0;
    run.questions.forEach((q, i) => {
      const before = run.log.slice(0, at);
      at += run.written[i];
      if (q.kind === "tier") return;
      const open = q.items.some((a, j) =>
        q.items.slice(j + 1).some((b) => lookup(before, a, b) === undefined),
      );
      expect(open).toBe(true);
    });
  });

  it("terminates on noisy, intransitive answers", () => {
    for (const seed of [1, 2, 3]) {
      const items = ids(30);
      const truth = truthFor(items, seed);
      const run = drive(scheme, items, truth, 4, settingsFor(scheme, 30), { noise: 0.15, seed });
      const result = createEngine(scheme).result(run.input);
      expect(new Set(result.placed.map((r) => r.id)).size).toBe(result.placed.length);
    }
  });
});

describe("exact engines recover the hidden order", () => {
  it.each(["merge", "round_robin", "insertion"] as const)("%s", (scheme) => {
    for (const n of SIZES)
      for (const k of GROUPS) {
        const items = ids(n);
        const truth = truthFor(items, n + k * 7);
        const run = drive(scheme, items, truth, k, settingsFor(scheme, n));
        expect(createEngine(scheme).result(run.input).placed.map((r) => r.id)).toEqual(truth);
      }
  });

  it("tiers with every tier ordered", () => {
    for (const n of SIZES)
      for (const k of GROUPS) {
        const items = ids(n);
        const truth = truthFor(items, n * 3 + k);
        const run = drive("tiers", items, truth, k, settingsFor("tiers", n));
        expect(createEngine("tiers").result(run.input).placed.map((r) => r.id)).toEqual(truth);
      }
  });

  it("tiers without ordering is a tier list with no places", () => {
    const items = ids(20);
    const truth = truthFor(items, 4);
    const settings = defaultSchemeSettings("tiers");
    const run = drive("tiers", items, truth, 3, settings);
    const result = createEngine("tiers").result(run.input);
    expect(result.placed).toEqual([]);
    expect(run.questions.every((q) => q.kind === "tier")).toBe(true);
    expect(run.questions).toHaveLength(20);
    const best = result.unplaced.find((u) => u.id === truth[0]);
    expect(best?.tier).toBe(0);
  });

  it("tiers orders only the top tiers asked for", () => {
    const items = ids(25);
    const truth = truthFor(items, 8);
    const settings = { ...defaultSchemeSettings("tiers"), rankTop: 2 };
    const run = drive("tiers", items, truth, 4, settings);
    const result = createEngine("tiers").result(run.input);
    // 25 items into 5 tiers -> the two top tiers hold the best ten
    expect(result.placed.map((r) => r.id)).toEqual(truth.slice(0, 10));
  });

  it("top_k finds and orders exactly the best K", () => {
    for (const n of [5, 13, 30, 60])
      for (const k of GROUPS)
        for (const K of [1, 3, 10]) {
          const items = ids(n);
          const truth = truthFor(items, n * K + k);
          const run = drive("top_k", items, truth, k, { k: K });
          const result = createEngine("top_k").result(run.input);
          expect(result.placed.map((r) => r.id)).toEqual(truth.slice(0, Math.min(K, n)));
        }
  });

  it("top_k grows K without losing answers", () => {
    const items = ids(30);
    const truth = truthFor(items, 12);
    const first = drive("top_k", items, truth, 4, { k: 5 });
    const more = drive("top_k", items, truth, 4, { k: 8 }, { start: first });
    expect(more.log.slice(0, first.log.length)).toEqual(first.log);
    expect(createEngine("top_k").result(more.input).placed.map((r) => r.id)).toEqual(truth.slice(0, 8));
  });

  it("bracket crowns the true best and orders the final", () => {
    for (const n of [2, 3, 5, 8, 13, 30])
      for (const k of GROUPS) {
        const items = ids(n);
        const truth = truthFor(items, n + k);
        const run = drive("bracket", items, truth, k, { thirdPlace: false });
        const placed = createEngine("bracket").result(run.input).placed.map((r) => r.id);
        expect(placed[0]).toBe(truth[0]);
        const byTruth = [...placed].sort((a, b) => truth.indexOf(a) - truth.indexOf(b));
        expect(placed).toEqual(byTruth);
      }
  });

  it("bracket plays a third-place match for pairs", () => {
    const items = ids(8);
    const truth = truthFor(items, 21);
    const run = drive("bracket", items, truth, 2, { thirdPlace: true });
    const result = createEngine("bracket").result(run.input);
    expect(result.placed).toHaveLength(4);
    expect(result.placed[0].id).toBe(truth[0]);
    const unplaced = result.unplaced.map((u) => u.stage);
    expect(unplaced.every((s) => typeof s === "number" && s >= 1)).toBe(true);
  });
});

describe("approximate engines stay close to the hidden order", () => {
  // Averages over five fields. Swiss is approximate by design: with groups of
  // five on a small field every participant plays a single screen, measured
  // rho 0.68–0.77 at n=13 (task 33 audit, unchanged behaviour). Rating fits
  // strengths to all answers and lands at ~1.0.
  it.each([
    ["swiss", 0.6],
    ["rating", 0.95],
  ] as const)("%s keeps average Spearman >= %s", (scheme, floor) => {
    for (const n of [13, 30, 60])
      for (const k of [2, 3, 5]) {
        let rho = 0;
        for (const seed of [1, 2, 3, 4, 5]) {
          const items = ids(n);
          const truth = truthFor(items, n * 13 + k * 7 + seed);
          const run = drive(scheme, items, truth, k, defaultSchemeSettings(scheme));
          rho += spearman(createEngine(scheme).result(run.input).placed.map((r) => r.id), truth) / 5;
        }
        expect(rho).toBeGreaterThanOrEqual(floor);
      }
  });

  it("rating beats swiss on the same field and screen budget", () => {
    let ratingScore = 0;
    let swissScore = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const items = ids(40);
      const truth = truthFor(items, seed);
      const swiss = drive("swiss", items, truth, 3, {});
      const rating = drive("rating", items, truth, 3, { accuracy: "fast" }, { maxScreens: swiss.questions.length });
      swissScore += spearman(createEngine("swiss").result(swiss.input).placed.map((r) => r.id), truth);
      ratingScore += spearman(createEngine("rating").result(rating.input).placed.map((r) => r.id), truth);
    }
    expect(ratingScore).toBeGreaterThanOrEqual(swissScore - 0.05);
  });
});

describe("screen estimates", () => {
  it.each(["swiss", "rating"] as const)("%s stays near its estimate", (scheme) => {
    // Greedy grouping can need a screen or two past the ideal pass count; the
    // service shows max(done + current, plan), so the bar never passes 100%.
    for (const n of SIZES)
      for (const k of GROUPS) {
        const items = ids(n);
        const truth = truthFor(items, n * 5 + k);
        const settings = settingsFor(scheme, n);
        const run = drive(scheme, items, truth, k, settings);
        const plan = plannedScreens(scheme, n, k, settings);
        expect(run.questions.length).toBeLessThanOrEqual(Math.ceil(plan * 1.5) + 3);
      }
  });

  it.each(["merge", "insertion", "bracket"] as const)(
    "%s never runs past its plan",
    (scheme) => {
      for (const n of SIZES)
        for (const k of GROUPS) {
          const items = ids(n);
          const truth = truthFor(items, n * 5 + k);
          const settings = settingsFor(scheme, n);
          const run = drive(scheme, items, truth, k, settings);
          expect(run.questions.length).toBeLessThanOrEqual(plannedScreens(scheme, n, k, settings));
        }
    },
  );

  it("round_robin with pairs asks every pair once", () => {
    const run = drive("round_robin", ids(13), truthFor(ids(13), 1), 2, {});
    expect(run.questions).toHaveLength((13 * 12) / 2);
    expect(plannedScreens("round_robin", 13, 2)).toBe(78);
  });

  it("insertion with groups costs about half of merge", () => {
    const items = ids(60);
    const truth = truthFor(items, 3);
    const merge = drive("merge", items, truth, 2, {});
    const insertion = drive("insertion", items, truth, 5, {});
    expect(insertion.questions.length).toBeLessThanOrEqual(merge.questions.length * 0.6);
  });

  it("top_k and tiers stay within twice their model", () => {
    for (const n of [30, 60, 120]) {
      const items = ids(n);
      const truth = truthFor(items, n);
      const topK = drive("top_k", items, truth, 5, { k: 10 });
      expect(topK.questions.length).toBeLessThanOrEqual(2 * plannedScreens("top_k", n, 5, { k: 10 }));
      const tiers = drive("tiers", items, truth, 5, { tiers: ["S", "A", "B", "C", "D"], rankTop: 2 });
      expect(tiers.questions.length).toBeLessThanOrEqual(
        2 * plannedScreens("tiers", n, 5, { tiers: ["S", "A", "B", "C", "D"], rankTop: 2 }),
      );
    }
  });
});

describe("switching the algorithm keeps every answer", () => {
  it("swiss then insertion recovers the exact order and reuses the log", () => {
    const items = ids(30);
    const truth = truthFor(items, 17);
    const swiss = drive("swiss", items, truth, 4, {});
    const fresh = drive("insertion", items, truth, 4, {});
    const after = drive("insertion", items, truth, 4, {}, { start: swiss });
    expect(after.log.slice(0, swiss.log.length)).toEqual(swiss.log);
    expect(createEngine("insertion").result(after.input).placed.map((r) => r.id)).toEqual(truth);
    expect(after.questions.length).toBeLessThan(fresh.questions.length);
  });

  it("an already answered log ends a new exact engine without questions", () => {
    const items = ids(13);
    const truth = truthFor(items, 2);
    const rr = drive("round_robin", items, truth, 3, {});
    for (const scheme of ["merge", "insertion"] as const) {
      const run = drive(scheme, items, truth, 3, {}, { start: rr });
      expect(run.questions).toHaveLength(0);
      expect(createEngine(scheme).result(run.input).placed.map((r) => r.id)).toEqual(truth);
    }
  });
});

describe("pick answers", () => {
  it("record the winner over each other item and no draws", () => {
    expect(decodePickAnswer("a", ["b", "c"])).toEqual([
      { a: "a", b: "b", result: "a" },
      { a: "a", b: "c", result: "a" },
    ]);
  });

  it("bracket heats are pick screens", () => {
    const run = drive("bracket", ids(9), truthFor(ids(9), 1), 3, { thirdPlace: false });
    expect(run.questions.slice(0, 3).every((q) => q.kind === "pick")).toBe(true);
    expect(run.questions.at(-1)?.kind).toBe("rank");
  });

  it("top_k filters with one click per screen once the top is full", () => {
    const run = drive("top_k", ids(60), truthFor(ids(60), 9), 5, { k: 5 });
    expect(run.questions.some((q) => q.kind === "pick")).toBe(true);
  });
});

it("reports screens per engine for the record", () => {
  const rows: string[] = [];
  for (const n of [30, 60, 120]) {
    const items = ids(n);
    const truth = truthFor(items, n);
    const cell = (scheme: Scheme, k: number, settings: SchemeSettings) =>
      drive(scheme, items, truth, k, settings).questions.length;
    rows.push(
      [
        `n=${n}`,
        `merge ${cell("merge", 2, {})}`,
        `swiss5 ${cell("swiss", 5, {})}`,
        `insertion5 ${cell("insertion", 5, {})}`,
        `top10/5 ${cell("top_k", 5, { k: 10 })}`,
        `rating5 ${cell("rating", 5, { accuracy: "normal" })}`,
        `bracket5 ${cell("bracket", 5, { thirdPlace: false })}`,
        `tiers(S+A)/5 ${cell("tiers", 5, { tiers: ["S", "A", "B", "C", "D"], rankTop: 2 })}`,
      ].join(" · "),
    );
  }
  console.log(rows.join("\n"));
  expect(rows).toHaveLength(3);
  expect(pairKey("a", "b")).toBe("a|b");
});
