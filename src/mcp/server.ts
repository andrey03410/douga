import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveActor, type Actor } from "@/mcp/actor";
import { quotasFor } from "@/lib/domain/permissions";
import {
  search, findStudio, studioAnimes, animeCharacters, importPoster,
  findUser, userAnimeList, userFavourites, characterProfile, animeProfile,
  personProfile, userHistory,
} from "@/server/shikimori";
import { USER_RATE_STATUSES } from "@/lib/domain/shikimori";
import { absPath } from "@/lib/storage";
import { listArts, type PoolKind } from "@/server/arts";
import { listLocalMedia, importLocalMedia, mediaDirs } from "@/server/local-media";
import { importYoutubeAudio } from "@/mcp/youtube";
import type { ShikimoriType } from "@/lib/domain/shikimori";
import { registerStudioTools } from "@/mcp/studio-tools";
import { actor as authorizeActor } from "@/server/studio/shared";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

async function main() {
  const actor: Actor = await resolveActor();
  const uid = actor.userId;
  /** Authorize the signed-in account again on every call, so a role change applies at once. */
  function guard(fn: (current: Actor) => Promise<unknown>): Promise<ToolResult> {
    return authorizeActor(uid).then((user) => fn({ ...actor, role: user.role }))
      .then(ok).catch((e) => fail((e as Error)?.message ?? String(e)));
  }

  const server = new McpServer(
    { name: "douga", version: "0.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  registerStudioTools(server, actor);

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
    "shikimori_find_user",
    { description: "Найти пользователя Shikimori по нику (или по числовому id). → {id, nickname, url, avatarUrl}",
      inputSchema: { user: z.string() } },
    ({ user }) => guard(() => findUser(user)),
  );
  server.registerTool(
    "shikimori_user_anime_list",
    { description:
        "Список аниме пользователя с ЕГО оценками и статусами. status: planned (запланировано), " +
        "watching (смотрю), rewatching (пересматриваю), completed (просмотрено), on_hold (отложено), " +
        "dropped (брошено), all (весь список, по умолчанию). minScore отсекает по оценке юзера " +
        "(0 = без фильтра), order: score (по оценке, по умолчанию) | updated (по дате изменения) | name. " +
        "Список берётся целиком, поэтому сортировка/фильтр честные по всему списку; limit ≤ 500 (по умолчанию 50). " +
        "У записей с kind='music'/'pv'/'cm' персонажей нет — для сценария «персонажи из просмотренного» " +
        "бери kind tv/movie/ova/ona/special. " +
        "→ {user, total, countsByStatus, matched, items:[{id, type:'anime', label, kind, posterPath, facts, userScore, status, episodes, rewatches, updatedAt}]}",
      inputSchema: {
        user: z.string(),
        status: z.enum([...USER_RATE_STATUSES, "all"]).optional(),
        minScore: z.number().optional(),
        order: z.enum(["score", "updated", "name"]).optional(),
        limit: z.number().optional(),
      } },
    ({ user, status, minScore, order, limit }) =>
      guard(() => userAnimeList(user, { status, minScore, order, limit })),
  );
  server.registerTool(
    "shikimori_user_favourites",
    { description: "Избранное пользователя: аниме, персонажи, исполнители/другие люди (people) и сэйю (seiyuu). У аниме и персонажей posterPath готов для импорта. → {user,animes,characters,people,seiyuu}",
      inputSchema: { user: z.string() } },
    ({ user }) => guard(() => userFavourites(user)),
  );
  server.registerTool(
    "shikimori_person",
    { description: "Исполнитель или сэйю: имя, сайт и работы в аниме. → {id,label,url,website,works}",
      inputSchema: { id: z.number().int().positive() } },
    ({ id }) => guard(() => personProfile(id)),
  );
  server.registerTool(
    "shikimori_user_history",
    { description: "Публичная история просмотра и изменений оценок. Постранично, nextPage:null означает конец. Описания — исходный текст Shikimori. → {user,page,nextPage,items}",
      inputSchema: { user: z.string(), page: z.number().int().positive().default(1), limit: z.number().int().min(1).max(100).default(100) } },
    ({ user, page, limit }) => guard(() => userHistory(user, page, limit)),
  );
  server.registerTool(
    "shikimori_anime",
    { description:
        "Аниме с производственными студиями (спонсоры отброшены), годом, оценкой и жанрами. " +
        "Нужно, например, для раундов «студия против студии». " +
        "→ {id, type:'anime', label, kind, year, score, posterPath, studios:[{id, name}], genres, facts}",
      inputSchema: { id: z.number() } },
    ({ id }) => guard(() => animeProfile(id)),
  );
  server.registerTool(
    "shikimori_character",
    { description:
        "Персонаж и все аниме, где он появляется (старые сначала). debutYear — год первого " +
        "появления, то есть «эпоха» самого персонажа: у героини 2006 года она остаётся 2006 " +
        "даже в ремейке 2020-го. description — описание источника, может содержать BBCode и спойлеры. " +
        "→ {id, type:'character', label, description, posterPath, debutYear, animes:[{id, label, kind, year}]}",
      inputSchema: { id: z.number() } },
    ({ id }) => guard(() => characterProfile(id)),
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
    { description: "Импортировать постер (аниме/персонаж) в пул как картинку. Вернувшийся artId в документе SDK — это assetId привязки {kind:\"pool\", assetId}. → {artId}",
      inputSchema: { type: z.enum(["anime", "character"]), id: z.number(), posterPath: z.string(), label: z.string().optional() } },
    ({ type, id, posterPath, label }) =>
      guard((current) => importPoster(uid, { type: type as ShikimoriType, id, posterPath, label: label ?? null, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );
  server.registerTool(
    "list_pool",
    { description:
        "Что уже лежит в пуле медиа актора: картинки/видео/аудио с длительностью и путём файла " +
        "(filePath — абсолютный, картинку можно посмотреть глазами, если клиент умеет). " +
        "query фильтрует по подписи, kind — по типу; новые сверху. id арта в документе SDK — это assetId привязки {kind:\"pool\", assetId}. → {arts:[{id, label, kind, durationSec, hasAudio, sizeBytes, filePath, createdAt}], nextCursor}",
      inputSchema: {
        kind: z.enum(["image", "video", "audio"]).optional(),
        query: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      } },
    ({ kind, query, limit, cursor }) => guard(async () => {
      const page = await listArts(uid, { kind: kind as PoolKind | undefined, q: query, limit, cursor });
      return {
        arts: page.arts.map((a) => ({
          id: a.id,
          label: a.label,
          kind: a.kind,
          durationSec: a.durationSec,
          hasAudio: a.hasAudio,
          sizeBytes: a.sizeBytes,
          filePath: absPath(a.filePath),
          createdAt: a.createdAt,
        })),
        nextCursor: page.nextCursor,
      };
    }),
  );
  server.registerTool(
    "list_local_media",
    { description:
        "Медиа-файлы папки на диске машины (без рекурсии). Разрешены только папки из " +
        "MCP_LOCAL_MEDIA_DIRS: вне них — ошибка PATH_NOT_ALLOWED, без переменной — LOCAL_MEDIA_DISABLED. " +
        "После import_local_media artId файла в документе SDK — это assetId привязки {kind:\"pool\", assetId}. → {dir, roots, files:[{name, path, kind, sizeBytes}]}",
      inputSchema: { dir: z.string() } },
    ({ dir }) => guard(async () => ({ ...(await listLocalMedia(dir)), roots: mediaDirs() })),
  );
  server.registerTool(
    "import_local_media",
    { description:
        "Импортировать локальные файлы (пути из list_local_media) в пул. Оригиналы остаются на месте; " +
        "подпись берётся из имени файла. Не больше 50 файлов за вызов; проблемные файлы приходят " +
        "в failed (BAD_EXT / PATH_NOT_ALLOWED / NOT_FOUND / POOL_QUOTA), остальные импортируются. " +
        "artId в документе SDK — это assetId привязки {kind:\"pool\", assetId}. → {items:[{artId, label, kind, durationSec, sizeBytes}], failed:[{path, error}]}",
      inputSchema: { paths: z.array(z.string()) } },
    ({ paths }) =>
      guard((current) => importLocalMedia(uid, { paths, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );
  server.registerTool(
    "import_youtube_audio",
    { description: "Скачать звук с YouTube (yt-dlp) в пул. Дожидается завершения. artId в документе SDK — это assetId привязки {kind:\"pool\", assetId}. → {artId}",
      inputSchema: { url: z.string() } },
    ({ url }) =>
      guard((current) => importYoutubeAudio(uid, { url, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Startup failure (e.g. actor unresolved): report on stderr and exit non-zero.
  process.stderr.write(`MCP server failed to start: ${(err as Error)?.message ?? err}\n`);
  process.exit(1);
});
