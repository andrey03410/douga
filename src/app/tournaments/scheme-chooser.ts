import { SCHEMES, type Scheme } from "@/lib/domain/types";
import { createEngine, plannedScreens } from "@/lib/domain/engines";
import { MAX_GROUP_SIZE } from "@/lib/domain/group-answer";
import {
  MAX_TIERS,
  MIN_TIERS,
  defaultSchemeSettings,
  type SchemeSettings,
} from "@/lib/domain/scheme-settings";

/**
 * Task 33: pure helpers of the algorithm chooser (P19) — which algorithm to
 * suggest for a field size, the screen estimate the engine itself computes,
 * and the settings shown back to the person in one line.
 */

/** P19: suggestion by field size. */
export function recommendedSchemes(n: number): Scheme[] {
  if (n <= 12) return ["round_robin"];
  if (n <= 60) return ["insertion"];
  return ["top_k", "rating", "tiers"];
}

export function schemeHint(n: number): string {
  if (n <= 12) return `${n} — немного: круговая точнее всех и быстро кончится.`;
  if (n <= 60) return `${n} — средняя база: вставка даёт строгий топ вдвое быстрее слияния.`;
  return `${n} — большая база: «Лучшие K», «Рейтинг» или «Корзины» (внутри S и A — вставка).`;
}

/** Largest group the scheme accepts (pairs-only schemes say 2). */
export function maxGroupFor(scheme: Scheme): number {
  return Math.min(createEngine(scheme).maxGroupSize, MAX_GROUP_SIZE);
}

/** Screens the whole plan takes for n participants with these settings. */
export function chooserEstimate(
  scheme: Scheme,
  n: number,
  groupSize: number,
  settings: SchemeSettings,
): number {
  return plannedScreens(scheme, n, Math.min(groupSize, maxGroupFor(scheme)), settings);
}

/** All eight estimates at once, for the comparison table in the chooser. */
export function allEstimates(n: number, groupSize: number): Record<Scheme, number> {
  const out = {} as Record<Scheme, number>;
  for (const scheme of SCHEMES)
    out[scheme] = chooserEstimate(scheme, n, groupSize, defaultSchemeSettings(scheme));
  return out;
}

/** "S, A, B" or one name per line → tier names (2..7, at most 20 chars). */
export function parseTierNames(text: string): string[] | null {
  const names = text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length < MIN_TIERS || names.length > MAX_TIERS) return null;
  if (names.some((n) => n.length > 20)) return null;
  if (new Set(names).size !== names.length) return null;
  return names;
}

const ACCURACY: Record<NonNullable<SchemeSettings["accuracy"]>, string> = {
  fast: "быстро",
  normal: "обычно",
  precise: "точно",
};
export const ACCURACY_LABEL = ACCURACY;

/** One line under the algorithm name: what was configured. */
export function settingsSummary(scheme: Scheme, s: SchemeSettings): string {
  switch (scheme) {
    case "top_k":
      return `K = ${s.k ?? 10}`;
    case "tiers": {
      const tiers = s.tiers ?? [];
      const top = s.rankTop ?? 0;
      return top
        ? `${tiers.join(" · ")}; упорядочить: ${tiers.slice(0, top).join(", ")}`
        : `${tiers.join(" · ")}; только тир-лист`;
    }
    case "rating":
      return `точность: ${ACCURACY[s.accuracy ?? "normal"]}`;
    case "bracket":
      return s.thirdPlace ? "с матчем за 3-е место" : "";
    default:
      return "";
  }
}
