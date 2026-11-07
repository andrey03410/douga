import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import { saveFile, trackPath, removePath } from "@/lib/storage";
import { createEngine } from "@/lib/domain/engines";
import type { Question } from "@/lib/domain/engines";
import type { Comparison, ComparisonResult, Scheme } from "@/lib/domain/types";
import { isComparisonResult, isScheme } from "@/lib/domain/types";
import {
  MAX_GROUP_SIZE,
  clampGroupSize,
  decodeGroupAnswer,
  decodePickAnswer,
  validateGroupAnswer,
  validatePickAnswer,
} from "@/lib/domain/group-answer";
import { parseSchemeSettings, type SchemeSettings } from "@/lib/domain/scheme-settings";
import { can, quotasFor } from "@/lib/domain/permissions";
import { orderCoverage } from "@/lib/domain/order-coverage";
import {
  OVERLAY_SCHEMES,
  canExtend as runCanExtend,
  effectiveScheme,
  effectiveSettings,
  estimatedScreens,
  parseOverlay,
  screensBefore,
  runSegment,
  type SegmentRun,
} from "@/lib/domain/segment-run";
import { lookup } from "@/lib/domain/comparisons";
import { assertOwnedImage } from "./tournament-segments";
import {
  loadTournamentSegments,
  loadTournamentSegmentsFromDb,
  segmentProgress,
  aggregateTournamentStatus,
  completeSingleton,
} from "./tournament-segments";
export { updateTournamentSegments } from "./tournament-segments";
import type { ExtractedTrack } from "@/lib/upload";

/** Technical budget: engines stay in milliseconds up to this many participants. */
export const MAX_PARTICIPANTS = 2000;

export interface CreateInput {
  title: string;
  /** Omitted: the person picks the algorithm later (task 33, P15). */
  scheme?: Scheme;
  schemeSettings?: SchemeSettings;
  blindMode: boolean;
  /** How many participants one screen ranks; clamped to the engine and the field. */
  groupSize?: number;
  segments?: {
    title: string;
    subtitle?: string | null;
    posterArtId?: string | null;
    trackIndexes: number[];
  }[];
}

/** Bytes a participant occupies: its file, plus an embedded cover for tracks. */
export const participantBytes = (t: ExtractedTrack) =>
  t.data.length + (t.kind === "image" ? 0 : (t.cover?.data.length ?? 0));

const COVER_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Write one participant's files under the tournament and return the stored
 * paths. An image participant is its own cover (task 33, T01): thumbnails,
 * pool replacement and the SDK cover binding all work unchanged.
 */
export async function storeParticipantFiles(
  tournamentId: string,
  trackId: string,
  t: ExtractedTrack,
): Promise<{ filePath: string; coverPath?: string }> {
  const fallback = t.kind === "video" ? ".mp4" : t.kind === "image" ? ".jpg" : ".mp3";
  const ext = path.extname(t.filename).toLowerCase() || fallback;
  const filePath = await saveFile(trackPath(tournamentId, trackId, ext), t.data);
  if (t.kind === "image") return { filePath, coverPath: filePath };
  if (!t.cover) return { filePath };
  const coverPath = await saveFile(
    trackPath(tournamentId, trackId + "-cover", COVER_EXT[t.cover.format] ?? ".jpg"),
    t.cover.data,
  );
  return { filePath, coverPath };
}

export function participantRow(t: ExtractedTrack) {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    sourceFolder: t.sourceFolder,
    durationSec: t.durationSec,
    kind: t.kind,
    subtitle: t.subtitle ?? null,
    sourceUrl: t.sourceUrl ?? null,
    sourceKey: t.sourceKey ?? null,
    note: t.note ?? null,
    sizeBytes: participantBytes(t),
  };
}

/** Same participant twice in one segment (by sourceKey) is refused. */
export function assertNoDuplicates(
  tracks: readonly { title: string; sourceKey?: string | null }[],
) {
  const seen = new Map<string, string>();
  for (const t of tracks) {
    if (!t.sourceKey) continue;
    if (seen.has(t.sourceKey)) throw new Error(`DUPLICATE_ITEM:${t.title}`);
    seen.set(t.sourceKey, t.title);
  }
}

