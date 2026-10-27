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
import { orderCoverage } from "@/lib/domain/order-coverage";
import type { ExtractedTrack } from "@/lib/upload";

export interface CreateInput {
  title: string;
  scheme: Scheme;
  blindMode: boolean;
  /** How many tracks one screen ranks; clamped to the engine and the field. */
  groupSize?: number;
}

export async function createTournament(
  userId: string,
  input: CreateInput,
  tracks: ExtractedTrack[],
  limits?: { maxTournaments: number | null },
) {
  if (tracks.length < 2) throw new Error("NEED_AT_LEAST_TWO_TRACKS");

  // The slot check and the create run in one transaction so two concurrent
  // uploads cannot both squeeze past a 1-tournament quota.
  const tournament = await prisma.$transaction(async (tx) => {
    const max = limits?.maxTournaments ?? null;
    if (max !== null) {
      const count = await tx.tournament.count({ where: { userId } });
      if (count >= max) throw new Error("TOURNAMENT_LIMIT");
    }
    return tx.tournament.create({
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
  });

  let order = 0;
  for (const t of tracks) {
    const created = await prisma.track.create({
      data: {
        tournamentId: tournament.id,
        title: t.title,
        artist: t.artist,
        durationSec: t.durationSec,
        kind: t.kind,
        filePath: "",
        order: order++,
        sizeBytes: t.data.length,
      },
    });
    const ext = path.extname(t.filename) || (t.kind === "video" ? ".mp4" : ".mp3");
    const rel = await saveFile(trackPath(tournament.id, created.id, ext), t.data);
    await prisma.track.update({ where: { id: created.id }, data: { filePath: rel } });
  }

  return tournament;
}

export async function listTournaments(userId: string) {
  return prisma.tournament.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { tracks: true, comparisons: true } } },
  });
}

/** Load a tournament the user owns, with its tracks (ordered) and comparison log. */
export async function getTournament(userId: string, id: string) {
  const tournament = await prisma.tournament.findFirst({
    where: { id, userId },
    include: {
      tracks: { orderBy: { order: "asc" } },
      // Id breaks the tie: SQLite timestamps are milliseconds, and two screens
      // answered inside the same millisecond would otherwise come back in an
      // arbitrary order — which decides both "first answer wins" in `lookup`
      // and which screen undo removes.
      comparisons: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      batches: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      rankings: { orderBy: { rank: "asc" } },
    },
  });
  return tournament;
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
  return Math.min(clampGroupSize(t.groupSize, t.tracks.length), engine.maxGroupSize);
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
    t.status === "completed" ? null : engine.nextQuestion(items, log, groupSize, bonus);
  const progress = engine.progress(items, log, groupSize);

  // Buying another round only makes sense while the engine still has something
  // left to ask; round-robin and merge simply end when they are done.
  const canExtend =
    t.status !== "completed" &&
    question === null &&
    engine.nextQuestion(items, log, groupSize, bonus + (groupSize - 1)) !== null;

  // Provisional standings (null for schemes without a meaningful interim ranking).
  const partial = engine.partialRanking(items, log);
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  const standings = partial
    ? partial.map((r) => {
        const tr = byId.get(r.id)!;
        return { trackId: r.id, rank: r.rank, title: tr.title, artist: tr.artist, score: r.score };
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
  const step = nextComparison(t);
  if (!step.question) throw new Error("NOTHING_TO_ANSWER");

  const invalid = validateGroupAnswer(step.question, ranked, rest);
  if (invalid) throw new Error(invalid);

  const known = new Set(t.tracks.map((tr) => tr.id));
  for (const id of [...ranked, ...rest]) if (!known.has(id)) throw new Error("INVALID_PAIR");

  const log = toDomainComparisons(t.comparisons);
  const pairs = decodeGroupAnswer(ranked, rest).filter(
    (p) => lookup(log, p.a, p.b) === undefined,
  );

  await prisma.$transaction(async (tx) => {
    const batch = await tx.comparisonBatch.create({
      data: {
        tournamentId: t.id,
        size: ranked.length + rest.length,
        itemIds: JSON.stringify([...ranked, ...rest]),
      },
    });
    for (const p of pairs) {
      await tx.comparison.create({
        data: {
          tournamentId: t.id,
          trackAId: p.a,
          trackBId: p.b,
          result: p.result,
          batchId: batch.id,
        },
      });
    }
    await tx.tournament.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
  });

  return { written: pairs.length };
}

/** Undo the last screen: a whole batch, or a single pre-phase-18 comparison. */
export async function undoLastAnswer(t: LoadedTournament) {
  if (t.status === "completed") throw new Error("ALREADY_FINALIZED");

  const lastBatch = t.batches.at(-1) ?? null;
  const legacy = t.comparisons.filter((c) => c.batchId === null);
  const lastLegacy = legacy.at(-1) ?? null;

  // Ties go to the batch: batches only exist since phase 18, so a batch stamped
  // at the same millisecond as a loose row is the newer of the two.
  const useBatch =
    lastBatch !== null &&
    (lastLegacy === null || lastBatch.createdAt >= lastLegacy.createdAt);

  if (useBatch) {
    const removed = t.comparisons.filter((c) => c.batchId === lastBatch!.id).length;
    await prisma.comparisonBatch.delete({ where: { id: lastBatch!.id } });
    return { removed };
  }
  if (lastLegacy) {
    await prisma.comparison.delete({ where: { id: lastLegacy.id } });
    return { removed: 1 };
  }
  throw new Error("NOTHING_TO_UNDO");
}

/** Change how many tracks one screen ranks. Takes effect on the next question. */
export async function setGroupSize(userId: string, tournamentId: string, size: number) {
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
  await prisma.tournament.update({ where: { id: tournamentId }, data: { groupSize } });
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
  await prisma.tournament.update({ where: { id: t.id }, data: { bonusOpponents } });
  return bonusOpponents;
}

/**
 * Finalize a completed tournament. The first call computes the ranking from the
 * comparison log and persists it. Subsequent calls only adjust top-N and DO NOT
 * recompute the ranking — this preserves any manual reordering the user made.
 */
export async function finalize(t: LoadedTournament, topSize: number) {
  const items = t.tracks.map((tr) => tr.id);
  const log = toDomainComparisons(t.comparisons);
  const engine = createEngine(t.scheme as Scheme);
  // An already finalized tournament stays finalized: phase 18 changed how Swiss
  // decides it is done (opponents per track instead of rounds), and a run that
  // finished under the old rule can be a comparison short under the new one.
  // Re-opening it would block a plain top-N change on a finished top.
  if (t.status !== "completed" && !engine.isComplete(items, log, t.bonusOpponents)) {
    throw new Error("NOT_COMPLETE");
  }

  const clampedTop = Math.max(1, Math.min(topSize, items.length));

  if (t.status !== "completed" || t.rankings.length === 0) {
    const ranking = engine.ranking(items, log);
    await prisma.$transaction([
      prisma.ranking.deleteMany({ where: { tournamentId: t.id } }),
      ...ranking.map((r) =>
        prisma.ranking.create({
          data: { tournamentId: t.id, trackId: r.id, rank: r.rank, score: r.score },
        }),
      ),
      prisma.tournament.update({
        where: { id: t.id },
        data: { status: "completed", topSize: clampedTop },
      }),
    ]);
  } else {
    await prisma.tournament.update({
      where: { id: t.id },
      data: { topSize: clampedTop },
    });
  }

  await syncRenderConfigToRanking(t.id);
  return { topSize: clampedTop };
}

/** Manually reorder the final ranking (best -> worst by the given track order). */
export async function reorderRanking(
  userId: string,
  tournamentId: string,
  orderedTrackIds: string[],
) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
    include: { rankings: true },
  });
  if (!t) throw new Error("NOT_FOUND");
  if (t.status !== "completed") throw new Error("NOT_COMPLETE");

  const known = new Set(t.rankings.map((r) => r.trackId));
  if (orderedTrackIds.length !== known.size || orderedTrackIds.some((id) => !known.has(id))) {
    throw new Error("INVALID_ORDER");
  }

  await prisma.$transaction(
    orderedTrackIds.map((trackId, i) =>
      prisma.ranking.update({
        where: { tournamentId_trackId: { tournamentId, trackId } },
        data: { rank: i + 1 },
      }),
    ),
  );
  await syncRenderConfigToRanking(tournamentId);
}

