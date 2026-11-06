# AI Video SDK (студия)

Это единственная точка входа в видео Douga. Ролик (топ, пикер или доска) описывается каноническим версионированным JSON `VideoDocument`. Его правят на сайте и через MCP, проверяют, ведут историю и рендерят через устойчивую очередь.

## Моушен-кит

- [`motion-types.ts`](../../src/video/motion-types.ts), [`motion-schema.ts`](../../src/video/motion-schema.ts),
  [`motion-catalog.ts`](../../src/video/motion-catalog.ts) и [`motion-compiler.ts`](../../src/video/motion-compiler.ts)
  — закрытый каталог v1: 40 эффектов, 10 хореографий, 8 новых переходов,
  5 фонов и виджеты timer/versus/badge/progress. Короткий [SDK-гид](../features/30-motion-kit/sdk-guide.md).
- `settings.motion`: profile `smooth|snappy|bouncy|cinematic`, intensity
  `subtle|normal|bold`, общая `duration:Time`, каналы `enter/exit/loop/emphasis`,
  `stagger:{interval:Time,order:forward|reverse|center|rows}`, `choreography`.
  Узел переопределяет параметры через `motion`. Канал — имя либо
  `{name,duration?,delay?,intensity?,direction?,at?}`; `flip` нормализуется в `flip-y`.
- `at:Time` отсчитывается от node.from; `{event,offset?}` — от scene-local события.
  События scene.start/card.reveal/timer.start/answer.reveal и board.*; board event
  уточняется cardId/actionId/slotId. У card.reveal допустим cardId текущей сцены;
  остальные phase events selectors не принимают. Недоступное событие/карточка —
  диагностическая ошибка, fallback на начало первого reveal запрещён.
- Отсутствие наследует настройку, `null` выключает канал/хореографию/фон.
  Неявный global enter применяется к листьям. Собственный transform контейнера
  не копируется детям; container.motion.stagger задаёт локальный каскад их анимаций.
- IR сохраняет optional `node.motion[]` с scene-local from/duration/window;
  старые keyframes, исходные окна, аудио и число кадров не переписываются.
  Длительности вписываются в reveal/visible окно, включая короткие сцены.
  Порядок versus-impact: карточки → VS → timer; rank-reveal: номер → арт → текст.
- `settings.backdrop` выбирает art-blur/gradient-flow/light-orbs/particles/vignette.
  Источники current-card/round/asset; explicit asset обязателен для source asset.
  Переключение на round/current-card очищает унаследованный asset. В decision
  фон раунда либо нейтральная подложка, победитель — только после answer.
  Resolved медиа лежат в `scene.backdrop.layers[].media`; обходы медиа
  обязаны учитывать эти слои. У preset перенос назначений независим по settings-уровням.
- `settings.timer.variant`: digits/ring/segments/bar. Новые узлы versus
  (clean/neon/slash/impact), badge (rank/round/winner/label) и progress (scene/video).
  Explicit badge.text отключает auto-binding. Video progress получает общую длину
  после сборки v2 и scene-local from = -scene.from.
- Частицы ≤32, текстовые motion fragments ≤500 на сцену. Случайность по seed,
  без wall-clock/произвольного JS/CSS. Без новых настроек старый IR не меняется;
  проверка задачи 30 сравнивает полный JSON всех 54 пресетов × 5 FPS.

## Где код
- [`src/video/`](../../src/video/) — домен SDK без I/O. Публичный вход — [`index.ts`](../../src/video/index.ts) (types, schema, builders, compiler, layout, presets, patches, assets); сервер напрямую берёт ещё `resource-limits.ts` и `settings.ts`
  - [`schema.ts`](../../src/video/schema.ts) / [`types.ts`](../../src/video/types.ts) — строгие Zod-схемы (v1 и v2, неизвестные поля отвергаются), JSON Schema через `getVideoDocumentJsonSchema()`
  - [`builders.ts`](../../src/video/builders.ts) — `createVideoDocument`, `scene`/`textNode`/`containerNode`/`time`/`frame`: строят тот же JSON
  - [`compiler.ts`](../../src/video/compiler.ts) + `blocks.ts`/`nodes.ts`/`audio.ts` — `compileVideo(doc, manifest)` → `{plan, diagnostics, ready}`; план — чистый JSON без замыканий
  - [`layout.ts`](../../src/video/layout.ts) — размеры форматов (`OUTPUT_DIMENSIONS`) и раскладки `grid`/`arc`/`free`
  - [`presets.ts`](../../src/video/presets.ts) — 54 встроенных пресета `top|picker|board.<family>.<wide|vertical|square>`, `extractVideoPreset`/`applyVideoPreset`
  - [`board-state.ts`](../../src/video/board-state.ts) — чистые атомарные правила доски; [`board-compiler.ts`](../../src/video/board-compiler.ts) — действия в обычный план; [`board-presets.ts`](../../src/video/board-presets.ts) — 8 семейств и factory
  - [`patches.ts`](../../src/video/patches.ts) — `patchVideoDocument`: атомарные `set`/`unset` по стабильным ID (document/segment/participant/round/card/group/scene/node)
  - [`resource-limits.ts`](../../src/video/resource-limits.ts) — технические бюджеты (глубина, развёртка сцен/узлов/звука, ≤ 7200 с)