/** Pictures are quick to judge: four on a screen; tracks keep pairs (task 33). */
export const defaultGroupSize = (tracks: { kind: string }[]) =>
  tracks.length > 0 && tracks.every((t) => t.kind === "image") ? 4 : 2;

export async function createTournament(
  userId: string,
  input: CreateInput,
  tracks: ExtractedTrack[],
  limits?: { maxTournaments: number | null },
) {
  if (!tracks.length) throw new Error("NEED_AT_LEAST_TWO_TRACKS");
  if (tracks.length > MAX_PARTICIPANTS) throw new Error("TOO_MANY_PARTICIPANTS");
  const layout = input.segments ?? [
    { title: "Все треки", trackIndexes: tracks.map((_, i) => i) },
  ];
  const indices = layout.flatMap((s) => s.trackIndexes);
  if (
    !layout.length ||
    layout.some((s) => !s.title.trim()) ||
    indices.length !== tracks.length ||
    new Set(indices).size !== tracks.length ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i >= tracks.length)
  )
    throw new Error("INVALID_SEGMENTS");
  for (const s of layout) assertNoDuplicates(s.trackIndexes.map((i) => tracks[i]));
  const settings = input.scheme
    ? parseSchemeSettings(input.scheme, input.schemeSettings ?? {})
    : null;
  let createdId: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { id: userId } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!can(user.role, "tournament:create")) throw new Error("FORBIDDEN");
        const quota = quotasFor(user.role);
        const max = limits?.maxTournaments ?? quota.maxTournaments;
        if (
          max !== null &&
          (await tx.tournament.count({ where: { userId } })) >= max
        )
          throw new Error("TOURNAMENT_LIMIT");
        if (tracks.reduce((n, t) => n + participantBytes(t), 0) > quota.maxArchiveBytes)
          throw new Error("ARCHIVE_QUOTA");
        const cap = input.scheme ? createEngine(input.scheme).maxGroupSize : MAX_GROUP_SIZE;
        const tournament = await tx.tournament.create({
          data: {
            userId,
            title: input.title,
            // Placeholder while pending: effectiveScheme ignores it.
            scheme: input.scheme ?? "swiss",
            schemePending: !input.scheme,
            schemeSettings: settings ? JSON.stringify(settings) : null,
            blindMode: input.blindMode,
            groupSize: Math.min(clampGroupSize(input.groupSize ?? defaultGroupSize(tracks), tracks.length), cap),
            status: "in_progress",
          },
        });
        createdId = tournament.id;
        for (const [segmentOrder, s] of layout.entries()) {
          await assertOwnedImage(tx, userId, s.posterArtId);
          const segment = await tx.tournamentSegment.create({
            data: {
              tournamentId: tournament.id,
              title: s.title.trim(),
              subtitle: s.subtitle,
              posterArtId: s.posterArtId,
              order: segmentOrder,
            },
          });
          for (const [order, index] of s.trackIndexes.entries()) {
            const t = tracks[index];
            const created = await tx.track.create({
              data: {
                tournamentId: tournament.id,
                segmentId: segment.id,
                ...participantRow(t),
                filePath: "",
                order,
              },
            });
            const files = await storeParticipantFiles(tournament.id, created.id, t);
            await tx.track.update({ where: { id: created.id }, data: files });
          }
          await completeSingleton(tx, segment.id);
        }
        await aggregateTournamentStatus(tx, tournament.id);
        return tx.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
        });
      },
      { timeout: 300000 },
    );
  } catch (e) {
    if (createdId) await removePath(path.join("tournaments", createdId));
    throw e;
  }
}

export async function listTournaments(userId: string) {
  return prisma.tournament.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { tracks: true, comparisons: true, batches: true } } },
  });
}

/** Load a tournament the user owns, with its tracks (ordered) and comparison log. */
export async function getTournament(
  userId: string,
  id: string,
  segmentId?: string,
) {
  const t = await loadTournamentSegments(userId, id);
  if (!t) return null;
  return tournamentSlice(t, segmentId);
}

