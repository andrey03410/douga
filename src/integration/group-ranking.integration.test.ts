import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  effectiveGroupSize,
  extendPlan,
  finalize,
  getTournament,
  nextComparison,
  recordGroupAnswer,
  setGroupSize,
  undoLastAnswer,
} from "@/server/tournaments";
import { pairKey } from "@/lib/domain/comparisons";

// Phase 18 group ranking against the real schema: a screen is a batch of rows,
// undo removes the whole screen, and the group size may change mid-run.

// vitest.config sets DATABASE_URL (TEST_DATABASE_URL or prisma/dev.db): same DB as the services.
const DB_URL = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const EMAIL = "integration-groups@test.local";

let userId = "";

/** Hidden ground truth: track title "t03" ranks third-best. */
const rankOf = (title: string) => Number(title.slice(1));

async function makeTournament(
  scheme: "merge" | "swiss" | "round_robin",
  trackCount: number,
  groupSize: number,
) {
  const t = await prisma.tournament.create({
    data: { userId, title: `G ${scheme} ${trackCount}`, scheme, status: "in_progress", groupSize },
  });
  for (let i = 0; i < trackCount; i++) {
    await prisma.track.create({
      data: {
        tournamentId: t.id,
        title: `t${String(i).padStart(2, "0")}`,
        filePath: `fake/${i}.mp3`,
        order: i,
      },
    });
  }
  return t.id;
}

/** Answer every screen truthfully until the engine runs out. */
async function playOut(id: string, opts: { switchTo?: number; after?: number } = {}) {
  const byId = new Map(
    (await prisma.track.findMany({ where: { tournamentId: id } })).map((tr) => [tr.id, tr.title]),
  );
  let screens = 0;
  while (screens < 5000) {
    if (opts.switchTo && screens === (opts.after ?? 0)) {
      await setGroupSize(userId, id, opts.switchTo);
    }
    const t = (await getTournament(userId, id))!;
    const step = nextComparison(t);
    if (!step.question) break;
    const ranked = [...step.question].sort(
      (a, b) => rankOf(byId.get(a)!) - rankOf(byId.get(b)!),
    );
    await recordGroupAnswer(t, ranked, []);
    screens++;
  }
  return screens;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  userId = user.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.tournament.deleteMany({ where: { userId } });
});

describe("recording a group answer", () => {
  it("writes one batch per screen with every pair of the group", async () => {
    const id = await makeTournament("swiss", 6, 3);
    const t = (await getTournament(userId, id))!;
    const step = nextComparison(t);
    expect(step.question).toHaveLength(3);

    await recordGroupAnswer(t, step.question!, []);

    const batches = await prisma.comparisonBatch.findMany({ where: { tournamentId: id } });
    expect(batches).toHaveLength(1);
    expect(batches[0].size).toBe(3);
    expect(JSON.parse(batches[0].itemIds)).toEqual(step.question);

    const rows = await prisma.comparison.findMany({ where: { tournamentId: id } });
    expect(rows).toHaveLength(3); // C(3,2)
    expect(rows.every((r) => r.batchId === batches[0].id)).toBe(true);
    expect(rows.every((r) => r.result === "a")).toBe(true);
  });

  it("writes draws for the tail the user refused to separate", async () => {
    const id = await makeTournament("swiss", 6, 4);
    const t = (await getTournament(userId, id))!;
    const q = nextComparison(t).question!;
    await recordGroupAnswer(t, q.slice(0, 2), q.slice(2));

    const rows = await prisma.comparison.findMany({ where: { tournamentId: id } });
    expect(rows).toHaveLength(6); // C(4,2), nothing lost
    expect(rows.filter((r) => r.result === "draw")).toHaveLength(1); // the two-track tail
    expect(rows.filter((r) => r.result === "a")).toHaveLength(5);
  });

  it("refuses an answer to a group the engine is not asking", async () => {
    const id = await makeTournament("swiss", 6, 3);
    const t = (await getTournament(userId, id))!;
    const others = t.tracks.slice(3).map((tr) => tr.id);
    await expect(recordGroupAnswer(t, others, [])).rejects.toThrow("GROUP_MISMATCH");
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(0);
  });

  it("refuses an answer that drops a track from the group", async () => {
    const id = await makeTournament("swiss", 6, 3);
    const t = (await getTournament(userId, id))!;
    const q = nextComparison(t).question!;
    await expect(recordGroupAnswer(t, q.slice(0, 2), [])).rejects.toThrow("GROUP_MISMATCH");
  });

  it("refuses to answer a tournament that has nothing left to ask", async () => {
    const id = await makeTournament("swiss", 4, 4);
    await playOut(id);
    const t = (await getTournament(userId, id))!;
    await expect(recordGroupAnswer(t, t.tracks.map((tr) => tr.id), [])).rejects.toThrow(
      "NOTHING_TO_ANSWER",
    );
  });
});

