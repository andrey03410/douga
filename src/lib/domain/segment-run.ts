import { createEngine, engineGroupSize, plannedScreens } from "./engines";
import type { Engine, EngineInput, EngineResult, Question } from "./engines";
import { insertionStep, insertionPlan, toRanked } from "./engines/insertion";
import { PairIndex } from "./engines/pair-index";
import { clampGroupSize } from "./group-answer";
import { readSchemeSettings, type SchemeSettings } from "./scheme-settings";
import { isComparisonResult, isScheme, type Comparison, type Scheme } from "./types";

/**
 * Task 33: what a segment asks next and what its result is — one pure function
 * for the service, the pages and the progress summary, so they never disagree.
 *
 * Covers the three things beyond a plain engine call:
 * - the effective algorithm (segment's own, else the tournament default,
 *   none while the tournament waits for the person to choose);
 * - tiers from tier screens (the latest answer per participant wins);
 * - the insertion overlay: newcomers joining a finished order are inserted
 *   into it instead of re-running the whole algorithm (P14).
 */

/** Schemes whose finished result is a full strict order the overlay can extend. */
export const OVERLAY_SCHEMES: readonly Scheme[] = [
  "merge",
  "swiss",
  "round_robin",
  "insertion",
  "rating",
  "top_k",
];

export function effectiveScheme(
  tournament: { scheme: string; schemePending: boolean },
  segment: { scheme: string | null },
): Scheme | null {
  if (segment.scheme && isScheme(segment.scheme)) return segment.scheme;
  if (tournament.schemePending) return null;
  return isScheme(tournament.scheme) ? tournament.scheme : null;
}

export function effectiveSettings(
  scheme: Scheme,
  tournament: { schemeSettings: string | null },
  segment: { scheme: string | null; schemeSettings: string | null },
): SchemeSettings {
  return segment.scheme
    ? readSchemeSettings(scheme, segment.schemeSettings)
    : readSchemeSettings(scheme, tournament.schemeSettings);
}

export interface BatchRow {
  kind: string;
  tier: number | null;
  itemIds: string;
}

/** Latest tier per participant; "не участвует" (-1) removes the tier. */
export function tierMap(batches: readonly BatchRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of batches) {
    if (b.kind !== "tier") continue;
    let id: unknown;
    try {
      id = (JSON.parse(b.itemIds) as unknown[])[0];
    } catch {
      continue;
    }
    if (typeof id !== "string") continue;
    if (b.tier === null || b.tier < 0) out.delete(id);
    else out.set(id, b.tier);
  }
  return out;
}

export interface Overlay {
  base: string[];
  pending: string[];
  /** When newcomers reopened the finished top (ms): earlier answers stay out of undo and the new plan. */
  reopenedAt?: number;
}

export function parseOverlay(json: string | null | undefined): Overlay | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<Overlay>;
    if (!Array.isArray(v.base) || !Array.isArray(v.pending)) return null;
    return {
      base: v.base.filter((x): x is string => typeof x === "string"),
      pending: v.pending.filter((x): x is string => typeof x === "string"),
      ...(typeof v.reopenedAt === "number" && v.reopenedAt > 0 ? { reopenedAt: v.reopenedAt } : {}),
    };
  } catch {
    return null;
  }
}

export interface SegmentRunInput {
  scheme: Scheme | null;
  settings: SchemeSettings;
  /** Tournament group size as stored; clamped per engine here. */
  groupSize: number;
  bonusOpponents: number;
  /** Segment participants in upload order. */
  tracks: readonly { id: string; excluded: boolean }[];
  comparisons: readonly { trackAId: string; trackBId: string; result: string }[];
  batches: readonly BatchRow[];
  overlay: string | null;
  completed: boolean;
}

export interface SegmentRun {
  scheme: Scheme | null;
  engine: Engine | null;
  settings: SchemeSettings;
  groupSize: number;
  items: string[];
  log: Comparison[];
  tiers: Map<string, number>;
  overlay: Overlay | null;
  question: Question | null;
  result: EngineResult;
  /** Screens the plan is expected to take in total (with an overlay: after it reopened). */
  planned: number;
  input: EngineInput | null;
}