function tournamentSlice(
  t: NonNullable<Awaited<ReturnType<typeof loadTournamentSegments>>>,
  segmentId?: string,
) {
  const segments = segmentProgress(t);
  const active = segmentId
    ? segments.find((s) => s.id === segmentId)
    : segments[0];
  if (!active) return null;
  const ids = new Set(active.tracks.map((tr) => tr.id));
  const scheme = effectiveScheme(t, active);
  return {
    ...t,
    tournamentScheme: t.scheme,
    tournamentStatus: t.status,
    segments,
    activeSegmentId: active.id,
    /** Effective algorithm of the active segment; null = not chosen yet. */
    scheme,
    schemeSettings: scheme ? effectiveSettings(scheme, t, active) : {},
    segmentHasOwnScheme: active.scheme !== null,
    insertBase: active.insertBase,
    status: active.status,
    topSize: active.topSize,
    bonusOpponents: active.bonusOpponents,
    tracks: active.tracks,
    comparisons: t.comparisons.filter(
      (c) => ids.has(c.trackAId) && ids.has(c.trackBId),
    ),
    batches: t.batches.filter((b) => b.segmentId === active.id),
    rankings: t.rankings.filter((r) => r.segmentId === active.id),
  };
}

export function toDomainComparisons(
  rows: { trackAId: string; trackBId: string; result: string }[],
): Comparison[] {
  return rows
    .filter((r) => isComparisonResult(r.result))
    .map((r) => ({
      a: r.trackAId,
      b: r.trackBId,
      result: r.result as ComparisonResult,
    }));
}

export type LoadedTournament = NonNullable<Awaited<ReturnType<typeof getTournament>>>;

/** The engine's view of the active segment (see segment-run.ts). */
export function segmentRun(t: LoadedTournament): SegmentRun {
  return runSegment({
    scheme: t.scheme,
    settings: t.schemeSettings,
    groupSize: t.groupSize,
    bonusOpponents: t.bonusOpponents,
    tracks: t.tracks,
    comparisons: t.comparisons,
    batches: t.batches,
    overlay: t.insertBase,
    completed: t.status === "completed",
  });
}

/** Group size actually in force: the stored one, capped by the engine and field. */
export function effectiveGroupSize(t: LoadedTournament): number {
  return segmentRun(t).groupSize;
}

const questionItems = (q: Question | null): string[] | null =>
  q ? (q.kind === "tier" ? [q.item] : q.items) : null;

export function nextComparison(t: LoadedTournament) {
  const run = segmentRun(t);
  const completed = t.status === "completed";
  // A finalized tournament must not reopen for more questions — its ranking is
  // persisted and may have been reordered by hand since.
  const question = completed ? null : run.question;
  const engine = run.engine;

  // Provisional standings (only for schemes with a meaningful interim top).
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  const standings =
    engine?.partial || run.overlay
      ? run.result.placed.map((r) => {
          const tr = byId.get(r.id)!;
          return {
            trackId: r.id,
            rank: r.rank,
            title: tr.title,
            artist: tr.artist,
            score: r.score,
          };
        })
      : null;

  // Screens, not comparisons: with a changeable group size the comparison count
  // is not something the user can feel, and the bar would jump when k changes.
  const legacyScreens = t.comparisons.filter((c) => c.batchId === null).length;
  const done = t.batches.length + legacyScreens;
  const screens = {
    completed: done,
    // Growing the group shrinks the plan, so a run switched from pairs to fives
    // can already be past the new estimate. The screen on screen still has to be
    // inside it — "screen 3 of ~2" is nonsense.
    estimatedTotal: estimatedScreens(
      run,
      done,
      Boolean(question),
      screensBefore(run.overlay, t.batches, legacyScreens),
    ),
  };

  return {
    scheme: run.scheme,
    schemeRequired: run.scheme === null,
    settings: run.settings,
    /** Items of the screen (tier screens: the one participant). */
    question: questionItems(question),
    questionKind: question?.kind ?? null,
    groupSize: run.groupSize,
    maxGroupSize: engine ? Math.min(engine.maxGroupSize, MAX_GROUP_SIZE) : MAX_GROUP_SIZE,
    progress: screens,
    screens,
    coverage: orderCoverage(run.items, run.log),
    canExtend: runCanExtend(run, completed),
    // Answers from before newcomers reopened a finished top are not undoable.
    // (read from the stored overlay: a replayed top-K ignores it but undo does not)
    canUndo: (() => {
      if (completed || done === 0) return false;
      const reopenedAt = parseOverlay(t.insertBase)?.reopenedAt;
      return reopenedAt === undefined || t.batches.some((b) => b.createdAt.getTime() > reopenedAt);
    })(),
    isComplete: run.scheme !== null && question === null,
    standings,
    result: run.result,
    tiers: run.tiers,
    activeCount: run.items.length,
  };
}