- [`src/remotion/StudioVideo.tsx`](../../src/remotion/StudioVideo.tsx) — единый рендерер плана (композиция `Studio` в [`Root.tsx`](../../src/remotion/Root.tsx)) для Player, PNG, клипов и финального MP4; покадровая математика — [`studio-frame.ts`](../../src/remotion/studio-frame.ts), градиент/тень → CSS — [`studio-paint.ts`](../../src/remotion/studio-paint.ts)
- [`src/server/studio/`](../../src/server/studio/) — сервисы (вход `index.ts`, все `import "server-only"`):
  - [`projects.ts`](../../src/server/studio/projects.ts) — создание, черновик (replace/patch/preset), commit/restore, CAS
  - [`revisions.ts`](../../src/server/studio/revisions.ts) — история, `freezeStudioProject` → `StudioSnapshot`
  - [`sources.ts`](../../src/server/studio/sources.ts) — `reconcileSource`: синхронизация с рейтингом турнира
  - [`assets.ts`](../../src/server/studio/assets.ts), [`inspection.ts`](../../src/server/studio/inspection.ts) — разрешение привязок, хэши, явный осмотр медиа
  - [`jobs.ts`](../../src/server/studio/jobs.ts), [`worker.ts`](../../src/server/studio/worker.ts), [`engine.ts`](../../src/server/studio/engine.ts), [`render.ts`](../../src/server/studio/render.ts), [`imports.ts`](../../src/server/studio/imports.ts) — очередь, lease, бандл Remotion, рендер, импорт по ссылке
  - [`http.ts`](../../src/server/studio/http.ts) + [`http-origin.ts`](../../src/server/studio/http-origin.ts) — HTTP-адаптер, коды ошибок, проверка `Origin`
  - [`publication.ts`](../../src/server/studio/publication.ts) — одна публичная ссылка на проект
  - [`watch-public.ts`](../../src/server/studio/watch-public.ts) — план для гостя и раздача файлов снимка
  - [`export-html.ts`](../../src/server/studio/export-html.ts) + [`export-slice.ts`](../../src/server/studio/export-slice.ts) — один офлайн-`.html`
- [`scripts/studio-worker.ts`](../../scripts/studio-worker.ts) — исполнитель очереди (`npm run studio:worker`); [`scripts/studio-render-child.ts`](../../scripts/studio-render-child.ts) — дочерний процесс bundle/render/import
- UI: [`src/app/studio/`](../../src/app/studio/) — `/studio/new` (`new/`), `/studio/<id>` (`StudioWorkspace.tsx`, `editor-state.ts`); список SDK-проектов — [`/projects`](../../src/app/projects/page.tsx); SDK-кнопка в результатах турнира — `src/app/tournaments/[id]/ResultsPanel.tsx`
  - страница просмотра [`/watch/<token>`](../../src/app/watch/[token]/page.tsx) и плеер [`src/watch/WatchPlayer.tsx`](../../src/watch/WatchPlayer.tsx). Чистые функции плеера (главы, клавиши, автоскрытие, окно предзагрузки) лежат в [`src/watch/model.ts`](../../src/watch/model.ts), функции офлайн-файла — в [`src/watch/offline.ts`](../../src/watch/offline.ts). Шапку на `/watch` убирает [`src/middleware.ts`](../../src/middleware.ts)
