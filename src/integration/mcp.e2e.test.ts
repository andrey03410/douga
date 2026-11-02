import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { MCP_TOOL_NAMES } from "@/mcp/instructions";
import { removePath } from "@/lib/storage";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const EMAIL = "integration-mcp-e2e@test.local";
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

const ROOT = resolve(__dirname, "..", "..");
let userId: string;
let shiki: Server;
let client: Client;
let transport: StdioClientTransport;
// Local-disk fixture: an allowlisted "ost" folder and a sibling that is not.
let ostDir: string;
let secretsDir: string;

const FFMPEG = ffmpegPath as unknown as string;
function ffmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(FFMPEG, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    proc.on("error", rej);
    proc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}`))));
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

// Parse the JSON payload a tool returns in its text content.
async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = res.content.map((c) => c.text).join("");
  const data = JSON.parse(text);
  if (res.isError) throw new Error(`tool ${name} failed: ${text}`);
  return data;
}

// Fake Shikimori profile: two rated animes (one of them Death Note, whose
// characters the roles route below serves) plus favourites.
const PROFILE = { id: 1270120, nickname: "andrey03410", url: "https://shikimori.io/andrey03410", avatar: null };
const RATES = [
  { id: 1, score: 10, status: "completed", episodes: 37, rewatches: 0, updated_at: "2026-01-05T10:00:00+03:00",
    anime: { id: 1535, name: "Death Note", russian: "Тетрадь смерти", kind: "tv", score: "8.62", aired_on: "2006-10-04",
      image: { original: "/system/animes/original/1535.jpg", preview: "/system/animes/preview/1535.jpg" } }, manga: null },
  { id: 2, score: 5, status: "dropped", episodes: 2, rewatches: 0, updated_at: "2026-02-05T10:00:00+03:00",
    anime: { id: 20, name: "Naruto", russian: "Наруто", kind: "tv", score: "8.02", aired_on: "2002-10-03",
      image: { original: "/system/animes/original/20.jpg", preview: "/system/animes/preview/20.jpg" } }, manga: null },
];
const FAVOURITES = {
  animes: [{ id: 1535, name: "Death Note", russian: "Тетрадь смерти", image: "/system/animes/x64/1535.jpg", url: null }],
  characters: [{ id: 17, name: "Light", russian: "Лайт", image: "/system/characters/x64/17.jpg", url: null }],
  mangas: [], ranobe: [], people: [],
};

beforeAll(async () => {
  shiki = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname.startsWith("/api/users")) {
      res.setHeader("content-type", "application/json");
      if (
        (url.pathname === `/api/users/${PROFILE.nickname}` && url.searchParams.get("is_nickname") === "1") ||
        url.pathname === `/api/users/${PROFILE.id}`
      ) {
        res.end(JSON.stringify(PROFILE));
        return;
      }
      if (url.pathname === `/api/users/${PROFILE.id}/anime_rates`) {
        res.end(JSON.stringify(RATES));
        return;
      }
      if (url.pathname === `/api/users/${PROFILE.id}/favourites`) {
        res.end(JSON.stringify(FAVOURITES));
        return;
      }
      res.statusCode = 404;
      res.end("no");
      return;
    }
    if (url.pathname === "/api/studios") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: 11, name: "Madhouse", filtered_name: "Madhouse" }]));
      return;
    }
    if (url.pathname === "/api/animes" && url.searchParams.get("studio")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: 1535, name: "Death Note", russian: "Тетрадь смерти", kind: "tv", score: "8.62", aired_on: "2006-10-04",
          image: { original: "/system/animes/original/1535.jpg", preview: "/system/animes/preview/1535.jpg" } },
      ]));
      return;
    }
    if (/^\/api\/animes\/\d+\/roles$/.test(url.pathname)) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { roles: ["Main"], character: { id: 17, name: "Light", russian: "Лайт",
          image: { original: "/system/characters/original/17.jpg", preview: "/system/characters/preview/17.jpg" } } },
        { roles: ["Main"], character: { id: 18, name: "L", russian: "Эл",
          image: { original: "/system/characters/original/18.jpg", preview: "/system/characters/preview/18.jpg" } } },
      ]));
      return;
    }
    if (url.pathname.startsWith("/system/")) {
      res.setHeader("content-type", "image/jpeg");
      res.end(JPG);
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });
  await new Promise<void>((r) => shiki.listen(0, r));
  const port = (shiki.address() as { port: number }).port;

  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
  userId = user.id;

  const base = await mkdtemp(join(tmpdir(), "mcp-e2e-"));
  ostDir = join(base, "ost");
  secretsDir = join(base, "secrets");
  await mkdir(ostDir, { recursive: true });
  await mkdir(secretsDir, { recursive: true });
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=330:duration=1",
    "-c:a", "libmp3lame", join(ostDir, "01. calm.mp3"),
  ]);
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:a", "libmp3lame", join(ostDir, "02. calmer.mp3"),
  ]);
  await writeFile(join(ostDir, "bg.jpg"), JPG);
  await writeFile(join(ostDir, "notes.txt"), "not media");
  await writeFile(join(secretsDir, "passwords.mp3"), "secret");

  transport = new StdioClientTransport({
    command: resolve(ROOT, "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: ROOT,
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      MCP_ACTOR_EMAIL: EMAIL,
      SHIKIMORI_BASE_URL: `http://127.0.0.1:${port}`,
      MCP_LOCAL_MEDIA_DIRS: ostDir,
    },
    stderr: "inherit",
  });
  client = new Client({ name: "e2e", version: "0" });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await transport?.close();
  await cleanup();
  await new Promise<void>((r) => shiki.close(() => r()));
});

