# MCP-сервер

Доски SDK: `video_preset_list/get` отдают 24 пресета `board.*` (всего встроенных 54),
короткий ID вроде `board.tier` означает wide. `video_examples` содержит восемь
полных документов `board-<family>`. `video_schema_get` описывает board v1 внутри
документа v2 и stable-ID patch targets boardSlot/boardRound/boardCard/boardAction.
Создание, патчи, личные пресеты, commit и jobs идут теми же сервисами; отдельного
игрового протокола нет. Подробности — [SDK-гид задачи 29](../features/29-slot-boards/sdk-guide.md).

Stdio MCP-сервер `douga` позволяет внешнему ИИ самому собирать ролики. Он ищет материал в Shikimori, кладёт медиа в пул и собирает видео только инструментами `video_*` AI Video SDK ([studio-sdk.md](studio-sdk.md)). При `initialize` сервер отдаёт короткую инструкцию: подготовка турнира, топ по турниру, свой топ и пикер. Места в турнире определяет человек.

Сервер работает от имени одного аккаунта Douga, поэтому всё созданное видно на сайте этого аккаунта.

## Моушен-кит

- `video_capabilities.motion` объявляет catalogVersion1, 67 записей, четыре
  профиля, три силы и маршруты discovery/галереи. Всего зарегистрировано 52 tools.
- `video_motion_list({category?,limit?,cursor?})`: summaries без example,
  limit1..100 (default20), version/total/items/nextCursor. Cursor — непрозрачный
  ключ category:name последней записи; применять с тем же category.
- `video_motion_get({name,category?})`: полная metadata и `entry.example`,
  явно помеченный authoring-fragment. Flash существует в effect и transition;
  без category — `MOTION_CATEGORY_REQUIRED`. Flip — alias flip-y. Unknown — NOT_FOUND.
- `completeExampleId` ведёт к полному рецепту категории, не обязательно точному
  выбранному эффекту. `video_examples({id?})` читает один либо все 27 документов:
  15 прежних и 12 motion-рецептов. Новые items включают standInManifest и note;
  synthetic pool IDs надо заменить собственными assetId перед сохранением.
- [`motion-examples.ts`](../../src/video/motion-examples.ts) — общий browser-safe
  builder всех 67 локальных превью; [`/studio/motion`](../../src/app/studio/motion/page.tsx)
  требует вход, держит один StudioPreview и копирует подписанный fragment envelope.
  Профиль/сила/вариант пересобирают тот же VideoDocument, compiler и renderer.
- Timeline читает существующие motion.clip/window границы как composition-absolute
  recommendedFrames, включая последний/следующий кадр перехода. Он не компилирует
  авторский JSON повторно и не прибавляет node.from к уже scene-local clip.from.
- [Задача 30](../features/30-motion-kit/README.md), [SDK-гид](../features/30-motion-kit/sdk-guide.md).

## Где код

- [`src/mcp/server.ts`](../../src/mcp/server.ts) — точка входа. `new McpServer({name, version}, {instructions})` и `StdioServerTransport`. Обёртка `guard` перечитывает роль при каждом вызове
- [`src/mcp/instructions.ts`](../../src/mcp/instructions.ts) — текст инструкции и список из 50 имён. Инструкция не длиннее 3 КБ
- Инструменты в `server.ts`:
  - 11 `shikimori_*`: поиск, студии, аниме, персонажи, люди, списки и избранное ([shikimori.md](shikimori.md));
  - 5 инструментов пула: `list_pool`, `import_shikimori_poster`, `import_youtube_audio`, `list_local_media`, `import_local_media`. В описаниях сказано, что `artId` пула — это `assetId` привязки `{kind:"pool"}`
