import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { effectiveScheme, effectiveSettings, estimatedScreens, runSegment } from "@/lib/domain/segment-run";

type Db = Prisma.TransactionClient;
export const segmentsUpdateSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            title: z.string().trim().min(1).max(300),
            subtitle: z.string().max(2000).nullable().optional(),
            posterArtId: z.string().min(1).nullable().optional(),
            trackIds: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    confirmReset: z.boolean().optional(),
  })
  .strict();
export type SegmentsUpdate = z.infer<typeof segmentsUpdateSchema>;

/** The first write serializes migration with other edits, including other processes. */
export async function ensureTournamentSegments(db: Db, tournamentId: string) {
  const existing = await db.tournamentSegment.findFirst({
    where: { tournamentId },
  });
  if (existing) return;
  await db.tournament.update({
    where: { id: tournamentId },
    data: { updatedAt: new Date() },
  });
  if (await db.tournamentSegment.count({ where: { tournamentId } })) return;
  const t = await db.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
  });
  const segment = await db.tournamentSegment.create({
    data: {
      tournamentId,
      title: "Все треки",
      order: 0,
      status: t.status,
      topSize: t.topSize,
      bonusOpponents: t.bonusOpponents,
    },
  });
  await db.track.updateMany({
    where: { tournamentId, segmentId: null },
    data: { segmentId: segment.id },
  });
  await db.comparisonBatch.updateMany({
    where: { tournamentId, segmentId: null },
    data: { segmentId: segment.id },
  });
  await db.ranking.updateMany({
    where: { tournamentId, segmentId: null },
    data: { segmentId: segment.id },
  });
  await completeSingleton(db, segment.id);
}

export async function completeSingleton(db: Db, segmentId: string) {
  // Task 33: excluded participants do not count — one active participant is a finished top.
  const tracks = await db.track.findMany({ where: { segmentId, excluded: false } });
  if (tracks.length !== 1) return;
  const tr = tracks[0];
  await db.tournamentSegment.update({
    where: { id: segmentId },
    data: { status: "completed", topSize: 1 },
  });
  await db.ranking.upsert({
    where: {
      tournamentId_trackId: { tournamentId: tr.tournamentId, trackId: tr.id },
    },
    create: {
      tournamentId: tr.tournamentId,
      segmentId,
      trackId: tr.id,
      rank: 1,
      score: 0,
    },
    update: { segmentId },
  });
}

export async function aggregateTournamentStatus(db: Db, tournamentId: string) {
  const segments = await db.tournamentSegment.findMany({
    where: { tournamentId },
    orderBy: { order: "asc" },
  });
  await db.tournament.update({
    where: { id: tournamentId },
    data: {
      status: segments.every((s) => s.status === "completed")
        ? "completed"
        : "in_progress",
      // Compatibility with the single-segment clients and stored old projects.
      ...(segments.length === 1
        ? {
            topSize: segments[0].topSize,
            bonusOpponents: segments[0].bonusOpponents,
          }
        : {}),
    },
  });
}

export async function assertOwnedImage(
  db: Db,
  userId: string,
  artId: string | null | undefined,
) {
  if (!artId) return;
  if (
    !(await db.art.findFirst({ where: { id: artId, userId, kind: "image" } }))
  )
    throw new Error("INVALID_ART");
}

