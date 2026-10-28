# AI Video SDK (студия)

Сейчас это основная точка входа Douga. Видео (топ или пикер) описывается каноническим версионированным JSON `VideoDocument`. Его правят на сайте и через MCP, проверяют, ведут историю и рендерят через устойчивую очередь. Прежние конструкторы (`VideoProject`) живут отдельно и сюда не мигрируют.

## Где код
- [`src/video/`](../../src/video/) — домен SDK без I/O. Публичный вход — [`index.ts`](../../src/video/index.ts) (types, schema, builders, compiler, layout, presets, patches, assets); сервер напрямую берёт ещё `resource-limits.ts` и `settings.ts`
  - [`schema.ts`](../../src/video/schema.ts) / [`types.ts`](../../src/video/types.ts) — строгие Zod-схемы (`schemaVersion: 1`, неизвестные поля отвергаются), JSON Schema через `getVideoDocumentJsonSchema()`
  - [`builders.ts`](../../src/video/builders.ts) — `createVideoDocument`, `scene`/`textNode`/`containerNode`/`time`/`frame`: строят тот же JSON
  - [`compiler.ts`](../../src/video/compiler.ts) + `blocks.ts`/`nodes.ts`/`audio.ts` — `compileVideo(doc, manifest)` → `{plan, diagnostics, ready}`; план — чистый JSON без замыканий
  - [`layout.ts`](../../src/video/layout.ts) — размеры форматов (`OUTPUT_DIMENSIONS`) и раскладки `grid`/`arc`/`free`
  - [`presets.ts`](../../src/video/presets.ts) — 30 встроенных пресетов `top|picker.<family>.<wide|vertical|square>`, `extractVideoPreset`/`applyVideoPreset`
  - [`patches.ts`](../../src/video/patches.ts) — `patchVideoDocument`: атомарные `set`/`unset` по стабильным ID (document/participant/round/card/group/scene/node)
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
  - страница просмотра [`/watch/<token>`](../../src/app/watch/[token]/page.tsx) и плеер [`src/watch/WatchPlayer.tsx`](../../src/watch/WatchPlayer.tsx); шапку на `/watch` убирает [`src/middleware.ts`](../../src/middleware.ts)
