/**
 * Task 33: pure logic of the compare screen — the three answers from clicks
 * and keys, paging inside the zoom, and why a participant has no place.
 */

export type RankStep =
  | { kind: "pick"; picks: string[] }
  | { kind: "submit"; ranked: string[]; rest: string[] };

/**
 * Clicking the n-th participant gives it the next free place; when one is
 * left it takes the last place and the screen is answered.
 */
export function rankClick(picks: readonly string[], id: string, question: readonly string[]): RankStep {
  if (!question.includes(id) || picks.includes(id)) return { kind: "pick", picks: [...picks] };
  const next = [...picks, id];
  if (next.length >= question.length - 1) {
    const last = question.filter((q) => !next.includes(q));
    return { kind: "submit", ranked: [...next, ...last], rest: [] };
  }
  return { kind: "pick", picks: next };
}

/** Digit key → participant index on the screen, or null. */
export function digitIndex(key: string, length: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const n = Number(key);
  return n <= length ? n - 1 : null;
}

/** Tier screen keys: 1…n put into a tier (0-based), 0 means "не участвует". */
export function tierFromKey(key: string, tierCount: number): number | null {
  if (key === "0") return -1;
  const i = digitIndex(key, tierCount);
  return i;
}

/** Zoom arrows wrap around the screen's participants. */
export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}

/** P22: why a participant has no place in the result. */
export function unplacedReason(
  u: { tier?: number; stage?: number },
  tierNames: readonly string[] | null,
  scheme: string | null,
): string {
  if (u.tier !== undefined && tierNames?.[u.tier]) return `корзина ${tierNames[u.tier]}`;
  if (u.stage !== undefined) return `вылет в раунде ${u.stage}`;
  if (scheme === "tiers") return "ещё без корзины";
  if (scheme === "top_k") return "не вошли";
  if (scheme === "bracket") return "ещё в сетке";
  return "без места";
}