describe("a full grouped run", () => {
  it.each([
    ["swiss", 3],
    ["swiss", 5],
    ["round_robin", 3],
    ["round_robin", 4],
  ] as const)("%s with groups of %i terminates without duplicate pairs", async (scheme, k) => {
    const id = await makeTournament(scheme, 8, k);
    const screens = await playOut(id);

    const rows = await prisma.comparison.findMany({ where: { tournamentId: id } });
    const keys = rows.map((r) => pairKey(r.trackAId, r.trackBId));
    expect(new Set(keys).size).toBe(keys.length);
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(screens);

    const t = (await getTournament(userId, id))!;
    const step = nextComparison(t);
    expect(step.isComplete).toBe(true);
    expect(step.coverage.contradictory).toBe(0);
    expect(step.screens.completed).toBe(screens);
    expect(step.screens.completed).toBeLessThanOrEqual(step.screens.estimatedTotal);
  });

  it("survives the group size changing halfway through", async () => {
    const id = await makeTournament("swiss", 12, 5);
    await playOut(id, { switchTo: 2, after: 1 });

    const t = (await getTournament(userId, id))!;
    expect(nextComparison(t).isComplete).toBe(true);
    const sizes = t.batches.map((b) => b.size);
    expect(sizes[0]).toBe(5); // asked before the switch
    expect(sizes.slice(1).every((s) => s === 2)).toBe(true); // and after it
    expect(sizes.length).toBeGreaterThan(2);
    const rows = await prisma.comparison.findMany({ where: { tournamentId: id } });
    const keys = rows.map((r) => pairKey(r.trackAId, r.trackBId));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never numbers the current screen past its own estimate", async () => {
    // Growing the group shrinks the plan, so a run switched from pairs to fives
    // can already be past the new estimate.
    const id = await makeTournament("swiss", 9, 2);
    for (let screen = 0; screen < 4; screen++) {
      const t = (await getTournament(userId, id))!;
      const q = nextComparison(t).question!;
      await recordGroupAnswer(t, q, []);
    }
    await setGroupSize(userId, id, 5);

    const t = (await getTournament(userId, id))!;
    const step = nextComparison(t);
    expect(step.question).not.toBeNull();
    expect(step.screens.completed).toBe(4);
    expect(step.screens.completed + 1).toBeLessThanOrEqual(step.screens.estimatedTotal);
  });

  it("reports contradictions instead of quietly ordering them", async () => {
    // A user who answers inconsistently must see it, not get a confident top.
    const id = await makeTournament("round_robin", 3, 3);
    const t = (await getTournament(userId, id))!;
    const [a, b, c] = nextComparison(t).question!;
    await recordGroupAnswer(t, [a, b, c], []);

    // undo the screen and answer the cycle by hand: a>b, b>c, c>a
    await undoLastAnswer((await getTournament(userId, id))!);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      await prisma.comparison.create({
        data: { tournamentId: id, trackAId: x, trackBId: y, result: "a" },
      });
    }
    const cov = nextComparison((await getTournament(userId, id))!).coverage;
    expect(cov.contradictory).toBe(3);
    expect(cov.ordered).toBe(0);
    expect(cov.orderedPct).toBe(0);
  });

  it("reaches a full strict ranking that can be finalized", async () => {
    const id = await makeTournament("round_robin", 6, 3);
    await playOut(id);
    const t = (await getTournament(userId, id))!;
    await finalize(t, 3);

    const rankings = await prisma.ranking.findMany({
      where: { tournamentId: id },
      orderBy: { rank: "asc" },
    });
    const byId = new Map(t.tracks.map((tr) => [tr.id, tr.title]));
    expect(rankings.map((r) => byId.get(r.trackId))).toEqual([
      "t00", "t01", "t02", "t03", "t04", "t05",
    ]);
  });
});