- API: [`src/app/api/studio/`](../../src/app/api/studio/) — catch-all `[[...path]]/route.ts` → `studioHttp`
- MCP: [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `video_*`-инструменты поверх тех же сервисов, подробности в [mcp.md](mcp.md)
- [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs) — повторяемая проверка через настоящий stdio MCP

## Данные
- Модели Prisma: `StudioProject`, `StudioRevision`, `StudioAssetReference`, `StudioSnapshot`, `StudioPublication`, `StudioExportCache`, `StudioPreset`, `StudioMutation`, `StudioAnalysis`, `StudioJob`, `StudioWorkerLease` ([schema](../../prisma/schema.prisma)); с `VideoProject` не связаны
- Привязки медиа в документе (`bindings`): `pool` (Art пула), `track` (трек турнира), `builtin`; `StudioAssetReference` держит Art/Track/Tournament по scope `head`/`draft`/`revision:N`
- Диск (`storage/`): `studio/<userId>/<projectId>/versions/<uuid>` — подготовленные ассеты ревизии; `studio-jobs/<userId>/<jobId>` — результаты; `studio-engines/<sha256>` — бандлы Remotion; `studio-exports/<userId>/<projectId>/<revisionId>` — нарезанные фрагменты для `.html`

## Как устроено
- Форматы `wide`/`vertical`/`square` = 1920×1080 / 1080×1920 / 1080×1080. Встроенные пресеты — 30 FPS (схема допускает 24/25/30/50/60). Лимиты старых конструкторов (9 карточек/50 раундов) сюда не переносятся, действуют только технические бюджеты.
- Документ: `source` (`manual`|`tournament`, participants, rounds с cards/groups/answer), `bindings`, `settings` + `formatSettings`, `scenes` (`block: custom|top|picker`, `repeat: participants|rounds`, узлы container/text/shape/image/video/card/timer/audio с анимациями) и `audio` (плейлист, cues с ролями primary/music/sfx/voice). Произвольный JS/TSX документ не исполняет: новый эффект = расширение схемы + компилятора + `StudioVideo`.
- `StudioProject.version` — CAS-токен (`expectedVersion`), растёт при любой записи: черновик, синхронизация источника, commit. `revision` — номер сохранённой ревизии, растёт только при commit/restore/смене источника. Это разные числа.
- Черновик хранится текстом (`draftText`) даже при невалидном JSON. `previewJson` обновляется только готовым планом; происхождение превью — `previewRevision` (`null` = из черновика) и `previewVersion`; `previewStale` = превью не от текущей версии.
- Restore создаёт новую ревизию со старым содержимым. Идемпотентность — `idempotencyKey` в `StudioMutation`: ключ общий на аккаунт, тот же ключ с другим запросом → `IDEMPOTENCY_CONFLICT`.
- Каждое чтение проекта вызывает `reconcileSource`. Участники = top-N рейтинга, ID участника = `trackId`; `caption`, оформление и медиа сохраняются по этому ID. При смене отпечатка рейтинга head получает ревизию с reason `source`.
- Задание: `startStudioJob` → `freezeStudioProject` (снимок: resolved document, manifest, файлы с SHA-256, план) + `engineId` → `StudioJob` в статусе `queued`. Воркер берёт единственный тяжёлый слот `StudioWorkerLease` (lease 30 с, heartbeat 5 с, ≤ 3 попытки) и форкает `studio-render-child.ts`. Виды: `still`/`clip`/`audio` (≤ 15 с, длинная сторона 720) и `render` (весь таймлайн).
- Пресеты (30 встроенных + личные `StudioPreset`) содержат только оформление и абстрактные слоты; схема отвергает участников и реальные медиа-привязки. Применение переносит медиа только по совместимой структуре, иначе `PRESET_INCOMPATIBLE`.

## Грабли
- `expectedVersion` ≠ `revision`. Устаревшая версия → `VERSION_CONFLICT` (HTTP 409); `revision` в задании выбирает сохранённый документ. Даже чтение может поднять `version` (синхронизация источника), поэтому перед записью перечитывайте.
- Ошибочный JSON сохраняется черновиком и молча к head не откатывается. Commit/freeze/финальное задание по невалидному черновику → `VALIDATION_FAILED`. Последнее корректное превью показывается с пометкой происхождения — не выдавайте его за текущее.
- Редактор (`acceptRemote` в `editor-state.ts`) при параллельной правке не трогает грязный буфер: держит локальный текст и его `baseVersion`, ставит `conflict`. Буфер заменяет только явная «Загрузить серверную версию».
- Задание фиксирует frozen inputs (снимок + `engineId`). Правка или новый рейтинг меняют проект, но не старые задания; новый MP4 — только новым заданием, автоматического перерендера нет. Снимок защищён FK `Restrict`, пока на него ссылаются задания.
- `CardStyle.gradient`/`shadow` структурные: отсутствие поля наследует, явный `null` сбрасывает наследованный эффект. Не подменяйте их произвольным CSS/URL (цвет проходит regex, URL запрещены).
- Осмотр `Art.kind=image` (`inspection.ts`) не делает input seek даже к нулю: крупный JPEG теряет единственный кадр, и ffmpeg отдаёт 0 байт.
- Финальный `render` требует `render:run` (admin). Это проверяется при постановке и повторно в воркере. Превью доступны с `media:upload`. Лимиты ([`job-types.ts`](../../src/server/studio/job-types.ts) `studioJobLimits`): не больше 4 активных заданий на аккаунт; не-админу — не больше 512 МиБ результатов суммарно (`JOB_QUOTA_EXCEEDED`).
- HTML-плеер — второй выход той же сохранённой ревизии, не замена MP4. Публикация (`POST /api/studio/projects/<id>/publication`) зовёт `freezeStudioProject` с явным номером ревизии и не коммитит черновик. На проект одна `StudioPublication`: обновление меняет снимок и оставляет токен, снятие удаляет строку. Снимок, на который ссылается публикация, не удаляют `releaseUnclaimedSnapshot`, `deleteStudioJob` и `deleteStudioSnapshot` (`PUBLICATION_IN_USE`). Удаление проекта и аккаунта сначала снимает публикации.
- Гость открывает `/watch/<token>` без сессии. Клиенту уходят название и план, в котором `src` переписан на `/api/watch/<token>/media/<sha256><ext>`. Файл отдаёт `streamStudioFile` (Range, без чтения целиком). Чужой hash и снятый токен — 404, страница говорит «Ролик снят с публикации».
- «Скачать .html» работает и без ссылки: `GET .../export.html?estimate=1` нарезает окна плана (звук AAC, видео H.264, запас 0,5 с) и возвращает точный размер, сам `GET` стримит один файл. Кэш нарезки для роли без `render:run` не больше 512 МиБ (`EXPORT_QUOTA_EXCEEDED`): проверка и вставка строк идут в одной транзакции с записью в `User`, поэтому два одновременных экспорта не проскакивают порог. Файл на диске не хранится. Если транзакция публикации откатилась, квитанция `publish-freeze:` снимается вместе с невостребованным снимком, и тот же ключ идемпотентности можно повторить.
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
- Обязательно после последних правок: `npm test`, `npx tsc --noEmit`, `npm run build`
- Живой сайт: `npm run dev` (сначала проверьте, что порт 3000 свободен) + `npm run studio:worker`. Путь: `/projects` → `/studio/new` → `/studio/<id>`: «Сохранить и проверить», «Показать превью», задания PNG/клип/аудио.
- MCP: `node scripts/verify-studio.mjs --actor you@example.com --project PROJECT_ID --kind clip --seconds 3 --output storage/studio-verification/<run>`. Нужны ровно один `--project`/`--document` и новый каталог. Код 0 — байты сверены; 1 — ошибка/отмена/таймаут; 2 — результат > 12 MiB, нужна аутентифицированная загрузка на сайте (это не подтверждение download).
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
