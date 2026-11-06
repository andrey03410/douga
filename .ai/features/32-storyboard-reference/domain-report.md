# Задача 2: отбор смысловых кадров и статическая проверка

Реализовано 2026-11-06. Домен browser-safe, без I/O, БД и зависимости от renderer.
Общие index/server/MCP не менялись.

## API

- `selectStoryboard(plan: CompiledVideo, options?: StoryboardOptions): StoryboardSelection`.
  `options`: `mode: overview|scene` (default overview), `sceneId?`, `segmentId?`,
  `page` (0-based, default 0), `pageSize` (1..24, default 12).
  `tiles`: `id/sceneId/segmentId?/label/state/frame/localFrame/timeSec/analysis`.
  `analysis`: `method: semantic|heuristic`, `limitations: string[]`.
  Остальные поля: `totalScenes/scenesCovered/remainingScenes/totalTiles/page/pageSize/totalPages`.
  Число сцен учитывает фильтры, охват относится именно к текущей странице.
- `matchStoryboard(before, after, options?): StoryboardMatch`.
  `pairs: {id,before:StoryboardTile|null,after:StoryboardTile|null}[]`,
  `totalPairs/totalScenes/scenesCovered/remainingScenes/page/pageSize/totalPages`.
  Join выполняется до пагинации по `[segmentId|null,sceneId,state]`;
  длительность может измениться, frames каждой стороны фактические.
- `reviewVideo(plan, diagnostics, document, profile?): VideoReviewReport`.
  `profile`: `safeArea?: Rect` в пикселях, `minReadableSec?`, `charactersPerSecond?`.
  Возвращает `issues/checks/coverage/suggestions`.
  Экспортированы `VideoReviewProfile/Severity/Issue/Check/Suggestion/Report`,
  `VideoPatchOperation` (alias штатного `PatchOperation`), все типы storyboard.

## Отбор

Обзор выбирает один кадр каждой сцены: top с видимой подписью после входа,
пикер со всеми вариантами до answer, board после движения, answer отдельно.
Алгоритм рассматривает интервалы видимости, подписи, phasings, motion/keyframes
и переходы. Подробный режим отдаёт события, движения, before/during/after перехода.
Все кадры ограничены собственным `[scene.from, scene.from+duration)`;
нулевая сцена не выдаёт незаконную плитку и остаётся в `remainingScenes`.
Для custom явно указана эвристика `custom-semantics-not-inferred`;
нет устойчивого окна — `no-stable-window`.
Legacy fade/slide используют половину сцены как предел перехода, adjacent entrance
использует полную длительность; loop занимает всё motion.window, а не один период.

## Проверка и исправления

Фактические ошибки: штатная диагностика, измеренный overflow и missing glyphs.
Явный clip/ellipsis остаётся warning. Повторы диагностик объединяются по
коду/сцене/узлу, доказательства layout сохраняются. Safe area проверяется только
при заданном профиле и остаётся warning статической геометрии. Окно чтения —
самое длинное непрерывное видимое окно подписи без переходов/движения,
по умолчанию `max(0.8 sec, characters/16)`; скрытые подписи не считаются ошибкой.
Само пересечение прямоугольников не порождает ошибки.

Issue имеет стабильные `id/code`, severity `error|warning|info`,
`sceneId?/segmentId?/nodeId?/frame?`, `message/evidence`, `suggestionIds?` и
объяснимый `nextAction` (`text_inspect|clip`). Check имеет `id=code`, status
`passed|warning|error|notChecked|notApplicable`, статический mode и охват.
`coverage.complete=false`: motion/audio/pixel contrast всегда `notChecked`;
числа frames описывают точки статического плана, не просмотр отрендеренных PNG.

Предложения: компактная подпись в сохранённом readable minimum, тёмная плашка
для белого subtitle/caption над реальным visual underlay, возврат локальной
label к выбранной теме. Поля: `id/kind/title/risk:low/issueIds/operations`,
`affectedScenes/overrides/requiresRecheck:true`. Реальная canonical patch
валидируется; предложение не объявляет проблему уже решённой.

Authoring node сопоставляется только по точному compiler suffix в своей сцене,
единственному экземпляру в плане и без repeating container ancestor. Для
штатного top card допустим participant ID, если это единственная карточка
участника во всём плане. Generated picker/board и неоднозначные повторы не
получают фиктивного patch target; остаётся осмотр с объяснением. Font face,
CJK для compact Oswald, rich runs, fit groups, parent typography и null-скоупы
проверяются консервативно. Рейтинг/ответы/медиа/текст не меняются.

## TDD и проверки

1. Storyboard RED: после минимальных пустых exports 13 тестов упали по отсутствующему
   отбору/coverage/join. После реализации 13 GREEN.
2. Review RED: 12 из 14 тестов упали по отсутствующим issues/fixes/checks/profile guards.
   После реализации 27 тестов двух файлов GREEN.
3. Отдельные RED-регрессии подтвердили ошибки half-duration adjacent transition,
   одного периода loop вместо полного окна, missing glyph evidence и связи issue→fix.
   Каждая исправлена до следующего шага.
4. Итог после последних правок:
   `npx vitest run src/video/storyboard.test.ts src/video/video-review.test.ts`
   — **2 файла, 35 тестов PASS** (19 + 16).
5. Targeted strict typecheck по этим четырём файлам через `npx tsc --noEmit --strict
   --skipLibCheck --target ES2022 --module esnext --moduleResolution bundler
   --esModuleInterop ...` — **PASS**.

Покрыты три формата, top/picker/answer/custom, все восемь board families,
v1/v2, disabled segments, local/absolute frames, короткие/нулевые окна,
переходы/loop/board events, длинная пагинация и фильтры, inserted/missing compare,
реальный measured layout, missing glyphs, проверяемое устранение overflow patch,
плашка/возврат темы, intentional overlaps, repeated/generated ID guards.

Общий npm test/build/tsc и живая поверхность — ответственность основной интеграции;
в этом независимом задании они намеренно не запускались по инструкции оркестратора.
