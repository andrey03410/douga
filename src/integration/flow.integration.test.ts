import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createEngine } from "@/lib/domain/engines";
import { toDomainComparisonsRaw } from "./helpers";
import { assemblePlanItems, type AssembleItem } from "@/lib/render-assemble";
import { buildVideoPlan } from "@/lib/domain/video-plan";

// Integration test: drives the real Prisma schema (SQLite) through a full Phase 1
// tournament and a Phase 2 render-config assembly. Uses an isolated connection to
// the dev database and cleans up after itself. Pure ffmpeg/Remotion steps are not
// exercised here (covered by domain unit tests).

// vitest.config sets DATABASE_URL (TEST_DATABASE_URL or prisma/dev.db): same DB as the services.
const DB_URL = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
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

describe("Phase 1 + Phase 2 integration", () => {
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

    // Phase 2: create a render config for top-N and assemble a video plan
    const top = reloaded!.rankings.filter((r) => r.rank <= topSize);
    const config = await prisma.renderConfig.create({
      data: {
        tournamentId: tournament.id,
        introText: "Test Top",
        items: {
          create: top.map((r) => ({
            trackId: r.trackId,
            rank: r.rank,
            clipMode: "active_snippet",
            snippetLenSec: 30,
          })),
        },
      },
      include: { items: { include: { track: true }, orderBy: { rank: "asc" } } },
    });

    const assembleItems: AssembleItem[] = config.items.map((it) => ({
      trackId: it.trackId!,
      rank: it.rank,
      title: it.track!.title,
      artist: it.track!.artist,
      customLabel: it.customLabel,
      clipMode: it.clipMode as "manual" | "active_snippet",
      clipStartSec: it.clipStartSec,
      clipEndSec: it.clipEndSec,
      snippetLenSec: it.snippetLenSec,
      durationSec: it.track!.durationSec,
      visual: null,
      audioRef: `/api/tracks/${it.trackId}/audio`,
    }));
    const plan = buildVideoPlan(
      { order: "desc", introEnabled: true, introText: "Test Top", outroEnabled: true, outroText: null },
      assemblePlanItems(assembleItems, { defaultClipSec: 30 }),
    );

    expect(plan.segments).toHaveLength(3);
    // desc order -> worst-of-top (#3) first, #1 last
    expect(plan.segments.map((s) => s.rank)).toEqual([3, 2, 1]);
    expect(plan.segments[2].label).toBe("1 - A");
    expect(plan.durationInFrames).toBeGreaterThan(0);
  });
});