export async function updateTournamentSegments(
  userId: string,
  tournamentId: string,
  input: SegmentsUpdate,
) {
  const parsed = segmentsUpdateSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_SEGMENTS");
  return prisma.$transaction(async (db) => {
    // A write before reading the structure takes SQLite's writer lock. No stale
    // preview can authorize an edit that misses an answer submitted meanwhile.
    const claimed = await db.tournament.updateMany({
      where: { id: tournamentId, userId },
      data: { updatedAt: new Date() },
    });
    if (!claimed.count) throw new Error("NOT_FOUND");
    await ensureTournamentSegments(db, tournamentId);
    const old = await db.tournamentSegment.findMany({
      where: { tournamentId },
      include: { tracks: true },
    });
    const knownSegments = new Set(old.map((s) => s.id));
    const tracks = old.flatMap((s) => s.tracks);
    const byTrack = new Map(tracks.map((t) => [t.id, t]));
    const allIds = parsed.data.segments.flatMap((s) => s.trackIds);
    const suppliedIds = parsed.data.segments.flatMap((s) =>
      s.id ? [s.id] : [],
    );
    if (
      new Set(suppliedIds).size !== suppliedIds.length ||
      suppliedIds.some((id) => !knownSegments.has(id))
    )
      throw new Error("INVALID_SEGMENTS");
    if (
      allIds.length !== tracks.length ||
      new Set(allIds).size !== tracks.length ||
      allIds.some((id) => !byTrack.has(id))
    )
      throw new Error("INVALID_TRACKS");
    for (const s of parsed.data.segments)
      await assertOwnedImage(db, userId, s.posterArtId);
    const moved = new Set(
      parsed.data.segments.flatMap((s) =>
        s.trackIds.filter((id) => byTrack.get(id)!.segmentId !== s.id),
      ),
    );
    const changedSegments = new Set<string>();
    for (const s of parsed.data.segments) {
      const previous = old.find((p) => p.id === s.id);
      if (
        !previous ||
        previous.tracks.length !== s.trackIds.length ||
        previous.tracks.some((t) => !s.trackIds.includes(t.id))
      ) {
        if (s.id) changedSegments.add(s.id);
      }
    }
    for (const id of moved) changedSegments.add(byTrack.get(id)!.segmentId!);
    const batches = await db.comparisonBatch.findMany({
      where: { tournamentId },
    });
    const removedBatches = batches.filter((b) =>
      (JSON.parse(b.itemIds) as string[]).some((id) => moved.has(id)),
    );
    const removedBatchIds = removedBatches.map((b) => b.id);
    const legacy = await db.comparison.findMany({
      where: { tournamentId, batchId: null },
    });
    const removedLegacy = legacy.filter(
      (c) => moved.has(c.trackAId) || moved.has(c.trackBId),
    );
    const answersToReset = removedBatches.length + removedLegacy.length;
    if (answersToReset && !parsed.data.confirmReset)
      return { requiresConfirmation: true as const, answersToReset };
    if (removedBatchIds.length)
      await db.comparisonBatch.deleteMany({
        where: { id: { in: removedBatchIds } },
      });
    if (removedLegacy.length)
      await db.comparison.deleteMany({
        where: { id: { in: removedLegacy.map((c) => c.id) } },
      });
    await db.ranking.deleteMany({
      where: { tournamentId, segmentId: { in: [...changedSegments] } },
    });
    const retained: string[] = [];
    for (const [order, s] of parsed.data.segments.entries()) {
      const data = {
        title: s.title,
        subtitle: s.subtitle ?? null,
        posterArtId: s.posterArtId ?? null,
        order,
      };
      const segment = s.id
        ? await db.tournamentSegment.update({
            where: { id: s.id },
            data: {
              ...data,
              ...(changedSegments.has(s.id)
                ? { status: "in_progress", topSize: null, bonusOpponents: 0, insertBase: null }
                : {}),
            },
          })
        : await db.tournamentSegment.create({
            data: { tournamentId, ...data },
          });
      retained.push(segment.id);
      for (const [trackOrder, id] of s.trackIds.entries())
        await db.track.update({
          where: { id },
          data: { segmentId: segment.id, order: trackOrder },
        });
    }
    await db.tournamentSegment.deleteMany({
      where: { tournamentId, id: { notIn: retained } },
    });
    for (const id of retained) await completeSingleton(db, id);
    await aggregateTournamentStatus(db, tournamentId);
    return { requiresConfirmation: false as const, answersToReset };
  });
}

export async function loadTournamentSegmentsFromDb(
  db: Db,
  userId: string,
  id: string,
) {
  if (!(await db.tournament.findFirst({ where: { id, userId } }))) return null;
  await ensureTournamentSegments(db, id);
  const result = await db.tournament.findUnique({
    where: { id },
    include: {
      segments: { orderBy: { order: "asc" } },
      tracks: { orderBy: { order: "asc" } },
      comparisons: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      batches: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      rankings: { orderBy: { rank: "asc" } },
    },
  });
  if (
    result?.segments.length === 1 &&
    result.status === "completed" &&
    result.segments[0].status !== "completed"
  ) {
    await db.tournamentSegment.update({
      where: { id: result.segments[0].id },
      data: { status: "completed", topSize: result.topSize },
    });
    result.segments[0].status = "completed";
    result.segments[0].topSize = result.topSize;
  }
  return result;
}

export async function loadTournamentSegments(userId: string, id: string) {
  return prisma.$transaction((db) =>
    loadTournamentSegmentsFromDb(db, userId, id),
  );
}

export function segmentProgress(
  t: NonNullable<Awaited<ReturnType<typeof loadTournamentSegments>>>,
) {
  return t.segments.map((s) => {
    const tracks = t.tracks.filter((tr) => tr.segmentId === s.id);
    const ids = new Set(tracks.map((tr) => tr.id));
    const comparisons = t.comparisons.filter(
      (c) => ids.has(c.trackAId) && ids.has(c.trackBId),
    );
    const batches = t.batches.filter((b) => b.segmentId === s.id);
    const scheme = effectiveScheme(t, s);
    const answeredScreens =
      batches.length + comparisons.filter((c) => !c.batchId).length;
    const run = runSegment({
      scheme,
      settings: scheme ? effectiveSettings(scheme, t, s) : {},
      groupSize: t.groupSize,
      bonusOpponents: s.bonusOpponents,
      tracks,
      comparisons,
      batches,
      overlay: s.insertBase,
      completed: s.status === "completed",
    });
    return {
      ...s,
      tracks,
      trackCount: tracks.length,
      activeCount: run.items.length,
      effectiveScheme: scheme,
      answeredScreens,
      // Screens, like the compare page (task 33: engines no longer count pairs).
      progress: {
        completed: answeredScreens,
        estimatedTotal: estimatedScreens(run, answeredScreens, false),
      },
    };
  });
}