export type Answer =
  | { kind: "rank"; ranked: string[]; rest: string[] }
  | { kind: "pick"; winner: string }
  | { kind: "tier"; itemId: string; tier: number };

/**
 * Record one screen. The answer must be to the screen the engine is actually
 * asking — a stale screen is refused rather than folded in, so the log can never
 * disagree with the schedule that produced it. Pairs already in the log are
 * skipped: `lookup` honours the first answer, so writing a second row would
 * silently inflate the score without changing the order.
 */
export async function recordAnswer(t: LoadedTournament, answer: Answer) {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: t.id },
      data: { updatedAt: new Date() },
    });
    const fresh = await loadTournamentSegmentsFromDb(tx, t.userId, t.id);
    const current = fresh ? tournamentSlice(fresh, t.activeSegmentId) : null;
    if (!current) throw new Error("NOT_FOUND");
    const run = segmentRun(current);
    const q = current.status === "completed" ? null : run.question;
    if (!q) throw new Error(run.scheme ? "NOTHING_TO_ANSWER" : "SCHEME_REQUIRED");

    if (q.kind === "tier") {
      if (answer.kind !== "tier" || answer.itemId !== q.item) throw new Error("GROUP_MISMATCH");
      const names = run.settings.tiers ?? [];
      if (!Number.isInteger(answer.tier) || answer.tier < -1 || answer.tier >= names.length)
        throw new Error("INVALID_TIER");
      await writeTier(tx, t.id, current.activeSegmentId, q.item, answer.tier);
      return { written: 0 };
    }

    let pairs: Comparison[];
    if (q.kind === "pick") {
      // Older clients answer every screen with a ranking; its winner is the pick.
      const winner =
        answer.kind === "pick" ? answer.winner : answer.kind === "rank" ? answer.ranked[0] : undefined;
      if (!winner || validatePickAnswer(q.items, winner)) throw new Error("GROUP_MISMATCH");
      if (answer.kind === "rank" && validateGroupAnswer(q.items, answer.ranked, answer.rest))
        throw new Error("GROUP_MISMATCH");
      pairs = decodePickAnswer(winner, q.items);
    } else {
      if (answer.kind !== "rank") throw new Error("GROUP_MISMATCH");
      const invalid = validateGroupAnswer(q.items, answer.ranked, answer.rest);
      if (invalid) throw new Error(invalid);
      pairs = decodeGroupAnswer(answer.ranked, answer.rest);
    }
    const log = toDomainComparisons(current.comparisons);
    const freshPairs = pairs.filter((p) => lookup(log, p.a, p.b) === undefined);
    const shown = answer.kind === "rank" ? [...answer.ranked, ...answer.rest] : q.items;
    const batch = await tx.comparisonBatch.create({
      data: {
        tournamentId: t.id,
        segmentId: current.activeSegmentId,
        size: q.items.length,
        itemIds: JSON.stringify(shown),
        kind: q.kind,
      },
    });
    for (const p of freshPairs)
      await tx.comparison.create({
        data: {
          tournamentId: t.id,
          trackAId: p.a,
          trackBId: p.b,
          result: p.result,
          batchId: batch.id,
        },
      });
    return { written: freshPairs.length };
  });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function writeTier(tx: Tx, tournamentId: string, segmentId: string, itemId: string, tier: number) {
  await tx.comparisonBatch.create({
    data: {
      tournamentId,
      segmentId,
      size: 1,
      itemIds: JSON.stringify([itemId]),
      kind: "tier",
      tier,
    },
  });
  // "Не участвует" is the same exclusion as in the composition view (P13).
  if (tier === -1) await tx.track.update({ where: { id: itemId }, data: { excluded: true } });
}

/** Pre-33 entry point: a ranked screen. Kept for callers and tests. */
export function recordGroupAnswer(t: LoadedTournament, ranked: string[], rest: string[]) {
  return recordAnswer(t, { kind: "rank", ranked, rest });
}

