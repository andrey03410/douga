import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { fetchFreshPosterUrls } from "@/lib/shikimori";
import {
  search, importPoster, findStudio, studioAnimes, animeCharacters,
  findUser, userAnimeList, userFavourites, characterProfile, animeProfile, personProfile, userHistory,
} from "@/server/shikimori";

// Real DB + createArt pipeline; Shikimori is a LOCAL http server pointed at via
// SHIKIMORI_BASE_URL (no external network). A 1x1 jpg stands in for a poster.
const EMAIL = "integration-shikimori@test.local";
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

// The poster the site shows lives under /uploads/poster/... and differs from the
// legacy /system copy — distinguishable bytes let the tests tell them apart.
const FRESH_JPG = Buffer.concat([JPG, Buffer.alloc(500, 0x20)]);
/** What the fake GraphQL answers: "url" | "foreign" | "missing" | "error". */
let graphqlMode: "url" | "foreign" | "missing" | "error" = "url";
let graphqlCalls = 0;

let userId: string;
let server: Server;
/** Query strings the fake Shikimori saw (asserts we don't over-fetch). */
const seen: string[] = [];
/** How many next /api/users requests answer 429 (rate-limit retry test). */
let rateLimitOnce = 0;

// Fake profile of the real test account, with a small but representative list.
const PROFILE = {
  id: 1270120,
  nickname: "andrey03410",
  url: "https://shikimori.io/andrey03410",
  avatar: "https://shikimori.io/system/users/x48/1270120.png?1",
};

const anime = (id: number, name: string, russian: string, year: string, kind = "tv") => ({
  id, name, russian, kind, score: "8.00", aired_on: year,
  image: {
    original: `/system/animes/original/${id}.jpg?1`,
    preview: `/system/animes/preview/${id}.jpg?1`,
  },
});

const RATES = [
  { id: 1, score: 10, status: "completed", episodes: 24, rewatches: 1,
    updated_at: "2026-01-05T10:00:00+03:00", anime: anime(934, "Higurashi", "Когда плачут цикады", "2006-04-04"), manga: null },
  { id: 2, score: 8, status: "completed", episodes: 12, rewatches: 0,
    updated_at: "2026-02-05T10:00:00+03:00", anime: anime(4181, "Clannad After Story", "Кланнад: Продолжение истории", "2008-10-03"), manga: null },
  { id: 3, score: 0, status: "planned", episodes: 0, rewatches: 0,
    updated_at: "2026-03-05T10:00:00+03:00", anime: anime(14075, "Zetsuen no Tempest", "Буря потерь", "2012-10-05"), manga: null },
  { id: 4, score: 6, status: "dropped", episodes: 3, rewatches: 0,
    updated_at: "2026-04-05T10:00:00+03:00", anime: anime(226, "Elfen Lied", "Эльфийская песнь", "2004-07-25"), manga: null },
  // music clips share the list but have no characters — kind lets callers skip them
  { id: 5, score: 10, status: "completed", episodes: 1, rewatches: 0,
    updated_at: "2025-12-01T10:00:00+03:00", anime: anime(62027, "Tori no Uta", "Птичья песня", "2001-01-01", "music"), manga: null },
  // a manga rate lives in the same shape and must be ignored
  { id: 6, score: 9, status: "completed", chapters: 100, anime: null,
    manga: { id: 12, name: "Berserk", russian: "Берсерк" } },
];

