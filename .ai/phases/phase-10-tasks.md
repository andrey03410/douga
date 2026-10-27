# Фаза 10 — MCP-сервер: ИИ сам собирает пикер — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдать возможности приложения как MCP-сервер (stdio), чтобы внешний
ИИ-клиент сам собрал видео-проект «Пикер»: discovery в Shikimori (студия →
аниме → персонажи), импорт постеров/аудио в пул и раскладка по раундам с
назначением ответа.

**Architecture:** Отдельный Node-entrypoint `src/mcp/server.ts` на
`@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), запускается
через `tsx`. Инструменты — тонкий адаптер над существующим фреймворк-независимым
сервисным слоем (`src/server/*`), ноль дублирования, та же БД/квоты/сторедж.
Идентичность актора берётся из env `MCP_ACTOR_EMAIL`. Рендер не экспонируется —
инструмент отдаёт ссылку `/projects/<id>`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk@^1.29`, `tsx@^4.23`,
`zod@^3.23` (уже есть), Prisma/SQLite, Vitest.

Спека: [`.ai/specs/10-mcp-server.md`](../specs/10-mcp-server.md).

## Global Constraints

- **`server-only` в Node-процессе.** Модули `src/server/*` начинаются с
  `import "server-only"`, который бросает вне RSC. MCP-процесс — обычный Node,
  поэтому запускается с `tsconfig.mcp.json`, где `paths` алиасит
  `"server-only"` на существующий стаб `src/test/server-only-stub.ts`
  (проверено: `tsx` резолвит bare-специфаер через tsconfig `paths`). В самих
  файлах `src/mcp/*` строку `import "server-only"` НЕ добавлять.
- **Ноль дублирования доменной логики.** Все мутации идут через существующие
  сервисные функции (`createProject`, `addRound`, `patchRound`, `addTile`,
  `patchTile`, `setPlaylist`, `importPoster`, `startDownload`). MCP-слой их
  только вызывает и форматирует ответ.
- **Квоты и права.** Импорт-инструменты берут потолок пула из
  `quotasFor(actor.role).maxPoolBytes` и проверяют `can(actor.role,
  "media:upload")`; на нехватку прав/квоты возвращают текстовую ошибку, не роняя
  MCP-сессию.
- **Изоляция актора.** Каждая мутация вызывается с `actor.userId`; сервисный
  слой уже фильтрует чужие сущности (`NOT_FOUND`).
- **Ответы инструментов — JSON-текст.** Успех:
  `{ content: [{ type: "text", text: JSON.stringify(data) }] }`. Ошибка: то же
  с `isError: true` и телом `{ error: "<человекочитаемо>" }`. Сессия не падает.
- **Русские сообщения об ошибках** в пользовательском тексте (как в остальном
  проекте); имена инструментов и ключи JSON — латиницей.
- **Тесты не ходят в реальную сеть.** Shikimori в тестах — локальный HTTP-сервер
  через `SHIKIMORI_BASE_URL` (паттерн фазы 9). Реальный shikimori.io — только в
  ручной верификации.
- **Перед авторитетным `npm test` останавливать dev-сервер** (общий
  `prisma/dev.db` → блокировки SQLite).

## File Structure

Создаётся:
- `tsconfig.mcp.json` — extends базовый, `paths` c алиасом `server-only`.
- `src/mcp/actor.ts` — резолв `MCP_ACTOR_EMAIL` → `{userId, email, role}`.
- `src/mcp/compose.ts` — композит `addTileFromShikimori` (импорт постера + плитка).
- `src/mcp/youtube.ts` — `pollDownload` + `importYoutubeAudio` (обёртка над `startDownload`).
- `src/mcp/project-summary.ts` — чистый форматтер `LoadedProject` → компактный JSON.
- `src/mcp/server.ts` — bootstrap: `McpServer`, регистрация всех инструментов, stdio.
- `src/integration/mcp-actor.integration.test.ts`
- `src/integration/mcp-compose.integration.test.ts`
- `src/integration/mcp-youtube.integration.test.ts`
- `src/mcp/project-summary.test.ts`
- `src/integration/mcp.e2e.test.ts`

Изменяется:
- `src/lib/domain/shikimori.ts` (+ `matchStudios`, `extractRoleCharacters`, тип `StudioResult`).
- `src/lib/domain/shikimori.test.ts` (+ юнит-тесты discovery-мапперов).
- `src/lib/shikimori.ts` (+ `fetchStudiosRaw`, `fetchStudioAnimesRaw`, `fetchAnimeRolesRaw`).
- `src/server/shikimori.ts` (+ `findStudio`, `studioAnimes`, `animeCharacters`; рефактор `search` на общие DTO-хелперы).
- `src/integration/shikimori.integration.test.ts` (+ endpoints и тесты discovery).
- `package.json` (deps + скрипт `mcp`).
- `.env.example` (+ `MCP_ACTOR_EMAIL`).
- `README.md`, `CLAUDE.md` (документация MCP + счётчик тестов).

---

## Task 1: Доменные хелперы discovery (чистые, без сети)

**Files:**
- Modify: `src/lib/domain/shikimori.ts`
- Test: `src/lib/domain/shikimori.test.ts`

**Interfaces:**
- Consumes: существующие `CharacterResult`, `mapCharacterResult` из этого же файла.
- Produces:
  - `interface StudioResult { id: number; name: string }`
  - `matchStudios(rawList: unknown[], query: string, limit: number): StudioResult[]`
  - `extractRoleCharacters(rawRoles: unknown[], role: "Main" | "all"): CharacterResult[]`

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `src/lib/domain/shikimori.test.ts` (файл уже импортирует
хелперы из `./shikimori`; расширить импорт на `matchStudios`,
`extractRoleCharacters`, тип `StudioResult`):

```ts
import { matchStudios, extractRoleCharacters } from "./shikimori";

describe("matchStudios", () => {
  const studios = [
    { id: 11, name: "Madhouse", filtered_name: "Madhouse", real: false, image: null },
    { id: 2, name: "Studio Madhouse Jr", filtered_name: "Madhouse Jr", real: false },
    { id: 7, name: "Bones", filtered_name: "Bones" },
    { id: 99, name: 123 }, // мусор: name не строка
  ];
  it("matches by name substring, case-insensitive", () => {
    const res = matchStudios(studios, "madhouse", 10);
    expect(res.map((s) => s.id).sort()).toEqual([2, 11]);
    expect(res[0]).toEqual({ id: 11, name: "Madhouse" });
  });
  it("matches by filtered_name when name differs", () => {
    const res = matchStudios([{ id: 5, name: "Studio X", filtered_name: "Bones" }], "bones", 10);
    expect(res).toEqual([{ id: 5, name: "Studio X" }]);
  });
  it("respects the limit and skips malformed entries", () => {
    expect(matchStudios(studios, "o", 1)).toHaveLength(1);
    expect(matchStudios(studios, "", 10)).toEqual([]);
  });
});

describe("extractRoleCharacters", () => {
  const roles = [
    { roles: ["Main"], character: { id: 17, name: "Naruto", russian: "Наруто",
      image: { original: "/system/characters/original/17.jpg", preview: "/system/characters/preview/17.jpg" } } },
    { roles: ["Supporting"], character: { id: 18, name: "Sakura", russian: "Сакура",
      image: { original: "/system/characters/original/18.jpg", preview: "/system/characters/preview/18.jpg" } } },
    { roles: ["Main"], character: { id: "bad" } }, // мусорный персонаж
  ];
  it("keeps only Main-role characters and maps them", () => {
    const res = extractRoleCharacters(roles, "Main");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 17, name: "Naruto", russian: "Наруто",
      posterPath: "/system/characters/original/17.jpg" });
  });
  it("role='all' keeps every valid character", () => {
    expect(extractRoleCharacters(roles, "all").map((c) => c.id).sort()).toEqual([17, 18]);
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run src/lib/domain/shikimori.test.ts`
Expected: FAIL — `matchStudios`/`extractRoleCharacters` не экспортированы.

- [ ] **Step 3: Реализовать хелперы**

Добавить в конец `src/lib/domain/shikimori.ts`:

```ts
export interface StudioResult {
  id: number;
  name: string;
}

interface RawStudio {
  id?: unknown;
  name?: unknown;
  filtered_name?: unknown;
}

/** Studios have no search endpoint — filter the full list by name locally. */
export function matchStudios(rawList: unknown[], query: string, limit: number): StudioResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: StudioResult[] = [];
  for (const raw of rawList) {
    const s = raw as RawStudio;
    if (typeof s?.id !== "number" || typeof s?.name !== "string" || !s.name.trim()) continue;
    const filtered = typeof s.filtered_name === "string" ? s.filtered_name : "";
    if (s.name.toLowerCase().includes(q) || filtered.toLowerCase().includes(q)) {
      out.push({ id: s.id, name: s.name });
    }
  }
  return out.slice(0, limit);
}

