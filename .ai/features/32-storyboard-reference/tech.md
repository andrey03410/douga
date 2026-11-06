# Технические решения

Полный продукт принят 2026-11-06, автономный режим до merge. Решения ниже
приняты агентом в пределах разрешения владельца.

## Исходная система

Прочитаны карты studio-sdk/mcp/render/dev-env, presets/builders/board-presets,
types, timeline, projects, typography, jobs/job-types/worker/revisions/snapshots,
engine/render, MCP adapters и HTTP. Встроены 54 пресета; canonical document v1/v2,
измерение текста и assets.evaluate доступны серверу. freezeStudioProject может
создать ревизию и reconcileSource, поэтому для inspect он не подходит.
StudioJob.kind — String, snapshotId nullable; worker имеет общий fenced lease.
Рендер копирует frozen файлы и шрифты в собственный bundle/public.

## T01. Канонические рецепты и заполнение

- Варианты: **расширить существующий каталог**; второй формат рецептов.
- Решение агента: отдельный browser-safe recipes.ts выдаёт VideoPreset и metadata
  шести направлений, совместимые kind/format, contentForm и реальные примеры.
  Каталог list/get/create/apply использует их через getBuiltinPreset/getBuiltinPresets.
  Старые 54 записи и их IDs/выходы не меняются. Новые ID recipe.<style>.<kind>.<format>.
- content.ts: строгая форма участников, раундов и действий известных досок;
  buildVideoContent(document,input) возвращает тот же VideoDocument. Обновление
  именованных частей сохраняет оформление и стабильные IDs; replace явный.
  Сервер content.ts использует существующий атомарный patch/save/CAS/receipt путь,
  проверяет ownership/asset kind через штатную evaluate, не меняет рейтинг турнира.

## T02. Отбор кадров и диагностика

- Варианты: **чистые функции над CompiledVideo**; renderer читает authoring JSON.
- Решение агента: src/video/storyboard.ts экспортирует selectStoryboard(plan,options)
  и matchStoryboard(before,after,options). Options: mode overview|scene, sceneId?,
  segmentId?, page (0-based default0), pageSize (1..24 default12).
  Selection: tiles с id/sceneId/segmentId/label/state/frame/localFrame/timeSec,
  totalScenes/scenesCovered/remainingScenes/totalTiles/page/pageSize/totalPages.
  Обзор по одному устойчивому кадру сцены; подробный — события/переходы/boardEvents,
  без frame вне [from,to). Сопоставление по ID+state, additions/removals явные.
- video-review.ts: reviewVideo(plan,diagnostics,document,profile) возвращает
  issues/checks/coverage/suggestions. Проверки layout overflow/missing,
  text-safe-area, duration/readable-window; неоднозначные случаи — warning,
  не безусловные ошибки. Исправления — детерминированные stable-ID patches
  для известных authoring targets; никаких попыток адресовать generated ID
  как настоящий node. Неподдержанное — nextAction text_inspect/clip.

## T03. Снимок без изменения проекта и долговечная очередь

- Варианты: **inspection input у StudioJob без snapshot FK**; изменить Prisma;
  использовать freezeStudioProject и его побочный commit.
- Решение агента: новая серверная storyboard.ts читает owned row/view напрямую,
  выбирает текущий draft либо заданную revision, evaluate копирует медиа/шрифты
  в studio-jobs/<user>/<job>/inputs. Проверяются version до/после подготовки,
  schema/resources; диагностике разрешён только TEXT_OVERFLOW.
- inputJson inspection job содержит frozen content с hash и origin
  (projectId/version/revision|null/documentHash/format). Существующий job FK
  защищает проект, копии inputs принадлежат job и удаляются вместе с ним.
  Worker проверяет canonical hash и использует тот же lease/heartbeat/cancel.
- kind storyboard добавляется к job views/results, не в публичный startStudioJob
  schema. Для deep preview очередь clip/audio получает тот же inspection wrapper,
  не делает commit. Старые snapshot jobs продолжают прежний путь.