const FAVOURITES = {
  animes: [
    { id: 572, name: "Kaze no Tani no Nausicaa", russian: "Навсикая из Долины ветров",
      image: "/system/animes/x64/572.jpg?1711957866", url: null },
  ],
  mangas: [{ id: 1, name: "M", russian: "М", image: "/system/mangas/x64/1.jpg", url: null }],
  ranobe: [],
  characters: [
    { id: 251, name: "Haruhi Suzumiya", russian: "Харухи Судзумия",
      image: "/system/characters/x64/251.jpg?1712015455", url: null },
    { id: 4604, name: "Nagisa Furukawa", russian: null,
      image: "/system/characters/x64/4604.jpg", url: null },
  ],
  people: [{ id: 9, name: "Someone", russian: null, image: "/system/people/x64/9.jpg", url: null }],
  seyu: [{ id: 10, name: "Voice Actor", russian: "Сэйю" }],
};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith("/api/users")) {
      seen.push(req.url!);
      if (rateLimitOnce > 0) {
        rateLimitOnce--;
        res.statusCode = 429;
        return res.end("too many");
      }
      const byNickname =
        url.pathname === `/api/users/${PROFILE.nickname}` &&
        url.searchParams.get("is_nickname") === "1";
      if (byNickname || url.pathname === `/api/users/${PROFILE.id}`) return json(PROFILE);
      if (url.pathname === `/api/users/${PROFILE.id}/anime_rates`) return json(RATES);
      if (url.pathname === `/api/users/${PROFILE.id}/favourites`) return json(FAVOURITES);
      if (url.pathname === `/api/users/${PROFILE.id}/history`) {
        return json(url.searchParams.get("page") === "1"
          ? [{ id: 11, description: "Оценка изменена" }, { id: 12 }, { id: 13 }]
          : [{ id: 13 }]);
      }
      res.statusCode = 404;
      return res.end("no");
    }
    if (url.pathname === "/api/people/9") {
      return json({ id: 9, name: "Someone", website: "https://example.com", works: [
        { anime: { id: 5114, name: "FMA", russian: "Стальной алхимик" }, role: "Исполнение гл. муз. темы" },
        { anime: null, manga: { id: 1 } },
      ] });
    }
    if (url.pathname === "/api/studios") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: 11, name: "Madhouse", filtered_name: "Madhouse", real: false, image: null },
        { id: 7, name: "Bones", filtered_name: "Bones", real: false, image: null },
      ]));
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
        { roles: ["Main"], character: { id: 17, name: "Light Yagami", russian: "Лайт Ягами",
          image: { original: "/system/characters/original/17.jpg", preview: "/system/characters/preview/17.jpg" } } },
        { roles: ["Supporting"], character: { id: 18, name: "Ryuk", russian: "Рюук",
          image: { original: "/system/characters/original/18.jpg", preview: "/system/characters/preview/18.jpg" } } },
      ]));
      return;
    }
    if (url.pathname === "/api/animes") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: 20, name: "Naruto", russian: "Наруто", kind: "tv", score: "8.02", aired_on: "2002-10-03",
          image: { original: "/system/animes/original/20.jpg", preview: "/system/animes/preview/20.jpg" } },
      ]));
      return;
    }
    if (/^\/api\/animes\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/").pop());
      if (id !== 2167) {
        res.statusCode = 404;
        return res.end("no");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: 2167, name: "Clannad", russian: "Кланнад", kind: "tv", score: "7.99", aired_on: "2007-10-05",
        image: { original: "/system/animes/original/2167.jpg", preview: "/system/animes/preview/2167.jpg" },
        studios: [
          { id: 2, name: "Kyoto Animation", filtered_name: "Kyoto Animation", real: true },
          { id: 777, name: "Sponsor", filtered_name: "Sponsor", real: false },
        ],
        genres: [{ id: 22, russian: "Романтика" }],
      }));
      return;
    }
    if (/^\/api\/characters\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/").pop());
      if (id !== 17) {
        res.statusCode = 404;
        return res.end("no");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: 17, name: "Rika Furude", russian: "Рика Фурудэ",
        description: "Спокойный персонаж. [spoiler]Описание источника[/spoiler]",
        image: { original: "/system/characters/original/17.jpg", preview: "/system/characters/preview/17.jpg" },
        animes: [
          { id: 41006, name: "Higurashi Gou", russian: "Цикады: Карма", kind: "tv", aired_on: "2020-10-01" },
          { id: 934, name: "Higurashi", russian: "Когда плачут цикады", kind: "tv", aired_on: "2006-04-05" },
          { id: 555, name: "Undated", russian: "Без даты", kind: "special", aired_on: null },
        ],
      }));
      return;
    }
    if (url.pathname === "/api/characters/search") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: 17, name: "Naruto Uzumaki", russian: "Наруто Узумаки",
          image: { original: "/system/characters/original/17.jpg", preview: "/system/characters/preview/17.jpg" } },
      ]));
      return;
    }
    if (url.pathname === "/api/graphql") {
      graphqlCalls++;
      if (graphqlMode === "error") {
        res.statusCode = 500;
        return res.end("boom");
      }
      // the id list is echoed back with a poster url of the requested shape
      const body: string[] = [];
      req.on("data", (c) => body.push(String(c)));
      req.on("end", () => {
        const query = JSON.parse(body.join("") || "{}").query as string;
        const field = query.includes("characters(") ? "characters" : "animes";
        const all = (/ids: "([\d,]*)"/.exec(query)?.[1] ?? "").split(",").filter(Boolean);
        // like the real API: without an explicit limit only two entries come back
        const limit = Number(/limit: (\d+)/.exec(query)?.[1] ?? 2);
        const ids = all.slice(0, limit);
        const host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const poster = (id: string) => {
          if (graphqlMode === "missing") return null;
          const base = graphqlMode === "foreign" ? "https://evil.example" : host;
          return { originalUrl: `${base}/uploads/poster/${field}/${id}/abc123.jpeg` };
        };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          data: { [field]: ids.map((id) => ({ id, poster: poster(id) })) },
        }));
      });
      return;
    }
    if (/^\/uploads\/poster\/(animes|characters)\/\d+\/[\w.-]+$/.test(url.pathname)) {
      res.setHeader("content-type", "image/jpeg");
      res.end(FRESH_JPG);
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

describe("shikimori search", () => {
  it("normalizes anime hits into DTOs with a thumb url and facts", async () => {
    const res = await search("anime", "naruto");
    expect(res).toHaveLength(1);
    expect(res[0].label).toBe("Наруто");
    expect(res[0].posterPath).toBe("/system/animes/original/20.jpg");
    expect(res[0].thumbUrl).toContain("/system/animes/preview/20.jpg");
    expect(res[0].facts).toContain("2002");
  });
  it("normalizes character hits", async () => {
    const res = await search("character", "naruto");
    expect(res[0].label).toBe("Наруто Узумаки");
  });
  it("returns [] for a blank query without hitting the network", async () => {
    expect(await search("anime", "   ")).toEqual([]);
  });
});

describe("shikimori importPoster", () => {
  it("downloads the poster the site shows (fresh /uploads url), not the legacy copy", async () => {
    graphqlMode = "url";
    const before = graphqlCalls;
    const { artId } = await importPoster(userId, {
      type: "anime", id: 20, posterPath: "/system/animes/original/20.jpg",
      label: "Наруто", maxPoolBytes: null,
    });
    const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
    expect(art.kind).toBe("image");
    expect(art.label).toBe("Наруто");
    expect(art.sizeBytes).toBe(FRESH_JPG.length); // не legacy JPG.length
    expect(graphqlCalls).toBe(before + 1);
  });

  it("a pre-resolved posterUrl is used as is (no extra GraphQL call)", async () => {
    const host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const before = graphqlCalls;
    const { artId } = await importPoster(userId, {
      type: "character", id: 17, posterPath: "/system/characters/original/17.jpg",
      posterUrl: `${host}/uploads/poster/characters/17/fresh.jpeg`,
      label: "Наруто Узумаки", maxPoolBytes: null,
    });
    const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
    expect(art.sizeBytes).toBe(FRESH_JPG.length);
    expect(graphqlCalls).toBe(before);
  });

  it("resolves poster urls for a whole batch, not just the API's default page", async () => {
    graphqlMode = "url";
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const urls = await fetchFreshPosterUrls("character", ids);
    // без явного limit Shikimori отдаёт только 2 записи на запрос
    expect(urls.size).toBe(120);
    expect(urls.get(77)).toContain("/uploads/poster/characters/77/");
    // 120 id -> 3 страницы по 50
    expect(await fetchFreshPosterUrls("anime", [])).toEqual(new Map());
  });

  it("falls back to the legacy poster when the fresh url is absent, broken or foreign", async () => {
    for (const mode of ["missing", "error", "foreign"] as const) {
      graphqlMode = mode;
      const { artId } = await importPoster(userId, {
        type: "anime", id: 20, posterPath: "/system/animes/original/20.jpg",
        label: `fallback-${mode}`, maxPoolBytes: null,
      });
      const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
      expect(art.sizeBytes, mode).toBe(JPG.length); // legacy-копия
    }
    graphqlMode = "url";
  });

  it("rejects an unsafe image path", async () => {
    await expect(
      importPoster(userId, { type: "anime", id: 1, posterPath: "/etc/passwd", label: "x", maxPoolBytes: null }),
    ).rejects.toThrow("BAD_IMAGE_PATH");
  });

  it("enforces the pool quota", async () => {
    await expect(
      importPoster(userId, {
        type: "anime", id: 20, posterPath: "/system/animes/original/20.jpg",
        label: "Наруто", maxPoolBytes: 1,
      }),
    ).rejects.toThrow("POOL_QUOTA");
  });
});

describe("shikimori discovery", () => {
  it("finds a studio by name", async () => {
    const res = await findStudio("madhouse");
    expect(res).toEqual([{ id: 11, name: "Madhouse" }]);
  });
  it("returns [] for a blank studio query", async () => {
    expect(await findStudio("  ")).toEqual([]);
  });
  it("lists a studio's animes as DTOs", async () => {
    const res = await studioAnimes(11);
    expect(res[0]).toMatchObject({ id: 1535, type: "anime", label: "Тетрадь смерти",
      posterPath: "/system/animes/original/1535.jpg" });
    expect(res[0].facts).toContain("2006");
  });
  it("returns Main characters of an anime as DTOs", async () => {
    const res = await animeCharacters(1535);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 17, type: "character", label: "Лайт Ягами",
      posterPath: "/system/characters/original/17.jpg" });
  });
  it("anime profile carries the production studios, sponsors dropped", async () => {
    const p = await animeProfile(2167);
    expect(p).toMatchObject({ id: 2167, type: "anime", label: "Кланнад", kind: "tv", year: 2007, score: 7.99,
      posterPath: "/system/animes/original/2167.jpg" });
    expect(p.studios).toEqual([{ id: 2, name: "Kyoto Animation" }]);
    expect(p.facts).toBe("2007 · TV · ★7.99");
    await expect(animeProfile(404)).rejects.toThrow();
  });
  it("character profile carries the debut year, not the year of a remake", async () => {
    const p = await characterProfile(17);
    expect(p).toMatchObject({ id: 17, type: "character", label: "Рика Фурудэ",
      posterPath: "/system/characters/original/17.jpg", debutYear: 2006 });
    // oldest first, undatable entries dropped
    expect(p.animes.map((a) => a.year)).toEqual([2006, 2020]);
    expect(p.animes[0].label).toBe("Когда плачут цикады");
    expect(p.description).toContain("[spoiler]Описание источника[/spoiler]");
    await expect(characterProfile(999)).rejects.toThrow();
  });
  it("role='all' includes supporting characters", async () => {
    const res = await animeCharacters(1535, { role: "all" });
    expect(res.map((c) => c.id).sort()).toEqual([17, 18]);
  });
});

