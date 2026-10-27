# Фаза 9 — Импорт постеров из Shikimori: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используйте
> superpowers:subagent-driven-development или superpowers:executing-plans для
> выполнения задача-за-задачей. Шаги помечены чекбоксами (`- [ ]`).

Спека: [`../specs/09-shikimori-import.md`](../specs/09-shikimori-import.md).

**Goal:** В менеджере медиа искать аниме/персонажа Shikimori с живым превью и
синхронно импортировать постер в пул как `Art(kind=image)`.

**Architecture:** Браузер обращается только к нашим роутам `/api/shikimori/*`;
Next.js-сервер ходит в Shikimori REST v1 (базовый URL и User-Agent из env).
Импорт синхронный, постер зачисляется через существующий `createArt`
(транзакционная квота). Схема БД не меняется.

**Tech Stack:** Next.js 14, TypeScript, Prisma (SQLite), Vitest, `fetch`
(глобальный, Node 18+), React (клиентский компонент модалки).

## Global Constraints

- Внешние запросы — **только с сервера** (`server-only` модули); браузер не
  ходит в Shikimori напрямую (кроме `<img>`-превью по абсолютному URL).
- Базовый URL: `process.env.SHIKIMORI_BASE_URL` || `https://shikimori.io`.
- User-Agent: `process.env.SHIKIMORI_USER_AGENT` || `douga`.
- Пермишен на оба роута: `media:upload`; квота пула из
  `quotasFor(role).maxPoolBytes`.
- SSRF-защита: сервер скачивает постер **только** по пути, прошедшему
  `isSafeImagePath`, и **только** с настроенного базового хоста.
- Тексты интерфейса и ошибок — на русском (как в остальном проекте).
- Комментарии/стиль — как в соседних файлах (`ytdlp-args.ts`, `arts.ts`).

---

### Task 1: Доменные хелперы Shikimori (чистые, юнит-тесты)

**Files:**
- Create: `src/lib/domain/shikimori.ts`
- Test: `src/lib/domain/shikimori.test.ts`
- Modify: `.env.example` (добавить две переменные)