- Кэш по user/project/document+resolved hashes+engineId+options, scoped idempotency
  учитывает запрос и версию. Старый результат явно содержит старый origin.
  Страница ≤24 frames, общий PNG ≤12 MiB, срок/квоты текущих preview jobs.
  MCP bounded wait до 2 секунд, затем job_get/inspect action. Worker не запускается
  скрытно внутри сервиса; очередь без worker описывается честно.

## T04. Общая подготовка renderer

- Решение агента: выделить prepareStudioRender и renderStudioFrames в
  src/server/studio/render-frames.ts. Сигнатура renderStudioFrames({directory,
  engineId,frozen,frames,scale?}) -> Promise<{frame:number,path:string}[]>;
  path абсолютный. Это trusted internal API для worker и regression runner.
- renderStill использует shared openBrowser, PNG и выбранные абсолютные frames.
  StoryboardSheet — отдельная закрытая Remotion Composition: плитки с готовыми
  изображениями и подписями, без повторного вычисления исходного видео.
  Preview longEdge720, сетка с адаптивными пропорциями; regression scale1.
- Сравнение рендерит пары из одного job; несопоставимые сцены явно подписаны.
  Исходные standalone frames сохраняются рядом с grid, HTTP выдаёт их через
  проверенный manifest, не через пользовательский path.
- Сверено с документацией Remotion: renderStill scale/imageFormat/puppeteerInstance,
  openBrowser и browserExecutable. Ссылки: https://www.remotion.dev/docs/renderer/render-still
  и https://www.remotion.dev/docs/renderer/open-browser . Локальные d.ts — источник
  совместимости с установленной версией. Новых npm-зависимостей не требуется.

## T05. Проверки и исправления

- review.ts читает тот же evaluate origin; reportId включает document hash/version.
  apply принимает reportId и suggestionIds, expectedVersion; перед записью заново
  вычисляет предложения и проверяет fingerprint. Патчи атомарны, сохраняется before
  через mutation receipt/inspection result; commit и публикация не вызываются.
- Сравнение с ревизией и с собственным ранее полученным storyboard job работает
  по stable scene/state. Для последнего сохраняется frozen plan в inspection job.
- Deep запускает ограниченные representative clip/audio окна и возвращает готовые
  ссылки/команды. Завершённые результаты повторно проверяются на origin и декодируются;
  сведения о выполнении не называют плавность и красоту доказанными автоматически.
- Все counts/nextActions bounded, текст только по текущей странице. Не найденный,
  malformed, stale, unrenderable и partial имеют различные статусы.

## T06. UI и MCP

- Четыре новых tools: video_content_set, video_storyboard, video_review,
  video_review_apply. Каталоги расширяются metadata/recommended/preview/form.
  Инструкция сервера ≤3KiB, весь маршрут и три коротких рабочих примера.
- POST projects/:id/{content,storyboard,review,review-apply}; job artifact/frame
  GET через тот же session actor/ownership/hash; gallery recipe preview endpoint.
- Studio получает отдельный раздел/страницу storyboard, review, comparison,
  пагинацию, stale/version, переход в player; recipes gallery с примеркой.
  Главный workspace интегрируется ссылкой; dirty buffer не перезаписывается.

## T07. Эталоны

- Browser-safe fixtures покрывают все 54 прежних пресета, рецепты и каталоги
  motion/typography, непустые RU/JP, границы и фазы. Generated SVG/tones локальны.
- src/video/visual-regression.ts вычисляет PSNR/changedPixelRatio/maxDelta/ROI
  над одинаковыми RGBA buffers, размер/отсутствие baseline не pass.
- scripts/visual-regression.ts render|check|accept с manifest environment/fixture hash.
  accept требует явный флаг и reason, отчёт reference/actual/diff.
  Baselines .ai/features/32-storyboard-reference/baselines/ версионируются;
  actual/reports storage/verification/32-storyboard/. Сначала измерить repeatability,
  точный RGBA default, точечные допуски только с записанным основанием.
- Проверяется весь fixture manifest, fail любого mandatory frame красит набор;
  renderer code hash фиксируется как provenance и не отключает compare.

## Затронутые зоны

studio-sdk, mcp, render, dev-env; их карточки обновляются перед QG.
Prisma schema не меняется. Любая необходимая корректировка этих решений
фиксируется в execution.md; полный продукт не сокращается молча.