- [`src/mcp/tournament-tools.ts`](../../src/mcp/tournament-tools.ts) — `registerTournamentTools`: `tournament_list`, `tournament_get`, `tournament_create`, `tournament_segments_update`; ответы и назначение мест отсутствуют
- [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `registerStudioTools`: 30 инструментов `video_*` и ресурсы `video://`. `video_examples` содержит пример `top-manual`: три участника, `rank`, медиа пула и `settings.top.snippet.mode:"active"`
- [`src/mcp/actor.ts`](../../src/mcp/actor.ts) — `resolveActor()` по `MCP_ACTOR_EMAIL`
- [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) — `import_youtube_audio`: ждёт `DownloadJob` до 180 с
- Запуск: `npm run mcp`. Нужен ещё `npm run studio:worker`, иначе задания остаются в очереди

## Данные

Своих таблиц у MCP нет. Инструменты пишут в `Art`, `DownloadJob`, `Tournament`/`TournamentSegment`/`Track` и модели студии ([schema](../../prisma/schema.prisma)).

## Как устроено

- Актор: при старте `resolveActor()` ищет пользователя по `MCP_ACTOR_EMAIL`. Если переменной или аккаунта нет, процесс пишет причину в stderr и завершается с кодом 1
- Каждый вызов заново читает роль. Чужой id даёт `NOT_FOUND`. Квоты пула — из `quotasFor(role)`
- `tournament_list` → `{tournaments}`, `tournament_get {id,segmentId?}` → активный срез и полный `segments[]` с треками/прогрессом. Чтение старого турнира лениво создаёт «Все треки», сохраняя его рейтинг.
- `tournament_create` принимает `{title,scheme?,blindMode?,groupSize?,segments:[{title,subtitle?,posterArtId?,tracks:[{path}|{assetId}]}]}`. Локальный path обязан лежать в `MCP_LOCAL_MEDIA_DIRS` до и после `realpath`; assetId — собственный audio/video пула. Оригиналы и файлы пула копируются в турнир. `posterArtId` — собственная картинка. Ответ `{id,url,trackCount}` ведёт на сайт, где человек сравнивает треки.
- `list_local_media` читает одну папку без рекурсии. В `files[]` кроме name/path/kind/sizeBytes доступны теги title/artist/album, durationSec и sourceFolder. Metadata внешней цели symlink не читается. `import_local_media` по-прежнему импортирует в пул с отдельным лимитом 50 файлов за вызов.
- `tournament_segments_update {id,segments:[{id?,title,subtitle?,posterArtId?,trackIds}],confirmReset?}` принимает полный состав: каждый трек ровно один раз. Состав, подписи и постеры доступны агенту; `rank`, `topSize`, ответы — нет. Перенос снимает целые батчи по `itemIds` и отдельные legacy-пары; `{requiresConfirmation:true,answersToReset:N}` требует явного согласия перед повтором с `confirmReset:true`. Сервис повторно считает N и проверяет состав внутри транзакции.
- Создание турнира заново проверяет роль, число турниров и суммарные байты треков с встроенными обложками по `maxArchiveBytes`; пути и пул проверяются до чтения. Подробный контракт — [tournament.md](tournament.md).
- Три рецепта сборки видео из инструкции:
  - топ по турниру: `video_source_list` → `video_project_create` с `presetId` топа и `sourceId` (без `presetId` `sourceId` не принимается) → оформление → `video_project_validate` → `video_draft_commit` → `video_job_start`;
  - свой топ: медиа в пул, документ `source.kind:"manual"`, участники с `rank` и привязками `pool`, фрагмент `active`;
  - пикер: пресеты `picker.*` и `video_examples`
- Правки идут через CAS по `expectedVersion`. Повтор того же шага — с тем же `idempotencyKey`
- `video_job_start kind:"render"` без права `render:run` даёт `FORBIDDEN`. Клип доступен автору

## Грабли

- Уже запущенная сессия клиента не подхватывает новый код сервера. Нужен перезапуск или stdio-драйвер
- Без `--silent` баннер npm попадает в stdout и ломает протокол
- `import_youtube_audio` качает внутри процесса MCP. На аккаунт не больше двух активных загрузок
- Не держите общий `studio:worker` во время интеграционных тестов: он перехватывает их задания
- Пример драйвера — [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs)

## Как проверить

- `npx vitest run src/mcp/instructions.test.ts` — длина инструкции, пример `top-manual` проходит схему и компилируется
- `npx vitest run src/integration/mcp.e2e.test.ts` — ровно 50 имён, инструкция в `initialize`, Shikimori и импорт с диска
- `npx vitest run src/integration/studio-mcp.integration.test.ts` — `video_*`
- `npx vitest run src/integration/tournament-mcp.integration.test.ts` — настоящий stdio: создание из path/assetId, чтение и подписи сегментов, сохранение оригиналов, отказы для чужого пула и пути вне allowlist
- Вживую: stdio-клиент с `MCP_ACTOR_EMAIL` и запущенным воркером собирает клип по каждому из трёх рецептов. Для турнира проверь подготовку нескольких сегментов, ссылку на сайт и preview переноса со снятием ответов. Кадры и `volumedetect` — в [render.md](render.md)

## История

- [спека 10](../specs/10-mcp-server.md), [спека 22](../specs/22-ai-video-sdk-contract.md), [спека 23](../specs/23-ai-video-service-contract.md)
- Задача 26 оставила 46 инструментов и инструкцию сервера. Прежние инструменты сборки пикера и ручного топа удалены
- [задача 27](../features/27-segments/README.md) добавила четыре инструмента подготовки турнира: всего 50 имён, ответы и ранги остаются у человека
