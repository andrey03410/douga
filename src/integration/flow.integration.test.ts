import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { createPrismaClient } from "@/lib/db";
import { legacyEngine as createEngine } from "@/test/engine-legacy";
import { toDomainComparisonsRaw } from "./helpers";
// Integration test: drives the real Prisma schema (SQLite) through a full
// tournament. Uses an isolated connection to the dev database and cleans up
// after itself.

// vitest.config sets DATABASE_URL (TEST_DATABASE_URL or prisma/dev.db): same DB as the services.
const DB_URL = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const prisma = createPrismaClient(DB_URL);
const TEST_EMAIL = "integration-flow@test.local";

// hidden ground-truth order keyed by title (lower = better)
const VALUE: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

describe("tournament integration", () => {
  it("runs a tournament to completion and persists a ranking + render config", async () => {
    const user = await prisma.user.create({
      data: { email: TEST_EMAIL, passwordHash: "x" },
    });

    const tournament = await prisma.tournament.create({
      data: { userId: user.id, title: "Test Top", scheme: "merge", status: "in_progress" },
    });

    const titles = ["A", "B", "C", "D", "E"];
    const tracks = [];
    for (let i = 0; i < titles.length; i++) {
      tracks.push(
        await prisma.track.create({
          data: {
            tournamentId: tournament.id,
            title: titles[i],
            filePath: `fake/${titles[i]}.mp3`,
            order: i,
          },
        }),
      );
    }
    const idToTitle = new Map(tracks.map((t) => [t.id, t.title]));
    const items = tracks.map((t) => t.id);
    const engine = createEngine("merge");

    // comparison loop, persisting each decision like the real service does
    let guard = 0;
    while (true) {
      if (guard++ > 1000) throw new Error("did not terminate");
      const rows = await prisma.comparison.findMany({
        where: { tournamentId: tournament.id },
        orderBy: { createdAt: "asc" },
      });
      const pair = engine.nextPair(items, toDomainComparisonsRaw(rows));
      if (!pair) break;
      const va = VALUE[idToTitle.get(pair.a)!];
      const vb = VALUE[idToTitle.get(pair.b)!];
      const result = va === vb ? "draw" : va < vb ? "a" : "b";
      await prisma.comparison.create({
        data: { tournamentId: tournament.id, trackAId: pair.a, trackBId: pair.b, result },
      });
    }

    const finalRows = await prisma.comparison.findMany({
      where: { tournamentId: tournament.id },
    });
    expect(engine.isComplete(items, toDomainComparisonsRaw(finalRows))).toBe(true);

    const ranking = engine.ranking(items, toDomainComparisonsRaw(finalRows));
    const orderedTitles = ranking.map((r) => idToTitle.get(r.id));
    expect(orderedTitles).toEqual(["A", "B", "C", "D", "E"]);

    // finalize: persist ranking + top-N
    const topSize = 3;
    await prisma.$transaction([
      ...ranking.map((r) =>
        prisma.ranking.create({
          data: { tournamentId: tournament.id, trackId: r.id, rank: r.rank, score: r.score },
        }),
      ),
      prisma.tournament.update({
        where: { id: tournament.id },
        data: { status: "completed", topSize },
      }),
    ]);

    const reloaded = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: { rankings: { orderBy: { rank: "asc" } } },
    });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.topSize).toBe(3);
    expect(reloaded?.rankings.map((r) => idToTitle.get(r.trackId))).toEqual([
      "A", "B", "C", "D", "E",
    ]);
  });
});