/** Undo the last screen: a whole batch, or a single pre-phase-18 comparison. */
export async function undoLastAnswer(t: LoadedTournament) {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: t.id },
      data: { updatedAt: new Date() },
    });
    const fresh = await loadTournamentSegmentsFromDb(tx, t.userId, t.id);
    const current = fresh ? tournamentSlice(fresh, t.activeSegmentId) : null;
    if (!current) throw new Error("NOT_FOUND");
    if (current.status === "completed") throw new Error("ALREADY_FINALIZED");
    const lastBatch = current.batches.at(-1) ?? null;
    const lastLegacy =
      current.comparisons.filter((c) => c.batchId === null).at(-1) ?? null;
    if (!lastBatch && !lastLegacy) throw new Error("NOTHING_TO_UNDO");
    // Newcomers reopened a finished top: its answers are not this run's to undo.
    const reopenedAt = parseOverlay(current.insertBase)?.reopenedAt;
    if (reopenedAt !== undefined && !(lastBatch && lastBatch.createdAt.getTime() > reopenedAt))
      throw new Error("UNDO_BEFORE_REOPEN");
    if (
      lastBatch &&
      (!lastLegacy || lastBatch.createdAt >= lastLegacy.createdAt)
    ) {
      const removed = current.comparisons.filter(
        (c) => c.batchId === lastBatch.id,
      ).length;
      await tx.comparisonBatch.delete({ where: { id: lastBatch.id } });
      if (lastBatch.kind === "tier" && lastBatch.tier === -1) {
        const [itemId] = JSON.parse(lastBatch.itemIds) as string[];
        await tx.track.updateMany({ where: { id: itemId, tournamentId: t.id }, data: { excluded: false } });
      }
      return { removed };
    }
    if (lastLegacy) {
      await tx.comparison.delete({ where: { id: lastLegacy.id } });
      return { removed: 1 };
    }
    throw new Error("NOTHING_TO_UNDO");
  });
}

/** Change how many participants one screen ranks. Takes effect on the next question. */
export async function setGroupSize(
  userId: string,
  tournamentId: string,
  size: number,
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
    include: { _count: { select: { tracks: true } }, segments: true },
  });
  if (!t) throw new Error("NOT_FOUND");
  // The cap is the most generous engine among the segments: a merge-only
  // tournament stays on pairs, a mixed one keeps groups for those who can.
  const schemes = t.segments.length
    ? t.segments.map((s) => effectiveScheme(t, s))
    : [effectiveScheme(t, { scheme: null })];
  const cap = Math.max(
    ...schemes.map((s) => (s ? createEngine(s).maxGroupSize : MAX_GROUP_SIZE)),
  );
  const groupSize = Math.min(clampGroupSize(size, t._count.tracks), cap);
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { groupSize },
  });
  return groupSize;
}

/** Buy one more round: every participant gets a group's worth of extra opponents. */
export async function extendPlan(t: LoadedTournament) {
  const run = segmentRun(t);
  if (!runCanExtend(run, t.status === "completed")) throw new Error("NOTHING_MORE_TO_ASK");
  const bonusOpponents = t.bonusOpponents + (run.groupSize - 1);
  await prisma.$transaction(async (tx) => {
    await tx.tournamentSegment.update({
      where: { id: t.activeSegmentId },
      data: { bonusOpponents },
    });
    await aggregateTournamentStatus(tx, t.id);
  });
  return bonusOpponents;
}

/**
 * Finalize a completed segment. The first call computes the ranking from the
 * log and persists the strict places. Subsequent calls only adjust top-N and DO
 * NOT recompute the ranking — this preserves any manual reordering.
 */
export async function finalize(t: LoadedTournament, topSize: number) {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: t.id },
      data: { updatedAt: new Date() },
    });
    const fresh = await loadTournamentSegmentsFromDb(tx, t.userId, t.id);
    const current = fresh ? tournamentSlice(fresh, t.activeSegmentId) : null;
    if (!current) throw new Error("NOT_FOUND");
    const run = segmentRun(current);
    const completed = current.status === "completed";
    if (!run.items.length || (!completed && (!run.scheme || run.question)))
      throw new Error("NOT_COMPLETE");
    const rewrite = !completed || !current.rankings.length;
    const placed = rewrite ? run.result.placed : current.rankings;
    const clampedTop = placed.length
      ? Math.max(1, Math.min(Math.trunc(topSize) || placed.length, placed.length))
      : null;
    if (rewrite) {
      await tx.ranking.deleteMany({
        where: { tournamentId: t.id, segmentId: current.activeSegmentId },
      });
      for (const r of run.result.placed)
        await tx.ranking.create({
          data: {
            tournamentId: t.id,
            segmentId: current.activeSegmentId,
            trackId: r.id,
            rank: r.rank,
            score: r.score,
          },
        });
    }
    await tx.tournamentSegment.update({
      where: { id: current.activeSegmentId },
      data: { status: "completed", topSize: clampedTop, insertBase: null },
    });
    await aggregateTournamentStatus(tx, t.id);
    return { topSize: clampedTop };
  });
}