**Interfaces:**
- Produces:
  - `type ShikimoriType = "anime" | "character"`
  - `interface AnimeResult { id: number; name: string; russian: string | null; posterPath: string | null; previewPath: string | null; kind: string | null; score: number | null; year: number | null }`
  - `interface CharacterResult { id: number; name: string; russian: string | null; posterPath: string | null; previewPath: string | null }`
  - `mapAnimeResult(raw: unknown): AnimeResult | null`
  - `mapCharacterResult(raw: unknown): CharacterResult | null`
  - `pickLabel(russian: string | null | undefined, name: string | null | undefined): string | null`
  - `absoluteImageUrl(base: string, path: string): string`
  - `isSafeImagePath(path: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/shikimori.test.ts
import { describe, it, expect } from "vitest";
import {
  mapAnimeResult,
  mapCharacterResult,
  pickLabel,
  absoluteImageUrl,
  isSafeImagePath,
} from "@/lib/domain/shikimori";

const rawAnime = {
  id: 20,
  name: "Naruto",
  russian: "Наруто",
  image: {
    original: "/system/animes/original/20.jpg?1711965679",
    preview: "/system/animes/preview/20.jpg?1711965679",
  },
  kind: "tv",
  score: "8.02",
  aired_on: "2002-10-03",
};

const rawChar = {
  id: 17,
  name: "Naruto Uzumaki",
  russian: "Наруто Узумаки",
  image: { original: "/system/characters/original/17.jpg?1", preview: "/system/characters/preview/17.jpg?1" },
};

describe("mapAnimeResult", () => {
  it("normalizes a raw anime hit", () => {
    expect(mapAnimeResult(rawAnime)).toEqual({
      id: 20,
      name: "Naruto",
      russian: "Наруто",
      posterPath: "/system/animes/original/20.jpg?1711965679",
      previewPath: "/system/animes/preview/20.jpg?1711965679",
      kind: "tv",
      score: 8.02,
      year: 2002,
    });
  });
  it("returns null for a hit without an id", () => {
    expect(mapAnimeResult({ name: "x" })).toBeNull();
  });
  it("tolerates missing score/aired_on", () => {
    const r = mapAnimeResult({ id: 1, name: "A", image: {} })!;
    expect(r.score).toBeNull();
    expect(r.year).toBeNull();
    expect(r.posterPath).toBeNull();
  });
});

describe("mapCharacterResult", () => {
  it("normalizes a raw character hit", () => {
    expect(mapCharacterResult(rawChar)).toEqual({
      id: 17,
      name: "Naruto Uzumaki",
      russian: "Наруто Узумаки",
      posterPath: "/system/characters/original/17.jpg?1",
      previewPath: "/system/characters/preview/17.jpg?1",
    });
  });
});

describe("pickLabel", () => {
  it("prefers russian, falls back to name, then null", () => {
    expect(pickLabel("Наруто", "Naruto")).toBe("Наруто");
    expect(pickLabel("  ", "Naruto")).toBe("Naruto");
    expect(pickLabel(null, "  ")).toBeNull();
  });
});

describe("absoluteImageUrl", () => {
  it("joins base and path without double slash", () => {
    expect(absoluteImageUrl("https://shikimori.io", "/system/animes/original/20.jpg")).toBe(
      "https://shikimori.io/system/animes/original/20.jpg",
    );
    expect(absoluteImageUrl("https://shikimori.io/", "/system/x.jpg")).toBe(
      "https://shikimori.io/system/x.jpg",
    );
  });
});

describe("isSafeImagePath", () => {
  it("accepts poster/preview system paths (with query)", () => {
    expect(isSafeImagePath("/system/animes/original/20.jpg?1711965679")).toBe(true);
    expect(isSafeImagePath("/system/characters/preview/17.jpg")).toBe(true);
  });
  it("rejects foreign hosts, traversal and non-system paths", () => {
    expect(isSafeImagePath("https://evil.example/system/animes/original/1.jpg")).toBe(false);
    expect(isSafeImagePath("/system/../etc/passwd")).toBe(false);
    expect(isSafeImagePath("/uploads/1.jpg")).toBe(false);
    expect(isSafeImagePath("/system/users/original/1.jpg")).toBe(false);
    expect(isSafeImagePath("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/domain/shikimori.test.ts`
Expected: FAIL — module `@/lib/domain/shikimori` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/domain/shikimori.ts
// Pure Shikimori helpers: normalizing REST v1 search hits and validating image
// paths before the server fetches them (SSRF guard). No network here.

export type ShikimoriType = "anime" | "character";

export interface AnimeResult {
  id: number;
  name: string;
  russian: string | null;
  posterPath: string | null;
  previewPath: string | null;
  kind: string | null;
  score: number | null;
  year: number | null;
}

export interface CharacterResult {
  id: number;
  name: string;
  russian: string | null;
  posterPath: string | null;
  previewPath: string | null;
}

