import type { Comparison, ComparisonResult } from "../types";

/**
 * O(1) view of the answer log. Same rule as `lookup`: the FIRST answer for a
 * pair wins, later rows for it are ignored. Engines that probe many pairs
 * (insertion, rating) build one per call instead of scanning the log each time.
 */
export class PairIndex {
  private readonly results = new Map<string, ComparisonResult>();
  private readonly opponents = new Map<string, Set<string>>();

  constructor(log: readonly Comparison[]) {
    for (const c of log) {
      if (c.a === c.b) continue;
      const key = c.a < c.b ? `${c.a}|${c.b}` : `${c.b}|${c.a}`;
      if (this.results.has(key)) continue;
      // stored oriented to the lexicographically smaller id
      const flipped = c.a > c.b;
      this.results.set(
        key,
        !flipped || c.result === "draw" ? c.result : c.result === "a" ? "b" : "a",
      );
      this.link(c.a, c.b);
      this.link(c.b, c.a);
    }
  }

  private link(a: string, b: string) {
    let set = this.opponents.get(a);
    if (!set) this.opponents.set(a, (set = new Set()));
    set.add(b);
  }

  /** Result oriented to the question "a vs b"; undefined when never answered. */
  get(a: string, b: string): ComparisonResult | undefined {
    if (a === b) return undefined;
    const lo = a < b;
    const r = this.results.get(lo ? `${a}|${b}` : `${b}|${a}`);
    if (r === undefined || r === "draw" || lo) return r;
    return r === "a" ? "b" : "a";
  }

  has(a: string, b: string): boolean {
    return this.get(a, b) !== undefined;
  }

  /** a beat b. */
  beats(a: string, b: string): boolean {
    return this.get(a, b) === "a";
  }

  /** Distinct opponents of `id` (all answered pairs, active or not). */
  opponentsOf(id: string): ReadonlySet<string> {
    return this.opponents.get(id) ?? EMPTY;
  }

  /** Every answered pair once, oriented to the first id. */
  *pairs(): Iterable<[string, string, ComparisonResult]> {
    for (const [key, r] of this.results) {
      const [a, b] = key.split("|");
      yield [a, b, r];
    }
  }
}

const EMPTY: ReadonlySet<string> = new Set();

/** Deterministic small hash: varies screen order without randomness. */
export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Put `x` among `others` at a deterministic position (not always first). */
export function placeAmong(x: string, others: string[], salt = ""): string[] {
  const at = stableHash(x + salt) % (others.length + 1);
  return [...others.slice(0, at), x, ...others.slice(at)];
}