/** Manually reorder the final ranking (best -> worst by the given track order). */
export async function reorderRanking(
  userId: string,
  tournamentId: string,
  orderedTrackIds: string[],
  segmentId?: string,
) {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({
      where: { id: tournamentId, userId },
      data: { updatedAt: new Date() },
    });
    if (!claimed.count) throw new Error("NOT_FOUND");
    const fresh = await loadTournamentSegmentsFromDb(tx, userId, tournamentId);
    const t = fresh ? tournamentSlice(fresh, segmentId) : null;
    if (!t) throw new Error("NOT_FOUND");
    if (t.status !== "completed") throw new Error("NOT_COMPLETE");
    const known = new Set(t.rankings.map((r) => r.trackId));
    if (
      orderedTrackIds.length !== known.size ||
      new Set(orderedTrackIds).size !== known.size ||
      orderedTrackIds.some((id) => !known.has(id))
    )
      throw new Error("INVALID_ORDER");
    for (const [i, trackId] of orderedTrackIds.entries())
      await tx.ranking.update({
        where: { tournamentId_trackId: { tournamentId, trackId } },
        data: { rank: i + 1 },
      });
  });
}

/**
 * Task 33 (P15, P16): pick the algorithm of one segment or of all of them.
 * The log is kept — the new engine replays it and only asks what it lacks. A
 * finished segment reopens: its persisted order belonged to the old algorithm.
 */
export async function setSegmentScheme(
  userId: string,
  tournamentId: string,
  input: { segmentId?: string; scheme: string; settings?: unknown; allSegments?: boolean },
) {
  if (!isScheme(input.scheme)) throw new Error("UNKNOWN_SCHEME");
  const scheme = input.scheme;
  const settings = parseSchemeSettings(scheme, input.settings ?? {});
  const json = JSON.stringify(settings);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({
      where: { id: tournamentId, userId },
      data: { updatedAt: new Date() },
    });
    if (!claimed.count) throw new Error("NOT_FOUND");
    const fresh = await loadTournamentSegmentsFromDb(tx, userId, tournamentId);
    if (!fresh) throw new Error("NOT_FOUND");
    const targets = input.allSegments
      ? fresh.segments
      : fresh.segments.filter((s) => s.id === (input.segmentId ?? fresh.segments[0]?.id));
    if (!targets.length) throw new Error("NOT_FOUND");
    let reopened = 0;
    for (const s of targets) {
      const before = effectiveScheme(fresh, s);
      const beforeSettings = before ? JSON.stringify(effectiveSettings(before, fresh, s)) : null;
      const same = before === scheme && beforeSettings === json;
      const reopen = !same && s.status === "completed";
      if (reopen) {
        reopened++;
        await tx.ranking.deleteMany({ where: { tournamentId, segmentId: s.id } });
      }
      await tx.tournamentSegment.update({
        where: { id: s.id },
        data: {
          scheme,
          schemeSettings: json,
          ...(same ? {} : { insertBase: null }),
          ...(reopen ? { status: "in_progress", topSize: null } : {}),
        },
      });
      await completeSingleton(tx, s.id);
    }
    if (input.allSegments || fresh.segments.length === 1)
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { scheme, schemeSettings: json, schemePending: false },
      });
    await aggregateTournamentStatus(tx, tournamentId);
    return { scheme, settings, segments: targets.length, reopened };
  });
}

/**
 * Task 33 (P21): move a participant on the tier board, outside the screen
 * order. A change that touches the strictly ordered top tiers of a finished
 * segment reopens it; a pure tier list stays finished.
 */
