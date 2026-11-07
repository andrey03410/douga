import type { Comparison } from "../types";
import { pairKey, playedPairs, rankByScore } from "../comparisons";
import { MAX_GROUP_SIZE, clampGroupSize } from "../group-answer";
import type { Engine } from "./types";

/**
 * Every item vs every other. Accurate but O(N^2) comparisons — which is exactly
 * why groups pay off most here: ranking k tracks settles C(k,2) pairs at once,
 * so triples cover the same field in a third of the screens.
 *
 * The group is built greedily in upload order: the first unanswered pair seeds
 * it, then any track that has met nobody already picked joins. At k=2 this is
 * the plain row-major scan the engine has always done.
 *
 * Greedy does not reach the theoretical floor of ceil(C(n,2)/C(k,2)) — a screen
 * may only hold tracks that have all not met, and once the unplayed graph thins
 * out the groups shrink back to pairs. Cleverer seeding was measured (most-open
 * first, least-open first, best-connected fill) and each won on some field sizes
 * while losing badly on others, so the simplest rule stands. What holds
 * everywhere: any group size above two costs at most half the screens of
 * pairwise, which is the promise that matters.
 */
function nextGroup(
  items: string[],
  comparisons: Comparison[],
  groupSize: number,
): string[] | null {
  const n = items.length;
  if (n < 2) return null;
  const k = clampGroupSize(groupSize, n);
  const played = playedPairs(comparisons);

  let group: string[] | null = null;
  for (let i = 0; i < n && !group; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!played.has(pairKey(items[i], items[j]))) {
        group = [items[i], items[j]];
        break;
      }
    }
  }
  if (!group) return null;

  for (const candidate of items) {
    if (group.length === k) break;
    if (group.includes(candidate)) continue;
    if (group.every((picked) => !played.has(pairKey(picked, candidate)))) {
      group.push(candidate);
    }
  }
  return group;
}

export const roundRobinEngine: Engine = {
  scheme: "round_robin",
  maxGroupSize: MAX_GROUP_SIZE,
  partial: true,

  next({ items, comparisons, groupSize }) {
    const group = nextGroup(items, comparisons, groupSize);
    return group ? { kind: "rank", items: group } : null;
  },

  result({ items, comparisons }) {
    return { placed: rankByScore(items, comparisons), unplaced: [] };
  },

  // The floor ceil(pairs / C(k,2)); greedy grouping may need more screens, the
  // service keeps the estimate at least one past the screens already done.
  plannedScreens(n, groupSize) {
    if (n <= 1) return 0;
    const k = clampGroupSize(groupSize, n);
    return Math.ceil((n * (n - 1)) / 2 / ((k * (k - 1)) / 2));
  },
};