interface RawRoleEntry {
  roles?: unknown;
  character?: unknown;
}

/** Pull characters out of an /animes/:id/roles response, optionally Main-only. */
export function extractRoleCharacters(
  rawRoles: unknown[],
  role: "Main" | "all",
): CharacterResult[] {
  const out: CharacterResult[] = [];
  for (const raw of rawRoles) {
    const r = raw as RawRoleEntry;
    const roles = Array.isArray(r?.roles) ? r.roles : [];
    if (role === "Main" && !roles.includes("Main")) continue;
    const ch = mapCharacterResult(r?.character);
    if (ch) out.push(ch);
  }
  return out;
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run src/lib/domain/shikimori.test.ts`
Expected: PASS (старые + новые).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/shikimori.ts src/lib/domain/shikimori.test.ts
git commit -m "Phase 10: domain helpers for Shikimori discovery (studios, roles)"
```

---

## Task 2: Клиент + сервисные функции discovery

**Files:**
- Modify: `src/lib/shikimori.ts`
- Modify: `src/server/shikimori.ts`
- Test: `src/integration/shikimori.integration.test.ts`

**Interfaces:**
- Consumes: `getJson` (private, `src/lib/shikimori.ts`); `matchStudios`,
  `extractRoleCharacters`, `StudioResult`, `mapAnimeResult` (Task 1 + существующие).
- Produces (в `src/lib/shikimori.ts`):
  - `fetchStudiosRaw(): Promise<unknown[]>`
  - `fetchStudioAnimesRaw(studioId: number, order: string, limit: number): Promise<unknown[]>`
  - `fetchAnimeRolesRaw(animeId: number): Promise<unknown[]>`
- Produces (в `src/server/shikimori.ts`):
  - `findStudio(query: string, limit?: number): Promise<StudioResult[]>`
  - `studioAnimes(studioId: number, opts?: { order?: string; limit?: number }): Promise<SearchDto[]>`
  - `animeCharacters(animeId: number, opts?: { role?: "Main" | "all" }): Promise<SearchDto[]>`

- [ ] **Step 1: Написать падающие интеграционные тесты**

Расширить локальный HTTP-сервер в `beforeAll` (`src/integration/shikimori.integration.test.ts`) новыми ветками ПЕРЕД финальным `res.statusCode = 404`:

```ts
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
```

Расширить импорт сверху файла: `import { search, importPoster, findStudio, studioAnimes, animeCharacters } from "@/server/shikimori";`

Добавить блок тестов в конец файла:

```ts
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
  it("role='all' includes supporting characters", async () => {
    const res = await animeCharacters(1535, { role: "all" });
    expect(res.map((c) => c.id).sort()).toEqual([17, 18]);
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run src/integration/shikimori.integration.test.ts`
Expected: FAIL — `findStudio`/`studioAnimes`/`animeCharacters` не экспортированы.

- [ ] **Step 3: Добавить raw-клиенты**

В `src/lib/shikimori.ts`, после `searchCharactersRaw`, добавить:

```ts
export async function fetchStudiosRaw(): Promise<unknown[]> {
  const data = await getJson(`/api/studios`);
  return Array.isArray(data) ? data : [];
}

export async function fetchStudioAnimesRaw(
  studioId: number,
  order: string,
  limit: number,
): Promise<unknown[]> {
  const data = await getJson(
    `/api/animes?studio=${studioId}&order=${encodeURIComponent(order)}&limit=${limit}`,
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchAnimeRolesRaw(animeId: number): Promise<unknown[]> {
  const data = await getJson(`/api/animes/${animeId}/roles`);
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 4: Рефактор `search` на общие DTO-хелперы и добавить discovery**

В `src/server/shikimori.ts`:

1. Расширить импорт из домена:

```ts
import {
  mapAnimeResult,
  mapCharacterResult,
  matchStudios,
  extractRoleCharacters,
  pickLabel,
  absoluteImageUrl,
  isSafeImagePath,
  type ShikimoriType,
  type AnimeResult,
  type CharacterResult,
  type StudioResult,
} from "@/lib/domain/shikimori";
import {
  shikimoriBase,
  searchAnimesRaw,
  searchCharactersRaw,
  fetchPoster,
  fetchStudiosRaw,
  fetchStudioAnimesRaw,
  fetchAnimeRolesRaw,
} from "@/lib/shikimori";
```

2. Добавить (после `animeFacts`) чистые DTO-хелперы и убрать дублирование в `search`:

```ts
const MAX_DISCOVERY = 50;
const clampLimit = (n: number | undefined, def: number) =>
  Math.min(Math.max(1, Math.floor(n ?? def)), MAX_DISCOVERY);

function thumbFor(base: string, previewPath: string | null): string | null {
  return previewPath && isSafeImagePath(previewPath) ? absoluteImageUrl(base, previewPath) : null;
}

function animeToDto(base: string, r: AnimeResult): SearchDto {
  return {
    id: r.id, type: "anime", label: pickLabel(r.russian, r.name),
    thumbUrl: thumbFor(base, r.previewPath), posterPath: r.posterPath,
    facts: animeFacts(r.kind, r.score, r.year),
  };
}

function characterToDto(base: string, r: CharacterResult): SearchDto {
  return {
    id: r.id, type: "character", label: pickLabel(r.russian, r.name),
    thumbUrl: thumbFor(base, r.previewPath), posterPath: r.posterPath,
    facts: r.russian && r.russian !== r.name ? r.name : null,
  };
}
```

3. Переписать тело `search` через новые хелперы (поведение неизменно):

```ts
export async function search(type: ShikimoriType, q: string, limit = MAX_RESULTS): Promise<SearchDto[]> {
  const query = q.trim();
  if (!query) return [];
  const base = shikimoriBase();

  if (type === "anime") {
    const raw = await searchAnimesRaw(query, limit);
    return raw.map(mapAnimeResult).filter((r): r is AnimeResult => r != null)
      .slice(0, limit).map((r) => animeToDto(base, r));
  }
  const raw = await searchCharactersRaw(query);
  return raw.map(mapCharacterResult).filter((r): r is CharacterResult => r != null)
    .slice(0, limit).map((r) => characterToDto(base, r));
}
```

4. Добавить discovery-функции (после `search`, перед `ImportPosterInput`):

```ts
export async function findStudio(query: string, limit = MAX_RESULTS): Promise<StudioResult[]> {
  if (!query.trim()) return [];
  const raw = await fetchStudiosRaw();
  return matchStudios(raw, query, clampLimit(limit, MAX_RESULTS));
}

export async function studioAnimes(
  studioId: number,
  opts: { order?: string; limit?: number } = {},
): Promise<SearchDto[]> {
  const order = opts.order?.trim() || "popularity";
  const limit = clampLimit(opts.limit, 20);
  const base = shikimoriBase();
  const raw = await fetchStudioAnimesRaw(studioId, order, limit);
  return raw.map(mapAnimeResult).filter((r): r is AnimeResult => r != null)
    .slice(0, limit).map((r) => animeToDto(base, r));
}

export async function animeCharacters(
  animeId: number,
  opts: { role?: "Main" | "all" } = {},
): Promise<SearchDto[]> {
  const base = shikimoriBase();
  const raw = await fetchAnimeRolesRaw(animeId);
  return extractRoleCharacters(raw, opts.role ?? "Main").map((r) => characterToDto(base, r));
}
```

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run src/integration/shikimori.integration.test.ts`
Expected: PASS (старые search/import + новые discovery).

- [ ] **Step 6: Commit**

```bash
git add src/lib/shikimori.ts src/server/shikimori.ts src/integration/shikimori.integration.test.ts
git commit -m "Phase 10: Shikimori discovery service (studio/animes/roles)"
```

---

## Task 3: Зависимости, tsconfig.mcp, резолв актора

**Files:**
- Modify: `package.json`
- Create: `tsconfig.mcp.json`
- Create: `src/mcp/actor.ts`
- Modify: `.env.example`
- Test: `src/integration/mcp-actor.integration.test.ts`

**Interfaces:**
- Produces: `interface Actor { userId: string; email: string; role: string }` и
  `resolveActor(): Promise<Actor>` в `src/mcp/actor.ts`.

- [ ] **Step 1: Установить зависимости**

Run:
```bash
npm install @modelcontextprotocol/sdk@^1.29.0 && npm install -D tsx@^4.23.0
```
Expected: обе записаны в `package.json` (dep и devDep соответственно), `package-lock.json` обновлён.

- [ ] **Step 2: Создать `tsconfig.mcp.json`**

`paths` в `extends` полностью перекрывается, поэтому `@/*` переобъявляется:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "server-only": ["./src/test/server-only-stub.ts"]
    }
  }
}
```

- [ ] **Step 3: Добавить скрипт `mcp` в `package.json`**

В блок `"scripts"` добавить:
```json
    "mcp": "tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json src/mcp/server.ts",