describe("undo", () => {
  it("removes the whole screen, not one pair of it", async () => {
    const id = await makeTournament("swiss", 8, 4);
    const t = (await getTournament(userId, id))!;
    const q = nextComparison(t).question!;
    expect(q).toHaveLength(4);
    await recordGroupAnswer(t, q, []);
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(6); // C(4,2)

    const loaded = (await getTournament(userId, id))!;
    const { removed } = await undoLastAnswer(loaded);
    expect(removed).toBe(6);
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(0);
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(0);
  });

  it("removes the newest screen when several are stacked up", async () => {
    const id = await makeTournament("swiss", 8, 3);
    await playOut(id);
    const before = (await getTournament(userId, id))!;
    const last = before.batches.at(-1)!;
    const inLast = before.comparisons.filter((c) => c.batchId === last.id).length;

    const { removed } = await undoLastAnswer(before);
    expect(removed).toBe(inLast);
    expect(await prisma.comparisonBatch.findUnique({ where: { id: last.id } })).toBeNull();
    expect(await prisma.comparisonBatch.count({ where: { tournamentId: id } })).toBe(
      before.batches.length - 1,
    );
  });

  it("lets the undone screen be asked again", async () => {
    const id = await makeTournament("swiss", 6, 3);
    const first = (await getTournament(userId, id))!;
    const q1 = nextComparison(first).question!;
    await recordGroupAnswer(first, q1, []);

    const second = (await getTournament(userId, id))!;
    await undoLastAnswer(second);

    const third = (await getTournament(userId, id))!;
    expect(nextComparison(third).question).toEqual(q1);
  });

  it("also undoes a pre-phase-18 comparison that has no batch", async () => {
    const id = await makeTournament("swiss", 4, 2);
    const t = (await getTournament(userId, id))!;
    await prisma.comparison.create({
      data: {
        tournamentId: id,
        trackAId: t.tracks[0].id,
        trackBId: t.tracks[1].id,
        result: "a",
      },
    });
    const loaded = (await getTournament(userId, id))!;
    expect((await undoLastAnswer(loaded)).removed).toBe(1);
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(0);
  });

  it("refuses when there is nothing to undo", async () => {
    const id = await makeTournament("swiss", 4, 2);
    const t = (await getTournament(userId, id))!;
    await expect(undoLastAnswer(t)).rejects.toThrow("NOTHING_TO_UNDO");
  });

  it("refuses on a finalized tournament", async () => {
    const id = await makeTournament("round_robin", 4, 3);
    await playOut(id);
    await finalize((await getTournament(userId, id))!, 2);
    const done = (await getTournament(userId, id))!;
    await expect(undoLastAnswer(done)).rejects.toThrow("ALREADY_FINALIZED");
  });
});