export async function setTier(t: LoadedTournament, itemId: string, tier: number) {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
    const fresh = await loadTournamentSegmentsFromDb(tx, t.userId, t.id);
    const current = fresh ? tournamentSlice(fresh, t.activeSegmentId) : null;
    if (!current) throw new Error("NOT_FOUND");
    if (current.scheme !== "tiers") throw new Error("NOT_TIERS");
    if (!current.tracks.some((tr) => tr.id === itemId)) throw new Error("NOT_FOUND");
    const names = current.schemeSettings.tiers ?? [];
    if (!Number.isInteger(tier) || tier < -1 || tier >= names.length) throw new Error("INVALID_TIER");
    const run = segmentRun(current);
    const old = run.tiers.get(itemId);
    const rankTop = current.schemeSettings.rankTop ?? 0;
    // Already out (e.g. excluded in the composition view): nothing to record, nothing to undo later.
    if (tier === -1 && current.tracks.find((tr) => tr.id === itemId)?.excluded) return { reopened: false };
    await writeTier(tx, t.id, current.activeSegmentId, itemId, tier);
    if (tier !== -1) await tx.track.update({ where: { id: itemId }, data: { excluded: false } });
    const touchesOrder = (old !== undefined && old < rankTop) || (tier >= 0 && tier < rankTop) || tier === -1;
    if (current.status === "completed" && touchesOrder && rankTop > 0) {
      await tx.ranking.deleteMany({ where: { tournamentId: t.id, segmentId: current.activeSegmentId } });
      await tx.tournamentSegment.update({
        where: { id: current.activeSegmentId },
        data: { status: "in_progress" },
      });
      await aggregateTournamentStatus(tx, t.id);
      return { reopened: true };
    }
    return { reopened: false };
  });
}

/**
 * After participants join or return to a finished segment: newcomers are
 * inserted into the persisted order (P14), or — for tier lists and brackets,
 * whose result is not one strict order — the segment simply reopens.
 */
export async function reopenForNewcomers(
  tx: Tx,
  tournament: { id: string; scheme: string; schemePending: boolean; schemeSettings: string | null },
  segment: {
    id: string;
    status: string;
    scheme: string | null;
    schemeSettings: string | null;
    insertBase: string | null;
    topSize: number | null;
  },
  newcomers: string[],
) {
  if (!newcomers.length) return;
  const overlay = parseOverlay(segment.insertBase);
  if (segment.status !== "completed" && !overlay) return;
  const scheme = effectiveScheme(tournament, segment);
  const base =
    overlay?.base ??
    (
      await tx.ranking.findMany({
        where: { tournamentId: tournament.id, segmentId: segment.id },
        orderBy: { rank: "asc" },
      })
    ).map((r) => r.trackId);
  // The person's top size stays (finalize clamps it to the places there will be),
  // unless it only meant "the one participant there was".
  const activeIds = new Set(
    (await tx.track.findMany({ where: { segmentId: segment.id, excluded: false }, select: { id: true } })).map((t) => t.id),
  );
  const topSize = base.filter((id) => activeIds.has(id)).length <= 1 ? { topSize: null } : {};
  if (scheme && OVERLAY_SCHEMES.includes(scheme)) {
    const pending = [...new Set([...(overlay?.pending ?? []), ...newcomers])];
    const reopenedAt = overlay?.reopenedAt ?? Date.now();
    await tx.tournamentSegment.update({
      where: { id: segment.id },
      data: { insertBase: JSON.stringify({ base, pending, reopenedAt }), status: "in_progress", ...topSize },
    });
  } else {
    await tx.tournamentSegment.update({
      where: { id: segment.id },
      data: { status: "in_progress", insertBase: null, ...topSize },
    });
  }
  await tx.ranking.deleteMany({ where: { tournamentId: tournament.id, segmentId: segment.id } });
  await aggregateTournamentStatus(tx, tournament.id);
}

/** Delete a tournament the user owns, including its stored media. */
export async function deleteTournament(userId: string, tournamentId: string) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
  });
  if (!t) throw new Error("NOT_FOUND");

  // Claim deletion in SQLite before unlink: studio references must protect bytes.
  await prisma.$transaction(async (tx) => {
    if (await tx.studioAssetReference.count({ where: { tournamentId } }))
      throw new Error("STUDIO_SOURCE_IN_USE");
    await tx.tournament.delete({ where: { id: tournamentId } });
  });
  await removePath(path.join("tournaments", tournamentId));
}
