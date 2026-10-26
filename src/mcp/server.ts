import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveActor, type Actor } from "@/mcp/actor";
import { can, quotasFor } from "@/lib/domain/permissions";
import {
  search, findStudio, studioAnimes, animeCharacters, importPoster,
  findUser, userAnimeList, userFavourites, characterProfile, animeProfile,
  personProfile, userHistory,
} from "@/server/shikimori";
import { USER_RATE_STATUSES } from "@/lib/domain/shikimori";
import {
  createProject, getProject, addRound, patchRound, deleteRound, addTile, patchTile, patchProject, setPlaylist,
  setRoundMode, addGroup, patchGroup, deleteGroup, addTileToGroup, listGroups,
} from "@/server/projects";
import { absPath } from "@/lib/storage";
import { listArts, type PoolKind } from "@/server/arts";
import { listLocalMedia, importLocalMedia, mediaDirs } from "@/server/local-media";
import { buildPickerPreviewPlan } from "@/server/picker-render";
import { addTileFromShikimori } from "@/mcp/compose";
import { importYoutubeAudio } from "@/mcp/youtube";
import { projectSummary } from "@/mcp/project-summary";
import type { ShikimoriType } from "@/lib/domain/shikimori";
import { setTopItems, topItemsSchema } from "@/server/manual-top";
import { topSummary } from "@/mcp/top-summary";
import { registerStudioTools } from "@/mcp/studio-tools";
import { actor as authorizeActor } from "@/server/studio/shared";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

/** Block ids of a round, in display order (empty for a plain round). */
const groupIdsOf = async (uid: string, roundId: string) =>
  (await listGroups(uid, roundId)).map((g) => g.id);

