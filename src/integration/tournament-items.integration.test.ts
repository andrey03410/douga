import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createArt } from "@/server/arts";
import { createTournament } from "@/server/tournaments";
import { addParticipants, resolveItemSources } from "@/server/tournament-items";
import type { ExtractedTrack } from "@/lib/upload";

// Task 33, plan task 4: participants from Shikimori (in pages, with a fallback
// poster and per-item skips), the pool and the disk; duplicates refused per
// segment. Shikimori is a LOCAL http server (SHIKIMORI_BASE_URL), no network.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FRESH = Buffer.concat([PNG, Buffer.alloc(300, 1)]);

/** Characters the fake GraphQL knows: poster "fresh" | null; legacy poster served or not. */
const CHARACTERS: Record<number, { name: string; russian: string; poster: boolean; legacy: boolean }> = {
  1: { name: "Beatrice", russian: "Беатриче", poster: true, legacy: true },
  2: { name: "Ange Ushiromiya", russian: "Анже Уширомия", poster: false, legacy: true },
  3: { name: "Faceless", russian: "", poster: false, legacy: false },
};
const ANIMES: Record<number, { name: string; russian: string; year: number; studios: string[] }> = {
  4181: { name: "Umineko", russian: "Когда плачут чайки", year: 2009, studios: ["Studio Deen"] },
};
let graphqlDown = false;
let graphqlQueries: string[] = [];

