import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { removePath } from "@/lib/storage";
import { prisma } from "@/lib/db";
import {
  getTournament,
  nextComparison,
  recordGroupAnswer,
  finalize,
  updateTournamentSegments,
  undoLastAnswer,
  reorderRanking,
  createTournament,
} from "@/server/tournaments";

let userId: string;
beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: "segments-backend@test.local" },
  });
  userId = (
    await prisma.user.create({
      data: {
        email: "segments-backend@test.local",
        passwordHash: "x",
        role: "admin",
      },
    })
  ).id;
});
async function clearTournaments() {
  for (const t of await prisma.tournament.findMany({ where: { userId } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.tournament.deleteMany({ where: { userId } });
}
afterAll(async () => {
  await clearTournaments();
  await prisma.user.deleteMany({ where: { id: userId } });
});
beforeEach(clearTournaments);
async function legacy(count = 4) {
  return prisma.tournament.create({
    data: {
      userId,
      title: "Segments",
      scheme: "round_robin",
      status: "in_progress",
      groupSize: 3,
      tracks: {
        create: Array.from({ length: count }, (_, i) => ({
          title: `t${i}`,
          filePath: "fake.mp3",
          order: i,
        })),
      },
    },
    include: { tracks: true },
  });
}
it("lazily places a legacy tournament in one segment without changing its manual ranking", async () => {
  const t = await legacy();
  await prisma.tournament.update({
    where: { id: t.id },
    data: { status: "completed", topSize: 2 },
  });
  for (const [i, tr] of [...t.tracks].reverse().entries())
    await prisma.ranking.create({
      data: { tournamentId: t.id, trackId: tr.id, rank: i + 1, score: 0 },
    });
  const loaded = (await getTournament(userId, t.id))!;
  expect(loaded).toHaveProperty("segments");
  expect(loaded.segments).toHaveLength(1);
  expect(loaded.activeSegmentId).toBe(loaded.segments[0].id);
  expect(loaded.rankings.map((r) => r.trackId)).toEqual(
    [...t.tracks].reverse().map((tr) => tr.id),
  );
  expect(nextComparison(loaded).question).toBeNull();
  expect(loaded.topSize).toBe(2);
});

it("keeps grouped answers, undo and final rankings inside the selected segment", async () => {
  const t = await legacy(6);
  const loaded = (await getTournament(userId, t.id))!;
  const layout = [
    {
      id: loaded.activeSegmentId,
      title: "A",
      trackIds: t.tracks.slice(0, 3).map((t) => t.id),
    },
    { title: "B", trackIds: t.tracks.slice(3).map((t) => t.id) },
  ];
  await updateTournamentSegments(userId, t.id, { segments: layout });
  const a = (await getTournament(userId, t.id))!;
  const b = (await getTournament(userId, t.id, a.segments[1].id))!;
  await recordGroupAnswer(a, nextComparison(a).question!, []);
  expect(
    (await getTournament(userId, t.id, b.activeSegmentId))!.comparisons,
  ).toHaveLength(0);
  expect(
    (await getTournament(userId, t.id, a.activeSegmentId))!.batches,
  ).toHaveLength(1);
  await recordGroupAnswer(b, nextComparison(b).question!, []);
  await undoLastAnswer((await getTournament(userId, t.id, b.activeSegmentId))!);
  expect(
    (await getTournament(userId, t.id, a.activeSegmentId))!.comparisons,
  ).toHaveLength(3);
  await finalize((await getTournament(userId, t.id, a.activeSegmentId))!, 2);
  expect((await getTournament(userId, t.id, b.activeSegmentId))!.status).toBe(
    "in_progress",
  );
  await reorderRanking(
    userId,
    t.id,
    [...a.tracks].reverse().map((t) => t.id),
    a.activeSegmentId,
  );
  expect(
    (await getTournament(userId, t.id, a.activeSegmentId))!.rankings.map(
      (r) => r.trackId,
    ),
  ).toEqual([...a.tracks].reverse().map((t) => t.id));
});
it("completes a singleton immediately with a persisted first place", async () => {
  const t = await legacy(3);
  const loaded = (await getTournament(userId, t.id))!;
  await updateTournamentSegments(userId, t.id, {
    segments: [
      { id: loaded.activeSegmentId, title: "one", trackIds: [t.tracks[0].id] },
      { title: "two", trackIds: t.tracks.slice(1).map((t) => t.id) },
    ],
  });
  const one = (await getTournament(userId, t.id))!;
  expect(one.status).toBe("completed");
  expect(one.rankings[0]).toMatchObject({ trackId: t.tracks[0].id, rank: 1 });
  expect(nextComparison(one).question).toBeNull();
});
it("previews removed screens and removes complete batches including a track appearing only in itemIds", async () => {
  const t = await legacy(7);
  const loaded = (await getTournament(userId, t.id))!;
  await updateTournamentSegments(userId, t.id, {
    segments: [
      {
        id: loaded.activeSegmentId,
        title: "A",
        trackIds: t.tracks.slice(0, 4).map((t) => t.id),
      },
      { title: "B", trackIds: t.tracks.slice(4).map((t) => t.id) },
    ],
  });
  const a = (await getTournament(userId, t.id))!;
  const b = (await getTournament(userId, t.id, a.segments[1].id))!;
  await recordGroupAnswer(b, nextComparison(b).question!, []);
  const [x, y, z, w] = a.tracks.map((t) => t.id);
  await prisma.comparisonBatch.create({
    data: {
      tournamentId: t.id,
      segmentId: a.activeSegmentId,
      size: 3,
      itemIds: JSON.stringify([x, y, z]),
      comparisons: {
        create: { tournamentId: t.id, trackAId: y, trackBId: z, result: "a" },
      },
    },
  });
  await prisma.comparison.create({
    data: { tournamentId: t.id, trackAId: x, trackBId: w, result: "a" },
  });
  const segments = [
    { id: a.activeSegmentId, title: "A", trackIds: [y, z, w] },
    {
      id: b.activeSegmentId,
      title: "B",
      trackIds: [x, ...b.tracks.map((t) => t.id)],
    },
  ];
  expect(
    await updateTournamentSegments(userId, t.id, { segments }),
  ).toMatchObject({ requiresConfirmation: true, answersToReset: 2 });
  expect((await getTournament(userId, t.id))!.tracks).toHaveLength(4);
  expect(
    await updateTournamentSegments(userId, t.id, {
      segments,
      confirmReset: true,
    }),
  ).toMatchObject({ requiresConfirmation: false, answersToReset: 2 });
  expect(
    (await getTournament(userId, t.id, a.activeSegmentId))!.comparisons,
  ).toHaveLength(0);
  expect(
    (await getTournament(userId, t.id, b.activeSegmentId))!.comparisons,
  ).toHaveLength(3);
});
it("refuses duplicates, missing tracks, unknown segments and foreign ownership", async () => {
  const t = await legacy(3);
  const loaded = (await getTournament(userId, t.id))!;
  const ids = t.tracks.map((t) => t.id);
  for (const trackIds of [
    [ids[0], ids[0], ids[2]],
    [ids[0]],
    [...ids, "foreign"],
  ])
    await expect(
      updateTournamentSegments(userId, t.id, {
        segments: [{ id: loaded.activeSegmentId, title: "A", trackIds }],
      }),
    ).rejects.toThrow("INVALID_TRACKS");
  await expect(
    updateTournamentSegments(userId, t.id, {
      segments: [{ id: "foreign", title: "A", trackIds: ids }],
    }),
  ).rejects.toThrow("INVALID_SEGMENTS");
  await expect(
    updateTournamentSegments("foreign", t.id, {
      segments: [{ title: "A", trackIds: ids }],
    }),
  ).rejects.toThrow("NOT_FOUND");
});
it("creates explicit singleton segments and preserves track metadata", async () => {
  const tracks = [
    {
      filename: "a.mp3",
      kind: "audio" as const,
      title: "a",
      artist: "artist",
      durationSec: 15,
      data: Buffer.from("a"),
      album: "album",
      sourceFolder: "Episode 1",
      cover: { data: Buffer.from("cover"), format: "image/png" },
    },
  ];
  const t = await createTournament(
    userId,
    {
      title: "New",
      scheme: "merge",
      blindMode: false,
      segments: [{ title: "One", trackIndexes: [0] }],
    },
    tracks,
  );
  const loaded = (await getTournament(userId, t.id))!;
  expect(loaded.status).toBe("completed");
  expect(loaded.tracks[0]).toMatchObject({
    album: "album",
    sourceFolder: "Episode 1",
  });
  expect(loaded.tracks[0].coverPath).toMatch(/\.png$/);
});
it("edits metadata only for the owner and validates best moment and owned image covers", async () => {
  const { updateTrackMetadata } = await import("@/server/track-metadata");
  const t = await legacy(2);
  const tr = t.tracks[0];
  await prisma.track.update({
    where: { id: tr.id },
    data: { durationSec: 10 },
  });
  const art = await prisma.art.create({
    data: { userId, filePath: "cover.png", kind: "image" },
  });
  expect(
    await updateTrackMetadata(userId, tr.id, {
      title: "Fixed",
      artist: "A",
      comment: "Why",
      bestMomentSec: 5,
      coverArtId: art.id,
    }),
  ).toMatchObject({
    title: "Fixed",
    artist: "A",
    comment: "Why",
    bestMomentSec: 5,
    coverArtId: art.id,
  });
  await expect(
    updateTrackMetadata(userId, tr.id, { bestMomentSec: 11 }),
  ).rejects.toThrow("INVALID_BEST_MOMENT");
  await expect(
    updateTrackMetadata(userId, tr.id, { coverArtId: "foreign" }),
  ).rejects.toThrow("INVALID_ART");
  await expect(
    updateTrackMetadata("foreign", tr.id, { title: "bad" }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    updateTrackMetadata(userId, tr.id, { rank: 1 } as never),
  ).rejects.toThrow("INVALID_TRACK_METADATA");
  await prisma.track.update({
    where: { id: tr.id },
    data: { coverArtId: null },
  });
  await prisma.art.delete({ where: { id: art.id } });
});
it("preserves a completed legacy singleton's stored score and first rank during migration", async () => {
  const t = await legacy(1);
  await prisma.tournament.update({
    where: { id: t.id },
    data: { status: "completed", topSize: 1 },
  });
  await prisma.ranking.create({
    data: { tournamentId: t.id, trackId: t.tracks[0].id, rank: 1, score: 7.5 },
  });
  const loaded = (await getTournament(userId, t.id))!;
  expect(loaded.status).toBe("completed");
  expect(loaded.rankings).toHaveLength(1);
  expect(loaded.rankings[0]).toMatchObject({
    trackId: t.tracks[0].id,
    segmentId: loaded.activeSegmentId,
    rank: 1,
    score: 7.5,
  });
});
