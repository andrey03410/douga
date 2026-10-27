import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readdir } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { MAX_TILES } from "@/lib/domain/picker-layout";
import { createProject, getProject } from "@/server/projects";
import { addTileFromShikimori } from "@/mcp/compose";

const EMAIL = "integration-mcp-compose@test.local";
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////" +
    "////////////////////////////////////////////////////wgARCAABAAEDASIAAhEBAxEB" +
    "/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAB" +
    "//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oA" +
    "CAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAA" +
    "AAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgAD" +
    "AAAAEB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAA" +
    "AA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64",
);

let userId: string;
let server: Server;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname.startsWith("/system/")) {
      res.setHeader("content-type", "image/jpeg");
      res.end(JPG);
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.SHIKIMORI_BASE_URL = `http://127.0.0.1:${port}`;
  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
  userId = user.id;
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("addTileFromShikimori", () => {
  it("imports a poster and places it as an answer tile", async () => {
    const project = await createProject(userId, "Персонажи Madhouse", "picker");
    const loaded = await getProject(userId, project.id);
    const roundId = loaded!.rounds[0].id;

    const { tileId, artId } = await addTileFromShikimori(userId, {
      roundId, type: "character", id: 17,
      posterPath: "/system/characters/original/17.jpg",
      label: "Лайт", isAnswer: true, maxPoolBytes: null,
    });
    expect(tileId).toMatch(/.+/);

    const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
    expect(art.kind).toBe("image");
    const tile = await prisma.pickerTile.findUniqueOrThrow({ where: { id: tileId } });
    expect(tile.label).toBe("Лайт");
    expect(tile.isAnswer).toBe(true);
    expect(tile.artId).toBe(artId);
  });

  // T12: the poster is imported before the tile is placed. When placing fails,
  // the fresh art must not stay in the pool eating the quota.
  async function poolSnapshot() {
    const rows = await prisma.art.findMany({ where: { userId }, select: { id: true } });
    const files = await readdir(absPath(`arts/${userId}`)).catch(() => [] as string[]);
    return { ids: rows.map((r) => r.id).sort(), files: [...files].sort() };
  }

  it("rolls the imported poster back when the round is full", async () => {
    const project = await createProject(userId, "Полный раунд", "picker");
    const loaded = await getProject(userId, project.id);
    const roundId = loaded!.rounds[0].id;
    const filler = await prisma.art.create({
      data: { userId, filePath: "fake/filler.jpg", label: "filler", kind: "image", sizeBytes: 1 },
    });
    await prisma.pickerTile.createMany({
      data: Array.from({ length: MAX_TILES }, (_, order) => ({ roundId, artId: filler.id, order })),
    });
    const before = await poolSnapshot();

    await expect(
      addTileFromShikimori(userId, {
        roundId, type: "anime", id: 21,
        posterPath: "/system/animes/original/21.jpg",
        label: "Лишний", maxPoolBytes: null,
      }),
    ).rejects.toThrow("TOO_MANY_TILES");

    expect(await poolSnapshot()).toEqual(before);
    expect(await prisma.pickerTile.count({ where: { roundId } })).toBe(MAX_TILES);
  });

  it("rolls the imported poster back when the block does not exist", async () => {
    const before = await poolSnapshot();
    await expect(
      addTileFromShikimori(userId, {
        groupId: "no-such-group", type: "character", id: 17,
        posterPath: "/system/characters/original/17.jpg",
        label: null, maxPoolBytes: null,
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(await poolSnapshot()).toEqual(before);
  });
});
