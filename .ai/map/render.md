# Рендер видео (общий конвейер)

Как Douga превращает план таймлайна в MP4: Remotion-композиции в headless Chrome плюс нарезка медиа через ffmpeg-static. Здесь общее для классики (топы, пикер) и студии. Студийный план, очередь и бюджеты описаны в [studio-sdk.md](studio-sdk.md), что рендерят топ и пикер — в [classic-video.md](classic-video.md).

## Где код
- [`src/remotion/index.ts`](../../src/remotion/index.ts) → [`Root.tsx`](../../src/remotion/Root.tsx) — три композиции: `Top`, `Picker`, `Studio`. `calculateMetadata` берёт `durationInFrames`/`fps`/`width`/`height` из `props.plan`
- [`src/remotion/types.ts`](../../src/remotion/types.ts) — `AssetMode`: `"url"` (Player в браузере, ссылки `/api/...`) или `"static"` (basename в `publicDir` рендера)
- [`src/server/render.ts`](../../src/server/render.ts) — топы (турнир и ручной): `resolveActiveSnippetsFor`, `buildPreviewPlan`, постановка задания, `runRender`, `describeRenderError`
- [`src/server/picker-render.ts`](../../src/server/picker-render.ts) — то же для пикера, плюс `ensureTickAsset` (тик таймера)
- [`src/lib/render-assemble.ts`](../../src/lib/render-assemble.ts) — чистая сборка позиций в `PlanItemInput`: длина и старт клипа, обрезка по длине источника, визуал
- [`src/lib/audio.ts`](../../src/lib/audio.ts) — обёртки ffmpeg-static: `clipAudio`, `clipVideo`, `writeSilence`, `writeTick`, `findActiveSnippet`, `probeDurationSec`
- [`src/lib/domain/rms.ts`](../../src/lib/domain/rms.ts) — активный сниппет: окно с максимальной RMS-энергией (префикс-суммы, O(n))
- [`src/lib/domain/render-jobs.ts`](../../src/lib/domain/render-jobs.ts) — DTO задания, `downloadUrl`, `isActiveRenderJob`
- [`src/server/render-jobs.ts`](../../src/server/render-jobs.ts) — `failStaleRenderJobs`: задания, оборванные перезапуском, переходят в failed
- [`src/app/components/FragmentPreview.tsx`](../../src/app/components/FragmentPreview.tsx) — «Старт отсюда» и «▶ Фрагмент»
- API: `POST /api/tournaments/[id]/render` и [`POST /api/projects/[id]/render`](../../src/app/api/projects/[id]/render/route.ts) (запуск; `GET` — список заданий), [`render-jobs/[id]`](../../src/app/api/render-jobs/[id]/route.ts) (статус, `DELETE`), [`render-jobs/[id]/download`](../../src/app/api/render-jobs/[id]/download/route.ts)
- Студия: [`src/server/studio/render.ts`](../../src/server/studio/render.ts) и [`engine.ts`](../../src/server/studio/engine.ts) — тот же Remotion, но своя очередь
- Конфиг: [`next.config.mjs`](../../next.config.mjs) выносит `@remotion/bundler`, `@remotion/renderer`, `ffmpeg-static` из серверного бандла Next

## Данные
- Модели Prisma ([schema](../../prisma/schema.prisma)): `RenderJob` (`tournamentId` ИЛИ `projectId`, `status` queued/running/done/failed, `progress`, `outputPath`, `outputBytes`, `error`), `RenderItem.resolvedStartSec` (кэш RMS). У студии свой `StudioJob`.
- Диск: `storage/renders/<jobId>.mp4`. Ассеты задания лежат в `storage/renders/tmp/<jobId>/public` (`renderTmpDir`), тик — в `storage/assets/tick.wav`. `runRender` и `runPickerRender` идут через `withRenderJob`: после любого рендера, удачного или нет, каталог `tmp/<jobId>` удаляется. Удаление best effort, MP4 остаётся.

