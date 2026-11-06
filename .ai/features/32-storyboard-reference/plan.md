# План реализации: раскадровка и визуальная помощь агенту

> Исполнение автономно до merge по feature. Используются TDD и независимая
> финальная проверка; независимые доменные модули делегируются по
> superpowers:dispatching-parallel-agents, интеграцию ведёт основной агент.

**Цель:** полный продукт P01–P13.
**Архитектура:** чистый SDK для рецептов/заполнения/отбора/анализа;
сервер inspection origin и штатная очередь; общий Remotion renderer, HTTP/MCP/UI.
**Стек:** текущие TypeScript/Zod/Prisma/Remotion/Vitest/ffmpeg, без новых зависимостей.
**Спецификация:** [product.md](product.md), решения [tech.md](tech.md).

## Общие ограничения

- Только канонический VideoDocument, без произвольного JS/CSS.
- Чтение не меняет проект, source, draft или revision; CAS при записи обязателен.
- Права/ownership/квоты заново проверяются; финальный render только admin.
- Все страницы одного результата закреплены за origin и frozen media/fonts.
- ≤24 плитки страницы, default12; PNG ≤12MiB, previews ≤15s/720 long edge.
- Доки/UX по-русски; код/коммиты по-английски. Доказательства только storage/.
- Тройка строго npm test → npm run build → npx tsc --noEmit после последних правок.

## Фокус ревью

1. Invalid draft не подменяется last-good preview; inspect без reconcile/commit.
2. Generated scene/node IDs не используются как реальные patch targets.
3. Cache/retry/CAS/delete гонки не смешивают происхождение и чужие ресурсы.
4. Dense/vertical/long RU+JP/board events сохраняют читаемость и полноту охвата.
5. Missing/changed baseline, другой размер/цвет/кадр не становится passed.

### Задача 1: рецепты и предметное заполнение

Файлы: src/video/recipes.ts, content.ts, соответствующие *.test.ts;
src/server/studio/content.ts, recipes.ts и тесты. Не редактировать общие index,
presets.ts, MCP/HTTP: интеграция в задаче 5.

Интерфейсы: getVideoRecipes(), getVideoRecipe(id), getRecipePresets();
videoContentInputSchema и buildVideoContent(document,input)->VideoDocument;
setStudioContent(userId,projectId,input), selectStudioRecipes(userId,filters).

- [x] RED: все supported kind/format схемы и compile, смена содержимого сохраняет
  оформление, восьми board families передаются действия автора; ID/asset/answer
  ошибки, unsupported custom/tournament guards, CAS/idempotency.
- [x] GREEN: шесть направлений, metadata/contentForm/example, строгие формы,
  стабильное сопоставление, missingInputs, атомарная запись штатным сервисом.
- [x] Проверка: npx vitest run src/video/recipes.test.ts src/video/content.test.ts
  src/server/studio/content.test.ts . Ожидается PASS, включая отказ на wrong kind.
- [x] Коммит feat(studio): add curated recipes and semantic content authoring.

### Задача 2: смысловые кадры и проверяемые замечания

Файлы: src/video/storyboard.ts, video-review.ts и *.test.ts.
Интерфейсы selectStoryboard/matchStoryboard/reviewVideo описаны в T02;
diagnostics штатного compiler. Код browser-safe, без I/O/DB, прямые импорты.

- [x] RED: top/picker/board/custom, scene-local vs absolute, transitions,
  короткие/нулевые окна, paging/segment, stable compare/add/remove; layout issues
  и only-valid-authoring-target fixes, intentional overlaps, notChecked.
- [x] GREEN: смысловой deterministic selection и explainable review/suggestions.
- [x] Проверка: npx vitest run src/video/storyboard.test.ts src/video/video-review.test.ts .
- [x] Коммит feat(video): select storyboard moments and actionable review checks.

### Задача 3: воспроизводимые fixtures и pixel regression