describe("group size setting", () => {
  it("clamps to the field and to the global cap", async () => {
    const small = await makeTournament("swiss", 3, 2);
    expect(await setGroupSize(userId, small, 7)).toBe(3);
    const big = await makeTournament("swiss", 40, 2);
    expect(await setGroupSize(userId, big, 99)).toBe(7);
    expect(await setGroupSize(userId, big, 1)).toBe(2);
  });

  it("holds merge to pairs whatever the user asks for", async () => {
    const id = await makeTournament("merge", 8, 2);
    expect(await setGroupSize(userId, id, 5)).toBe(2);
    const t = (await getTournament(userId, id))!;
    expect(effectiveGroupSize(t)).toBe(2);
    expect(nextComparison(t).question).toHaveLength(2);
    expect(nextComparison(t).maxGroupSize).toBe(2);
  });

  it("does not touch another user's tournament", async () => {
    const other = await prisma.user.create({
      data: { email: `other-${EMAIL}`, passwordHash: "x" },
    });
    const id = await makeTournament("swiss", 6, 2);
    await expect(setGroupSize(other.id, id, 5)).rejects.toThrow("NOT_FOUND");
    await prisma.user.delete({ where: { id: other.id } });
  });
});

describe("one more round", () => {
  it("gives the engine something to ask after the plan is done", async () => {
    const id = await makeTournament("swiss", 8, 3);
    await playOut(id);
    const done = (await getTournament(userId, id))!;
    const step = nextComparison(done);
    expect(step.isComplete).toBe(true);
    expect(step.canExtend).toBe(true);

    expect(await extendPlan(done)).toBe(2); // groupSize - 1
    const extended = (await getTournament(userId, id))!;
    expect(nextComparison(extended).question).not.toBeNull();
  });

  it("lifts the determinacy it advertises", async () => {
    const id = await makeTournament("swiss", 9, 3);
    await playOut(id);
    const before = nextComparison((await getTournament(userId, id))!).coverage.orderedPct;
    for (let round = 0; round < 3; round++) {
      const t = (await getTournament(userId, id))!;
      if (!nextComparison(t).canExtend) break;
      await extendPlan(t);
      await playOut(id);
    }
    const after = nextComparison((await getTournament(userId, id))!).coverage.orderedPct;
    expect(after).toBeGreaterThan(before);
  });

  it("refuses once every pair has been compared", async () => {
    const id = await makeTournament("swiss", 4, 2);
    // drive it all the way to a full round robin
    for (let round = 0; round < 10; round++) {
      await playOut(id);
      const t = (await getTournament(userId, id))!;
      if (!nextComparison(t).canExtend) break;
      await extendPlan(t);
    }
    const t = (await getTournament(userId, id))!;
    expect(nextComparison(t).canExtend).toBe(false);
    await expect(extendPlan(t)).rejects.toThrow("NOTHING_MORE_TO_ASK");
    expect(await prisma.comparison.count({ where: { tournamentId: id } })).toBe(6);
  });
});

describe("finished tournaments", () => {
  it("stays closed and keeps accepting a new top size", async () => {
    const id = await makeTournament("round_robin", 5, 3);
    await playOut(id);
    await finalize((await getTournament(userId, id))!, 3);

    const done = (await getTournament(userId, id))!;
    const step = nextComparison(done);
    expect(step.question).toBeNull();
    expect(step.canExtend).toBe(false);

    // top-N must still be adjustable afterwards
    const changed = await finalize(done, 2);
    expect(changed.topSize).toBe(2);
  });

  it("can be finalized even when the newer completion rule disagrees", async () => {
    // A pre-phase-18 Swiss run: byes left some tracks one opponent short, so the
    // opponents-per-track rule would call it unfinished.
    const id = await makeTournament("swiss", 5, 2);
    const t = (await getTournament(userId, id))!;
    await prisma.comparison.create({
      data: {
        tournamentId: id,
        trackAId: t.tracks[0].id,
        trackBId: t.tracks[1].id,
        result: "a",
      },
    });
    await prisma.tournament.update({ where: { id }, data: { status: "completed" } });

    const stale = (await getTournament(userId, id))!;
    await expect(finalize(stale, 3)).resolves.toEqual({ topSize: 3 });
  });
});
