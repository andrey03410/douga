import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
let client: Client, transport: StdioClientTransport, userId: string;
const email = `tournament-mcp-${randomUUID()}@test.local`;
let root: string, poolId: string, picturePoolId: string;
let shikimori: Server;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** Local Shikimori: characters 1 and 2 exist with a poster, 404 has no picture. */
function startShikimori() {
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (url.pathname === "/api/graphql") {
      const chunks: string[] = [];
      req.on("data", (c) => chunks.push(String(c)));
      req.on("end", () => {
        const query = JSON.parse(chunks.join("")).query as string;
        const ids = (/ids: "([\d,]*)"/.exec(query)?.[1] ?? "").split(",").filter(Boolean);
        const names: Record<string, string> = { "1": "Беатриче", "2": "Батлер", "404": "Без картинки" };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: {
              characters: ids
                .filter((id) => names[id])
                .map((id) => ({
                  id,
                  name: names[id],
                  russian: names[id],
                  url: `${host}/characters/${id}`,
                  poster: id === "404" ? null : { originalUrl: `${host}/uploads/poster/characters/${id}/p.png` },
                })),
            },
          }),
        );
      });
      return;
    }
    if (url.pathname.startsWith("/uploads/poster/")) {
      res.setHeader("content-type", "image/png");
      return res.end(PNG);
    }
    res.statusCode = 404;
    res.end("no");
  });
  return new Promise<Server>((r) => server.listen(0, () => r(server)));
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(
    (result.content as { type: string; text: string }[]).find(
      (c) => c.type === "text",
    )!.text,
  );
  if (result.isError) throw new Error(JSON.stringify(data));
  return data;
}
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email, passwordHash: "x", role: "admin" },
    })
  ).id;
  root = absPath(`verification/27-segments/mcp-${userId}`);
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/track.mp3`, "fixture");
  await writeFile(`${root}/Rika.png`, PNG);
  const pictureRel = `verification/27-segments/mcp-${userId}/pool.png`;
  await writeFile(absPath(pictureRel), PNG);
  picturePoolId = (
    await prisma.art.create({
      data: { userId, kind: "image", label: "Мион", filePath: pictureRel },
    })
  ).id;
  shikimori = await startShikimori();
  const rel = `verification/27-segments/mcp-${userId}/pool.mp3`;
  await writeFile(absPath(rel), "pool fixture");
  poolId = (
    await prisma.art.create({
      data: { userId, kind: "audio", label: "Pool track", filePath: rel },
    })
  ).id;
  client = new Client({ name: "test-tournaments", version: "1" });
  transport = new StdioClientTransport({
    command: resolve(process.cwd(), "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL!,
      MCP_ACTOR_EMAIL: email,
      MCP_LOCAL_MEDIA_DIRS: root,
      SHIKIMORI_BASE_URL: `http://127.0.0.1:${(shikimori.address() as { port: number }).port}`,
    },
  });
  await client.connect(transport);
}, 20000);
afterAll(async () => {
  await client?.close();
  await new Promise<void>((r) => (shikimori ? shikimori.close(() => r()) : r()));
  const tournaments = await prisma.tournament.findMany({ where: { userId } });
  for (const t of tournaments) await removePath(`tournaments/${t.id}`);
  await prisma.user.deleteMany({ where: { id: userId } });
  if (userId) await removePath(`verification/27-segments/mcp-${userId}`);
});
it("prepares owned segments from allowed disk files and pool without exposing human answer tools", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toContain("tournament_create");
  expect(names.filter((n) => n.startsWith("tournament_"))).toEqual(
    expect.arrayContaining([
      "tournament_list",
      "tournament_get",
      "tournament_create",
      "tournament_segments_update",
    ]),
  );
  expect(
    names.filter((n) => /tournament_.*(answer|rank|finalize|compare)/.test(n)),
  ).toEqual([]);
  const created = await call("tournament_create", {
    title: "Prepared",
    scheme: "merge",
    segments: [
      { title: "Disk", tracks: [{ path: `${root}/track.mp3` }] },
      { title: "Pool", tracks: [{ assetId: poolId }] },
    ],
  });
  const loaded = await call("tournament_get", { id: created.id });
  expect(loaded.segments).toHaveLength(2);
  expect(loaded.segments.map((s: { title: string }) => s.title)).toEqual([
    "Disk",
    "Pool",
  ]);
  expect((await readFile(`${root}/track.mp3`)).toString()).toBe("fixture");
  expect(
    (await call("tournament_list")).tournaments.some(
      (t: { id: string }) => t.id === created.id,
    ),
  ).toBe(true);
  const segments = loaded.segments.map(
    (s: { id: string; title: string; tracks: { id: string }[] }) => ({
      id: s.id,
      title: s.title + " fixed",
      trackIds: s.tracks.map((t) => t.id),
    }),
  );
  await call("tournament_segments_update", { id: created.id, segments });
  expect(
    (await call("tournament_get", { id: created.id })).segments[0].title,
  ).toBe("Disk fixed");
  await expect(
    call("tournament_create", {
      title: "Bad",
      scheme: "merge",
      segments: [{ title: "No", tracks: [{ path: "/etc/passwd" }] }],
    }),
  ).rejects.toThrow("PATH_NOT_ALLOWED");
  await expect(
    call("tournament_create", {
      title: "Bad",
      scheme: "merge",
      segments: [{ title: "No", tracks: [{ assetId: "foreign" }] }],
    }),
  ).rejects.toThrow("NOT_FOUND");
});