/**
 * Keep the render config's items aligned with the current top-N ranking: update
 * ranks, add newly-included tracks, drop excluded ones, preserving per-item
 * settings (clip/art) for tracks that remain.
 */
async function syncRenderConfigToRanking(tournamentId: string) {
  const config = await prisma.renderConfig.findUnique({
    where: { tournamentId },
    include: { items: true },
  });
  if (!config) return;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { rankings: { orderBy: { rank: "asc" } } },
  });
  if (!tournament) return;

  const topSize = tournament.topSize ?? tournament.rankings.length;
  const desired = tournament.rankings.filter((r) => r.rank <= topSize);
  const desiredIds = new Set(desired.map((r) => r.trackId));
  const existing = new Map(config.items.map((it) => [it.trackId, it]));

  const ops = [];
  for (const r of desired) {
    const item = existing.get(r.trackId);
    if (item) {
      if (item.rank !== r.rank) {
        ops.push(prisma.renderItem.update({ where: { id: item.id }, data: { rank: r.rank } }));
      }
    } else {
      ops.push(
        prisma.renderItem.create({
          data: {
            renderConfigId: config.id,
            trackId: r.trackId,
            rank: r.rank,
            clipMode: "active_snippet",
            snippetLenSec: 30,
          },
        }),
      );
    }
  }
  for (const it of config.items) {
    if (!desiredIds.has(it.trackId!)) {
      ops.push(prisma.renderItem.delete({ where: { id: it.id } }));
    }
  }
  if (ops.length) await prisma.$transaction(ops);
}

/** Delete a tournament the user owns, including its stored media and renders. */
export async function deleteTournament(userId: string, tournamentId: string) {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
    include: { renderJobs: true },
  });
  if (!t) throw new Error("NOT_FOUND");

  // Claim deletion in SQLite before unlink: studio references must protect bytes.
  await prisma.$transaction(async tx => {
    if(await tx.studioAssetReference.count({where:{tournamentId}})) throw new Error("STUDIO_SOURCE_IN_USE");
    await tx.tournament.delete({where:{id:tournamentId}});
  });
  await removePath(path.join("tournaments", tournamentId));
  for (const job of t.renderJobs) {
    await removePath(path.join("renders", `${job.id}.mp4`));
    await removePath(path.join("renders", "tmp", job.id));
  }

}