describe("MCP server end-to-end", () => {
  it("exposes exactly the studio, pool and shikimori tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("video_source_list");
    expect(instructions).toContain('source.kind:"manual"');
  });

  it("reads Shikimori without building a project", async () => {
    const studios = await call("shikimori_find_studio", { query: "Madhouse" });
    expect(studios[0]).toMatchObject({ id: 11, name: "Madhouse" });
    const animes = await call("shikimori_studio_animes", { studioId: 11 });
    expect(animes[0]).toMatchObject({ id: 1535, type: "anime" });
    const chars = await call("shikimori_anime_characters", { animeId: 1535 });
    expect(chars.map((c: { id: number }) => c.id).sort()).toEqual([17, 18]);

    const user = await call("shikimori_find_user", { user: "andrey03410" });
    expect(user).toMatchObject({ id: 1270120, nickname: "andrey03410" });
    await expect(call("shikimori_find_user", { user: "nope-nope" })).rejects.toThrow(
      /USER_NOT_FOUND/,
    );

    // only the anime this user rated 8+
    const list = await call("shikimori_user_anime_list", { user: "andrey03410", minScore: 8 });
    expect(list.total).toBe(2);
    expect(list.countsByStatus).toMatchObject({ completed: 1, dropped: 1 });
    expect(list.matched).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: 1535, label: "Тетрадь смерти", userScore: 10, status: "completed",
    });
    const fav = await call("shikimori_user_favourites", { user: "andrey03410" });
    expect(fav.characters[0]).toMatchObject({
      id: 17, posterPath: "/system/characters/original/17.jpg",
    });
  }, 60_000);

  it("imports allowlisted local media into the pool", async () => {
    const listed = await call("list_local_media", { dir: ostDir });
    expect(listed.files.map((f: { name: string }) => f.name)).toEqual([
      "01. calm.mp3", "02. calmer.mp3", "bg.jpg",
    ]);
    expect(listed.files[0].kind).toBe("audio");
    await expect(call("list_local_media", { dir: secretsDir })).rejects.toThrow(/PATH_NOT_ALLOWED/);

    const imported = await call("import_local_media", {
      paths: [
        `${ostDir}/01. calm.mp3`,
        `${ostDir}/02. calmer.mp3`,
        `${ostDir}/bg.jpg`,
        `${secretsDir}/passwords.mp3`,
      ],
    });
    expect(imported.failed).toEqual([
      { path: `${secretsDir}/passwords.mp3`, error: "PATH_NOT_ALLOWED" },
    ]);
    expect(imported.items).toHaveLength(3);
    expect(existsSync(`${ostDir}/01. calm.mp3`)).toBe(true);

    const tracks = imported.items.filter((i: { kind: string }) => i.kind === "audio");
    expect(tracks[0].label).toBe("01. calm");
    expect(tracks[0].durationSec).toBeGreaterThan(0.5);

    // the pool is browsable, so an agent can reuse what is already there
    const pool = await call("list_pool", { kind: "audio", query: "calm" });
    expect(pool.arts.map((a: { id: string }) => a.id).sort()).toEqual(
      tracks.map((t: { artId: string }) => t.artId).sort(),
    );
    expect(pool.arts[0].filePath).toContain("arts/");
  }, 60_000);
});