Файлы: src/video/visual-fixtures.ts, visual-regression.ts и *.test.ts;
scripts/visual-regression.ts, baseline manifest под папкой задачи.
Consumes renderStudioFrames({directory,engineId,frozen,frames,scale?}) из задачи4.

- [x] RED: identical infinity, changed small ROI, mismatch dimensions/missing
  baseline, один failed frame красит suite; fixtures для всех54 и каталогов.
- [x] GREEN: локальные fixture media, manifest, render/check/explicit accept,
  actual/reference/diff и PNG/RGBA metrics, environment provenance.
- [x] Проверка: npx vitest run src/video/visual-regression.test.ts src/video/visual-fixtures.test.ts .
- [x] Коммит test(video): add reproducible visual regression fixtures and runner.

### Задача 4: durable inspection и общий renderer

Файлы: server/studio/storyboard.ts, review.ts, render-frames.ts, storyboard-render.ts;
jobs/job-types/worker/render, scripts/studio-render-child.ts;
remotion/StoryboardSheet.tsx и Root.tsx, service/integration tests.
Consumes задачи2; produces T03–T05 и renderStudioFrames для задачи3.

- [x] RED: current/invalid/stale/historical origin; no project writes,
  queued/cache/de-dupe/CAS/cancel/ownership/quota; review_apply recomputation,
  compare same moments, deep jobs не commit. Настоящий worker выдает grid PNG.
- [x] GREEN: frozen input в job directory, hash+lease fencing, shared renderer,
  frame resources, compact report, bounded fixes и matching comparison.
- [x] Проверка: targeted service/integration tests плюс real still/clip/audio.
- [x] Коммит feat(studio): render durable storyboards and apply verified review fixes.

### Задача 5: MCP, HTTP и пользовательские поверхности

Файлы: mcp/storyboard-tools.ts, studio-tools/instructions/server;
server/studio/http/index, video/presets/index; app/studio/storyboard/, recipes/,
StudioWorkspace.tsx/new, studio.css, MCP/HTTP tests.

- [x] RED: четыре tool names/strict schemas/compact output, image block,
  ready nextActions, recipe discovery/preview, authentication/Origin/CAS.
- [x] GREEN: короткий маршрут, формы примеров, галерея, storyboard page,
  проблемы/до-после/плеер, origin/page/coverage, скачивание; dirty buffer сохранён.
- [x] Проверка: настоящий stdio + HTTP + браузер под отдельным аккаунтом,
  шесть контрольных сценариев простым авторским маршрутом, все3 формата.
- [x] Коммит feat(studio): expose guided authoring and storyboard review in MCP and UI.

### Задача 6: эталоны, QG и независимое ревью

- [x] Сгенерировать/посмотреть baselines, повторно render/check, внести контрольную
  pixel/ROI регрессию и подтвердить fail; сравнить реальный MP4 и decoded audio.
- [x] Сохранить воспроизводимые scripts/SDK guide и verify.md с evidence.
- [x] npm test → npm run build → npx tsc --noEmit:122 files / 1420 tests,build/tscPASS.
- [x] Свежий ревьюер получает полный diff; FR01–03 исправлены,повторный scopedPASS.
- [ ] PR, stage review; автономная приёмка, stage merged/history и merge PR.

### Задача 7: знания

- [x] Обновить map/studio-sdk.md, mcp.md, render.md, dev-env.md и при необходимости
  AGENTS.md: контракты, новые tools/ресурсы, recipe/content route, budgets,
  baseline command и условия воспроизведения. Проверить ссылки.
- [x] Карты, README, SDK-гид и доказательства обновлены и сохранены в коммитах задачи.

## Самопроверка плана

P01–P13 покрыты задачами1–6; source/revision side effects отделены в inspection.
Задачи1/2/3 независимы и имеют раздельные файлы; общий каталог и адаптеры меняет
только основной агент. Подготовка renderer в задаче4 — единственная зависимость
runner из задачи3. Журнал исполнения — execution.md в этой папке.