```

- [ ] **Step 4: Добавить `MCP_ACTOR_EMAIL` в `.env.example`**

Добавить строку в конец `.env.example`:
```
MCP_ACTOR_EMAIL="you@example.com"
```

- [ ] **Step 5: Написать падающий тест актора**

Create `src/integration/mcp-actor.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolveActor } from "@/mcp/actor";

const EMAIL = "integration-mcp-actor@test.local";
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.MCP_ACTOR_EMAIL;
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
});

afterAll(async () => {
  if (saved === undefined) delete process.env.MCP_ACTOR_EMAIL;
  else process.env.MCP_ACTOR_EMAIL = saved;
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("resolveActor", () => {
  it("resolves userId + role from MCP_ACTOR_EMAIL", async () => {
    process.env.MCP_ACTOR_EMAIL = EMAIL;
    const actor = await resolveActor();
    expect(actor.email).toBe(EMAIL);
    expect(actor.role).toBe("admin");
    expect(actor.userId).toMatch(/.+/);
  });
  it("throws a clear error when the env var is unset", async () => {
    delete process.env.MCP_ACTOR_EMAIL;
    await expect(resolveActor()).rejects.toThrow(/MCP_ACTOR_EMAIL/);
  });
  it("throws when no account matches", async () => {
    process.env.MCP_ACTOR_EMAIL = "nobody@test.local";
    await expect(resolveActor()).rejects.toThrow(/nobody@test.local/);
  });
});
```

- [ ] **Step 6: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/integration/mcp-actor.integration.test.ts`
Expected: FAIL — `@/mcp/actor` не существует.

- [ ] **Step 7: Реализовать `src/mcp/actor.ts`**

```ts
import { prisma } from "@/lib/db";

// The MCP server acts on behalf of exactly one account, identified by
// MCP_ACTOR_EMAIL. All tool calls run with this user's id, role and quotas.
export interface Actor {
  userId: string;
  email: string;
  role: string;
}

export async function resolveActor(): Promise<Actor> {
  const email = process.env.MCP_ACTOR_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "MCP_ACTOR_EMAIL не задан — укажите email аккаунта, от имени которого работает MCP-сервер",
    );
  }
  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new Error(`Аккаунт для MCP_ACTOR_EMAIL="${email}" не найден — сначала зарегистрируйте его в приложении`);
  }
  return { userId: user.id, email: user.email, role: user.role };
}
```

- [ ] **Step 8: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/integration/mcp-actor.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.mcp.json src/mcp/actor.ts .env.example src/integration/mcp-actor.integration.test.ts
git commit -m "Phase 10: MCP deps, tsconfig shim, actor resolution"
```

---

## Task 4: Композит, поллер загрузок, форматтер проекта

**Files:**
- Create: `src/mcp/compose.ts`
- Create: `src/mcp/youtube.ts`
- Create: `src/mcp/project-summary.ts`
- Test: `src/mcp/project-summary.test.ts`
- Test: `src/integration/mcp-compose.integration.test.ts`
- Test: `src/integration/mcp-youtube.integration.test.ts`

**Interfaces:**
- Consumes: `importPoster` (`@/server/shikimori`), `addTile`, `patchTile`,
  `startDownload` (`@/server/downloads`), `LoadedProject` (`@/server/projects`),
  `ShikimoriType` (`@/lib/domain/shikimori`).
- Produces:
  - `addTileFromShikimori(userId, input): Promise<{ tileId: string; artId: string }>`
    где `input: { roundId: string; type: ShikimoriType; id: number; posterPath: string; label?: string | null; isAnswer?: boolean; maxPoolBytes: number | null }`
  - `pollDownload(jobId: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<{ artId: string }>`
  - `importYoutubeAudio(userId, input): Promise<{ artId: string }>`
    где `input: { url: string; maxPoolBytes: number | null; timeoutMs?: number }`
  - `projectSummary(p: LoadedProject): ProjectSummary`

- [ ] **Step 1: Написать падающий юнит-тест форматтера**

Create `src/mcp/project-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { projectSummary } from "./project-summary";
import type { LoadedProject } from "@/server/projects";

const fake = {
  id: "p1", title: "Персонажи Madhouse", kind: "picker",
  playlist: [{ artId: "a9", art: { label: "OST" } }],
  rounds: [
    { id: "r1", order: 0, prompt: "Кто главный?",
      tiles: [
        { id: "t1", label: "Лайт", isAnswer: true, artId: "a1" },
        { id: "t2", label: "Рюук", isAnswer: false, artId: "a2" },
      ] },
  ],
} as unknown as LoadedProject;

describe("projectSummary", () => {
  it("projects a loaded project into a compact structure", () => {
    const s = projectSummary(fake);
    expect(s).toEqual({
      id: "p1", title: "Персонажи Madhouse", kind: "picker", url: "/projects/p1",
      playlist: [{ artId: "a9", label: "OST" }],
      rounds: [
        { id: "r1", order: 0, prompt: "Кто главный?",
          tiles: [
            { id: "t1", label: "Лайт", isAnswer: true, artId: "a1" },
            { id: "t2", label: "Рюук", isAnswer: false, artId: "a2" },
          ] },
      ],
    });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/mcp/project-summary.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать `src/mcp/project-summary.ts`**

```ts
import type { LoadedProject } from "@/server/projects";

export interface ProjectSummary {
  id: string;
  title: string;
  kind: string;
  url: string;
  playlist: { artId: string; label: string | null }[];
  rounds: {
    id: string;
    order: number;
    prompt: string | null;
    tiles: { id: string; label: string | null; isAnswer: boolean; artId: string | null }[];
  }[];
}

/** Compact, agent-friendly view of a project for the get_project tool. */
export function projectSummary(p: LoadedProject): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    kind: p.kind,
    url: `/projects/${p.id}`,
    playlist: p.playlist.map((pl) => ({ artId: pl.artId, label: pl.art.label })),
    rounds: p.rounds.map((r) => ({
      id: r.id,
      order: r.order,
      prompt: r.prompt,
      tiles: r.tiles.map((t) => ({
        id: t.id, label: t.label, isAnswer: t.isAnswer, artId: t.artId,
      })),
    })),
  };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npx vitest run src/mcp/project-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Реализовать `src/mcp/compose.ts`**

```ts
import { importPoster } from "@/server/shikimori";
import { addTile, patchTile } from "@/server/projects";
import type { ShikimoriType } from "@/lib/domain/shikimori";

export interface AddTileFromShikimoriInput {
  roundId: string;
  type: ShikimoriType;
  id: number;
  posterPath: string;
  label?: string | null;
  isAnswer?: boolean;
  maxPoolBytes: number | null;
}

/** Import a Shikimori poster into the pool and place it as a tile in one call. */
export async function addTileFromShikimori(
  userId: string,
  input: AddTileFromShikimoriInput,
): Promise<{ tileId: string; artId: string }> {
  const { artId } = await importPoster(userId, {
    type: input.type,
    id: input.id,
    posterPath: input.posterPath,
    label: input.label ?? null,
    maxPoolBytes: input.maxPoolBytes,
  });
  const tile = await addTile(userId, input.roundId, artId);
  if (input.label != null || input.isAnswer) {
    await patchTile(userId, tile.id, {
      ...(input.label != null ? { label: input.label } : {}),
      ...(input.isAnswer ? { isAnswer: true } : {}),
    });
  }
  return { tileId: tile.id, artId };
}
```

- [ ] **Step 6: Реализовать `src/mcp/youtube.ts`**

```ts
import { prisma } from "@/lib/db";
import { startDownload } from "@/server/downloads";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 1_000;

/** Poll a DownloadJob to completion; resolves with the produced pool artId. */
export async function pollDownload(
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ artId: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Задача загрузки исчезла");
    if (job.status === "done" && job.artId) return { artId: job.artId };
    if (job.status === "failed") throw new Error(job.error || "Загрузка не удалась");
    if (job.status === "canceled") throw new Error("Загрузка отменена");
    if (Date.now() > deadline) throw new Error("Тайм-аут загрузки — попробуйте позже или другое качество");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ImportYoutubeAudioInput {
  url: string;
  maxPoolBytes: number | null;
  timeoutMs?: number;
}

/** Start a yt-dlp audio download and wait until it lands in the pool. */
export async function importYoutubeAudio(
  userId: string,
  input: ImportYoutubeAudioInput,
): Promise<{ artId: string }> {
  const job = await startDownload(userId, {
    url: input.url,
    mode: "audio",
    maxPoolBytes: input.maxPoolBytes,
  });
  return pollDownload(job.id, { timeoutMs: input.timeoutMs });
}
```

- [ ] **Step 7: Написать падающий интеграционный тест композита**

Create `src/integration/mcp-compose.integration.test.ts` (тот же локальный
Shikimori-паттерн, что в `shikimori.integration.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
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
});
```

- [ ] **Step 8: Написать падающий интеграционный тест поллера**

Create `src/integration/mcp-youtube.integration.test.ts` (без сети — прямая
работа с DownloadJob-строкой):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { pollDownload } from "@/mcp/youtube";

const EMAIL = "integration-mcp-youtube@test.local";
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.downloadJob.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("pollDownload", () => {
  it("resolves with artId when the job completes", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "running" },
    });
    setTimeout(() => {
      void prisma.downloadJob.update({ where: { id: job.id }, data: { status: "done", artId: "art-xyz" } });
    }, 150);
    const res = await pollDownload(job.id, { timeoutMs: 5000, intervalMs: 50 });
    expect(res.artId).toBe("art-xyz");
  });

  it("throws with the job error when the job fails", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "failed", error: "boom" },
    });
    await expect(pollDownload(job.id, { timeoutMs: 1000, intervalMs: 50 })).rejects.toThrow("boom");
  });

  it("throws on timeout while still running", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "running" },
    });
    await expect(pollDownload(job.id, { timeoutMs: 120, intervalMs: 40 })).rejects.toThrow(/Тайм-аут/);
  });
});
```

Примечание: поля `DownloadJob` (`url`, `mode`, `quality`, `status`, `artId`,
`error`) взяты из существующего использования в `src/server/downloads.ts`.
Если фактические not-null-поля схемы отличаются — свериться со
`schema.prisma` и добавить недостающие в `data`.

- [ ] **Step 9: Запустить новые интеграционные тесты — убедиться, что проходят**

Run: `npx vitest run src/integration/mcp-compose.integration.test.ts src/integration/mcp-youtube.integration.test.ts`
Expected: PASS (dev-сервер остановлен, иначе возможны блокировки SQLite).

- [ ] **Step 10: Commit**

```bash
git add src/mcp/compose.ts src/mcp/youtube.ts src/mcp/project-summary.ts src/mcp/project-summary.test.ts src/integration/mcp-compose.integration.test.ts src/integration/mcp-youtube.integration.test.ts
git commit -m "Phase 10: MCP compose (tile-from-shikimori), download poller, project summary"
```

---

## Task 5: MCP-сервер (регистрация инструментов + stdio) и E2E

**Files:**
- Create: `src/mcp/server.ts`
- Test: `src/integration/mcp.e2e.test.ts`

**Interfaces:**
- Consumes: `resolveActor` (`@/mcp/actor`); `search`, `findStudio`,
  `studioAnimes`, `animeCharacters`, `importPoster` (`@/server/shikimori`);
  `createProject`, `getProject`, `addRound`, `patchRound`, `addTile`,
  `patchTile`, `setPlaylist` (`@/server/projects`); `addTileFromShikimori`
  (`@/mcp/compose`); `importYoutubeAudio` (`@/mcp/youtube`); `projectSummary`
  (`@/mcp/project-summary`); `quotasFor`, `can` (`@/lib/domain/permissions`).
- Produces: исполняемый stdio MCP-сервер; список инструментов — см. Step 3.

- [ ] **Step 1: Написать падающий E2E-тест**

Create `src/integration/mcp.e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
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

beforeAll(async () => {
  shiki = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
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

  transport = new StdioClientTransport({
    command: resolve(ROOT, "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: ROOT,
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      MCP_ACTOR_EMAIL: EMAIL,
      SHIKIMORI_BASE_URL: `http://127.0.0.1:${port}`,
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

describe("MCP server end-to-end (Madhouse scenario)", () => {
  it("exposes the expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      "shikimori_find_studio", "shikimori_studio_animes", "shikimori_anime_characters",
      "shikimori_search", "import_shikimori_poster", "import_youtube_audio",
      "create_picker_project", "add_round", "add_tile", "add_tile_from_shikimori",
      "set_playlist", "get_project",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("builds a two-round picker with answers via tools", async () => {
    const { projectId, firstRoundId } = await call("create_picker_project", { title: "Персонажи Madhouse" });
    expect(projectId).toMatch(/.+/);

    const studios = await call("shikimori_find_studio", { query: "Madhouse" });
    expect(studios[0]).toMatchObject({ id: 11, name: "Madhouse" });

    const animes = await call("shikimori_studio_animes", { studioId: 11 });
    expect(animes[0]).toMatchObject({ id: 1535, type: "anime" });

    const chars = await call("shikimori_anime_characters", { animeId: 1535 });
    expect(chars.map((c: { id: number }) => c.id).sort()).toEqual([17, 18]);

    await call("add_tile_from_shikimori", {
      roundId: firstRoundId, type: "character", id: 17,
      posterPath: "/system/characters/original/17.jpg", label: "Лайт", isAnswer: true,
    });
    await call("add_tile_from_shikimori", {
      roundId: firstRoundId, type: "character", id: 18,
      posterPath: "/system/characters/original/18.jpg", label: "Эл",
    });

    const { roundId } = await call("add_round", { projectId, prompt: "Второй раунд" });
    await call("add_tile_from_shikimori", {
      roundId, type: "character", id: 17,
      posterPath: "/system/characters/original/17.jpg", label: "Лайт", isAnswer: true,
    });

    const summary = await call("get_project", { projectId });
    expect(summary.rounds).toHaveLength(2);
    expect(summary.rounds[0].tiles).toHaveLength(2);
    expect(summary.rounds[0].tiles.filter((t: { isAnswer: boolean }) => t.isAnswer)).toHaveLength(1);

    // The project really exists in the DB for the actor.
    const rounds = await prisma.pickerRound.count({ where: { projectId, project: { userId } } });
    expect(rounds).toBe(2);
  }, 60_000);
});
```

- [ ] **Step 2: Запустить E2E — убедиться, что падает**

Run: `npx vitest run src/integration/mcp.e2e.test.ts`
Expected: FAIL — `src/mcp/server.ts` не существует (спавн tsx не находит модуль).

- [ ] **Step 3: Реализовать `src/mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveActor, type Actor } from "@/mcp/actor";
import { can, quotasFor } from "@/lib/domain/permissions";
import { search, findStudio, studioAnimes, animeCharacters, importPoster } from "@/server/shikimori";
import {
  createProject, getProject, addRound, patchRound, addTile, patchTile, setPlaylist,
} from "@/server/projects";
import { addTileFromShikimori } from "@/mcp/compose";
import { importYoutubeAudio } from "@/mcp/youtube";
import { projectSummary } from "@/mcp/project-summary";
import type { ShikimoriType } from "@/lib/domain/shikimori";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

/** Wrap a handler so service-layer throws become tool errors, not crashes. */
function guard(fn: () => Promise<unknown>): Promise<ToolResult> {
  return fn().then(ok).catch((e) => fail((e as Error)?.message ?? String(e)));
}

async function main() {
  const actor: Actor = await resolveActor();
  const maxPoolBytes = quotasFor(actor.role).maxPoolBytes;
  const canUpload = can(actor.role, "media:upload");
  const uid = actor.userId;

  const server = new McpServer({ name: "douga", version: "0.1.0" });

  // ---- Discovery (Shikimori, read-only) ----
  server.registerTool(
    "shikimori_find_studio",
    { description: "Найти студию Shikimori по названию. → [{id, name}]",
      inputSchema: { query: z.string() } },
    ({ query }) => guard(() => findStudio(query)),
  );
  server.registerTool(
    "shikimori_studio_animes",
    { description: "Аниме студии (по умолчанию по популярности). → [{id, type:'anime', label, posterPath, facts}]",
      inputSchema: { studioId: z.number(), order: z.string().optional(), limit: z.number().optional() } },
    ({ studioId, order, limit }) => guard(() => studioAnimes(studioId, { order, limit })),
  );
  server.registerTool(
    "shikimori_anime_characters",
    { description: "Персонажи аниме (по умолчанию только Main). → [{id, type:'character', label, posterPath}]",
      inputSchema: { animeId: z.number(), role: z.enum(["Main", "all"]).optional() } },
    ({ animeId, role }) => guard(() => animeCharacters(animeId, { role })),
  );
  server.registerTool(
    "shikimori_search",
    { description: "Поиск аниме или персонажа по названию. → [{id, type, label, posterPath, facts}]",
      inputSchema: { type: z.enum(["anime", "character"]), query: z.string() } },
    ({ type, query }) => guard(() => search(type, query)),
  );

  // ---- Pool imports ----
  server.registerTool(
    "import_shikimori_poster",
    { description: "Импортировать постер (аниме/персонаж) в пул как картинку. → {artId}",
      inputSchema: { type: z.enum(["anime", "character"]), id: z.number(), posterPath: z.string(), label: z.string().optional() } },
    ({ type, id, posterPath, label }) =>
      !canUpload ? Promise.resolve(fail("Импорт медиа недоступен вашей роли"))
        : guard(() => importPoster(uid, { type: type as ShikimoriType, id, posterPath, label: label ?? null, maxPoolBytes })),
  );
  server.registerTool(
    "import_youtube_audio",
    { description: "Скачать звук с YouTube (yt-dlp) в пул. Дожидается завершения. → {artId}",
      inputSchema: { url: z.string() } },
    ({ url }) =>
      !canUpload ? Promise.resolve(fail("Импорт медиа недоступен вашей роли"))
        : guard(() => importYoutubeAudio(uid, { url, maxPoolBytes })),
  );

  // ---- Picker building ----
  server.registerTool(
    "create_picker_project",
    { description: "Создать проект «Пикер». Стартует с одним пустым раундом (firstRoundId). → {projectId, firstRoundId}",
      inputSchema: { title: z.string() } },
    ({ title }) => guard(async () => {
      const project = await createProject(uid, title, "picker");
      const loaded = await getProject(uid, project.id);
      return { projectId: project.id, firstRoundId: loaded!.rounds[0]?.id ?? null };
    }),
  );
  server.registerTool(
    "add_round",
    { description: "Добавить раунд в пикер. Необязательные поля настраивают вопрос/таймер/показ ответа/подписи. → {roundId}",
      inputSchema: {
        projectId: z.string(),
        prompt: z.string().optional(),
        timerSec: z.number().optional(),
        revealSec: z.number().optional(),
        labelsMode: z.enum(["always", "finale", "never"]).optional(),
      } },
    ({ projectId, prompt, timerSec, revealSec, labelsMode }) => guard(async () => {
      const round = await addRound(uid, projectId);
      if (prompt != null || timerSec != null || revealSec != null || labelsMode != null) {
        await patchRound(uid, round.id, {
          ...(prompt != null ? { prompt, showPrompt: true } : {}),
          ...(timerSec != null ? { timerSec } : {}),
          ...(revealSec != null ? { revealSec } : {}),
          ...(labelsMode != null ? { labelsMode } : {}),
        });
      }
      return { roundId: round.id };
    }),
  );
  server.registerTool(
    "add_tile",
    { description: "Добавить плитку из уже импортированного арта (image/video) в раунд. → {tileId}",
      inputSchema: { roundId: z.string(), artId: z.string(), label: z.string().optional(), isAnswer: z.boolean().optional() } },
    ({ roundId, artId, label, isAnswer }) => guard(async () => {
      const tile = await addTile(uid, roundId, artId);
      if (label != null || isAnswer) {
        await patchTile(uid, tile.id, {
          ...(label != null ? { label } : {}),
          ...(isAnswer ? { isAnswer: true } : {}),
        });
      }
      return { tileId: tile.id };
    }),
  );
  server.registerTool(
    "add_tile_from_shikimori",
    { description: "Импортировать постер Shikimori и добавить плиткой в раунд одним вызовом. → {tileId, artId}",
      inputSchema: {
        roundId: z.string(), type: z.enum(["anime", "character"]), id: z.number(),
        posterPath: z.string(), label: z.string().optional(), isAnswer: z.boolean().optional(),
      } },
    ({ roundId, type, id, posterPath, label, isAnswer }) =>
      !canUpload ? Promise.resolve(fail("Импорт медиа недоступен вашей роли"))
        : guard(() => addTileFromShikimori(uid, {
            roundId, type: type as ShikimoriType, id, posterPath,
            label: label ?? null, isAnswer, maxPoolBytes,
          })),
  );
  server.registerTool(
    "set_playlist",
    { description: "Задать фоновую музыку пикера (упорядоченные id аудио-артов). → {ok:true}",
      inputSchema: { projectId: z.string(), artIds: z.array(z.string()) } },
    ({ projectId, artIds }) => guard(async () => { await setPlaylist(uid, projectId, artIds); return { ok: true }; }),
  );
  server.registerTool(
    "get_project",
    { description: "Прочитать структуру проекта (раунды/плитки/ответы/плейлист) для самопроверки. → summary",
      inputSchema: { projectId: z.string() } },
    ({ projectId }) => guard(async () => {
      const p = await getProject(uid, projectId);
      if (!p) throw new Error("Проект не найден");
      return projectSummary(p);
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Startup failure (e.g. actor unresolved): report on stderr and exit non-zero.
  process.stderr.write(`MCP server failed to start: ${(err as Error)?.message ?? err}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Запустить E2E — убедиться, что проходит**

Run: `npx vitest run src/integration/mcp.e2e.test.ts`
Expected: PASS (dev-сервер остановлен). Первый запуск медленный — tsx компилирует
сервер на лету; таймаут теста 60 c это покрывает.

- [ ] **Step 5: Ручной smoke — сервер реально стартует и отдаёт список инструментов**

Run:
```bash
MCP_ACTOR_EMAIL="$(sqlite3 prisma/dev.db 'select email from User order by createdAt limit 1;')" \
  bash -lc 'printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"version\":\"0\"}}}" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}" | npm run -s mcp' 2>/dev/null | tail -1
```
Expected: строка JSON c `"tools":[...]`, среди имён — `create_picker_project`,
`shikimori_find_studio` и т. д. (Если `sqlite3` нет — подставить любой
существующий email из аккаунтов вручную.)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts src/integration/mcp.e2e.test.ts
git commit -m "Phase 10: MCP stdio server with tools + end-to-end test"
```

---

## Task 6: Документация (README + CLAUDE.md + счётчик тестов)

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Прогнать весь тест-сет и зафиксировать число тестов**

Остановить dev-сервер, затем:
Run: `npm test 2>&1 | tail -5`
Expected: все тесты зелёные. Записать фактическое `Tests <N> passed` — это `<N>`
пойдёт в README/CLAUDE.md вместо прежних 242.

- [ ] **Step 2: Добавить в `README.md` раздел «MCP-сервер»**

Вставить новый раздел (после раздела про импорт по ссылке / Shikimori,
перед «Требованиями» — точное место определить по структуре файла). Содержимое:

````markdown
## MCP-сервер (ИИ сам собирает пикер)

Приложение умеет работать как **MCP-сервер** (stdio): внешний ИИ-клиент
(Claude Desktop / Claude Code) сам находит материал в Shikimori, импортирует
постеры и аудио в пул и раскладывает их по раундам проекта «Пикер». Рендер
остаётся в UI — инструменты возвращают ссылку `/projects/<id>`, вы проверяете
и рендерите проект сами.

### Запуск

MCP-сервер действует от имени одного аккаунта. Укажите его email и запустите:

```bash
# .env
MCP_ACTOR_EMAIL="you@example.com"   # email уже зарегистрированного аккаунта

npm run mcp
```

Права и квоты берутся из роли этого аккаунта (импорт требует роль с
`media:upload`; размер пула ограничен квотой роли).

### Подключение из Claude Desktop / Claude Code

В конфиге MCP-клиента (например `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "douga": {
      "command": "npm",
      "args": ["run", "-s", "mcp"],
      "cwd": "/абсолютный/путь/к/douga",
      "env": { "MCP_ACTOR_EMAIL": "you@example.com" }
    }
  }
}
```

### Доступные инструменты

| Инструмент | Назначение | Возвращает |
|---|---|---|
| `shikimori_find_studio` | найти студию по названию | `[{id, name}]` |
| `shikimori_studio_animes` | аниме студии (по популярности) | `[{id, type, label, posterPath, facts}]` |
| `shikimori_anime_characters` | персонажи аниме (по умолчанию Main) | `[{id, type, label, posterPath}]` |
| `shikimori_search` | поиск аниме/персонажа по названию | `[{id, type, label, posterPath, facts}]` |
| `import_shikimori_poster` | импорт постера в пул как картинку | `{artId}` |
| `import_youtube_audio` | скачать звук с YouTube (yt-dlp) в пул | `{artId}` |
| `create_picker_project` | создать пикер (уже с 1 пустым раундом) | `{projectId, firstRoundId}` |
| `add_round` | добавить раунд (вопрос/таймер/подписи) | `{roundId}` |
| `add_tile` | плитка из готового арта | `{tileId}` |
| `add_tile_from_shikimori` | импорт постера + плитка одним вызовом | `{tileId, artId}` |
| `set_playlist` | фоновая музыка пикера | `{ok}` |
| `get_project` | структура проекта для самопроверки | `summary` |

### Пример сценария (студия Madhouse, 4 варианта, 10 раундов)

Попросите ИИ: «Собери пикер персонажей студии Madhouse, по 4 варианта в
раунде, 10 раундов, в каждом отметь одного как правильный ответ». ИИ сам:
`shikimori_find_studio("Madhouse")` → `shikimori_studio_animes` →
`shikimori_anime_characters` → `create_picker_project` → циклом `add_round` +
`add_tile_from_shikimori` (один `isAnswer: true`) → `get_project` для сверки →
отдаёт ссылку на проект. Дальше вы открываете `/projects/<id>` и рендерите.
````

- [ ] **Step 3: Обновить статус в `CLAUDE.md`**

В блоке «## Статус» дописать фазу 10 в перечень (по образцу фаз 8–9) и
обновить счётчик тестов с 242 на фактический `<N>` из Step 1. Пример
формулировки фазы 10:

```
Фаза 10 — MCP-сервер: приложение отдаёт возможности как MCP (stdio,
@modelcontextprotocol/sdk), внешний ИИ сам собирает пикер — discovery в
Shikimori (студия→аниме→Main-персонажи), импорт постеров/YouTube-аудио в пул,
раскладка по раундам с назначением ответа; актор из MCP_ACTOR_EMAIL, права/
квоты через существующую ролевую модель, рендер остаётся в UI.
```

Также в предложении про стек/тесты заменить «242 теста» на «<N> тестов».

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Phase 10: docs — MCP server usage, tools reference, test count"
```

---

## Итоговая верификация (после всех задач)

- `npm test` — все тесты зелёные (dev-сервер остановлен).
- Ручной прогон реальным ИИ из Claude Code по инструкции README (сетевой,
  как smoke фаз 8–9): подключить MCP-сервер, попросить собрать небольшой пикер
  (например 2 раунда по 3 персонажа Madhouse), убедиться что проект появился в
  `/projects` и открывается. Это финальная проверка «убедись что всё работает».
