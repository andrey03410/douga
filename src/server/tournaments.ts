import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import { saveFile, trackPath, removePath } from "@/lib/storage";
import { createEngine } from "@/lib/domain/engines";
import type { Comparison, ComparisonResult, Scheme } from "@/lib/domain/types";
import { isComparisonResult } from "@/lib/domain/types";
import { lookup } from "@/lib/domain/comparisons";
import {
  clampGroupSize,
  decodeGroupAnswer,
  plannedScreens,
  validateGroupAnswer,
} from "@/lib/domain/group-answer";
import { can, quotasFor } from "@/lib/domain/permissions";
import { assertOwnedImage } from "./tournament-segments";
import { orderCoverage } from "@/lib/domain/order-coverage";
import {
  loadTournamentSegments,
  loadTournamentSegmentsFromDb,
  segmentProgress,
  aggregateTournamentStatus,
  ensureTournamentSegments,
  completeSingleton,
} from "./tournament-segments";
export { updateTournamentSegments } from "./tournament-segments";
import type { ExtractedTrack } from "@/lib/upload";

export interface CreateInput {
  title: string;
  scheme: Scheme;
  blindMode: boolean;
  /** How many tracks one screen ranks; clamped to the engine and the field. */
  groupSize?: number;
  segments?: {
    title: string;
    subtitle?: string | null;
    posterArtId?: string | null;
    trackIndexes: number[];
  }[];
}

export async function createTournament(
  userId: string,
  input: CreateInput,
  tracks: ExtractedTrack[],
  limits?: { maxTournaments: number | null },
) {
  if (!tracks.length) throw new Error("NEED_AT_LEAST_TWO_TRACKS");
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
        if (
          tracks.reduce(
            (n, t) => n + t.data.length + (t.cover?.data.length ?? 0),
            0,
          ) > quota.maxArchiveBytes
        )
          throw new Error("ARCHIVE_QUOTA");
        const tournament = await tx.tournament.create({
          data: {
            userId,
            title: input.title,
            scheme: input.scheme,
            blindMode: input.blindMode,
            groupSize: Math.min(
              clampGroupSize(input.groupSize ?? 2, tracks.length),
              createEngine(input.scheme).maxGroupSize,
            ),
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
                title: t.title,
                artist: t.artist,
                album: t.album,
                sourceFolder: t.sourceFolder,
                durationSec: t.durationSec,
                kind: t.kind,
                filePath: "",
                order,
                sizeBytes: t.data.length + (t.cover?.data.length ?? 0),
              },
            });
            const ext =
              path.extname(t.filename) ||
              (t.kind === "video" ? ".mp4" : ".mp3");
            const filePath = await saveFile(
              trackPath(tournament.id, created.id, ext),
              t.data,
            );
            let coverPath: string | undefined;
            if (t.cover) {
              const coverExt =
                t.cover.format === "image/png"
                  ? ".png"
                  : t.cover.format === "image/webp"
                    ? ".webp"
                    : ".jpg";
              coverPath = await saveFile(
                trackPath(tournament.id, created.id + "-cover", coverExt),
                t.cover.data,
              );
            }
            await tx.track.update({
              where: { id: created.id },
              data: { filePath, coverPath },
            });
          }
          await completeSingleton(tx, segment.id);
        }
        await aggregateTournamentStatus(tx, tournament.id);
        return tx.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
        });
      },
      { timeout: 120000 },
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
    include: { _count: { select: { tracks: true, comparisons: true } } },
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
  return {
    ...t,
    tournamentStatus: t.status,
    segments,
    activeSegmentId: active.id,
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

type LoadedTournament = NonNullable<Awaited<ReturnType<typeof getTournament>>>;

/** Group size actually in force: the stored one, capped by the engine and field. */
export function effectiveGroupSize(t: LoadedTournament): number {
  const engine = createEngine(t.scheme as Scheme);
  return Math.min(
    clampGroupSize(t.groupSize, t.tracks.length),
    engine.maxGroupSize,
  );
}

export function nextComparison(t: LoadedTournament) {
  const items = t.tracks.map((tr) => tr.id);
  const log = toDomainComparisons(t.comparisons);
  const engine = createEngine(t.scheme as Scheme);
  const groupSize = effectiveGroupSize(t);
  const bonus = t.bonusOpponents;

  // A finalized tournament must not reopen for more questions — its ranking is
  // persisted and may have been reordered by hand since.
  const question =
    t.status === "completed"
      ? null
      : engine.nextQuestion(items, log, groupSize, bonus);
  const progress = engine.progress(items, log, groupSize);

  // Buying another round only makes sense while the engine still has something
  // left to ask; round-robin and merge simply end when they are done.
  const canExtend =
    t.status !== "completed" &&
    question === null &&
    engine.nextQuestion(items, log, groupSize, bonus + (groupSize - 1)) !==
      null;

  // Provisional standings (null for schemes without a meaningful interim ranking).
  const partial = engine.partialRanking(items, log);
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  const standings = partial
    ? partial.map((r) => {
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
    estimatedTotal: Math.max(
      done + (question ? 1 : 0),
      plannedScreens(t.scheme as Scheme, items.length, groupSize),
    ),
  };

  return {
    question,
    groupSize,
    maxGroupSize: engine.maxGroupSize,
    progress,
    screens,
    coverage: orderCoverage(items, log),
    canExtend,
    isComplete: question === null,
    standings,
  };
}

/**
 * Record one screen. The answer must be to the group the engine is actually
 * asking — a stale screen is refused rather than folded in, so the log can never
 * disagree with the schedule that produced it. Pairs already in the log are
 * skipped: `lookup` honours the first answer, so writing a second row would
 * silently inflate the score without changing the order.
 */
export async function recordGroupAnswer(
  t: LoadedTournament,
  ranked: string[],
  rest: string[],
) {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: t.id },
      data: { updatedAt: new Date() },
    });
    const fresh = await loadTournamentSegmentsFromDb(tx, t.userId, t.id);
    const current = fresh ? tournamentSlice(fresh, t.activeSegmentId) : null;
    if (!current) throw new Error("NOT_FOUND");
    const step = nextComparison(current);
    if (!step.question) throw new Error("NOTHING_TO_ANSWER");
    const invalid = validateGroupAnswer(step.question, ranked, rest);
    if (invalid) throw new Error(invalid);
    const log = toDomainComparisons(current.comparisons);
    const pairs = decodeGroupAnswer(ranked, rest).filter(
      (p) => lookup(log, p.a, p.b) === undefined,
    );
    const batch = await tx.comparisonBatch.create({
      data: {
        tournamentId: t.id,
        segmentId: current.activeSegmentId,
        size: ranked.length + rest.length,
        itemIds: JSON.stringify([...ranked, ...rest]),
      },
    });
    for (const p of pairs)
      await tx.comparison.create({
        data: {
          tournamentId: t.id,
          trackAId: p.a,
          trackBId: p.b,
          result: p.result,
          batchId: batch.id,
        },
      });
    return { written: pairs.length };
  });
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
    if (
      lastBatch &&
      (!lastLegacy || lastBatch.createdAt >= lastLegacy.createdAt)
    ) {
      const removed = current.comparisons.filter(
        (c) => c.batchId === lastBatch.id,
      ).length;
      await tx.comparisonBatch.delete({ where: { id: lastBatch.id } });
      return { removed };
    }
    if (lastLegacy) {
      await tx.comparison.delete({ where: { id: lastLegacy.id } });
      return { removed: 1 };
    }
    throw new Error("NOTHING_TO_UNDO");
  });
}