describe("shikimori user list & favourites", () => {
  it("resolves a nickname (and an id) to a profile, 404 -> USER_NOT_FOUND", async () => {
    const byNick = await findUser("  andrey03410 ");
    expect(byNick).toEqual({
      id: 1270120, nickname: "andrey03410", url: "https://shikimori.io/andrey03410",
      avatarUrl: "https://shikimori.io/system/users/x48/1270120.png?1",
    });
    // a numeric ref goes straight to /api/users/:id (no is_nickname)
    expect(await findUser("1270120")).toMatchObject({ id: 1270120 });
    expect(seen.some((u) => u === "/api/users/1270120")).toBe(true);

    await expect(findUser("no-such-nick")).rejects.toThrow("USER_NOT_FOUND");
    await expect(findUser("   ")).rejects.toThrow("USER_NOT_FOUND");
  });

  it("returns the list with the user's scores/statuses, counts and totals", async () => {
    const res = await userAnimeList("andrey03410");
    expect(res.user.nickname).toBe("andrey03410");
    // the manga rate is not part of the anime list
    expect(res.total).toBe(5);
    expect(res.countsByStatus).toEqual({
      planned: 1, watching: 0, rewatching: 0, completed: 3, on_hold: 0, dropped: 1,
    });
    expect(res.matched).toBe(5);
    // default order: the user's own score, best first, unrated last
    expect(res.items.map((i) => i.userScore)).toEqual([10, 10, 8, 6, null]);
    // kind is exposed so a caller can skip music clips (they have no characters)
    expect(res.items.map((i) => i.kind)).toEqual(["tv", "music", "tv", "tv", "tv"]);
    expect(res.items[0]).toMatchObject({
      id: 934, type: "anime", label: "Когда плачут цикады", status: "completed",
      kind: "tv", userScore: 10, episodes: 24, rewatches: 1,
      posterPath: "/system/animes/original/934.jpg?1",
    });
    expect(res.items[0].facts).toContain("2006"); // общие факты аниме сохранены
    expect(res.items[0].thumbUrl).toContain("/system/animes/preview/934.jpg");
    // the whole list is fetched once, filtering happens locally
    expect(seen.filter((u) => u.includes("anime_rates"))).toHaveLength(1);
    expect(seen.some((u) => u.includes("anime_rates") && u.includes("status="))).toBe(false);
  });

  it("filters by status / minScore and cuts by limit", async () => {
    const completed = await userAnimeList("andrey03410", { status: "completed" });
    expect(completed.matched).toBe(3);
    expect(completed.items.map((i) => i.id)).toEqual([934, 62027, 4181]);
    expect(completed.total).toBe(5); // total stays the whole list

    const good = await userAnimeList("andrey03410", { minScore: 8 });
    expect(good.items.map((i) => i.userScore)).toEqual([10, 10, 8]);

    const cut = await userAnimeList("andrey03410", { limit: 1, order: "updated" });
    expect(cut.matched).toBe(5);
    expect(cut.items).toHaveLength(1);
    expect(cut.items[0].id).toBe(226); // freshest update

    const planned = await userAnimeList("andrey03410", { status: "planned" });
    expect(planned.items).toEqual([expect.objectContaining({ id: 14075, userScore: null })]);
  });

  it("favourites: animes and characters with import-ready poster paths", async () => {
    const fav = await userFavourites("andrey03410");
    expect(fav.animes).toEqual([
      expect.objectContaining({
        id: 572, type: "anime", label: "Навсикая из Долины ветров",
        posterPath: "/system/animes/original/572.jpg?1711957866",
      }),
    ]);
    expect(fav.characters.map((c) => c.id)).toEqual([251, 4604]);
    expect(fav.characters[0]).toMatchObject({
      type: "character", label: "Харухи Судзумия",
      posterPath: "/system/characters/original/251.jpg?1712015455",
      facts: "Haruhi Suzumiya",
    });
    expect(fav.characters[1].label).toBe("Nagisa Furukawa"); // фолбэк на оригинал
    expect(fav.characters[0].thumbUrl).toContain("/system/characters/preview/251.jpg");
    expect(fav.people).toEqual([{ id: 9, label: "Someone", url: expect.stringContaining("/people/9") }]);
    expect(fav.seiyuu).toEqual([{ id: 10, label: "Сэйю", url: expect.stringContaining("/people/10") }]);
  });

  it("retains music credits independently of anime ratings", async () => {
    const person = await personProfile(9);
    expect(person.works).toEqual([{ animeId: 5114, label: "Стальной алхимик", role: "Исполнение гл. муз. темы" }]);
    expect(person.website).toBe("https://example.com");
    await expect(personProfile(404)).rejects.toThrow();
  });

  it("paginates public history without exposing the API lookahead item twice", async () => {
    const first = await userHistory(PROFILE.nickname, 1, 2);
    const second = await userHistory(PROFILE.nickname, first.nextPage!, 2);
    expect(first.items.map(x => (x as { id: number }).id)).toEqual([11, 12]);
    expect(second.items).toEqual([{ id: 13 }]);
    expect(second.nextPage).toBeNull();
    expect(seen).toContain(`/api/users/${PROFILE.id}/history?page=2&limit=2`);
  });

  it("retries a 429 (Shikimori rate limit) and gives up after the retries", async () => {
    // the real backoff is seconds; the test hook keeps the suite fast
    process.env.SHIKIMORI_RETRY_MS = "10,20,30";
    try {
      rateLimitOnce = 1;
      const before = seen.length;
      expect(await findUser("andrey03410")).toMatchObject({ id: 1270120 });
      expect(seen.length - before).toBe(2); // одна отбитая попытка + успешная

      // beyond the retry budget the error is explicit, not a silent empty result
      rateLimitOnce = 9;
      const attemptsBefore = seen.length;
      await expect(findUser("andrey03410")).rejects.toThrow("RATE_LIMITED");
      expect(seen.length - attemptsBefore).toBe(4); // первая + 3 ретрая
      rateLimitOnce = 0;
    } finally {
      delete process.env.SHIKIMORI_RETRY_MS;
    }
  }, 20_000);

  it("a favourite poster path really imports into the pool", async () => {
    const fav = await userFavourites("andrey03410");
    const { artId } = await importPoster(userId, {
      type: "character", id: fav.characters[0].id,
      posterPath: fav.characters[0].posterPath!, label: fav.characters[0].label,
      maxPoolBytes: null,
    });
    const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
    expect(art.kind).toBe("image");
    expect(art.label).toBe("Харухи Судзумия");
  });
});
