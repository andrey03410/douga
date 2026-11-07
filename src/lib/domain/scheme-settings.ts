import { z } from "zod";
import type { Scheme } from "./types";

/**
 * Task 33: per-algorithm settings. One flat shape keeps the engines simple;
 * each scheme validates only the fields it understands (strict), so a stray
 * field is a client bug, not a silently ignored knob.
 */
export interface SchemeSettings {
  /** top_k: how many places to determine strictly. */
  k?: number;
  /** tiers: tier names, best first (2..7). */
  tiers?: string[];
  /** tiers: how many top tiers to order strictly (0 = tier list only). */
  rankTop?: number;
  /** rating: opponents per item, multiplier of ceil(log2 n). */
  accuracy?: "fast" | "normal" | "precise";
  /** bracket: pairs only — semifinal losers play for third place. */
  thirdPlace?: boolean;
}

export const MAX_TOP_K = 2000;
export const MIN_TIERS = 2;
export const MAX_TIERS = 7;
export const DEFAULT_TIERS = ["S", "A", "B", "C", "D"];

const tierName = z.string().trim().min(1).max(20);

const SCHEMAS: Record<Scheme, z.ZodType<SchemeSettings>> = {
  merge: z.object({}).strict(),
  swiss: z.object({}).strict(),
  round_robin: z.object({}).strict(),
  insertion: z.object({}).strict(),
  top_k: z.object({ k: z.number().int().min(1).max(MAX_TOP_K) }).strict(),
  tiers: z
    .object({
      tiers: z.array(tierName).min(MIN_TIERS).max(MAX_TIERS),
      rankTop: z.number().int().min(0).max(MAX_TIERS),
    })
    .strict()
    .refine((v) => v.rankTop <= v.tiers.length, "rankTop > tiers")
    .refine((v) => new Set(v.tiers.map((t) => t.toLowerCase())).size === v.tiers.length, "duplicate tier names"),
  rating: z.object({ accuracy: z.enum(["fast", "normal", "precise"]) }).strict(),
  bracket: z.object({ thirdPlace: z.boolean() }).strict(),
};

export function defaultSchemeSettings(scheme: Scheme): SchemeSettings {
  switch (scheme) {
    case "top_k":
      return { k: 10 };
    case "tiers":
      return { tiers: [...DEFAULT_TIERS], rankTop: 0 };
    case "rating":
      return { accuracy: "normal" };
    case "bracket":
      return { thirdPlace: false };
    default:
      return {};
  }
}

/** Validate settings for a scheme, filling missing fields with defaults. */
export function parseSchemeSettings(
  scheme: Scheme,
  raw: unknown,
): SchemeSettings {
  const base = defaultSchemeSettings(scheme);
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...base, ...(raw as Record<string, unknown>) }
      : base;
  const parsed = SCHEMAS[scheme].safeParse(value);
  if (!parsed.success) throw new Error("INVALID_SCHEME_SETTINGS");
  return parsed.data;
}

/** Stored JSON → settings; unreadable or stale settings fall back to defaults. */
export function readSchemeSettings(
  scheme: Scheme,
  json: string | null | undefined,
): SchemeSettings {
  if (!json) return defaultSchemeSettings(scheme);
  try {
    return parseSchemeSettings(scheme, JSON.parse(json));
  } catch {
    return defaultSchemeSettings(scheme);
  }
}

export interface SchemeInfo {
  scheme: Scheme;
  label: string;
  /** What the person sees on screen. */
  screens: string;
  /** What the result is. */
  result: string;
  /** When to pick it. */
  when: string;
  /** Places are strict for every participant once complete. */
  fullOrder: boolean;
}

export const SCHEME_INFO: Record<Scheme, SchemeInfo> = {
  round_robin: {
    scheme: "round_robin",
    label: "Круговая",
    screens: "Группы, пока не встретятся все пары",
    result: "Строгий порядок, самый точный",
    when: "До ~12 участников",
    fullOrder: true,
  },
  merge: {
    scheme: "merge",
    label: "Слияние",
    screens: "Только пары",
    result: "Строгий порядок",
    when: "Нужна точность без групп",
    fullOrder: true,
  },
  swiss: {
    scheme: "swiss",
    label: "Швейцарка",
    screens: "Группы, «Ещё раунд» добавляет соперников",
    result: "Приблизительный порядок",
    when: "Быстро прикинуть",
    fullOrder: true,
  },
  insertion: {
    scheme: "insertion",
    label: "Вставка",
    screens: "Новичок и опорные участники топа: упорядочи группу",
    result: "Строгий порядок, топ виден целиком в любой момент",
    when: "13–60 участников, нужна точность",
    fullOrder: true,
  },
  top_k: {
    scheme: "top_k",
    label: "Лучшие K",
    screens: "Обычные экраны и «выбери лучшего»",
    result: "Строгие места у K лучших, остальные «не вошли»",
    when: "Большая база, в ролик нужен топ-10 или топ-20",
    fullOrder: false,
  },
  tiers: {
    scheme: "tiers",
    label: "Корзины",
    screens: "Один участник крупно: корзина или «не участвует»",
    result: "Тир-лист, внутри верхних корзин — строгий порядок",
    when: "100+ участников, тир-лист",
    fullOrder: false,
  },
  rating: {
    scheme: "rating",
    label: "Рейтинг",
    screens: "Группы соперников близкой силы",
    result: "Строгий порядок по силе с учётом соперников",
    when: "Средняя и большая база, баланс скорости и точности",
    fullOrder: true,
  },
  bracket: {
    scheme: "bracket",
    label: "Олимпийская сетка",
    screens: "«Выбери лучшего» в группе, финал упорядочить",
    result: "Места у финалистов, остальные — «вылет в раунде N»",
    when: "Быстро и азартно, важен победитель",
    fullOrder: false,
  },
};