export function runSegment(s: SegmentRunInput): SegmentRun {
  const items = s.tracks.filter((t) => !t.excluded).map((t) => t.id);
  const active = new Set(items);
  const log: Comparison[] = s.comparisons
    .filter((c) => active.has(c.trackAId) && active.has(c.trackBId) && isComparisonResult(c.result))
    .map((c) => ({ a: c.trackAId, b: c.trackBId, result: c.result as Comparison["result"] }));
  const tiers = tierMap(s.batches);
  const empty: EngineResult = { placed: [], unplaced: items.map((id) => ({ id })) };
  if (!s.scheme)
    return {
      scheme: null,
      engine: null,
      settings: s.settings,
      groupSize: clampGroupSize(s.groupSize, items.length),
      items,
      log,
      tiers,
      overlay: null,
      question: null,
      result: empty,
      planned: 0,
      input: null,
    };
  const engine = createEngine(s.scheme);
  const k = engineGroupSize(s.scheme, s.groupSize, items.length);
  const input: EngineInput = {
    items,
    comparisons: log,
    groupSize: k,
    bonusOpponents: s.bonusOpponents,
    settings: s.settings,
    tiers,
  };
  const overlay = OVERLAY_SCHEMES.includes(s.scheme) ? parseOverlay(s.overlay) : null;
  if (overlay) {
    const base = overlay.base.filter((id) => active.has(id));
    const inBase = new Set(base);
    const waiting = new Set(overlay.pending);
    const pending = items.filter((id) => waiting.has(id) && !inBase.has(id));
    const step = insertionStep(base, pending, new PairIndex(log), k);
    // Top-K: places down to the last old member are proven against everyone
    // outside (they beat the old K-th). If that member now stands above the
    // K-th place (someone was excluded), the places below it are open to the
    // old participants waiting outside too: replay the log instead of handing
    // them to newcomers. A field smaller than K has nobody outside. Decided only
    // once the newcomers are placed, so the result does not depend on whether
    // the exclusion came before or after their screens.
    let lastOld = -1;
    step.list.forEach((id, i) => {
      if (inBase.has(id)) lastOld = i;
    });
    const outside = items.some((id) => !inBase.has(id) && !waiting.has(id));
    const open = !step.question && s.scheme === "top_k" && outside && lastOld + 1 < (s.settings.k ?? Infinity);
    if (!open) return overlayRun(s, engine, k, items, log, tiers, input, overlay, base, pending, step);
  }
  return {
    scheme: s.scheme,
    engine,
    settings: s.settings,
    groupSize: k,
    items,
    log,
    tiers,
    overlay: null,
    question: s.completed ? null : engine.next(input),
    result: engine.result(input),
    planned: plannedScreens(s.scheme, items.length, k, s.settings),
    input,
  };
}

function overlayRun(
  s: SegmentRunInput,
  engine: Engine,
  k: number,
  items: string[],
  log: Comparison[],
  tiers: Map<string, number>,
  input: EngineInput,
  overlay: Overlay,
  base: string[],
  pending: string[],
  step: { list: string[]; question: string[] | null },
): SegmentRun {
  let order = step.list;
  if (s.scheme === "top_k") order = order.slice(0, s.settings.k ?? order.length);
  const placed = new Set(order);
  return {
    scheme: s.scheme,
    engine,
    settings: s.settings,
    groupSize: k,
    items,
    log,
    tiers,
    overlay: { base, pending, ...(overlay.reopenedAt !== undefined ? { reopenedAt: overlay.reopenedAt } : {}) },
    question: s.completed || !step.question ? null : { kind: "rank", items: step.question },
    result: {
      placed: toRanked(order, log),
      unplaced: items.filter((id) => !placed.has(id)).map((id) => ({ id })),
    },
    planned: insertionPlan(base.length, pending.length, k),
    input,
  };
}

/** "One more round" helps only engines that plan in opponents per participant. */
export function canExtend(run: SegmentRun, completed: boolean): boolean {
  if (completed || run.question || !run.engine || !run.input || run.overlay) return false;
  if (run.scheme !== "swiss" && run.scheme !== "rating") return false;
  return (
    run.engine.next({
      ...run.input,
      bonusOpponents: (run.input.bonusOpponents ?? 0) + (run.groupSize - 1),
    }) !== null
  );
}

/**
 * Screens a segment is expected to take in total: the plan, but never less than
 * what is done plus the screen on screen. An overlay's plan starts where the
 * finished run ended (`doneBeforeReopen`).
 */
export function estimatedScreens(
  run: SegmentRun,
  done: number,
  onScreen: boolean,
  doneBeforeReopen = done,
): number {
  const planned = run.overlay ? doneBeforeReopen + run.planned : run.planned;
  return Math.max(done + (onScreen ? 1 : 0), planned);
}

/** Answered screens from before the reopen: batches up to that moment plus every pre-batch pair. */
export function screensBefore(
  overlay: Overlay | null,
  batches: readonly { createdAt: Date }[],
  legacyScreens: number,
): number | undefined {
  if (overlay?.reopenedAt === undefined) return undefined;
  return batches.filter((b) => b.createdAt.getTime() <= overlay.reopenedAt!).length + legacyScreens;
}