- API: [`src/app/api/studio/`](../../src/app/api/studio/) — catch-all `[[...path]]/route.ts` → `studioHttp`
- MCP: [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `video_*`-инструменты поверх тех же сервисов, подробности в [mcp.md](mcp.md)
- [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs) — повторяемая проверка через настоящий stdio MCP

## Данные
- Модели Prisma: `StudioProject`, `StudioRevision`, `StudioAssetReference`, `StudioSnapshot`, `StudioPublication`, `StudioExportCache`, `StudioPreset`, `StudioMutation`, `StudioAnalysis`, `StudioJob`, `StudioWorkerLease` ([schema](../../prisma/schema.prisma))
- Привязки медиа в документе (`bindings`): `pool` (Art пула), `track` (трек турнира, `media:"cover"` — его обложка), `builtin`; `StudioAssetReference` держит Art/Track/Tournament по scope `head`/`draft`/`revision:N`
- Диск (`storage/`): `studio/<userId>/<projectId>/versions/<uuid>` — подготовленные ассеты ревизии; `studio-jobs/<userId>/<jobId>` — результаты; `studio-engines/<sha256>` — бандлы Remotion; `studio-exports/<userId>/<projectId>/<key>.m4a|.mp4` — нарезки ffmpeg для `.html`, `key` считается от содержания окна

## Как устроено
- Форматы `wide`/`vertical`/`square` = 1920×1080 / 1080×1920 / 1080×1080. Встроенные пресеты — 30 FPS (схема допускает 24/25/30/50/60). Действуют технические бюджеты схемы.
- Документ v1: `source` (`manual`|`tournament`, participants, rounds с cards/groups/answer), `bindings`, `settings` + `formatSettings`, `scenes` (`block: custom|top|picker`, `repeat: participants|rounds`, узлы container/text/shape/image/video/card/timer/audio с анимациями) и `audio` (плейлист, cues с ролями primary/music/sfx/voice). Произвольный JS/TSX документ не исполняет: новый эффект = расширение схемы + компилятора + `StudioVideo`.
- Документ v2: корневой `scenes: []` и `segments[]` с id/kind/title/subtitle/poster/sourceSegmentId/participantIds/roundIds/scenes/settings/audio/enabled. В одном видео top, picker, board и custom. Общие settings/пресет наследуются, локальные overrides сохраняются. Патч target segment меняет один сегмент, set массива document.segments позволяет копировать (с новыми ID), переставлять и удалять.
- Примитивы v2: text bindings `segment.title/subtitle/number/count` (count — число мест), `participant.comment/album/score`; asset tokens `$participant.visual`, `$participant.audio`, `$segment.poster`; container `repeat:"participants"` + `selection:"segment"|"document"|"revealed"` + дочерний шаблон. `style.blur` = 0..200 px. `bestMomentSec` приоритетнее автоматического и ручного offset. Бюджеты развёртки суммируются по включённым сегментам и вложенным повторам.
- План остаётся IR schemaVersion1/compilerVersion1.0.0 и дополняется `segments:[{id,title,kind,from,to}]`; у сцен segmentId/segmentTitle. Timeline возвращает границы [from,to), watch/offline называют главы по сегментам. Старый v1 проходит прежний путь; проверка задачи27 подтвердила идентичные планы, lossless PNG и PCM.
- `StudioProject.version` — CAS-токен (`expectedVersion`), растёт при любой записи: черновик, синхронизация источника, commit. `revision` — номер сохранённой ревизии, растёт только при commit/restore/смене источника. Это разные числа.
- Черновик хранится текстом (`draftText`) даже при невалидном JSON. `previewJson` обновляется только готовым планом; происхождение превью — `previewRevision` (`null` = из черновика) и `previewVersion`; `previewStale` = превью не от текущей версии.
- Restore создаёт новую ревизию со старым содержимым. Идемпотентность — `idempotencyKey` в `StudioMutation`: ключ общий на аккаунт, тот же ключ с другим запросом → `IDEMPOTENCY_CONFLICT`.
- Каждое чтение проекта вызывает `reconcileSource`. Новый проект по турниру — v2: `source.segments` содержит готовые непустые сегменты в порядке турнира, участники — top-N каждого с локальными rank. ID участника = trackId; metadata (label/comment/album/score/bestMoment/cover) авторитетны из турнира, оформление сохраняется по ID. Новый готовый сегмент наследует общий пресет и встаёт после последнего исходного перед аутро. Авторский порядок, копии и удаление video-сегментов сохраняются. Временно неготовый source-сегмент остаётся в документе с enabled:false и восстанавливает оформление после готовности; `source.dormantSegments` хранит авторский enabled по video segment ID, а `source.suppressedSegmentIds` удерживает авторское удаление через этот цикл (в том числе удаление уже dormant части). V1 закрепляется за `source.segmentId`, не смешивает локальные рейтинги. При смене отпечатка head получает ревизию reason source.
- Задание: `startStudioJob` → `freezeStudioProject` (снимок: resolved document, manifest, файлы с SHA-256, план) + `engineId` → `StudioJob` в статусе `queued`. Воркер берёт единственный тяжёлый слот `StudioWorkerLease` (lease 30 с, heartbeat 5 с, ≤ 3 попытки) и форкает `studio-render-child.ts`. Виды: `still`/`clip`/`audio` (≤ 15 с, длинная сторона 720) и `render` (весь таймлайн).
- Пресеты (54 встроенных + личные `StudioPreset`) содержат только оформление и абстрактные слоты; схема отвергает участников и реальные медиа-привязки. Применение переносит медиа только по совместимой структуре, иначе `PRESET_INCOMPATIBLE`.

## Грабли
- `expectedVersion` ≠ `revision`. Устаревшая версия → `VERSION_CONFLICT` (HTTP 409); `revision` в задании выбирает сохранённый документ. Даже чтение может поднять `version` (синхронизация источника), поэтому перед записью перечитывайте.
- Ошибочный JSON сохраняется черновиком и молча к head не откатывается. Commit/freeze/финальное задание по невалидному черновику → `VALIDATION_FAILED`. Последнее корректное превью показывается с пометкой происхождения — не выдавайте его за текущее.
- Редактор (`acceptRemote` в `editor-state.ts`) при параллельной правке не трогает грязный буфер: держит локальный текст и его `baseVersion`, ставит `conflict`. Буфер заменяет только явная «Загрузить серверную версию».
- Задание фиксирует frozen inputs (снимок + `engineId`). Правка или новый рейтинг меняют проект, но не старые задания; новый MP4 — только новым заданием, автоматического перерендера нет. Снимок защищён FK `Restrict`, пока на него ссылаются задания.
- `CardStyle.gradient`/`shadow` структурные: отсутствие поля наследует, явный `null` сбрасывает наследованный эффект. Не подменяйте их произвольным CSS/URL (цвет проходит regex, URL запрещены).
- Осмотр `Art.kind=image` (`inspection.ts`) не делает input seek даже к нулю: крупный JPEG теряет единственный кадр, и ffmpeg отдаёт 0 байт.
- Финальный `render` требует `render:run` (admin). Это проверяется при постановке и повторно в воркере. Превью доступны с `media:upload`. Лимиты ([`job-types.ts`](../../src/server/studio/job-types.ts) `studioJobLimits`): не больше 4 активных заданий на аккаунт; не-админу — не больше 512 МиБ результатов суммарно (`JOB_QUOTA_EXCEEDED`).
- HTML-плеер — второй выход той же сохранённой ревизии, не замена MP4. Публикация (`POST /api/studio/projects/<id>/publication`) зовёт `freezeStudioProject` с явным номером ревизии и не коммитит черновик. На проект одна `StudioPublication`: обновление меняет снимок и оставляет токен, снятие удаляет строку. Снимок, на который ссылается публикация, не удаляют `releaseUnclaimedSnapshot`, `deleteStudioJob` и `deleteStudioSnapshot` (`PUBLICATION_IN_USE`). Удаление проекта и аккаунта сначала снимает публикации.
- Транзакции публикации и снятия первой командой пишут строку `StudioProject` и так берут блокировку записи SQLite. Внутри одного процесса Prisma и так выполняет транзакции по очереди, а сайт, MCP и воркер — разные процессы. Снятие сверяет `expectedVersion`. Тело `publication` разбирается строго: пустое тело — без опций, кривое — `MALFORMED_JSON`.
- Гость открывает `/watch/<token>` без сессии. Клиенту уходят название (оно же заголовок вкладки, `generateMetadata`) и план, в котором `src` переписан на `/api/watch/<token>/media/<sha256><ext>`. Файл отдаёт `streamStudioFile`: Range, без чтения целиком, `ETag` с хэшем и `private, max-age=31536000, immutable`, потому что имя файла и есть хэш. Разобранный индекс снимка хранится в памяти по `snapshotId`, снимок после заморозки не меняется. Чужой hash и снятый токен — 404, страница говорит «Ролик снят с публикации».
- Middleware срабатывает на всех страницах, кроме `/api`, `_next/static`, `_next/image` и `favicon.ico`. Заголовок `x-douga-chrome: bare` ставится только на `/watch`, на остальных страницах присланный клиентом снимается.
- Плеер `/watch` и офлайн-файла плавный за счёт трёх мер. Сцены и звуковые реплики `StudioVideo` монтируются за 2 с до начала (`premountFor`, только в Player). Картинки на 30 с вперёд заранее декодирует `new Image().decode()`: уже декодированный адрес не включает `pauseWhenLoading` (`src/remotion/image-ready.ts`). Звук, который ещё не начался, заранее скачивается `fetch` в HTTP-кэш, а `src` у `<audio>` не меняется. Remotion `prefetch` не годится: его поздняя подмена на blob перезагружает уже играющую реплику. Предпросмотр в студии и `/watch` берут `numberOfSharedAudioTags` из `sharedAudioTagCount`: смонтированные заранее реплики тоже занимают общий тег. Без этого каждое монтирование `<Img>` на миг ставит Player в буферизацию, а та ставит на паузу звук.
- «Скачать .html» работает и без ссылки: `GET .../export.html?estimate=1` готовит файлы и возвращает точный размер, сам `GET` стримит один файл с `Content-Length`. Окна плана считаются по ролям с запасом 0,5 с (`mediaSlices`):
  - картинка и источник, который используется от края до края, встраиваются из ревизии как есть;
  - звук реплики режется в AAC `.m4a`;
  - картинка видео-узла режется в H.264 `.mp4` без звука: `StudioVideo` не играет собственный звук узла;
  - постеры видео встраиваются отдельно.

  Ключ нарезки — проект, hash, роль, окно, fps и версия энкодера. Поэтому коммит без правок медиа берёт готовые файлы. Подготовка файлов одного проекта идёт по очереди, это гарантирует процесс сайта. Сначала удаляются нарезки, которые этой ревизии не нужны, поэтому старые не занимают квоту новых. Исключение — нарезки, которые ещё держит незаконченное скачивание или оценка. Пропавший файл режется заново. Окно не выходит за конец источника. Квоту 512 МиБ для ролей без `render:run` считают только нарезки (`EXPORT_QUOTA_EXCEEDED`). Проверка и вставка строки идут в одной транзакции с записью в `User`, поэтому два одновременных экспорта не проскакивают порог. ffmpeg убивается через 120 с (`EXPORT_SLICE_FAILED`). Сам `.html` на диске не хранится. Бандл плеера (esbuild) кэшируется по хэшу lock-файла и своих исходников. В файле Arimo 400/700 latin+cyrillic. Если транзакция публикации откатилась, квитанция `publish-freeze:` снимается вместе с невостребованным снимком, и тот же ключ идемпотентности можно повторить.
- Импорт по ссылке закрыт от SSRF тем же `assertPublicUrl`, что и пул ([media.md](media.md)). Схема `startStudioImportSchema` нормализует ссылку через `new URL(...).href`. yt-dlp получает ровно ту ссылку, которую проверил гард: Python `urlparse` читает `http://a.com\@127.0.0.1/` с хостом 127.0.0.1. `startStudioImport` отвечает `BLOCKED_HOST` на loopback или LAN (в MCP `{code: "BLOCKED_HOST"}`, задание не создаётся; HTTP-маршрута импорта нет), а нерезолвящийся хост ставит в очередь. `importStudioAttempt` проверяет адрес ещё раз прямо перед `probeUrl`. Там `BLOCKED_HOST` терминален: он есть в `terminalErrors` и падает с первой попытки. Сбой DNS — обычный `IMPORT_FAILED` с повторами. Дочерний процесс наследует `MEDIA_URL_ALLOW_PRIVATE` от worker.
- Удаление аккаунта (`deleteUser`, [roles.md](roles.md)) блокирует только активное задание: `queued`/`running` или с живой арендой. Это `JOB_IN_USE`, 409. Завершённые задания уходят вместе с аккаунтом, файлы `studio-jobs/<userId>` тоже, общие движки остаются.
- Тесты гоняются на той же `prisma/dev.db` (env в `vitest.config.ts`, `fileParallelism: false`) и делят тяжёлый слот. Общий `npm run studio:worker` перехватит задания интеграционных тестов — останавливайте его. Для одного задания: `npm run studio:worker -- --once --job JOB_ID`.
- Правка в `src/remotion`, `src/video`, `src/lib` или `package-lock.json` меняет `engineId`: первое задание пересобирает бандл (таймаут 120 с) в `storage/studio-engines/`.
- `src/server/studio` не должен импортировать клиентский `remotion` (`server-boundary.test.ts`).
- HTTP-мутации отвергают чужой `Origin` (сверка с `x-forwarded-host`/`Host`); прокси обязан подставлять публичный origin.
- MCP отдаёт не больше 12 MiB за медиарезультат; больший файл скачивается на сайте: `/api/studio/jobs/<id>/result?download=1`. `MCP_ACTOR_EMAIL` должен совпадать с веб-аккаунтом.

## Как проверить
- Домен: `npx vitest run src/video` (схема, компилятор, дуга, пресеты, бюджеты, градиент/тень)
- Рендерер/UI/сервис: `npx vitest run src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/app/studio src/server/studio`
- Интеграция: `npx vitest run src/integration/studio-` — реальная БД, рендер, yt-dlp в `studio-imports` (медленно). Общий worker на это время останавливайте.
- Обязательно после последних правок: `npm test` → `npm run build` → `npx tsc --noEmit`
- Живой сайт: `npm run dev` (сначала проверьте, что порт 3000 свободен) + `npm run studio:worker`. Путь: `/projects` → `/studio/new` → `/studio/<id>`: «Сохранить и проверить», «Показать превью», задания PNG/клип/аудио.
- MCP: `node scripts/verify-studio.mjs --actor you@example.com --project PROJECT_ID --kind clip --seconds 3 --output storage/studio-verification/<run>`. Нужны ровно один `--project`/`--document` и новый каталог. Код 0 — байты сверены; 1 — ошибка/отмена/таймаут; 2 — результат > 12 MiB, нужна аутентифицированная загрузка на сайте (это не подтверждение download).
- HTML-плеер: `/watch/<token>` и скачанный `.html` (открывать с выключенной сетью) прогоняйте в headless Chrome (`puppeteer-core`). Смотрите события `waiting` у `<audio>` во время просмотра, уход кадра от часов и кадры на паузе против MP4 того же номера (PSNR). Так сделана приёмка [задачи 25](../features/25-html-player-polish/verify.md).
- Приёмка: смотрите реальные кадры, декодированный звук и живой Player/сайт. Parity по типам, юнитам или метаданным не объявляйте.

## История
- [спека 20](../specs/20-ai-video-product.md) — продуктовые решения: внешний агент через MCP, автообновление по рейтингу, пресеты, очередь
- [спека 21](../specs/21-ai-video-technical-discussion.md) — развилки T01–T18: JSON + TS SDK, новый эффект добавляет разработчик
- [спека 22](../specs/22-ai-video-sdk-contract.md) — **актуальный контракт** SDK: функции, документ, план, патчи, пресеты
- [спека 23](../specs/23-ai-video-service-contract.md) — **актуальный контракт** сервиса: проекты, черновики, CAS, история, ассеты, пресеты
- [спека 24](../specs/24-ai-video-job-contract.md) — **актуальный контракт** очереди: задания, frozen snapshot, воркер, технические бюджеты
- [спека 25](../specs/25-ai-video-http-contract.md) — **актуальный контракт** сайта/HTTP: `/api/studio`, Origin, страницы
- [спека 26](../specs/26-sdk-visual-demos.md) — три демо, `CardStyle.gradient`/`shadow`, отказ от seek для JPEG
- Фаза 20: [план](../phases/phase-20-ai-video-sdk-plan.md), [решения](../phases/phase-20-implementation-decisions.md), [приёмка](../phases/phase-20-verification.md). Фаза 21: [план](../phases/phase-21-sdk-demos-plan.md), [приёмка](../phases/phase-21-verification.md) (978/978 на `07a01f8`)

## Задача 27

- [Техника сегментов](../features/27-segments/tech.md), [приёмка](../features/27-segments/verify.md).
- Тесты: `src/video/segments.test.ts`, `src/integration/studio-segments.integration.test.ts`, `src/app/studio/new/new-project.test.ts`.
- В v2 `card.style.playSound:false` выключает и отдельный participant audio; прежняя семантика v1 сохраняется. При apply общего пресета создаваемые sound slots изолированы по сегментам, разные tick не смешиваются.
- Четыре рецепта `video_examples`: rank-reveal, segment-intro, participant-summary, staircase.
- Пул защищает cover/poster через FK и human 409 TOURNAMENT_ASSET_IN_USE; binding track cover замораживает файл как image.
