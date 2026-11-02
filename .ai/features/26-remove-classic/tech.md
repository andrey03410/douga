# Технические решения

Стадия пройдена в автономном режиме ([brief.md](brief.md#автономный-режим)). Продуктовые
решения лежат в [product.md](product.md), ссылки вида P0N ведут туда. Реализует другой агент.
План он пишет сам в `plan.md`, опираясь на разделы «Состав изменений» и «Проверка» ниже.

## Исходная система

Проверено по коду ветки `main` на `5c1d6a8` и по карточкам
[classic-video](../../map/classic-video.md), [render](../../map/render.md), [mcp](../../map/mcp.md),
[media](../../map/media.md), [roles](../../map/roles.md), [tournament](../../map/tournament.md),
[studio-sdk](../../map/studio-sdk.md), [dev-env](../../map/dev-env.md).

### Классика

- Страницы: `src/app/projects/[id]/` (`page.tsx`, `PickerConstructor.tsx`) и
  `src/app/tournaments/[id]/render/` (`page.tsx`, `RenderConstructor.tsx`, `ArtGalleryModal.tsx`).
  На `/projects` есть раздел «Ранее созданные проекты» и `DeleteProjectButton.tsx`.
- API: `api/projects/` (корень, `[id]`, `items`, `items/[itemId]`, `playlist`, `rounds`, `render`,
  `render/config`), `api/rounds/[id]/` (`tiles`, `groups`), `api/groups/[id]/` (`tiles`),
  `api/tiles/[id]/` (`group`), `api/render-items/[id]`, `api/render-jobs/[id]/` (`download`),
  `api/tournaments/[id]/render/` (`config`). Только классике служат ещё `api/assets/tick` (тик
  пикера через `ensureTickAsset`) и `api/account/renders`.
- Сервисы: `src/server/projects.ts`, `manual-top.ts`, `render-items.ts`, `render-config-dto.ts`,
  `picker-render.ts`, `render.ts`, `render-jobs.ts`.
- Домен: `src/lib/render-assemble.ts`, `src/lib/domain/video-plan.ts`, `picker-plan.ts`,
  `picker-layout.ts`, `position-media.ts`, `art-crop.ts`, `render-jobs.ts`.
- Remotion: `src/remotion/TopVideo.tsx`, `PickerVideo.tsx`, `TitleCard.tsx`, `types.ts`. В `Root.tsx`
  зарегистрированы три композиции: `Studio`, `Top`, `Picker`. `StudioVideo.tsx` не импортирует
  ничего из классических модулей: его зависимости — `../video/types`, `studio-frame`,
  `studio-paint`, `image-ready`, `premount`.
- MCP: в `src/mcp/server.ts` 30 инструментов, из них 14 классических: `create_picker_project`,
  `create_top_project`, `add_round`, `set_round`, `delete_round`, `add_group`, `set_group`,
  `delete_group`, `add_tile`, `add_tile_from_shikimori`, `set_playlist`, `set_project`,
  `get_project`, `set_top_items`. Помощники: `compose.ts`, `project-summary.ts`, `top-summary.ts`.
- UI-компонент `src/app/components/FragmentPreview.tsx` («Старт отсюда») используют только
  два конструктора.
- Объём: эти файлы продакшн-кода — около 7,25 тыс. строк. Юнит-тесты, которые их проверяют, —
  около 4,6 тыс. строк, плюс интеграционные тесты.

### Где классика сцеплена с остающимся кодом

| Место | Что там классического |
|---|---|
| `prisma/schema.prisma` | связи `User.projects`, `Tournament.renderConfig/renderJobs`, `Track.renderItems`, восемь связей `Art` (`renderItems`, `audioRenderItems`, `pickerTiles`, `projectBgs`, `projectMusics`, `roundBgs`, `roundMusics`, `playlistItems`) |
| `src/server/tournaments.ts` | `syncRenderConfigToRanking` после `finalize` и `reorderRanking`; `deleteTournament` удаляет MP4 и `renders/tmp` заданий турнира |
| `src/server/users.ts` | `usageSummary` (агрегаты `RenderJob`, `renders`, `renderBytes`), бэкфилл `outputBytes`, `listRenderRows`, `deleteRenderJob`, `deleteUser` (проекты и их рендеры) |
| `src/server/arts.ts` | `ART_INCLUDE` считает восемь классических связей; `deleteArt` сбрасывает кроп и звук у `RenderItem`; `listRecentArts` по `lastUsedAt` |
| `src/lib/domain/art-usage.ts` | `ArtRelationCounts` и `UsageBreakdown` описывают позиции, карточки, плейлист и фоны классики |
| `Art.lastUsedAt` | пишут только `projects.ts`, `manual-top.ts` и `render-items.ts`; полосу «недавние» читает только режим `pick` у `ArtGalleryModal` (через `useMediaPool` и `GET /api/arts?recent=1`) |
| `src/app/components/ImportSources.tsx` | импорт в пул (файлы, ссылка и yt-dlp, Shikimori, `Ctrl+V`); подключён **только** в `ArtGalleryModal` |
| `react-easy-crop` | используется только в `ArtGalleryModal` |
| `src/lib/audio.ts` | `clipAudio`, `clipVideo`, `writeSilence`, `writeTick`, `probeDurationSec` вызывает только классика. Студии и пулу нужны `probeMediaInfo`, `extractPoster`, `findActiveSnippet` (и его `decodePcm`) |
| `src/lib/domain/render-jobs.ts` | `downloadTitleStem` нужен офлайн-плееру `src/watch/offline.ts` |
| `src/lib/domain/position-media.ts` | тип `MediaKind` нужен `src/server/arts.ts` |
| `src/lib/storage.ts` | `renderOutputPath`, `clipPath` |
| `src/app/tournaments/[id]/page.tsx`, `ResultsPanel.tsx` | панель «Рендер» со ссылкой на конструктор, кнопка «Открыть прежний рендер» (`destination: "legacy"`) |
| `src/app/account/AccountManager.tsx` | раздел «Рендеры» и удаление `api/render-jobs/<id>` |
| `scripts/e2e-run.mjs`, `scripts/e2e-render.mjs` | шаг `render/config`; весь e2e-рендер классики |
| `src/integration/studio-mcp.integration.test.ts` | проверка понижения роли вызывает `create_picker_project` |
| `src/lib/domain/prisma-drift.test.ts` | фикстура-схема с именами `VideoProject` и `PickerRound` (это только текст) |

### Что студии от классики не нужно (проверено)

- Тик: у студии свой `builtin` (`src/server/studio/assets.ts`, функция `builtin` пишет
  `storage/studio/builtin/<name>.wav`). `storage/assets/tick.wav` и `writeTick` нужны только
  классике.
- Рейтинг: SDK читает `Ranking` турнира сам (`src/server/studio/sources.ts`, `reconcileSource`),
  `RenderConfig` ему не нужен.
- Активный фрагмент: SDK считает его через `findActiveSnippet` и кэш `StudioAnalysis` по хэшу
  ассета (`src/server/studio/assets.ts`). Это работает и для звука из пула, и для трека турнира.
- Композиция: `src/server/studio/render.ts` выбирает `id: "Studio"`.

### Как SDK закрывает «свой топ агента» (P03)

`src/video/types.ts`: `Source.kind: "manual" | "tournament"`, у `Participant` есть `label`,
`caption`, `rank` и `media: {visual?, audio?}` — ключи в `bindings`. `AssetBinding` бывает
`pool` (`assetId` — это id `Art`), `track` или `builtin`. `settings.top`: `order`, `durationSec`
и `snippet.mode` — `manual`, `full` или `active`. MCP `video_project_create` принимает готовый
документ. `video_source_list` ищет турниры по названию. Сейчас пример топа в `video_examples`
минимальный: один участник без медиа (`src/mcp/studio-tools.ts`, `examples`).

### Данные на машине владельца (2026-11-02, только чтение)

`VideoProject` 17, `PickerRound` 332, `PickerTile` 1719, `PickerGroup` 485, `PickerPlaylistItem` 34,
`RenderConfig` 6, `RenderItem` 84, `RenderJob` 19. `storage/renders/` весит 1,9 ГБ: 27 MP4 и
`tmp/` на 383 МБ. `storage/assets/` содержит только `tick.wav`. Для сравнения: `StudioProject` 19,
`Tournament` 6. `prisma/dev.db` весит 86 МБ. Каталога миграций нет, схема применяется через
`prisma db push` (Prisma 5.22.0).

## Решения

### T01. Порядок работ и один PR

- Варианты:
  - (а) один PR. Порядок: код (UI и API → MCP → сервисы и домен → Remotion) → схема
    и `prisma generate` → копия базы → `db push` → удаление файлов → тесты и QG;
  - (б) несколько PR: сначала код, потом схема и данные.
- Рекомендация: (а). Задача одна, а `dev.db` у всех веток общая. Промежуточный `main`, где код
  без классики, а таблицы ещё есть, ничего не даёт. Таблицы удаляются как можно позже: пока
  их нет, dev-сервер владельца на `main` падает на `/projects`.
- **Решение:** (а). Коммиты задач плана должны проходить `npx tsc --noEmit`. Перед `db push`
  исполнитель предупреждает владельца: его dev-сервер на `main` до вливания будет падать
  на `/projects`. После вливания — `prisma generate` и перезапуск сайта, воркера и MCP.

### T02. Схема БД

- Варианты:
  - (а) удалить модели `VideoProject`, `PickerRound`, `PickerGroup`, `PickerTile`,
    `PickerPlaylistItem`, `RenderConfig`, `RenderItem`, `RenderJob`, их связи в `User`,
    `Tournament`, `Track`, `Art`, а также поле `Art.lastUsedAt`. Применить
    `npx prisma db push --accept-data-loss`, затем `npx prisma generate`;
  - (б) завести каталог миграций Prisma;
  - (в) оставить `Art.lastUsedAt`.
- Рекомендация: (а). Миграций в проекте нет, их заведение — отдельная задача. Флаг
  `--accept-data-loss` есть в установленной Prisma 5.22.0 (`npx prisma db push --help`), без него
  `db push` откажется удалять таблицы с данными. `lastUsedAt` после удаления никто не пишет,
  а читает его только полоса «недавние» удаляемой модалки (T06).
- **Решение:** (а). `DownloadJob` (загрузки yt-dlp для пула) остаётся.

### T03. Копия базы и удаление файлов

- Варианты:
  - (а) разовый ручной шаг исполнителя на машине владельца, записанный в `verify.md`:
    1. снять счётчики таблиц и `du` каталогов (запрос — как в «Данные на машине владельца»);
    2. `sqlite3 prisma/dev.db ".backup storage/backups/before-26-remove-classic-<YYYYMMDD-HHMMSS>.db"`;
    3. `npx prisma db push --accept-data-loss`;
    4. `rm -rf storage/renders`, удалить `storage/assets/tick.wav` и пустой `storage/assets/`;
    5. снова снять счётчики: студия, турниры, `Art` и `Track` не изменились;
  - (б) скрипт очистки в `scripts/`;
  - (в) код сам чистит `storage/renders` при старте.
- Рекомендация: (а). Машина одна, действие разовое. Скрипт в публичном репозитории остался бы
  мёртвым кодом. `.backup` у `sqlite3` снимает согласованную копию, даже если к базе подключены
  сайт или воркер (`/usr/bin/sqlite3` на машине есть). Обычный `cp` при открытой базе может
  снять копию посреди записи.
- **Решение:** (а). Копию базы код не читает. Удалять её или нет, решает владелец.
  Проверочные аккаунты (`e2e@test.local`) теряют свои MP4 вместе со всеми.

### T04. Remotion

- **Решение:** удалить `TopVideo.tsx`, `PickerVideo.tsx`, `TitleCard.tsx`, `types.ts`. В `Root.tsx`
  остаётся одна композиция `Studio` и константа `STUDIO_COMPOSITION_ID`, `COMPOSITION_ID` и
  `PICKER_COMPOSITION_ID` уходят. Развилки нет: студия классику не импортирует.
- Следствие: правка `src/remotion` и `package-lock.json` меняет `engineId`. Первое задание
  студии после вливания пересоберёт бандл (до 120 с). Так и задумано.

### T05. Общие модули: что остаётся, переезжает и удаляется

- Варианты:
  - (а) убрать из общих модулей всё, что вызывала только классика. Два нужных остальному коду
    куска перенести в нейтральные модули;
  - (б) оставить общие модули как есть, удалить только файлы классики.
- Рекомендация: (а). Иначе останутся мёртвые функции ffmpeg и пути `storage/renders`, а агент
  снова будет путаться.
- **Решение:** (а):
  - `src/lib/audio.ts`: остаются `probeMediaInfo`, `extractPoster`, `decodePcm` и
    `findActiveSnippet`. Удаляются `probeDurationSec`, `clipAudio`, `clipVideo`, `writeSilence`,
    `writeTick`. `src/lib/domain/rms.ts` остаётся. `audio-probe.test.ts` поправить, если он
    проверяет удалённые функции;
  - `downloadTitleStem` переезжает из `src/lib/domain/render-jobs.ts` в новый
    `src/lib/domain/download-name.ts` вместе со своими тест-кейсами. Остальное из
    `render-jobs.ts` (`renderDownloadDisposition`, DTO, `isActiveRenderJob`) удаляется;
  - тип `MediaKind` переезжает из `position-media.ts` к пулу, в `src/lib/domain/media-ext.ts`,
    остальное `position-media.ts` удаляется;
  - `art-crop.ts`, `video-plan.ts`, `picker-plan.ts`, `picker-layout.ts`, `render-assemble.ts`
    удаляются вместе с тестами, включая `group-layout.test.ts`;
  - из `src/lib/storage.ts` удаляются `renderOutputPath` и `clipPath`;
  - `src/lib/domain/group-answer.ts` — это групповые сравнения турнира, не пикер. Он остаётся.

### T06. Пул после классики

- **Решение:**
  - `ART_INCLUDE` в `src/server/arts.ts` считает только `studioReferences`, константа
    `PICTURE_ONLY_POSITIONS` уходит;
  - `ArtRelationCounts` сводится к `{studioReferences}`, а `UsageBreakdown` — к `{studio, total}`.
    `describeUsage`, `describeDeletion` и `sumUsage` упрощаются: медиа используется только
    ревизиями и черновиками студии. Защита `STUDIO_ASSET_IN_USE` (409) не меняется;
  - `deleteArt` больше не трогает `RenderItem`. Транзакция проверяет ссылки студии
    и удаляет строку;
  - удаляются `listRecentArts`, ветка `?recent=1` в `GET /api/arts` и опция «recent»
    в `useMediaPool` (см. T02 про `lastUsedAt`);
  - форма `Art` в ответах (`src/lib/art-dto.ts`) теряет `lastUsedAt`. Остальные поля, включая
    `usage`, сохраняют смысл.

### T07. Импорт в кабинете (P07)

- Варианты:
  - (а) подключить существующий `ImportSources` в блок пула `AccountManager`. После импорта
    перечитать пул и сводку квот. Если блок пула ещё не раскрыт, импорт виден и работает;
  - (б) сделать новую форму импорта.
- Рекомендация: (а). Компонент уже самодостаточный (`onImported`) и ходит в живые API:
  `api/arts`, `api/arts/from-url`, `api/downloads`, `api/shikimori`.
- **Решение:** (а). `ArtGalleryModal.tsx` удаляется, `react-easy-crop` уходит из `package.json`
  и lock-файла. `ImportSources.tsx`, `MediaBrowser.tsx`, `useMediaPool.ts`, `RenameField.tsx`
  остаются в `src/app/components/`.

### T08. Турниры (P02)

- **Решение:**
  - `syncRenderConfigToRanking` и его вызовы из `finalize` и `reorderRanking` удаляются.
    Поведение рейтинга не меняется;
  - `deleteTournament` больше не ищет задания рендера и не трогает `storage/renders`;
  - `ResultsPanel`: из `destination` уходит `"legacy"` вместе с кнопкой «Открыть прежний рендер».
    Под «Создать видео через SDK →» появляется одна строка `muted`: видео оформляет агент через
    MCP и находит этот турнир по названию. Панель «Рендер» в `src/app/tournaments/[id]/page.tsx`
    удаляется;
  - `scripts/e2e-run.mjs` теряет шаг `renderConfig`. `scripts/e2e-render.mjs` удаляется.

### T09. Кабинет и админка (P06)

- **Решение:**
  - `src/server/users.ts`: из `usageSummary` уходят `renders` и `renderBytes`, из бэкфилла —
    ветка `RenderJob`. Удаляются `listRenderRows` и `deleteRenderJob`. `deleteUser` больше
    не трогает проекты и их рендеры: ни строки, ни `renders/*`;
  - `src/server/render-jobs.ts` (`failStaleRenderJobs`) удаляется;
  - `api/account/renders` удаляется. В `AccountManager` уходят раздел «Рендеры» и ветка удаления
    `api/render-jobs/<id>`. Потребителей `renders` и `renderBytes` в ответе `GET /api/account/usage`
    проверить поиском и поправить;
  - права не меняются: `render:run` остаётся для финального рендера студии, квоты те же.

### T10. MCP (P08)

- Варианты подачи инструкции агенту:
  - (а) `instructions` сервера в MCP. Их получает каждый клиент при `initialize`;
  - (б) только README и описания инструментов;
  - (в) отдельный инструмент `video_guide`.
- Рекомендация: (а). Это штатный канал протокола, клиент кладёт его в контекст агента сам.
  В установленном `@modelcontextprotocol/sdk` 1.29.0 у `ServerOptions` есть поле `instructions`
  (`dist/esm/server/index.d.ts`), конструктор — `new McpServer(serverInfo, options?)`.
  (в) требует, чтобы агент догадался его вызвать.
- **Решение:** (а). Состав работ:
  - из `server.ts` удаляются 14 классических инструментов и их помощники (`groupIdsOf`, импорты
    `projects`, `manual-top`, `compose`, `project-summary`, `top-summary`, `picker-render`).
    Удаляются `src/mcp/compose.ts`, `project-summary.ts` с тестом и `top-summary.ts`.
    Остаются 46 инструментов: 11 `shikimori_*`, 5 инструментов пула, 30 `video_*`.
    Их имена и схемы не меняются;
  - текст инструкции лежит в отдельном модуле `src/mcp/instructions.ts`, чтобы его можно было
    проверить тестом, и передаётся в `new McpServer({name, version}, {instructions})`. Он по-русски,
    как описания инструментов пула, и не длиннее 3 КБ. Содержание:
    - видео делается только через `video_*`. Нужен запущенный `npm run studio:worker`.
      Финальный рендер `kind:"render"` доступен только админу;
    - топ по турниру: `video_source_list` (поиск по названию) → `video_project_create`
      (с `sourceId` или документом с `source.kind:"tournament"`) → оформление (`video_preset_apply`
      или `video_draft_patch`) → `video_project_validate` → `video_draft_commit` → `video_job_start`;
    - свой топ: медиа в пул (`import_youtube_audio`, `import_local_media`,
      `import_shikimori_poster`, `video_import_start`) → документ с `source.kind:"manual"`,
      участниками с `rank` и `bindings` вида `{kind:"pool", assetId:<artId>}` → дальше как выше.
      Фрагмент — `settings.top.snippet`, режим `active` сам находит громкое место;
    - пикер: пресеты `picker.*` и `video_examples`;
    - правки идут через CAS по `expectedVersion`, при повторе — тот же `idempotencyKey`;
  - описания пяти инструментов пула договаривают, что `artId` в документе SDK — это `assetId`
    привязки `pool`. Слово LEGACY и ссылки на `/projects/<id>` из описаний уходят;
  - `video_examples` получает пример `top-manual`: три участника с `rank`, `media.audio` и
    `media.visual`, `bindings` вида `pool` с заглушками `assetId`, `settings.top.snippet.mode:
    "active"`. Пример строится билдерами SDK и проходит схему документа. Привязки к реальным
    медиа сервис проверит только при создании проекта;
  - обёртку `guard` переименовывать не нужно, достаточно поправить комментарий
    («Retained legacy tools…»).

### T11. Удалённые адреса (P09)

- **Решение:** папки маршрутов удаляются целиком, Next App Router сам отвечает 404. Редиректов нет.
  - Страницы: `src/app/projects/[id]/`, `src/app/tournaments/[id]/render/`.
  - API: `api/projects/`, `api/rounds/`, `api/groups/`, `api/tiles/`, `api/render-items/`,
    `api/render-jobs/`, `api/tournaments/[id]/render/`, `api/assets/tick/`, `api/account/renders/`.
  - `/projects`: удалить раздел «Ранее созданные проекты», `KIND_LABEL`, импорт `listProjects`
    и `DeleteProjectButton.tsx`. Блоки «SDK-проекты» и `StudioSetup` остаются.

### T12. Тесты

- Варианты:
  - (а) удалить тесты удалённого кода, поправить смешанные, добавить тесты на новое поведение.
    Постоянного теста-сторожа «в коде нет слов классики» нет, поиск делается разово в QG;
  - (б) добавить тест-сторож, который грепает `src/` на запрещённые имена.
- Рекомендация: (а). Возврат классики и так поймают `tsc` и сборка: моделей больше нет. Тест на
  слова сломается на законных совпадениях: SDK-типы `PickerRound` и `PickerGroup` в `src/video/types.ts`
  останутся.
- **Решение:** (а):
  - удалить юниты: `picker-plan`, `picker-layout`, `group-layout`, `video-plan`, `position-media`,
    `art-crop`, `render-assemble`, `render-jobs` (кроме перенесённых кейсов `downloadTitleStem`),
    `src/mcp/project-summary.test.ts`;
  - удалить интеграционные: `projects`, `mcp-top`, `mcp-compose`, `render-jobs`, `render-files`;
  - поправить смешанные:
    - `video.integration` — сохранить `describe("pool uploads")`, остальное про позиции топа убрать;
    - `arts.integration` — убрать `render-item art assignment and crop` и проверки освобождения
      позиций, использование считать по ссылкам студии;
    - `account.integration` — убрать рендеры из сводки и списков;
    - `flow.integration` — турнир до конца без `RenderConfig`;
    - `roles.integration` — убрать `deleteRenderJob` и проверки классического рендера.
      Удаление аккаунта проверять без `RenderJob` и `renders/`, студийные проверки `render:run` оставить;
    - `user-backfill.integration` — убрать ветку `RenderJob`;
    - `studio-mcp.integration` — проверку понижения роли вести через `list_pool` вместо `create_picker_project`;
    - `mcp.e2e` — оставить handshake и сценарии Shikimori и пула, которые не строят пикер.
      Сценарии сборки пикера удалить;
    - `prisma-drift.test` — переименовать модели фикстуры в нейтральные, смысл теста тот же;
  - новые тесты:
    - список инструментов stdio-сервера равен ровно 46 ожидаемым именам, классических нет;
    - ответ `initialize` содержит `instructions` с `video_source_list` и `source.kind` `manual`;
    - пример `top-manual` из `video_examples` проходит схему документа и компилируется
      с подставленным манифестом;
    - `art-usage` считает только студию;
    - `deleteTournament` и `deleteUser` работают без `storage/renders`.

### T13. Знания

- **Решение:** в той же ветке:
  - удалить `.ai/map/classic-video.md`, убрать её строку из таблицы в `AGENTS.md`. Строка «Рендер»
    в `AGENTS.md` указывает на `src/server/studio/render.ts`;
  - [`render.md`](../../map/render.md) — только конвейер студии: Remotion, `engineId`, ffmpeg-пробы,
    нарезка `.html`. Грабли классики (`clipAudio`, `<Loop>`, `failStaleRenderJobs`, `RenderJob`) уходят;
  - [`mcp.md`](../../map/mcp.md) — 46 инструментов, `instructions`, три рецепта;
  - [`media.md`](../../map/media.md) — импорт в кабинете, использование только студией, без «недавних»;
  - [`roles.md`](../../map/roles.md) — без `RenderJob`, `VideoProject` и раздела «Рендеры»;
  - [`tournament.md`](../../map/tournament.md) — без синхронизации `RenderConfig`, путь «результаты → SDK»;
  - [`dev-env.md`](../../map/dev-env.md) — каталоги `storage/` без `renders/` и `assets/`, скрипты e2e;
  - [`shikimori.md`](../../map/shikimori.md) — живая проверка таба Shikimori в кабинете;
  - [`studio-sdk.md`](../../map/studio-sdk.md) — без оговорок «прежние конструкторы живут отдельно»;
  - `README.md` — раздел MCP переписать под `video_*` и три рецепта, убрать описание классики
    (возможности, тесты, дерево `remotion/`);
  - скилл [`verify`](../../../.claude/skills/verify/SKILL.md) — убрать разделы классики
    («Видео-проекты: пикер и ручной топ» и живой рендер через конструктор) и добавить три
    MCP-сценария из «Проверки».

  Спеки и журналы фаз в `.ai/specs`, `.ai/phases` — архив, их не правим. Строку в
  `.ai/history.md` добавляют при вливании.

## Состав изменений

Сводка для `plan.md`. Точный список исполнитель сверяет поиском по коду.

| Действие | Что |
|---|---|
| удалить | страницы и API из T11; `src/server/projects.ts`, `manual-top.ts`, `render-items.ts`, `render-config-dto.ts`, `picker-render.ts`, `render.ts`, `render-jobs.ts`; домен из T05; Remotion из T04; `src/mcp/compose.ts`, `project-summary.ts`, `top-summary.ts`; `FragmentPreview.tsx`, `ArtGalleryModal.tsx`, `DeleteProjectButton.tsx`; `scripts/e2e-render.mjs`; тесты из T12; `.ai/map/classic-video.md` |
| поправить | `prisma/schema.prisma`; `src/server/arts.ts`, `tournaments.ts`, `users.ts`; `src/lib/audio.ts`, `storage.ts`, `art-dto.ts`, `domain/art-usage.ts`, `domain/media-ext.ts`; `src/watch/offline.ts`; `src/remotion/Root.tsx`; `src/mcp/server.ts`, `studio-tools.ts`; `src/app/projects/page.tsx`, `tournaments/[id]/page.tsx`, `ResultsPanel.tsx`, `account/AccountManager.tsx`, `components/useMediaPool.ts`, `api/arts/route.ts`; `scripts/e2e-run.mjs`; `package.json`; карточки и доки из T13 |
| добавить | `src/lib/domain/download-name.ts`, `src/mcp/instructions.ts`, пример `top-manual`, тесты из T12 |
| данные | копия `dev.db`, `db push --accept-data-loss`, удаление `storage/renders/` и `storage/assets/tick.wav` (T03) |

Разовая проверка чистоты: `rg -n "VideoProject|videoProject|RenderConfig|renderConfig|RenderItem|renderItem|RenderJob|renderJob|PickerTile|pickerTile|PickerPlaylistItem|TopVideo|PickerVideo|TitleCard|create_picker_project|create_top_project|set_top_items|add_tile_from_shikimori|/api/projects|/api/render-jobs|/api/render-items|/api/rounds|/api/tiles|/api/groups|tournaments/.*/render|storage/renders|lastUsedAt" src scripts README.md AGENTS.md .ai/map .claude/skills/verify`
должна быть пустой. Совпадения `PickerRound` и `PickerGroup` в `src/video/` — это типы SDK, они остаются.

## Проверка

QG по скиллу `verify`: `npm test` → `npm run build` → `npx tsc --noEmit` после последних правок.
Живые проверки — под проверочным аккаунтом. `node scripts/e2e-setup.mjs` создаёт админа
`e2e@test.local`, турнир для него проходит `scripts/e2e-run.mjs`. Проекты и медиа владельца
ради проверок не трогаем.

- **Данные.** Счётчики и `du` до и после, путь копии базы. Число `StudioProject`, `Tournament`,
  `Track` и `Art` не изменилось. `storage/renders/` нет.
- **Сайт** (dev-сервер — после проверки порта 3000):
  - `/projects` без раздела «Ранее созданные проекты». `/projects/<старый id>` и
    `/tournaments/<id>/render` отдают 404, `GET /api/projects` — тоже 404;
  - результаты турнира: одна кнопка SDK и подсказка. `/studio/new?sourceId=…` создаёт проект;
  - `/account`: импорт файла, картинки по ссылке и постера Shikimori в пул. Удаление медиа,
    на которое ссылается студия, даёт 409. Раздела «Рендеры» нет.
- **MCP** через настоящий stdio (драйвер по образцу `scripts/verify-studio.mjs`,
  `MCP_ACTOR_EMAIL=e2e@test.local`, `npm run studio:worker` запущен):
  - `tools/list` — ровно 46 имён, в `initialize` есть `instructions`;
  - сценарий А, топ по турниру: `video_source_list` → `video_project_create` → пресет →
    commit → клип (`video_job_start kind:"clip"`). Проверить кадры и звук;
  - сценарий Б, свой топ: три звука и картинки в пул (`import_local_media` из
    `MCP_LOCAL_MEDIA_DIRS` или `import_youtube_audio`) → документ `manual` со `snippet.mode:"active"`
    → commit → клип. Затем финальный рендер `kind:"render"` того же проекта под админом:
    одна очередь и один рендерер от начала до конца. Кадры с правильными подписями и рангами,
    у каждой позиции звук громче тишины (`volumedetect`);
  - сценарий В, пикер: проект из пресета `picker.*` → клип, кадры раунда и таймера.
- **Объём.** `git diff --shortstat main...HEAD` и число строк `src/` до и после — в `verify.md`.

## Затронутые зоны

- [`.ai/map/classic-video.md`](../../map/classic-video.md) — удаляется целиком.
- [`.ai/map/render.md`](../../map/render.md) — остаётся только конвейер студии.
- [`.ai/map/mcp.md`](../../map/mcp.md) — состав инструментов, инструкция сервера, рецепты.
- [`.ai/map/media.md`](../../map/media.md) — импорт в кабинете, использование медиа, без «недавних».
- [`.ai/map/roles.md`](../../map/roles.md) — кабинет, удаление аккаунта, квоты без `RenderJob`.
- [`.ai/map/tournament.md`](../../map/tournament.md) — без `RenderConfig`, путь к SDK.
- [`.ai/map/dev-env.md`](../../map/dev-env.md) — каталоги `storage/`, e2e-скрипты.
- [`.ai/map/shikimori.md`](../../map/shikimori.md) — где проверять таб Shikimori.
- [`.ai/map/studio-sdk.md`](../../map/studio-sdk.md) — без оговорок про прежние конструкторы.
- `AGENTS.md`, `README.md`, скилл `verify`.