let server: Server;
let userId = "";
let otherId = "";
let mediaDir = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/graphql") {
      const chunks: string[] = [];
      req.on("data", (c) => chunks.push(String(c)));
      req.on("end", () => {
        if (graphqlDown) {
          res.statusCode = 500;
          return res.end("down");
        }
        const query = JSON.parse(chunks.join("")).query as string;
        graphqlQueries.push(query);
        const ids = (/ids: "([\d,]*)"/.exec(query)?.[1] ?? "").split(",").filter(Boolean).map(Number);
        if (query.includes("characters(")) {
          return json({
            data: {
              characters: ids
                .filter((id) => CHARACTERS[id])
                .map((id) => ({
                  id: String(id),
                  name: CHARACTERS[id].name,
                  russian: CHARACTERS[id].russian,
                  url: `${host}/characters/${id}`,
                  poster: CHARACTERS[id].poster
                    ? { originalUrl: `${host}/uploads/poster/characters/${id}/fresh.jpeg` }
                    : null,
                })),
            },
          });
        }
        return json({
          data: {
            animes: ids
              .filter((id) => ANIMES[id])
              .map((id) => ({
                id: String(id),
                name: ANIMES[id].name,
                russian: ANIMES[id].russian,
                url: `${host}/animes/${id}`,
                poster: { originalUrl: `${host}/uploads/poster/animes/${id}/a.jpeg` },
                kind: "tv",
                airedOn: { year: ANIMES[id].year },
                studios: ANIMES[id].studios.map((name) => ({ name })),
              })),
          },
        });
      });
      return;
    }
    const legacy = /^\/system\/characters\/original\/(\d+)\.jpg$/.exec(url.pathname);
    if (legacy) {
      if (!CHARACTERS[Number(legacy[1])]?.legacy) {
        res.statusCode = 404;
        return res.end("no");
      }
      res.setHeader("content-type", "image/jpeg");
      return res.end(PNG);
    }
    if (url.pathname.startsWith("/uploads/poster/")) {
      res.setHeader("content-type", "image/jpeg");
      return res.end(FRESH);
    }
    const character = /^\/api\/characters\/(\d+)$/.exec(url.pathname);
    if (character && CHARACTERS[Number(character[1])]) {
      const id = Number(character[1]);
      return json({
        id,
        name: CHARACTERS[id].name,
        russian: CHARACTERS[id].russian || null,
        image: { original: `/system/characters/original/${id}.jpg` },
        animes: [{ id: 4181, name: "Umineko", russian: "Когда плачут чайки", kind: "tv", aired_on: "2009-07-02" }],
      });
    }
    res.statusCode = 404;
    res.end("no");
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SHIKIMORI_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  userId = (
    await prisma.user.create({ data: { email: `items-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })
  ).id;
  otherId = (
    await prisma.user.create({ data: { email: `items-other-${randomUUID()}@test.local`, passwordHash: "x" } })
  ).id;
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "items-media-"));
  await writeFile(path.join(mediaDir, "Rika.png"), PNG);
  process.env.MCP_LOCAL_MEDIA_DIRS = mediaDir;
});

async function clear() {
  for (const t of await prisma.tournament.findMany({ where: { userId: { in: [userId, otherId] } } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.tournament.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  for (const a of await prisma.art.findMany({ where: { userId: { in: [userId, otherId] } } }))
    await removePath(a.filePath);
  await prisma.art.deleteMany({ where: { userId: { in: [userId, otherId] } } });
}
beforeEach(async () => {
  graphqlDown = false;
  graphqlQueries = [];
  await clear();
});
afterAll(async () => {
  await clear();
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await rm(mediaDir, { recursive: true, force: true });
  delete process.env.MCP_LOCAL_MEDIA_DIRS;
  await new Promise<void>((r) => server.close(() => r()));
});

const shiki = (type: "character" | "anime", id: number, extra: Record<string, string> = {}) => ({
  shikimori: { type, id },
  ...extra,
});

describe("Shikimori participants", () => {
  it("fetch in one page with names, links, subtitles and the fresh or legacy poster", async () => {
    const { tracks, skipped } = await resolveItemSources(
      userId,
      [shiki("character", 1, { note: "главная героиня" }), shiki("character", 2), shiki("anime", 4181)],
      Infinity,
    );
    expect(skipped).toEqual([]);
    const [beatrice, ange, anime] = tracks as ExtractedTrack[];
    expect(beatrice).toMatchObject({
      kind: "image",
      title: "Беатриче",
      subtitle: "Когда плачут чайки",
      note: "главная героиня",
      sourceKey: "shikimori:character:1",
    });
    expect(beatrice.sourceUrl).toMatch(/\/characters\/1$/);
    expect(beatrice.data.equals(FRESH)).toBe(true);
    // no poster in GraphQL: the legacy original is used
    expect(ange.data.equals(PNG)).toBe(true);
    expect(anime).toMatchObject({ title: "Когда плачут чайки", subtitle: "2009 · Studio Deen" });
    // characters and anime: one GraphQL page each, with an explicit limit
    expect(graphqlQueries).toHaveLength(2);
    expect(graphqlQueries.every((q) => /limit: \d+/.test(q))).toBe(true);
  });

  it("skips what cannot be fetched and keeps the rest", async () => {
    const { tracks, skipped } = await resolveItemSources(
      userId,
      [shiki("character", 1), shiki("character", 3), shiki("character", 999)],
      Infinity,
    );
    expect(tracks.map((t) => t?.title ?? null)).toEqual(["Беатриче", null, null]);
    expect(skipped).toEqual([
      { index: 1, type: "character", id: 3, reason: "NO_IMAGE" },
      { index: 2, type: "character", id: 999, reason: "NOT_FOUND" },
    ]);
  });

  it("an unavailable Shikimori skips its participants, not the disk and the pool", async () => {
    graphqlDown = true;
    const art = await createArt(userId, { fileName: "Mion.png", data: PNG, label: "Мион" });
    const { tracks, skipped } = await resolveItemSources(
      userId,
      [{ path: path.join(mediaDir, "Rika.png") }, { assetId: art.id }, shiki("character", 1)],
      Infinity,
    );
    expect(tracks.map((t) => t?.title ?? null)).toEqual(["Rika", "Мион", null]);
    expect(tracks[1]?.sourceKey).toBe(`art:${art.id}`);
    expect(skipped).toEqual([{ index: 2, type: "character", id: 1, reason: "SHIKIMORI_UNAVAILABLE" }]);
  }, 60_000);
});

describe("pool, disk and duplicates", () => {
  it("refuses someone else's pool item and a path outside the allowlist", async () => {
    const foreign = await createArt(otherId, { fileName: "x.png", data: PNG });
    await expect(resolveItemSources(userId, [{ assetId: foreign.id }], Infinity)).rejects.toThrow("NOT_FOUND");
    await expect(resolveItemSources(userId, [{ path: "/etc/hosts" }], Infinity)).rejects.toThrow();
  });

  it("counts pictures against the quota", async () => {
    await expect(
      resolveItemSources(userId, [{ path: path.join(mediaDir, "Rika.png") }], PNG.length - 1),
    ).rejects.toThrow("ARCHIVE_QUOTA");
  });

  it("refuses the same participant twice in a segment, allows it in another", async () => {
    const { tracks } = await resolveItemSources(userId, [shiki("character", 1), shiki("character", 2)], Infinity);
    const ready = tracks as ExtractedTrack[];
    await expect(
      createTournament(userId, { title: "Dup", blindMode: false }, [ready[0], ready[0]]),
    ).rejects.toThrow("DUPLICATE_ITEM:Беатриче");
    const t = await createTournament(
      userId,
      {
        title: "Umineko",
        blindMode: false,
        segments: [
          { title: "Ep 1", trackIndexes: [0, 1] },
          { title: "Ep 2", trackIndexes: [2] },
        ],
      },
      [ready[0], ready[1], ready[0]],
    );
    const segments = await prisma.tournamentSegment.findMany({ where: { tournamentId: t.id }, orderBy: { order: "asc" } });
    await expect(
      addParticipants(userId, t.id, { segmentId: segments[0].id }, [ready[1]]),
    ).rejects.toThrow("DUPLICATE_ITEM:Анже Уширомия");
    await addParticipants(userId, t.id, { segmentId: segments[1].id }, [ready[1]]);
    expect(await prisma.track.count({ where: { segmentId: segments[1].id } })).toBe(2);
  });
});