async function main() {
  const actor: Actor = await resolveActor();
  const uid = actor.userId;
  /** Retained legacy tools also authorize the original identity freshly per call. */
  function guard(fn: (current: Actor) => Promise<unknown>): Promise<ToolResult> {
    return authorizeActor(uid).then((user) => fn({ ...actor, role: user.role }))
      .then(ok).catch((e) => fail((e as Error)?.message ?? String(e)));
  }

  const server = new McpServer({ name: "tournament-bracket-video", version: "0.1.0" });
  registerStudioTools(server, actor);

  server.registerTool(
    "create_top_project",
    { description: "LEGACY VideoProject (не SDK): создать ручной топ без турнира. Для новых SDK-проектов используйте video_project_create. Затем set_top_items задаёт позиции. → {projectId,url}",
      inputSchema: { title: z.string().trim().min(1).max(200) } },
    ({ title }) => guard(async (current) => {
      if (!can(current.role, "tournament:create")) throw new Error("Создание видео недоступно вашей роли");
      const project = await createProject(uid, title, "top");
      return { projectId: project.id, url: `/projects/${project.id}` };
    }),
  );
  server.registerTool(
    "set_top_items",
    { description: "Заменить ВСЕ позиции ручного топа атомарно: items идут от лучшего (#1) к последнему. " +
        "audioArtId — аудио/видео со звуком из своего пула; artId — фон (картинка/видео). " +
        "clipSec:30 по умолчанию, берётся самый активный фрагмент по RMS. order:desc показывает N→1. " +
        "Пустые introText/outroText выключают титры. До 200 уникальных треков. После вызова get_project рассчитывает фрагменты и проверяет файлы.",
      inputSchema: topItemsSchema.shape },
    (args) => guard(async (current) => {
      if (!can(current.role, "tournament:create")) throw new Error("Создание видео недоступно вашей роли");
      return setTopItems(uid, args);
    }),
  );

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
    { description: "Импортировать постер (аниме/персонаж) в пул как картинку. → {artId}",
      inputSchema: { type: z.enum(["anime", "character"]), id: z.number(), posterPath: z.string(), label: z.string().optional() } },
    ({ type, id, posterPath, label }) =>
      guard((current) => importPoster(uid, { type: type as ShikimoriType, id, posterPath, label: label ?? null, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );
  server.registerTool(
    "list_pool",
    { description:
        "Что уже лежит в пуле медиа актора: картинки/видео/аудио с длительностью и путём файла " +
        "(filePath — абсолютный, картинку можно посмотреть глазами, если клиент умеет). " +
        "query фильтрует по подписи, kind — по типу; новые сверху. → {arts:[{id, label, kind, durationSec, hasAudio, sizeBytes, filePath, createdAt}], nextCursor}",
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
        "→ {dir, roots, files:[{name, path, kind, sizeBytes}]}",
      inputSchema: { dir: z.string() } },
    ({ dir }) => guard(async () => ({ ...(await listLocalMedia(dir)), roots: mediaDirs() })),
  );
  server.registerTool(
    "import_local_media",
    { description:
        "Импортировать локальные файлы (пути из list_local_media) в пул. Оригиналы остаются на месте; " +
        "подпись берётся из имени файла. Не больше 50 файлов за вызов; проблемные файлы приходят " +
        "в failed (BAD_EXT / PATH_NOT_ALLOWED / NOT_FOUND / POOL_QUOTA), остальные импортируются. " +
        "→ {items:[{artId, label, kind, durationSec, sizeBytes}], failed:[{path, error}]}",
      inputSchema: { paths: z.array(z.string()) } },
    ({ paths }) =>
      guard((current) => importLocalMedia(uid, { paths, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );
  server.registerTool(
    "import_youtube_audio",
    { description: "Скачать звук с YouTube (yt-dlp) в пул. Дожидается завершения. → {artId}",
      inputSchema: { url: z.string() } },
    ({ url }) =>
      guard((current) => importYoutubeAudio(uid, { url, maxPoolBytes: quotasFor(current.role).maxPoolBytes })),
  );

  // ---- Picker building ----
  server.registerTool(
    "create_picker_project",
    { description: "LEGACY VideoProject (не SDK): создать проект «Пикер». Для новых SDK-проектов используйте video_project_create. Стартует с пустым раундом и интро/аутро. → {projectId, firstRoundId}",
      inputSchema: {
        title: z.string(),
        orientation: z.enum(["landscape", "portrait"]).optional(),
        introText: z.string().optional(),
        outroText: z.string().optional(),
      } },
    ({ title, orientation, introText, outroText }) => guard(async () => {
      const project = await createProject(uid, title, "picker");
      if (orientation != null || introText !== undefined || outroText !== undefined) {
        await patchProject(uid, project.id, {
          ...(orientation != null ? { tileOrientation: orientation } : {}),
          ...(introText !== undefined
            ? { introText, introEnabled: introText.trim() !== "" }
            : {}),
          ...(outroText !== undefined
            ? { outroText, outroEnabled: outroText.trim() !== "" }
            : {}),
        });
      }
      const loaded = await getProject(uid, project.id);
      return { projectId: project.id, firstRoundId: loaded!.rounds[0]?.id ?? null };
    }),
  );
  server.registerTool(
    "add_round",
    { description:
        "Добавить раунд в пикер. mode: \"single\" (по умолчанию — 2-9 отдельных блоков) или " +
        "\"groups\" (сравнение блок к блоку: раунд сразу получает два пустых блока, дальше " +
        "add_tile/add_tile_from_shikimori с groupId). Необязательные поля настраивают " +
        "вопрос/таймер/показ/подписи/ориентацию. → {roundId, groupIds}",
      inputSchema: {
        projectId: z.string(),
        mode: z.enum(["single", "groups"]).optional(),
        prompt: z.string().optional(),
        timerSec: z.number().optional(),
        revealSec: z.number().optional(),
        labelsMode: z.enum(["always", "finale", "never"]).optional(),
        orientation: z.enum(["landscape", "portrait"]).optional(),
      } },
    ({ projectId, mode, prompt, timerSec, revealSec, labelsMode, orientation }) => guard(async () => {
      const round = await addRound(uid, projectId);
      if (mode === "groups") await setRoundMode(uid, round.id, "groups");
      if (prompt != null || timerSec != null || revealSec != null || labelsMode != null || orientation != null) {
        await patchRound(uid, round.id, {
          ...(prompt != null ? { prompt, showPrompt: true } : {}),
          ...(timerSec != null ? { timerSec } : {}),
          ...(revealSec != null ? { revealSec } : {}),
          ...(labelsMode != null ? { labelsMode } : {}),
          ...(orientation != null ? { tileOrientation: orientation } : {}),
        });
      }
      const groupIds = mode === "groups"
        ? (await groupIdsOf(uid, round.id))
        : [];
      return { roundId: round.id, groupIds };
    }),
  );
  server.registerTool(
    "add_tile",
    { description:
        "Добавить плитку из уже импортированного арта (image/video). Обычному раунду передавайте " +
        "roundId, групповому — groupId нужного блока (≤ 5 карточек в блоке). isAnswer работает " +
        "только в обычном раунде: в групповом победителя отмечает set_group. → {tileId}",
      inputSchema: {
        roundId: z.string().optional(), groupId: z.string().optional(),
        artId: z.string(), label: z.string().optional(), isAnswer: z.boolean().optional(),
        fitMode: z.enum(["cover", "fill", "contain"]).optional(),
      } },
    ({ roundId, groupId, artId, label, isAnswer, fitMode }) => guard(async () => {
      if (!roundId && !groupId) throw new Error("Укажите roundId или groupId");
      const tile = groupId
        ? await addTileToGroup(uid, groupId, artId)
        : await addTile(uid, roundId!, artId);
      if (label != null || isAnswer || fitMode != null) {
        await patchTile(uid, tile.id, {
          ...(label != null ? { label } : {}),
          ...(isAnswer ? { isAnswer: true } : {}),
          ...(fitMode != null ? { fitMode } : {}),
        });
      }
      return { tileId: tile.id };
    }),
  );
  server.registerTool(
    "add_tile_from_shikimori",
    { description:
        "Импортировать постер Shikimori и добавить карточкой одним вызовом: roundId для обычного " +
        "раунда, groupId для блока группового. → {tileId, artId}",
      inputSchema: {
        roundId: z.string().optional(), groupId: z.string().optional(),
        type: z.enum(["anime", "character"]), id: z.number(),
        posterPath: z.string(), label: z.string().optional(), isAnswer: z.boolean().optional(),
        fitMode: z.enum(["cover", "fill", "contain"]).optional(),
      } },
    ({ roundId, groupId, type, id, posterPath, label, isAnswer, fitMode }) =>
      guard(async (current) => {
            if (!roundId && !groupId) throw new Error("Укажите roundId или groupId");
            const result = await addTileFromShikimori(uid, {
              roundId, groupId, type: type as ShikimoriType, id, posterPath,
              label: label ?? null, isAnswer, maxPoolBytes: quotasFor(current.role).maxPoolBytes,
            });
            if (fitMode != null) {
              await patchTile(uid, result.tileId, { fitMode });
            }
            return result;
          }),
  );
  server.registerTool(
    "set_playlist",
    { description: "Задать фоновую музыку пикера (упорядоченные id аудио-артов). → {ok:true}",
      inputSchema: { projectId: z.string(), artIds: z.array(z.string()) } },
    ({ projectId, artIds }) => guard(async () => { await setPlaylist(uid, projectId, artIds); return { ok: true }; }),
  );
  server.registerTool(
    "set_project",
    { description:
        "Изменить сам проект: задний фон (backgroundArtId — картинка или видео из пула, null снимает фон), " +
        "название, ориентацию плиток, тексты интро/аутро (пустая строка выключает экран), " +
        "время показа блока, таймер, скрытие блока после показа, тиканье таймера. " +
        "Фоновая музыка ставится отдельно — set_playlist. → {ok:true}",
      inputSchema: {
        projectId: z.string(),
        backgroundArtId: z.string().nullable().optional(),
        title: z.string().optional(),
        orientation: z.enum(["landscape", "portrait"]).optional(),
        introText: z.string().optional(),
        outroText: z.string().optional(),
        revealSec: z.number().optional(),
        timerSec: z.number().optional(),
        hideAfterReveal: z.boolean().optional(),
        tickSound: z.boolean().optional(),
      } },
    (args) => guard(async () => {
      const { projectId, backgroundArtId, introText, outroText, ...rest } = args;
      await patchProject(uid, projectId, {
        ...rest,
        ...(backgroundArtId !== undefined ? { bgArtId: backgroundArtId } : {}),
        ...(introText !== undefined
          ? { introText, introEnabled: introText.trim() !== "" }
          : {}),
        ...(outroText !== undefined
          ? { outroText, outroEnabled: outroText.trim() !== "" }
          : {}),
      });
      return { ok: true };
    }),
  );
  server.registerTool(
    "get_project",
    { description: "Прочитать проект для самопроверки. Пикер: раунды/плитки/плейлист. Ручной топ: позиции/фон/активные фрагменты/таймлайн/readyToRender/warnings. Первый расчёт фрагментов может занять несколько минут. → summary",
      inputSchema: { projectId: z.string() } },
    ({ projectId }) => guard(async (current) => {
      const p = await getProject(uid, projectId);
      if (!p) throw new Error("Проект не найден");
      if (p.kind === "top") return {
        id: p.id, title: p.title, kind: p.kind, url: `/projects/${p.id}`,
        ...await topSummary(uid, projectId), renderAllowed: can(current.role, "render:run"),
      };
      // Planned runtime helps size a playlist to the video (pickers only).
      const durationSec =
        p.kind === "picker" ? buildPickerPreviewPlan(p).durationSec : undefined;
      return projectSummary(p, { durationSec });
    }),
  );
  server.registerTool(
    "set_round",
    { description:
        "Изменить существующий раунд (промпт/таймер/подписи/ориентацию/режим). Пустой prompt (\"\") " +
        "убирает вопрос; orientation:null снимает оверрайд. mode:\"groups\" переводит раунд в " +
        "групповое сравнение — уже добавленные плитки раскладываются по блокам (по 5), " +
        "mode:\"single\" возвращает их обычными плитками. → {ok:true, groupIds}",
      inputSchema: {
        roundId: z.string(),
        mode: z.enum(["single", "groups"]).optional(),
        prompt: z.string().optional(),
        timerSec: z.number().optional(),
        revealSec: z.number().optional(),
        labelsMode: z.enum(["always", "finale", "never"]).optional(),
        orientation: z.enum(["landscape", "portrait"]).nullable().optional(),
      } },
    ({ roundId, mode, prompt, timerSec, revealSec, labelsMode, orientation }) => guard(async () => {
      if (mode !== undefined) await setRoundMode(uid, roundId, mode);
      await patchRound(uid, roundId, {
        ...(prompt !== undefined ? { prompt, showPrompt: prompt.trim() !== "" } : {}),
        ...(timerSec != null ? { timerSec } : {}),
        ...(revealSec != null ? { revealSec } : {}),
        ...(labelsMode != null ? { labelsMode } : {}),
        ...(orientation !== undefined ? { tileOrientation: orientation } : {}),
      });
      return { ok: true, groupIds: await groupIdsOf(uid, roundId) };
    }),
  );
  server.registerTool(
    "add_group",
    { description:
        "Добавить блок в групповой раунд (максимум 3). label — название блока; без него кадр " +
        "покажет «Блок А/Б/В». → {groupId}",
      inputSchema: { roundId: z.string(), label: z.string().optional() } },
    ({ roundId, label }) => guard(async () => {
      const group = await addGroup(uid, roundId, label ?? null);
      return { groupId: group.id };
    }),
  );
  server.registerTool(
    "set_group",
    { description:
        "Изменить блок: label (пустая строка убирает название) и isAnswer — блок-победитель " +
        "(в раунде он один; ответ необязателен). → {ok:true}",
      inputSchema: {
        groupId: z.string(),
        label: z.string().optional(),
        isAnswer: z.boolean().optional(),
      } },
    ({ groupId, label, isAnswer }) => guard(async () => {
      await patchGroup(uid, groupId, {
        ...(label !== undefined ? { label } : {}),
        ...(isAnswer !== undefined ? { isAnswer } : {}),
      });
      return { ok: true };
    }),
  );
  server.registerTool(
    "delete_group",
    { description: "Удалить блок вместе с его карточками. → {ok:true}",
      inputSchema: { groupId: z.string() } },
    ({ groupId }) => guard(async () => { await deleteGroup(uid, groupId); return { ok: true }; }),
  );
  server.registerTool(
    "delete_round",
    { description: "Удалить раунд пикера (например пустой стартовый, чтобы сценарий был чистым). → {ok:true}",
      inputSchema: { roundId: z.string() } },
    ({ roundId }) => guard(async () => { await deleteRound(uid, roundId); return { ok: true }; }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Startup failure (e.g. actor unresolved): report on stderr and exit non-zero.
  process.stderr.write(`MCP server failed to start: ${(err as Error)?.message ?? err}\n`);
  process.exit(1);
});
