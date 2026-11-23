# MCP-сервер

## Интерактив для asobiba и HTTP (задача 34)

- Инструменты: `video_project_copy` (копия готового ролика под игру), `video_interactive_recipe_list`,
  `video_interactive_create` (проект по интерактивному рецепту), `video_interactive_publish`,
  `video_interactive_get`, `video_interactive_unpublish`. Раздел `interactive` в `video_capabilities`
  описывает контракт снимка, рецепты и маршрут. `matchData` принимают storyboard, review, задания
  кадров и клипов и timeline. Маршрут агента — токен из `video_interactive_publish` уходит в
  `video_snapshot_import` asobiba.
- Сервер собирается одной функцией [`createMcpServer(actor, {local})`](../../src/mcp/create-server.ts).
  stdio ([`server.ts`](../../src/mcp/server.ts)) — `local: true`; HTTP — `local: false`, без инструментов
  локального диска и yt-dlp.
- HTTP: [`/api/mcp`](../../src/app/api/mcp/route.ts), Streamable HTTP без сессий, `Authorization: Bearer dga_…`.
  Каждый запрос заново находит аккаунт по токену; нет токена или он отозван — 401.
  Токены — [`api-tokens.ts`](../../src/server/api-tokens.ts): в базе только SHA-256, до 10 активных,
  гостю не выдаются; выпуск и отзыв в кабинете ([`ApiTokens.tsx`](../../src/app/account/ApiTokens.tsx)).

## Текущий маршрут агента (задача 35)

`video_capabilities` объявляет type-first authoring, каталог и бюджеты; актуальные
имена инструментов перечислены в `MCP_TOOL_NAMES` и `tools/list`. HTTP исключает
три локальных инструмента. Обычный authoring-каталог — 12 `composition.*`:
портретный/музыкальный топ, picker и tier-list в wide/vertical/square.
Полный SDK registry сохраняет прежние IDs, но они не являются новым default.

1. `video_design_guide({kind,subject?,format?})`: сначала top/picker/tier-list,
   затем состав и пожелание владельца, палитра/пара шрифтов/движение. Guide содержит
   geometry, fontPairs, palettes, avoid, contentExample и обязательный visual workflow.
   `video_project_create({kind,subject?,format?,design?,sourceId?,...})` создаёт
   композицию; styleId не требуется. sourceId относится к топу из турнира.
2. `video_content_set` — kind/mode/participants/rounds/tiers, свои
   visualAssetId/audioAssetId, subtitle/kind/tier, группы с cardIds/label и явными
   answerGroupIds. musicAssetId/backgroundAssetId задаются по раунду: null
   выключает музыку раунда либо снимает его назначение фона.
   Для тир-листа content kind:"board" + tiers с participantIds;
   SDK сам создаёт placements. CAS, replay и ownership/media kind проверяются до записи.
3. `video_preset_list({recipes:true,kind,subject?,format,query?})` — до трёх
   curated композиций с рекомендацией и image blocks; `previewOrder` связывает
   изображения с IDs, `previews` показывает notReady/byteLimit. `video_preset_get`
   явно читает canonical preset/contentForm/example, включая совместимые старые IDs.
   Обычный список содержит композиции и личные пресеты; `video_examples({})`
   предлагает новые композиции wide. Прежние examples доступны по явному id.
4. `video_storyboard` — exact draft/revision, одна PNG-сетка default12/max24 плитки,
   scene/segment/page/compareRevision/compareJobId; pixelDiff:true добавляет
   diff PNG и метрики RGBA/PSNR для каждой сопоставимой пары. Ready возвращает native image;
   queued — общий job_get/inspect, без отдельного job на каждую плитку.
   `video_job_inspect({jobId,frameId:"0"})` открывает отдельный preview PNG.
   `nextPageAction` продолжает immutable origin через sourceJobId. Это же поле
   закрепляет review/deep за изображёнными материалами и engine; live source не
   перечитывается. В scene detail/compare scope сохраняется.
5. `video_review` — bounded issues/verified suggestions/nextAction, origin/coverage;
   mode deep готовит clip окна со звуком. `video_review_apply` принимает reportId,
   suggestionIds и expectedVersion, перепроверяет эффект и меняет только draft.
   Адресный deep: sceneId/segmentId/frame из готового nextAction. Compare содержит
   changed properties и resolved/new/remaining issues с явным static-only coverage.