it("builds a picture base from Shikimori, the pool and the disk; the person chooses the algorithm", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining(["tournament_items_add", "tournament_items_update", "tournament_items_remove"]),
  );
  expect(names.filter((n) => /tournament_.*(answer|rank|finalize|compare|tier|scheme)/.test(n))).toEqual([]);
  const created = await call("tournament_create", {
    title: "Umineko",
    segments: [
      {
        title: "Все",
        items: [
          { shikimori: { type: "character", id: 1 }, note: "главная героиня" },
          { shikimori: { type: "character", id: 404 } },
          { assetId: picturePoolId },
          { path: `${root}/Rika.png`, subtitle: "Higurashi" },
        ],
      },
    ],
  });
  expect(created).toMatchObject({
    itemCount: 3,
    schemeRequired: true,
    skipped: [{ segmentIndex: 0, itemIndex: 1, type: "character", id: 404, reason: "NO_IMAGE" }],
  });
  expect(created.estimates.merge).toBeGreaterThan(0);
  expect(Object.keys(created.estimates)).toHaveLength(8);
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: created.id } });
  expect(tournament.schemePending).toBe(true);
  const tracks = await prisma.track.findMany({ where: { tournamentId: created.id }, orderBy: { order: "asc" } });
  expect(tracks.map((t) => [t.title, t.kind, t.subtitle, t.note])).toEqual([
    ["Беатриче", "image", null, "главная героиня"],
    ["Мион", "image", null, null],
    ["Rika", "image", "Higurashi", null],
  ]);

  // the same character twice in one segment is refused, by name
  await expect(
    call("tournament_items_add", { id: created.id, items: [{ shikimori: { type: "character", id: 1 } }] }),
  ).rejects.toThrow("DUPLICATE_ITEM:Беатриче");
  const added = await call("tournament_items_add", {
    id: created.id,
    items: [{ shikimori: { type: "character", id: 2 } }],
  });
  expect(added.added).toHaveLength(1);
  await expect(
    call("tournament_items_add", { id: created.id, items: [{ shikimori: { type: "character", id: 404 } }] }),
  ).rejects.toThrow("ALL_ITEMS_SKIPPED");

  await call("tournament_items_update", {
    id: created.id,
    items: [
      { trackId: tracks[1].id, subtitle: "Higurashi", note: "из пула" },
      { trackId: tracks[2].id, excluded: true },
    ],
  });
  const updated = await prisma.track.findMany({ where: { tournamentId: created.id }, orderBy: { order: "asc" } });
  expect(updated.map((t) => [t.subtitle, t.excluded])).toEqual([
    [null, false],
    ["Higurashi", false],
    ["Higurashi", true],
    [null, false],
  ]);
  await expect(
    call("tournament_items_update", { id: created.id, items: [{ trackId: "foreign", note: "x" }] }),
  ).rejects.toThrow("NOT_FOUND");

  expect(await call("tournament_items_remove", { id: created.id, trackIds: added.added })).toEqual({
    requiresConfirmation: false,
    answersToReset: 0,
  });
  expect(await prisma.track.count({ where: { tournamentId: created.id } })).toBe(3);
  // the agent never answers: no comparisons exist after all of this
  expect(await prisma.comparisonBatch.count({ where: { tournamentId: created.id } })).toBe(0);
}, 60_000);