interface RawImage { original?: unknown; preview?: unknown }
interface RawHit {
  id?: unknown;
  name?: unknown;
  russian?: unknown;
  image?: RawImage;
  kind?: unknown;
  score?: unknown;
  aired_on?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const imgPath = (img: RawImage | undefined, key: "original" | "preview"): string | null =>
  img && typeof img[key] === "string" ? (img[key] as string) : null;

export function mapAnimeResult(raw: unknown): AnimeResult | null {
  const h = raw as RawHit;
  if (typeof h?.id !== "number" || typeof h?.name !== "string") return null;
  const scoreNum = h.score != null ? Number(h.score) : NaN;
  const yearNum = typeof h.aired_on === "string" ? Number(h.aired_on.slice(0, 4)) : NaN;
  return {
    id: h.id,
    name: h.name,
    russian: str(h.russian),
    posterPath: imgPath(h.image, "original"),
    previewPath: imgPath(h.image, "preview"),
    kind: str(h.kind),
    score: Number.isFinite(scoreNum) && scoreNum > 0 ? scoreNum : null,
    year: Number.isFinite(yearNum) ? yearNum : null,
  };
}

export function mapCharacterResult(raw: unknown): CharacterResult | null {
  const h = raw as RawHit;
  if (typeof h?.id !== "number" || typeof h?.name !== "string") return null;
  return {
    id: h.id,
    name: h.name,
    russian: str(h.russian),
    posterPath: imgPath(h.image, "original"),
    previewPath: imgPath(h.image, "preview"),
  };
}

export function pickLabel(
  russian: string | null | undefined,
  name: string | null | undefined,
): string | null {
  return russian?.trim() || name?.trim() || null;
}

export function absoluteImageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Only Shikimori poster/preview paths under /system are fetchable server-side.
// Rejects absolute URLs (foreign hosts), traversal and any other route.
export function isSafeImagePath(path: string): boolean {
  return /^\/system\/(animes|characters)\/(original|preview)\/\d+\.(jpe?g|png|webp)(\?\S*)?$/.test(
    path,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/domain/shikimori.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Update `.env.example`**

Добавьте после блока `YTDLP_*`:

```bash
# Shikimori (импорт постеров аниме/персонажей). Домен часто мигрирует
# (.one → .io → …) — при переезде поменяйте только этот URL и перезапустите.
SHIKIMORI_BASE_URL="https://shikimori.io"
# Осмысленный User-Agent требуется этикетом API Shikimori.
SHIKIMORI_USER_AGENT="douga"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain/shikimori.ts src/lib/domain/shikimori.test.ts .env.example
git commit -m "Phase 9: Shikimori domain helpers (map/label/image-path guard)"
```

---

### Task 2: Клиент API + сервис (search / importPoster) + интеграционный тест

**Files:**
- Create: `src/lib/shikimori.ts` (server-only: сетевой клиент)
- Create: `src/server/shikimori.ts` (server-only: сервис)
- Test: `src/integration/shikimori.integration.test.ts`

**Interfaces:**
- Consumes (Task 1): `mapAnimeResult`, `mapCharacterResult`, `pickLabel`,
  `absoluteImageUrl`, `isSafeImagePath`, `ShikimoriType`.
- Consumes (existing): `createArt(userId, { fileName, data, label, maxPoolBytes })`
  from `@/server/arts`; `prisma` from `@/lib/db`.
- Produces:
  - `src/lib/shikimori.ts`:
    - `shikimoriBase(): string`
    - `searchAnimesRaw(q: string, limit: number): Promise<unknown[]>`
    - `searchCharactersRaw(q: string): Promise<unknown[]>`
    - `fetchPoster(posterPath: string): Promise<{ data: Buffer; contentType: string }>`
  - `src/server/shikimori.ts`:
    - `interface SearchDto { id: number; type: ShikimoriType; label: string | null; thumbUrl: string | null; posterPath: string | null; facts: string | null }`
    - `search(type: ShikimoriType, q: string, limit?: number): Promise<SearchDto[]>`
    - `importPoster(userId, { type, id, posterPath, label, maxPoolBytes }): Promise<{ artId: string }>` — throws `"BAD_IMAGE_PATH"`, `"POOL_QUOTA"`, `"POSTER_FETCH_FAILED"`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/integration/shikimori.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { search, importPoster } from "@/server/shikimori";

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
    if (url.pathname === "/api/animes") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: 20, name: "Naruto", russian: "Наруто", kind: "tv", score: "8.02", aired_on: "2002-10-03",
          image: { original: "/system/animes/original/20.jpg", preview: "/system/animes/preview/20.jpg" } },
      ]));
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
  it("downloads the poster into the pool as an image art", async () => {
    const { artId } = await importPoster(userId, {
      type: "anime", id: 20, posterPath: "/system/animes/original/20.jpg",
      label: "Наруто", maxPoolBytes: null,
    });
    const art = await prisma.art.findUniqueOrThrow({ where: { id: artId } });
    expect(art.kind).toBe("image");
    expect(art.label).toBe("Наруто");
    expect(art.sizeBytes).toBeGreaterThan(0);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/integration/shikimori.integration.test.ts`
Expected: FAIL — `@/server/shikimori` not found.

- [ ] **Step 3: Implement the network client**

```ts
// src/lib/shikimori.ts
import "server-only";
import { absoluteImageUrl, isSafeImagePath } from "@/lib/domain/shikimori";

const DEFAULT_BASE = "https://shikimori.io";
const TIMEOUT_MS = 10_000;

export function shikimoriBase(): string {
  return (process.env.SHIKIMORI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

function userAgent(): string {
  return process.env.SHIKIMORI_USER_AGENT?.trim() || "douga";
}

async function getJson(pathAndQuery: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${shikimoriBase()}${pathAndQuery}`, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new Error("RATE_LIMITED");
    if (!res.ok) throw new Error(`SHIKIMORI_HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function searchAnimesRaw(q: string, limit: number): Promise<unknown[]> {
  const data = await getJson(`/api/animes?search=${encodeURIComponent(q)}&limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

export async function searchCharactersRaw(q: string): Promise<unknown[]> {
  const data = await getJson(`/api/characters/search?search=${encodeURIComponent(q)}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchPoster(posterPath: string): Promise<{ data: Buffer; contentType: string }> {
  if (!isSafeImagePath(posterPath)) throw new Error("BAD_IMAGE_PATH");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(absoluteImageUrl(shikimoriBase(), posterPath), {
      headers: { "User-Agent": userAgent() },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("POSTER_FETCH_FAILED");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("POSTER_FETCH_FAILED");
    return { data: buf, contentType: res.headers.get("content-type") || "image/jpeg" };
  } catch (e) {
    if ((e as Error).message === "BAD_IMAGE_PATH") throw e;
    throw new Error("POSTER_FETCH_FAILED");
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 4: Implement the service**

```ts
// src/server/shikimori.ts
import "server-only";
import {
  mapAnimeResult,
  mapCharacterResult,
  pickLabel,
  absoluteImageUrl,
  isSafeImagePath,
  type ShikimoriType,
} from "@/lib/domain/shikimori";
import { shikimoriBase, searchAnimesRaw, searchCharactersRaw, fetchPoster } from "@/lib/shikimori";
import { createArt } from "@/server/arts";

const MAX_RESULTS = 8;

export interface SearchDto {
  id: number;
  type: ShikimoriType;
  label: string | null;
  thumbUrl: string | null;
  posterPath: string | null;
  facts: string | null;
}

function animeFacts(kind: string | null, score: number | null, year: number | null): string | null {
  const parts: string[] = [];
  if (year != null) parts.push(String(year));
  if (kind) parts.push(kind.toUpperCase());
  if (score != null) parts.push(`★${score.toFixed(2)}`);
  return parts.length ? parts.join(" · ") : null;
}

export async function search(type: ShikimoriType, q: string, limit = MAX_RESULTS): Promise<SearchDto[]> {
  const query = q.trim();
  if (!query) return [];
  const base = shikimoriBase();
  const thumb = (p: string | null) => (p && isSafeImagePath(p) ? absoluteImageUrl(base, p) : null);

  if (type === "anime") {
    const raw = await searchAnimesRaw(query, limit);
    return raw
      .map(mapAnimeResult)
      .filter((r): r is NonNullable<typeof r> => r != null)
      .slice(0, limit)
      .map((r) => ({
        id: r.id, type, label: pickLabel(r.russian, r.name),
        thumbUrl: thumb(r.previewPath), posterPath: r.posterPath,
        facts: animeFacts(r.kind, r.score, r.year),
      }));
  }
  const raw = await searchCharactersRaw(query);
  return raw
    .map(mapCharacterResult)
    .filter((r): r is NonNullable<typeof r> => r != null)
    .slice(0, limit)
    .map((r) => ({
      id: r.id, type, label: pickLabel(r.russian, r.name),
      thumbUrl: thumb(r.previewPath), posterPath: r.posterPath,
      facts: r.russian && r.russian !== r.name ? r.name : null,
    }));
}

export interface ImportPosterInput {
  type: ShikimoriType;
  id: number;
  posterPath: string;
  label: string | null;
  maxPoolBytes: number | null;
}

export async function importPoster(userId: string, input: ImportPosterInput): Promise<{ artId: string }> {
  if (!isSafeImagePath(input.posterPath)) throw new Error("BAD_IMAGE_PATH");
  const { data } = await fetchPoster(input.posterPath); // may throw POSTER_FETCH_FAILED
  const art = await createArt(userId, {
    fileName: `shikimori-${input.type}-${input.id}.jpg`,
    data,
    label: input.label,
    maxPoolBytes: input.maxPoolBytes,
  });
  return { artId: art.id };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/integration/shikimori.integration.test.ts`
Expected: PASS (search anime/character, blank query, import ok, bad path, quota).

- [ ] **Step 6: Commit**

```bash
git add src/lib/shikimori.ts src/server/shikimori.ts src/integration/shikimori.integration.test.ts
git commit -m "Phase 9: Shikimori API client + service (search/importPoster) + integration"
```

---

### Task 3: API-роуты `/api/shikimori/search` и `/api/shikimori/import`

**Files:**
- Create: `src/app/api/shikimori/search/route.ts`
- Create: `src/app/api/shikimori/import/route.ts`

**Interfaces:**
- Consumes: `search`, `importPoster` from `@/server/shikimori`;
  `permissionOr403`, `badRequest` from `@/lib/api`; `quotasFor` from
  `@/lib/domain/permissions`; `type ShikimoriType` from `@/lib/domain/shikimori`.
- Produces: `GET /api/shikimori/search?type=&q=` → `{ results: SearchDto[] }`;
  `POST /api/shikimori/import` → `{ artId }`.

- [ ] **Step 1: Implement the search route**

```ts
// src/app/api/shikimori/search/route.ts
import { NextResponse } from "next/server";
import { permissionOr403, badRequest } from "@/lib/api";
import { search } from "@/server/shikimori";
import type { ShikimoriType } from "@/lib/domain/shikimori";

export async function GET(req: Request) {
  const auth = await permissionOr403("media:upload", "Импорт медиа недоступен вашей роли");
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const q = url.searchParams.get("q") ?? "";
  if (type !== "anime" && type !== "character") return badRequest("type: anime или character");

  try {
    const results = await search(type as ShikimoriType, q);
    return NextResponse.json({ results });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "RATE_LIMITED") return badRequest("Shikimori: слишком много запросов, подождите");
    return badRequest("Shikimori недоступен — попробуйте позже");
  }
}
```

- [ ] **Step 2: Implement the import route**

```ts
// src/app/api/shikimori/import/route.ts
import { NextResponse } from "next/server";
import { permissionOr403, badRequest } from "@/lib/api";
import { quotasFor } from "@/lib/domain/permissions";
import { importPoster } from "@/server/shikimori";

export async function POST(req: Request) {
  const auth = await permissionOr403("media:upload", "Импорт медиа недоступен вашей роли");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const type = body.type === "character" ? "character" : body.type === "anime" ? "anime" : null;
  const id = Number(body.id);
  const posterPath = String(body.posterPath ?? "");
  const label = body.label != null ? String(body.label) : null;
  if (!type || !Number.isFinite(id) || !posterPath) return badRequest("Некорректный запрос импорта");

  try {
    const { artId } = await importPoster(auth.userId, {
      type, id, posterPath, label,
      maxPoolBytes: quotasFor(auth.user.role).maxPoolBytes,
    });
    return NextResponse.json({ artId });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "BAD_IMAGE_PATH") return badRequest("Недопустимый адрес постера");
    if (msg === "POOL_QUOTA")
      return badRequest("Не влезает в квоту пула — освободите место в личном кабинете");
    if (msg === "POSTER_FETCH_FAILED") return badRequest("Не удалось скачать постер из Shikimori");
    throw e;
  }
}
```

- [ ] **Step 3: Typecheck + build sanity**

Run: `npx tsc --noEmit`
Expected: no errors in the new route files.

- [ ] **Step 4: Manual HTTP smoke (dev server running)**

Залогиньтесь по образцу `scripts/e2e-run.mjs` (куки-джар) и проверьте:
`GET /api/shikimori/search?type=anime&q=naruto` → `{ results: [...] }` с
непустым `thumbUrl`; `POST /api/shikimori/import` с `posterPath` из результата
→ `{ artId }`, и карточка появляется в `GET /api/arts`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/shikimori/search/route.ts src/app/api/shikimori/import/route.ts
git commit -m "Phase 9: /api/shikimori search + import routes (permissioned, quota)"
```

---

### Task 4: UI — `ShikimoriPanel` в менеджере медиа

**Files:**
- Modify: `src/app/tournaments/[id]/render/ArtGalleryModal.tsx` (добавить
  компонент `ShikimoriPanel` и вставить его рядом с `<UrlImportPanel/>` в блоке
  `mode === "manage"` / общем блоке загрузки, после `UrlImportPanel`)
- Modify: `src/app/globals.css` (стили `.shikimori-panel`, `.shk-result` — по
  образцу `.url-import`/`.art-card`)

**Interfaces:**
- Consumes: `GET /api/shikimori/search`, `POST /api/shikimori/import`.
- Produces: компонент `ShikimoriPanel({ onPoolChange }: { onPoolChange: () => void })`.

- [ ] **Step 1: Add the component** (внутри `ArtGalleryModal.tsx`, рядом с `UrlImportPanel`)

```tsx
interface ShkResult {
  id: number;
  type: "anime" | "character";
  label: string | null;
  thumbUrl: string | null;
  posterPath: string | null;
  facts: string | null;
}

/** Search Shikimori (anime/character) and import a poster into the pool. */
function ShikimoriPanel({ onPoolChange }: { onPoolChange: () => void }) {
  const [type, setType] = useState<"anime" | "character">("anime");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [doneId, setDoneId] = useState<number | null>(null);

  useEffect(() => {
    setError(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/shikimori/search?type=${type}&q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка поиска");
        setResults(data.results as ShkResult[]);
      } catch (e) {
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, type]);

  async function importOne(r: ShkResult) {
    if (!r.posterPath) return;
    setImportingId(r.id);
    setError(null);
    try {
      const res = await fetch("/api/shikimori/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: r.type, id: r.id, posterPath: r.posterPath, label: r.label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось импортировать");
      setDoneId(r.id);
      onPoolChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="shikimori-panel">
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <div className="kind-tabs">
          <button className={`btn ghost${type === "anime" ? " active" : ""}`} onClick={() => setType("anime")}>
            Аниме
          </button>
          <button className={`btn ghost${type === "character" ? " active" : ""}`} onClick={() => setType("character")}>
            Персонажи
          </button>
        </div>
        <input
          placeholder="🎴 Поиск в Shikimori…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
      </div>
      {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}
      {loading ? <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Ищем…</p> : null}
      {results.length > 0 ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {results.map((r) => (
            <div className="shk-result row" key={`${r.type}-${r.id}`} style={{ gap: 8, alignItems: "center" }}>
              {r.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.thumbUrl} alt={r.label ?? ""} className="shk-thumb" loading="lazy" />
              ) : (
                <div className="shk-thumb shk-thumb-empty">🎴</div>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.label ?? "без названия"}
                </span>
                {r.facts ? <span className="muted" style={{ fontSize: 12 }}>{r.facts}</span> : null}
              </span>
              {doneId === r.id ? (
                <span style={{ fontSize: 12, color: "#7be29a" }}>в пуле</span>
              ) : (
                <button
                  className="btn secondary"
                  disabled={importingId === r.id || !r.posterPath}
                  onClick={() => void importOne(r)}
                >
                  {importingId === r.id ? "…" : "⬇ В пул"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Mount it** — под `<UrlImportPanel .../>` в JSX модалки:

```tsx
<ShikimoriPanel
  onPoolChange={() => {
    void loadFirstPage(query, kindFilter);
    onPoolChange?.();
  }}
/>
```

- [ ] **Step 3: Add styles** to `src/app/globals.css`:

```css
.shikimori-panel { margin: 10px 0; }
.shk-thumb { width: 40px; height: 56px; object-fit: cover; border-radius: 4px; flex: 0 0 auto; }
.shk-thumb-empty { display: flex; align-items: center; justify-content: center; background: #222; }
.shk-result { padding: 4px 0; }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/tournaments/[id]/render/ArtGalleryModal.tsx src/app/globals.css
git commit -m "Phase 9: Shikimori search/import panel in the media manager"
```

---

### Task 5: Верификация вживую + документация

**Files:**
- Modify: `README.md` (раздел про менеджер медиа/импорт — добавить Shikimori)
- Modify: `CLAUDE.md` (строка статуса — Фаза 9)
- Modify: `.claude/skills/verify/SKILL.md` (раздел «Импорт из Shikimori (фаза 9)»)

- [ ] **Step 1: Full unit + integration suite**

Run: `npm test`
Expected: PASS, число тестов выросло на новые (обновить счётчик в README/CLAUDE.md).

- [ ] **Step 2: Real-Shikimori smoke (сетезависимый)**

Скрипт в scratchpad: `search("anime","naruto")` против дефолтного
`https://shikimori.io` (env не переопределён) → есть результат с `thumbUrl`;
один `fetchPoster` реального `posterPath` → буфер > 0. Если сеть режет хост —
зафиксировать как в фазе 8 (домен настраивается через env).

- [ ] **Step 3: UI-прогон (skill `verify`, puppeteer)**

Логин → открыть менеджер медиа (конструктор рендера) → в блоке Shikimori ввести
«naruto», дождаться дропдауна с постерами → клик «⬇ В пул» → карточка появилась
в сетке пула (проверить, что новый `Art(image)` виден). Скриншот сохранить.

- [ ] **Step 4: Update docs**

README: в блок про менеджер медиа добавить, что рядом с импортом по ссылке есть
поиск Shikimori (аниме/персонажи) с импортом постера в пул; отметить
`SHIKIMORI_BASE_URL`/`SHIKIMORI_USER_AGENT`. CLAUDE.md: дописать Фазу 9 в
строку статуса и обновить число тестов. verify/SKILL.md: краткий раздел с
гочами (домен через env, локальный HTTP-источник для интеграции, `<img>` тянет
превью напрямую кросс-доменно).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md .claude/skills/verify/SKILL.md
git commit -m "Phase 9: docs + verify recipe for Shikimori import"
```

## Готово, когда

В менеджере медиа поиск по названию аниме/персонажа даёт живой дропдаун с
постером и фактами, клик импортирует постер в пул как картинку (с учётом квоты
и роли), схема БД не тронута, домен Shikimori настраивается одной переменной
env, всё покрыто юнит- и интеграционными тестами и провалидировано вживую.
```