6. После apply есть draftBackupId; `video_document_get({projectId,reviewBackupId})`
   отдаёт before и готовый restore action. Commit/publish не вызываются автоматически.

После статической проверки агент должен фактически посмотреть PNG всех страниц,
плотные/длинные RU/JP подписи через `video_text_inspect` и движение/звук в deep
или `video_job_start kind:"clip"`. `notChecked` и `ready=true` не подтверждают
художественную готовность. После исправлений просмотр повторяется.

`video_resource_estimate({document})` — read-only pure preflight без проектов/jobs:
2 000 000 authored values и 100 000 expanded nodes, конкретные resource/used/limit/path
при отказе. complete=false означает раннюю остановку; audioCues относится к authored
rules, не неявному block audio/playlist. Timeline/audio проверяются compiler с manifest.
`video_capabilities.limits.document.maxSerializedBytes` — 32 МиБ UTF-8; сервер
одинаково ограничивает JSON serialize и text-save. Другие timeline/depth/audio
guards, бюджет медиарезультата MCP и worker limits не увеличивались.

Raw document — явный авторский/совместимый SDK-путь. Обычное создание по retired
presetId даёт `PRESET_RETIRED` после receipt replay; copy/restore/edit старого
документа остаются. Дизайн выбирается отдельно от типа, marker composition
не добавляется старому JSON автоматически.

Сервисные schemas доступны в video_schema_get(services). Реализация адаптеров —
[`storyboard-tools.ts`](../../src/mcp/storyboard-tools.ts), общий механизм очереди
и ресурсов прежний. Короткая инструкция initialize направляет к guide и реальному
просмотру; описание нового authoring — [карточка SDK](studio-sdk.md).
Детали frozen storyboard/review — [гид задачи 32](../features/32-storyboard-reference/sdk-guide.md).

Проверка: `npx tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json scripts/verify-storyboard.ts`
создаёт отдельные проверочные аккаунты/материалы, использует настоящий stdio,
адресные workers и сохраняет доказательства/секреты только в storage.

Доски SDK сохраняют 24 прежних пресета `board.*` для явного чтения/совместимости;
короткий ID вроде `board.tier` означает wide. Новое создание тир-листа идёт по kind.
Явный `video_examples({id:"board-<family>"})` читает прежний полный документ.
`video_schema_get` описывает board v1 внутри
документа v2 и stable-ID patch targets boardSlot/boardRound/boardCard/boardAction.
Создание, патчи, личные пресеты, commit и jobs идут теми же сервисами; отдельного
игрового протокола нет. Подробности — [SDK-гид задачи 29](../features/29-slot-boards/sdk-guide.md).

Stdio MCP-сервер `douga` позволяет внешнему ИИ собирать ролики. Он ищет материал
в Shikimori, кладёт медиа в пул и работает через `video_*` SDK. При `initialize`
получает маршрут «тип → состав → решение о стиле → проверка кадров и клипа».
Места, правильные ответы и распределение по тирам задаёт автор.

Сервер работает от имени одного аккаунта Douga, поэтому всё созданное видно на сайте этого аккаунта.

## Моушен-кит

- `video_capabilities.motion` описывает совместимый catalogVersion1, четыре
  профиля, три силы и маршруты discovery/галереи. Обычный motion discovery
  отбирает спокойные authoring effects/choreographies/transitions через
  [`authoring-motion.ts`](../../packages/video/src/authoring-motion.ts).
- `video_motion_list({category?,compatibility?,limit?,cursor?})`: summaries без example;
  compatibility:true открывает полный прежний каталог,
  limit1..100 (default20), version/total/items/nextCursor. Cursor — непрозрачный
  ключ category:name последней записи; применять с тем же category.
- `video_motion_get({name,category?})`: явное чтение полной metadata и `entry.example`,
  явно помеченный authoring-fragment. В совместимом каталоге Flash есть в effect и transition;
  без category — `MOTION_CATEGORY_REQUIRED`. Flip — alias flip-y. Unknown — NOT_FOUND.