## Как устроено
- Один план, два режима. API отдаёт превью-план (`assetMode: "url"`), Player в конструкторе рисует ту же композицию. Рендер пересобирает план поверх нарезанных файлов (`"static"`).
- Классика: `POST …/render` проверяет `render:run` (только админ), создаёт `RenderJob` и запускает `runRender`/`runPickerRender` fire-and-forget внутри процесса Next. UI опрашивает `/api/render-jobs/<id>`.
- Подготовка ассетов. Звук позиции режется `clipAudio` (AAC, фейды по 1 с) от `resolvedStartSec` или ручного старта; если звука нет — `writeSilence`. Видео — `clipVideo`: H.264 без звука, перекодирование ради точного seek. Картинки копируются как есть. Пикер дополнительно режет звук плиток, музыку раунда и треки плейлиста (у плейлиста фейд 0.05 с, кроссфейд делает композиция).
- Затем на каждый рендер: `bundle()` (`@remotion/bundler`, alias `@` → `src`), `selectComposition`, `renderMedia({codec: "h264"})` с `browserExecutable = REMOTION_BROWSER_EXECUTABLE` и `chromeMode: "chrome-for-testing"`. Выход — H.264 1920×1080@30 + AAC.
- Прогресс: 0.02 → подготовка ассетов до 0.5 (у пикера до 0.45) → `renderMedia` до 1. В конце `stat` пишет `outputBytes`; кабинет суммирует его, старые задания `src/server/users.ts` досчитывает лениво.
- Активный сниппет: `findActiveSnippet` декодирует моно PCM 8 кГц и ищет окно длиной `snippetLenSec`. Результат кэшируется в `resolvedStartSec` при загрузке конфига и сбрасывается при смене `clipMode`, длины или источника звука.
- «Старт отсюда» (`FragmentPreview`) играет исходный файл обычным `<audio>`/`<video>`, без Remotion. В топе ставит `clipMode: "manual"` и `clipStartSec`/`clipEndSec`, в пикере — `PickerTile.startSec`.
- Студия: тот же `Root`, композиция `Studio`, но бандл собирается один раз на `engineId` (хэш `src/remotion`, `src/video`, `src/lib`, `package-lock.json`) и рендерится в дочернем процессе воркера `npm run studio:worker`. `chromeMode` там не передаётся.

## Грабли
- Фейд-аут звука привязан к реальному концу потока: `clipAudio` делает `afade in → areverse → afade in → areverse`. Длительность VBR-mp3 по пробе завышена, и фейд, посчитанный по ней, уходит за EOF — звук обрывается.
- Чёрные кадры. `<Loop>` длится `floor(loopSec*fps) - 1` кадров (`TopVideo`, плитки и видеофон `PickerVideo`), а `clipVideo` режет с запасом +0.5 с, где источник позволяет. На `round` не менять: перекодированный файл короче пробы, и seek за EOF даёт чёрную вспышку на каждом стыке.
- В превью звук сырой, поэтому огибающую сегмента топа композиция считает только при `assetMode === "url"`. В рендере фейды уже в AAC — не задваивайте.
- Осмотр `Art.kind=image` через ffmpeg — без input seek (`-ss`), даже к нулю: крупный JPEG теряет единственный кадр ([`studio/inspection.ts`](../../src/server/studio/inspection.ts)).
- Браузер: без `REMOTION_BROWSER_EXECUTABLE` Remotion пытается скачать chrome-headless-shell, офлайн это падает. По заметке, системный Chrome ≥ 132 работает только в режиме `chrome-for-testing` ([README](../../README.md), раздел «Браузер для рендера»; [заметка](../research/remotion-headless-render.md)). Ошибку со словами browser/chrome `describeRenderError` дополняет подсказкой.
- Рендер классики живёт в процессе Next, и перезапуск сервера обрывает его. `failStaleRenderJobs` ([`src/server/render-jobs.ts`](../../src/server/render-jobs.ts)) помечает failed задания `queued`/`running`, которые не обновлялись 10 минут. Живой рендер обновляет строку сам. `withRenderJob` раз в минуту шлёт пульс `touchRenderJob`, даже если фаза не пишет прогресс: бандл, перекодирование длинного видео в `clipMode: full`. Финальные записи защищены. `completeRenderJob` переводит в done только задание в `running`, а у удалённого или упавшего за это время убирает осиротевший MP4. `failRenderJob` не бросает, даже если задания уже нет. Функцию вызывают все чтения и удаление: список конструктора, `GET /api/render-jobs/<id>`, список кабинета и `deleteRenderJob`. Правило то же, что у `DownloadJob`. Реестр в памяти не годится: после HMR живое задание выглядело бы мёртвым.
- `src/remotion` общий: правка `TopVideo`/`PickerVideo` меняет `engineId` студии, и первое студийное задание пересобирает бандл.
- Владение заданием проверяй только так: `OR: [{tournament: {userId}}, {project: {userId}}]` — задания турниров и проектов лежат в одной таблице.
- Скачивание читает MP4 целиком в память. Имя файла — название турнира или проекта: `filename*=UTF-8''<название>.mp4` по RFC 6266/5987, ASCII-фолбэк `douga-<ownerId>.mp4`. Запрещённые символы вычищаются, основа обрезается до 100 символов (`renderDownloadDisposition` в [`render-jobs.ts`](../../src/lib/domain/render-jobs.ts)).
- Каталоги `storage/renders/tmp/` от рендеров до задачи 23 остались на диске. Это данные владельца: код их не трогает.
- Финальный рендер только для админа, и в классике, и в студии. У роли user кнопка скрыта, `POST` отвечает 403.

