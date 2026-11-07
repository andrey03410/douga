import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { removePath, absPath } from "@/lib/storage";
import { prisma } from "@/lib/db";
import type { ExtractedTrack } from "@/lib/upload";
import {
  createTournament,
  finalize,
  getTournament,
  nextComparison,
  recordAnswer,
  reorderRanking,
  setSegmentScheme,
  setTier,
  undoLastAnswer,
  type LoadedTournament,
} from "@/server/tournaments";
import { addParticipants, deleteParticipants, setExcluded } from "@/server/tournament-items";

// Task 33 service against the real schema: algorithm per segment, pick and
// tier screens, switching without losing answers, exclusion and newcomers
// joining a finished order.

const EMAIL = "algorithms-33@test.local";
let userId = "";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } })).id;
});
async function clear() {
  for (const t of await prisma.tournament.findMany({ where: { userId } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.tournament.deleteMany({ where: { userId } });
}
afterAll(async () => {
  await clear();
  await prisma.user.deleteMany({ where: { id: userId } });
});
beforeEach(clear);

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const image = (title: string, key?: string): ExtractedTrack => ({
  filename: `${title}.png`,
  kind: "image",
  title,
  artist: null,
  album: null,
  sourceFolder: null,
  durationSec: null,
  data: PNG,
  subtitle: `${title} anime`,
  sourceKey: key ?? `test:${title}`,
});

/** Hidden truth: lower number is better (title "c03" is fourth best). */
const value = (t: LoadedTournament, id: string) =>
  Number(t.tracks.find((tr) => tr.id === id)!.title.slice(1));

async function make(n: number, scheme?: "swiss" | "insertion" | "top_k" | "tiers" | "bracket", segments = 1) {
  const tracks = Array.from({ length: n * segments }, (_, i) => image(`c${String(i % n).padStart(2, "0")}`, `k${i}`));
  const t = await createTournament(
    userId,
    {
      title: "Algorithms",
      scheme,
      blindMode: false,
      groupSize: 3,
      segments: Array.from({ length: segments }, (_, s) => ({
        title: `S${s}`,
        trackIndexes: Array.from({ length: n }, (_, i) => s * n + i),
      })),
    },
    tracks,
  );
  return t.id;
}

const load = async (id: string, segmentId?: string) => (await getTournament(userId, id, segmentId))!;

/** Answer honestly until the segment has nothing to ask. */
async function playOut(id: string, segmentId?: string, limit = 2000) {
  for (let i = 0; i < limit; i++) {
    const t = await load(id, segmentId);
    const step = nextComparison(t);
    if (!step.question) return i;
    const order = [...step.question].sort((a, b) => value(t, a) - value(t, b));
    if (step.questionKind === "tier") {
      const tiers = t.schemeSettings.tiers ?? [];
      const tier = Math.min(tiers.length - 1, Math.floor((value(t, order[0]) * tiers.length) / t.tracks.length));
      await recordAnswer(t, { kind: "tier", itemId: order[0], tier });
    } else if (step.questionKind === "pick") await recordAnswer(t, { kind: "pick", winner: order[0] });
    else await recordAnswer(t, { kind: "rank", ranked: order, rest: [] });
  }
  throw new Error("did not finish");
}

describe("algorithm choice", () => {
  it("an agent-built base waits for the person to choose", async () => {
    const id = await make(4);
    const t = await load(id);
    expect(t.scheme).toBeNull();
    const step = nextComparison(t);
    expect(step.schemeRequired).toBe(true);
    expect(step.question).toBeNull();
    expect(step.isComplete).toBe(false);
    await expect(recordAnswer(t, { kind: "rank", ranked: [], rest: [] })).rejects.toThrow("SCHEME_REQUIRED");
  });

  it("one segment or all of them, with settings", async () => {
    const id = await make(5, undefined, 2);
    const [s0, s1] = (await load(id)).segments;
    await setSegmentScheme(userId, id, { segmentId: s0.id, scheme: "top_k", settings: { k: 2 } });
    expect((await load(id, s0.id)).scheme).toBe("top_k");
    expect((await load(id, s1.id)).scheme).toBeNull();
    await setSegmentScheme(userId, id, { scheme: "insertion", allSegments: true });
    for (const s of [s0, s1]) expect((await load(id, s.id)).scheme).toBe("insertion");
    const row = await prisma.tournament.findUniqueOrThrow({ where: { id } });
    expect(row.schemePending).toBe(false);
    await expect(
      setSegmentScheme(userId, id, { scheme: "top_k", settings: { k: 0 }, allSegments: true }),
    ).rejects.toThrow("INVALID_SCHEME_SETTINGS");
  });

  it("switching keeps every answer and the new algorithm only asks what it lacks", async () => {
    const id = await make(8, "swiss");
    await playOut(id);
    const before = await prisma.comparison.count({ where: { tournamentId: id } });
    await setSegmentScheme(userId, id, { scheme: "insertion", allSegments: true });
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(before);
    const extra = await playOut(id);
    expect(extra).toBeGreaterThan(0);
    const t = await load(id);
    await finalize(t, 8);
    const done = await load(id);
    expect(done.rankings.map((r) => done.tracks.find((tr) => tr.id === r.trackId)!.title)).toEqual(
      Array.from({ length: 8 }, (_, i) => `c0${i}`),
    );
  });

  it("switching a finished segment reopens it", async () => {
    const id = await make(4, "insertion");
    await playOut(id);
    await finalize(await load(id), 4);
    const res = await setSegmentScheme(userId, id, { scheme: "top_k", settings: { k: 2 }, allSegments: true });
    expect(res.reopened).toBe(1);
    const t = await load(id);
    expect(t.status).toBe("in_progress");
    expect(t.rankings).toHaveLength(0);
    // the full order already answers top 2
    expect(nextComparison(t).isComplete).toBe(true);
    await finalize(t, 2);
    expect((await load(id)).rankings).toHaveLength(2);
  });
});

describe("pick and tier screens", () => {
  it("bracket asks pick screens and records no draws among the rest", async () => {
    const id = await make(9, "bracket");
    const t = await load(id);
    const step = nextComparison(t);
    expect(step.questionKind).toBe("pick");
    const winner = step.question![0];
    await recordAnswer(t, { kind: "pick", winner });
    const rows = await prisma.comparison.findMany({ where: { tournamentId: id } });
    expect(rows).toHaveLength(step.question!.length - 1);
    expect(rows.every((r) => r.result === "a" && r.trackAId === winner)).toBe(true);
    const batch = await prisma.comparisonBatch.findFirstOrThrow({ where: { tournamentId: id } });
    expect(batch.kind).toBe("pick");
    await expect(recordAnswer(await load(id), { kind: "pick", winner: "nope" })).rejects.toThrow("GROUP_MISMATCH");
    await playOut(id);
    await finalize(await load(id), 3);
    const done = await load(id);
    expect(done.tracks.find((tr) => tr.id === done.rankings[0].trackId)!.title).toBe("c00");
  });

  it("an old ranked answer still settles a pick screen", async () => {
    const id = await make(9, "bracket");
    const t = await load(id);
    const q = nextComparison(t).question!;
    await recordAnswer(t, { kind: "rank", ranked: q, rest: [] });
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(q.length - 1);
  });

  it("tiers: tier screens, 'не участвует' excludes and undo returns", async () => {
    const id = await make(6, "tiers");
    await setSegmentScheme(userId, id, {
      scheme: "tiers",
      settings: { tiers: ["S", "A", "B"], rankTop: 1 },
      allSegments: true,
    });
    let t = await load(id);
    let step = nextComparison(t);
    expect(step.questionKind).toBe("tier");
    const first = step.question![0];
    await recordAnswer(t, { kind: "tier", itemId: first, tier: -1 });
    expect((await prisma.track.findUniqueOrThrow({ where: { id: first } })).excluded).toBe(true);
    t = await load(id);
    expect(nextComparison(t).question![0]).not.toBe(first);
    await undoLastAnswer(t);
    expect((await prisma.track.findUniqueOrThrow({ where: { id: first } })).excluded).toBe(false);
    await expect(recordAnswer(await load(id), { kind: "tier", itemId: first, tier: 3 })).rejects.toThrow(
      "INVALID_TIER",
    );
    await playOut(id);
    t = await load(id);
    step = nextComparison(t);
    expect(step.isComplete).toBe(true);
    await finalize(t, 2);
    const done = await load(id);
    // c00, c01 are in S (6 items / 3 tiers) and get strict places
    expect(done.rankings.map((r) => done.tracks.find((tr) => tr.id === r.trackId)!.title)).toEqual(["c00", "c01"]);
    // moving someone out of the ordered tier reopens the finished segment
    const c00 = done.tracks.find((tr) => tr.title === "c00")!.id;
    expect((await setTier(done, c00, 2)).reopened).toBe(true);
    expect((await load(id)).status).toBe("in_progress");
  });
});

describe("composition", () => {
  it("excluding in a finished segment closes up places; returning inserts back", async () => {
    const id = await make(5, "insertion");
    await playOut(id);
    await finalize(await load(id), 5);
    let t = await load(id);
    const byTitle = (title: string) => t.tracks.find((tr) => tr.title === title)!.id;
    // manual order: c01 first
    const manual = ["c01", "c00", "c02", "c03", "c04"].map(byTitle);
    await reorderRanking(userId, id, manual);
    await setExcluded(userId, byTitle("c02"), true);
    t = await load(id);
    expect(t.status).toBe("completed");
    expect(t.rankings.map((r) => r.trackId)).toEqual(["c01", "c00", "c03", "c04"].map(byTitle));
    expect(t.rankings.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    await setExcluded(userId, byTitle("c02"), false);
    t = await load(id);
    expect(t.status).toBe("in_progress");
    // c02 already has answers against everyone: it slots in without a screen
    expect(nextComparison(t).isComplete).toBe(true);
    await finalize(t, 5);
    t = await load(id);
    expect(t.rankings.map((r) => r.trackId)).toEqual(["c01", "c00", "c02", "c03", "c04"].map(byTitle));
  });

  it("newcomers join a finished order by insertion and keep the manual order", async () => {
    const id = await make(4, "insertion");
    await playOut(id);
    await finalize(await load(id), 4);
    let t = await load(id);
    const ids = t.rankings.map((r) => r.trackId);
    const manual = [ids[1], ids[0], ids[2], ids[3]];
    await reorderRanking(userId, id, manual);
    const { added } = await addParticipants(userId, id, {}, [image("c10", "new:1")]);
    t = await load(id);
    expect(t.status).toBe("in_progress");
    const screens = await playOut(id);
    expect(screens).toBeGreaterThan(0);
    expect(screens).toBeLessThanOrEqual(2);
    t = await load(id);
    await finalize(t, 5);
    t = await load(id);
    expect(t.rankings.map((r) => r.trackId)).toEqual([...manual, added[0]]);
  });

  it("refuses duplicates in a segment", async () => {
    const id = await make(3, "insertion");
    await expect(addParticipants(userId, id, {}, [image("x", "k0")])).rejects.toThrow("DUPLICATE_ITEM:x");
    await expect(
      addParticipants(userId, id, {}, [image("y", "dup"), image("z", "dup")]),
    ).rejects.toThrow("DUPLICATE_ITEM");
  });

  it("deleting a participant with answers asks first, then removes screens and files", async () => {
    const id = await make(4, "insertion");
    const t = await load(id);
    const q = nextComparison(t).question!;
    await recordAnswer(t, { kind: "rank", ranked: q, rest: [] });
    const victim = (await prisma.comparison.findFirstOrThrow({ where: { tournamentId: id } })).trackAId;
    const file = (await prisma.track.findUniqueOrThrow({ where: { id: victim } })).filePath;
    const preview = await deleteParticipants(userId, id, [victim]);
    expect(preview).toEqual({ requiresConfirmation: true, answersToReset: 1 });
    expect(await prisma.track.count({ where: { id: victim } })).toBe(1);
    await deleteParticipants(userId, id, [victim], true);
    expect(await prisma.track.count({ where: { id: victim } })).toBe(0);
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(0);
    expect(existsSync(absPath(file))).toBe(false);
    expect(t.tracks).toHaveLength(4);
  });

  it("an image participant is its own cover", async () => {
    const id = await make(2, "insertion");
    const t = await load(id);
    for (const tr of t.tracks) {
      expect(tr.kind).toBe("image");
      expect(tr.coverPath).toBe(tr.filePath);
      expect(tr.subtitle).toMatch(/anime$/);
      expect(tr.sizeBytes).toBe(PNG.length);
    }
  });
});

describe("newcomers after review (task 33 QG)", () => {
  it("reopening keeps the top size, the plan does not grow with answers, undo stops at the reopen", async () => {
    const id = await make(20, "insertion");
    await playOut(id);
    await finalize(await load(id), 15);
    await addParticipants(userId, id, {}, ["c20", "c21", "c22", "c23"].map((n) => image(n, `new:${n}`)));
    let t = await load(id);
    expect(t.status).toBe("in_progress");
    expect(t.topSize).toBe(15);
    await expect(undoLastAnswer(t)).rejects.toThrow("UNDO_BEFORE_REOPEN");

    const estimates: number[] = [];
    let answered = 0;
    for (;;) {
      t = await load(id);
      const step = nextComparison(t);
      if (!step.question) break;
      estimates.push(step.screens.estimatedTotal);
      if (answered === 1) {
        // this run's own answer can be taken back, the finished run's cannot
        expect((await undoLastAnswer(t)).removed).toBeGreaterThan(0);
        t = await load(id);
        const again = nextComparison(t);
        await recordAnswer(t, { kind: "rank", ranked: [...again.question!].sort((a, b) => value(t, a) - value(t, b)), rest: [] });
        answered++;
        continue;
      }
      await recordAnswer(t, { kind: "rank", ranked: [...step.question].sort((a, b) => value(t, a) - value(t, b)), rest: [] });
      answered++;
    }
    expect(estimates.length).toBeGreaterThan(2);
    expect(Math.max(...estimates)).toBe(estimates[0]);
    await finalize(t, t.topSize ?? 10);
    t = await load(id);
    expect(t.topSize).toBe(15);
    expect(t.rankings.slice(-4).map((r) => t.tracks.find((tr) => tr.id === r.trackId)!.title)).toEqual(["c20", "c21", "c22", "c23"]);
  });

  it("a top-K that lost a place to exclusion replays instead of handing the newcomer the K-th place", async () => {
    const id = await make(12);
    await setSegmentScheme(userId, id, { scheme: "top_k", settings: { k: 5 } });
    await playOut(id);
    await finalize(await load(id), 5);
    let t = await load(id);
    const byTitle = (title: string) => t.tracks.find((tr) => tr.title === title)!.id;
    await setExcluded(userId, byTitle("c02"), true);
    await addParticipants(userId, id, {}, [image("c99", "new:worst")]);
    const segment = await prisma.tournamentSegment.findFirstOrThrow({ where: { tournamentId: id } });
    expect([segment.status, segment.insertBase]).toEqual(["in_progress", null]);
    await playOut(id);
    await finalize(await load(id), 5);
    t = await load(id);
    expect(t.rankings.map((r) => t.tracks.find((tr) => tr.id === r.trackId)!.title)).toEqual(["c00", "c01", "c03", "c04", "c05"]);
  });

  it("moving an already excluded participant to 'не участвует' records nothing", async () => {
    const id = await make(4, "tiers");
    const t = await load(id);
    const target = t.tracks[1].id;
    await setExcluded(userId, target, true);
    const before = await prisma.comparisonBatch.count({ where: { tournamentId: id } });
    await setTier(await load(id), target, -1);
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(before);
  });
});