- `completeExampleId` ведёт к полному рецепту категории, не обязательно точному
  выбранному эффекту. `video_examples({id})` явно читает прежние примеры и
  motion-рецепты; без id выдаются новые wide-композиции. Motion items включают standInManifest и note;
  synthetic pool IDs надо заменить собственными assetId перед сохранением.
- [`motion-examples.ts`](../../packages/video/src/motion-examples.ts) — общий browser-safe
  builder всех 67 локальных превью; [`/studio/motion`](../../src/app/studio/motion/page.tsx)
  требует вход, держит один StudioPreview и копирует подписанный fragment envelope.
  Профиль/сила/вариант пересобирают тот же VideoDocument, compiler и renderer.
- Timeline читает существующие motion.clip/window границы как composition-absolute
  recommendedFrames, включая последний/следующий кадр перехода. Он не компилирует
  авторский JSON повторно и не прибавляет node.from к уже scene-local clip.from.
- [Задача 30](../features/30-motion-kit/README.md), [SDK-гид](../features/30-motion-kit/sdk-guide.md).

## Где код

- [`src/mcp/server.ts`](../../src/mcp/server.ts) — точка входа. `new McpServer({name, version}, {instructions})` и `StdioServerTransport`. Обёртка `guard` перечитывает роль при каждом вызове
- [`src/mcp/instructions.ts`](../../src/mcp/instructions.ts) — текст инструкции и список `MCP_TOOL_NAMES`; `mcp.e2e` сверяет его с `tools/list`
- Инструменты в `server.ts`:
  - 11 `shikimori_*`: поиск, студии, аниме, персонажи, люди, списки и избранное ([shikimori.md](shikimori.md));
  - 5 инструментов пула: `list_pool`, `import_shikimori_poster`, `import_youtube_audio`, `list_local_media`, `import_local_media`. В описаниях сказано, что `artId` пула — это `assetId` привязки `{kind:"pool"}`