## Как проверить
- Юниты: `npx vitest run src/lib/domain/rms.test.ts src/lib/domain/render-jobs.test.ts src/lib/render-assemble.test.ts src/lib/audio-probe.test.ts src/lib/domain/video-plan.test.ts src/lib/domain/picker-plan.test.ts`
- Интеграция (пишет в `prisma/dev.db`): `npx vitest run src/integration/render-jobs.integration.test.ts src/integration/render-files.integration.test.ts src/integration/video.integration.test.ts`. `render-files` подменяет Remotion моками и проверяет чистку tmp и имя файла. Настоящий headless-рендер `npm test` не запускает — нужен живой прогон.
- Живой рендер: `node scripts/e2e-setup.mjs` создаёт админа `e2e@test.local`. Под ним открой `/projects/<id>` или `/tournaments/<id>/render` и нажми «🎬 Рендерить видео»; файл — `storage/renders/<jobId>.mp4`. [`scripts/e2e-render.mjs`](../../scripts/e2e-render.mjs) проходит турнир через `question`/`{ranked, rest}`, затем делает `render(id)`: POST → опрос → скачивание. `BASE` по умолчанию `http://localhost:3000`.
- Кадры: `node_modules/ffmpeg-static/ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png` (системных ffmpeg/ffprobe может не быть). Бери середины фаз плана: стык интро → сегмент чёрный из-за фейда. Смотри глазами.
- Звук: `… -ss <t> -t <dur> -i out.mp4 -af volumedetect -f null -`. Середина сегмента должна быть громче хвоста на ≥ 8 дБ. Длительность MP4 сходится с `previewPlan.durationSec`. Рецепты — [verify](../../.claude/skills/verify/SKILL.md).

## История
- [спека 02](../specs/02-phase-render.md) — асинхронный рендер, RMS-сниппет, скачивание
- [спека 04](../specs/04-video-support.md) — видео-ассеты, пре-клип и луп
- [спека 07](../specs/07-polish.md) — фейды по хвосту потока, защита от чёрных кадров, `REMOTION_BROWSER_EXECUTABLE`, «Старт отсюда»
- [спека 17](../specs/17-media-library.md) — `RenderJob.outputBytes` вместо `stat` на каждый MP4
- [спека 24](../specs/24-ai-video-job-contract.md) — очередь и технические бюджеты студийного рендера