/** Change how many tracks one screen ranks. Takes effect on the next question. */
export async function setGroupSize(
  userId: string,
  tournamentId: string,
  size: number,
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
    include: { _count: { select: { tracks: true } } },
  });
  if (!t) throw new Error("NOT_FOUND");
  const engine = createEngine(t.scheme as Scheme);
  const groupSize = Math.min(
    clampGroupSize(size, t._count.tracks),
    engine.maxGroupSize,
  );
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { groupSize },
  });
  return groupSize;
}

/** Buy one more round: every track gets a group's worth of extra opponents. */
export async function extendPlan(t: LoadedTournament) {
  const items = t.tracks.map((tr) => tr.id);
  const log = toDomainComparisons(t.comparisons);
  const engine = createEngine(t.scheme as Scheme);
  const groupSize = effectiveGroupSize(t);
  const bonusOpponents = t.bonusOpponents + (groupSize - 1);

  if (engine.nextQuestion(items, log, groupSize, bonusOpponents) === null) {
    throw new Error("NOTHING_MORE_TO_ASK");
  }
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
 * Finalize a completed tournament. The first call computes the ranking from the
 * comparison log and persists it. Subsequent calls only adjust top-N and DO NOT
 * recompute the ranking — this preserves any manual reordering the user made.
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
    const items = current.tracks.map((tr) => tr.id);
    const log = toDomainComparisons(current.comparisons);
    const engine = createEngine(current.scheme as Scheme);
    if (
      !items.length ||
      (current.status !== "completed" &&
        !engine.isComplete(items, log, current.bonusOpponents))
    )
      throw new Error("NOT_COMPLETE");
    const clampedTop = Math.max(
      1,
      Math.min(Math.trunc(topSize) || items.length, items.length),
    );
    if (current.status !== "completed" || !current.rankings.length) {
      await tx.ranking.deleteMany({
        where: { tournamentId: t.id, segmentId: current.activeSegmentId },
      });
      for (const r of engine.ranking(items, log))
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
      data: { status: "completed", topSize: clampedTop },
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