- [`src/mcp/tournament-tools.ts`](../../src/mcp/tournament-tools.ts) — `registerTournamentTools`: `tournament_list`, `tournament_get`, `tournament_create` (рецепт базы по Shikimori — в описании), `tournament_items_add`, `tournament_items_update`, `tournament_items_remove`, `tournament_segments_update`. Ответов, выбора алгоритма по умолчанию и назначения мест нет
- [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `registerStudioTools`: guide, estimate, `video_*` и ресурсы `video://`. Default examples — композиции; `top-manual` читается явно как raw SDK пример
- [`src/mcp/actor.ts`](../../src/mcp/actor.ts) — `resolveActor()` по `MCP_ACTOR_EMAIL`
- [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) — `import_youtube_audio`: ждёт `DownloadJob` до 180 с
- Запуск: `npm run mcp`. Нужен ещё `npm run studio:worker`, иначе задания остаются в очереди

## Данные

Своих таблиц у MCP нет. Инструменты пишут в `Art`, `DownloadJob`, `Tournament`/`TournamentSegment`/`Track` и модели студии ([schema](../../prisma/schema.prisma)).

## Как устроено

- Актор: при старте `resolveActor()` ищет пользователя по `MCP_ACTOR_EMAIL`. Если переменной или аккаунта нет, процесс пишет причину в stderr и завершается с кодом 1
- Каждый вызов заново читает роль. Чужой id даёт `NOT_FOUND`. Квоты пула — из `quotasFor(role)`
- `tournament_list` → `{tournaments}`, `tournament_get {id,segmentId?}` → активный срез и полный `segments[]` с треками/прогрессом. Чтение старого турнира лениво создаёт «Все треки», сохраняя его рейтинг.
- `tournament_create` принимает `{title,scheme?,schemeSettings?,blindMode?,groupSize?,segments:[{title,subtitle?,posterArtId?,items|tracks:[…]}]}`. Участник — `{shikimori:{type:"character"|"anime",id}}`, `{assetId}` (картинка, аудио или видео своего пула) или `{path}` (в `MCP_LOCAL_MEDIA_DIRS` до и после `realpath`), у любого `title?/subtitle?/note?`. Файлы копируются в турнир. `posterArtId` — собственная картинка. `scheme` агент не передаёт без просьбы человека. Ответ `{id,url,itemCount,trackCount,segments,emptySegments,skipped[{segmentIndex,itemIndex,type,id,reason}],schemeRequired,estimates}`: `estimates` — экраны по восьми алгоритмам при размере группы турнира (у картинок 4). Сбой Shikimori-участника уходит в `skipped`, всё пропало — `ALL_ITEMS_SKIPPED`; повтор в сегменте — `DUPLICATE_ITEM:<имя>`; чужой пул, путь и квота отклоняют вызов.
- `tournament_items_add {id,segmentId?|segmentTitle?,items,confirmReset?}`, `tournament_items_update {id,items:[{trackId,title?,subtitle?,note?,coverArtId?,excluded?}],confirmReset?}`, `tournament_items_remove {id,trackIds,confirmReset}`. Всё, что снимает ответы или меняет готовый топ (удаление с ответами, добавление в готовый сегмент, исключение и возврат там), сначала отвечает `requiresConfirmation` (`answersToReset` или `segmentsToReopen`) и ничего не меняет. Согласие перепроверяется внутри транзакции записи: человек мог сохранить топ, пока агент думал. Тогда `tournament_items_update` отвечает свежим `segmentsToReopen` и `partiallyApplied:true` (подписи и часть исключений уже записаны, повтор идемпотентен). Подписи меняются сразу; пачка сначала проверяется целиком.
- `list_local_media` читает одну папку без рекурсии. В `files[]` кроме name/path/kind/sizeBytes доступны теги title/artist/album, durationSec и sourceFolder. Metadata внешней цели symlink не читается. `import_local_media` по-прежнему импортирует в пул с отдельным лимитом 50 файлов за вызов.
- `tournament_segments_update {id,segments:[{id?,title,subtitle?,posterArtId?,trackIds}],confirmReset?}` принимает полный состав: каждый трек ровно один раз. Состав, подписи и постеры доступны агенту; `rank`, `topSize`, ответы — нет. Перенос снимает целые батчи по `itemIds` и отдельные legacy-пары; `{requiresConfirmation:true,answersToReset:N,segmentsToReopen}` (снимаемые ответы или готовые топы человека, которые откроются) требует явного согласия перед повтором с `confirmReset:true`. Сервис повторно считает N и проверяет состав внутри транзакции.
- Создание турнира заново проверяет роль, число турниров и суммарные байты треков с встроенными обложками по `maxArchiveBytes`; пути и пул проверяются до чтения. Подробный контракт — [tournament.md](tournament.md).
- Authoring из инструкции: guide по типу, затем create kind/subject/format/design.
  Топ турнира добавляет sourceId; свой топ получает participants с rank и медиа;
  picker — rounds/cards/groups/OST; tier-list — content kind:"board" с tiers.
  Затем storyboard всех страниц → text inspect/review → фактический deep/clip →
  исправления → validate/commit/job_start.
- Правки идут через CAS по `expectedVersion`. Повтор того же шага — с тем же `idempotencyKey`
- `video_job_start kind:"render"` проверяет `render:run`: все зарегистрированные,
  включая прежний `user`, имеют это право. Клип доступен автору; владение не обходится

## Грабли

- Уже запущенная сессия клиента не подхватывает новый код сервера. Нужен перезапуск или stdio-драйвер
- Без `--silent` баннер npm попадает в stdout и ломает протокол
- `import_youtube_audio` качает внутри процесса MCP. На аккаунт не больше двух активных загрузок
- Не держите общий `studio:worker` во время интеграционных тестов: он перехватывает их задания
- Пример драйвера — [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs)

## Как проверить

- `npx vitest run src/mcp/instructions.test.ts` — длина инструкции, пример `top-manual` проходит схему и компилируется
- `npx vitest run src/integration/mcp.e2e.test.ts` — набор имён совпадает с `MCP_TOOL_NAMES`, инструкция в `initialize`, Shikimori и импорт с диска
- `npx vitest run src/integration/studio-mcp.integration.test.ts` — `video_*`
- `npx vitest run src/integration/tournament-mcp.integration.test.ts` — настоящий stdio: создание из path/assetId/Shikimori (локальный стенд), `skipped`, `estimates`, `schemePending`, правка и исключение, удаление, согласие для готового топа, отказы для чужого пула и пути вне allowlist
- Вживую (задача 33): драйверы `storage/verification/33-image-tournament/mcp-collect.mjs` и `mcp-step.mjs` (вне git) — база «главные героини студии из просмотренного» на живом Shikimori, создание, проект SDK; см. [гид агента](../features/33-image-tournament/sdk-guide.md)
- Вживую: stdio-клиент с `MCP_ACTOR_EMAIL` проходит guide → создание по kind →
  content → storyboard всех страниц → review/clip. Проверь четыре адаптации
  композиций и три формата, явный style override, legacy raw/copy/restore,
  адресный overbudget и отсутствие записи от estimate. Для турнира — несколько
  сегментов и preview переноса со снятием ответов. Кадры/звук — в [render.md](render.md);
  фактически выполненное записывай в [verify.md задачи 35](../features/35-studio-design-quality/verify.md)

## История

- [спека 10](../specs/10-mcp-server.md), [спека 22](../specs/22-ai-video-sdk-contract.md), [спека 23](../specs/23-ai-video-service-contract.md)
- Задача 26 оставила 46 инструментов и инструкцию сервера. Прежние инструменты сборки пикера и ручного топа удалены
- [задача 27](../features/27-segments/README.md) добавила четыре инструмента подготовки турнира: всего 50 имён, ответы и ранги остаются у человека

## Типографика (задача 31)

В поставке задачи 31 было 57 инструментов: добавлены video_font_list/get, video_typography_list/get
и video_text_inspect (`src/mcp/typography-tools.ts`). Теперь каталоги дают 9 семейств,
12 стилей и 6 тем с фрагментами, фильтрами языка/italic/category и пагинацией.
Полные JSON: typography-ost, typography-picker-jp, typography-board-labels,
typography-rich-title в video_examples. [Короткий рецепт](../features/31-typography/sdk-guide.md).

video_text_inspect читает только принадлежащий актору проект/сохранённый черновик,
без reconcileSource/commit/новой ревизии. expectedVersion проверяет origin данных;
nodeId/segmentId/limit/cursor и lineLimit/lineOffset/runOffset ограничивают детали.
Ответ содержит реальные строки, fontSize, faces, overflow и продолжения.
preview:true отдаёт image block diagnostic PNG (≤12 MiB), без base64 в JSON.
Ошибки схемы/прав/ресурсов не обходятся; допускается только TEXT_OVERFLOW.
Тяжёлый слот занят — JOB_ACTIVE. Новые шрифты не требуют внешней сети/шрифтов ОС.

Применение темы через существующий video_draft_patch + CAS, затем inspect/validate
и штатные commit/jobs. Финальный render доступен всем зарегистрированным: старый `user` имеет права `admin`. SDK/сайт также
дают preserve/replace и scopes; dirty buffer не теряется. Настоящий stdio и
реальные кадры/офлайн проверяются по verify.md задачи 31.

Задача 33: участники-картинки и база от агента. `tournament_create` принимает
Shikimori-участников и картинки, отвечает `skipped`, `schemeRequired` и
`estimates`; три инструмента `tournament_items_*` правят состав. Рецепт базы по
профилю Shikimori живёт в описании `tournament_create`, маршрут целиком — в
[гиде агента задачи 33](../features/33-image-tournament/sdk-guide.md).

У `video_resource_estimate` поле `audioCues` считает authored explicit cues и
развёртку их anchors, без неявной музыки блоков/playlist. `complete` относится к
этой области обхода, не означает готовность рендера. Реальные cues смотрят в
скомпилированном timeline; их бюджеты компилятор проверяет отдельно. MCP добавляет
`serializedBytes` и `limits.maxSerializedBytes` после успешного bounded traversal;
при неполном обходе byte estimate — null.

В режиме Kaname HTTP MCP принимает персональный токен Douga. При каждом обращении сервер проверяет актуальные права по subject и локальную блокировку. Stdio выбирает привязанного пользователя по `KANAME_MCP_SUBJECT` и настроенному issuer. Загрузчик с локального диска требует полномочий владельца. Остальные роли работают над своими HTML-композициями.
