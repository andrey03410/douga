# Task 1 — SDK, каталог и компилятор

Статус: реализация завершена, целевые проверки GREEN; итоговый QG и renderer остаются у контроллера задачи.

Коммит: `415ac78` — `feat(video): add declarative motion kit and choreography compiler`.

## Изменения

Новые файлы:

- `src/video/motion-types.ts` — закрытые имена, авторские настройки, нормализованный IR и типы виджетов/фонов.
- `src/video/motion-schema.ts` — строгие browser-safe Zod-схемы без произвольных CSS/JS.
- `src/video/motion-catalog.ts` — каталог version 1: 40 эффектов, 10 хореографий, 8 новых переходов, 5 фонов, 4 виджета, metadata/examples.
- `src/video/motion-compiler.ts` — post-pass наследования, рецептов, событий, каскадов, бюджетов текста и разрешённых фоновых медиа.
- `src/video/motion.test.ts` — 49 целевых regression-тестов.

Изменены `src/video/{types,schema,compiler,nodes,settings,index,assets,blocks,presets}.ts` и `src/video/invariants.test.ts` (expected public node union расширен с 8 до 11 типов).
`src/remotion`, `src/mcp`, UI, watch/server не менялись. В коммит входят только эти SDK src-файлы; чужие `.ai` изменения не добавлены.

## TDD и проверка

Наблюдаемые RED-прогоны до соответствующей реализации:

1. Базовый контракт: **18 failed / 1 passed**, отсутствующие schema/каталог/IR/widgets/backdrop (`/tmp/douga-motion-red.txt`).
2. Semantic integration: **5 failed / 30 passed** — наследование custom timer, participant motion, board recipes, backdrop presets, общий progress v2 (`/tmp/douga-motion-red-integration.txt`).
3. Края: **4 failed / 36 passed** — общий текстовый бюджет, auto badge, crossfade фоновых слоёв, metadata совместимости (`/tmp/douga-motion-red-edges.txt`).
4. Контейнеры и локальные рецепты: **3 failed / 40 passed** (`/tmp/douga-motion-red-container.txt`).
5. Reveal/hold окна: **2 failed / 43 passed** (`/tmp/douga-motion-red-windows.txt`).
6. Explicit badge text: **1 failed / 45 passed** (`/tmp/douga-motion-red-explicit-badge.txt`).
7. Event вне reveal окна: **1 failed / 46 passed** (`/tmp/douga-motion-red-event-window.txt`).
8. Badge preset content: **1 failed / 47 passed** (`/tmp/douga-motion-red-preset-badge.txt`).
9. Preset event identities: **1 failed / 48 passed** (`/tmp/douga-motion-red-preset-anchors.txt`).

Последний полный целевой GREEN:

```sh
npx vitest run src/video/motion.test.ts src/video/sdk.test.ts src/video/segments.test.ts src/video/board-compiler.test.ts src/video/resource-limits.test.ts src/video/invariants.test.ts
```

**6 файлов / 160 тестов прошли**: motion 49, sdk 21, segments 34, board-compiler 7, resource-limits 7, invariants 42. Лог `/tmp/douga-motion-targeted-final.txt`.

`npx tsc --noEmit` — exit 0 после последних функциональных изменений, лог `/tmp/douga-motion-tsc-final.txt`.
`git diff --check` — без ошибок.

Промежуточный общий `npm test`, лог `/tmp/douga-motion-full-tests.txt`, **не зелёный**: найдено 4 failures. Три motion regression-теста (`diagnoses an entrance event that occurs after the semantic reveal window`, `extracts reusable badge text without content and reapplies the destination label`, `removes authored event identities from reusable presets and rejects unsanitized ones`) увидели ранний production snapshot Vite, поскольку в течение долгих integration-тестов код продолжал меняться. Отдельный fresh прогон всех трёх с финальным кодом GREEN. Четвёртый failure — старый expected union из 8 node types в `discovery and service integration > exports a recursive strict JSON schema for external agent authoring`; expected актуализирован до 11 типов, fresh invariant suite GREEN (42 теста). После этих результатов общий долгий процесс остановлен, повторный полный прогон отложен по указанию root до интеграции renderer/MCP. Пройденные тяжёлые integration-файлы включают studio-projects(33), studio-mcp(11), studio-jobs(12), shikimori(24), studio-segments(15), studio-imports(14), studio-http(12), roles(21), studio-export(3), group-ranking(27).

Полный итоговый QG `npm test → npm run build → npx tsc --noEmit` и живая поверхность поручены контроллеру после интеграции; не утверждаю, что они уже пройдены. Правило на следующие прогоны: production/tests не менять, пока процесс не закончится.

## Точный контракт для Task 2

Публичные exports из `src/video/index.ts`: все `motion-types`, все `motion-schema`, `motionCatalog`, `getMotionCatalogEntry`, `motionChannels`, `applySceneMotion`.

### Авторские данные

`Settings.motion` и `NodeBase.motion` используют `MotionSettings`:

```ts
{
  duration?: Time;
  profile?: "smooth" | "snappy" | "bouncy" | "cinematic";
  intensity?: "subtle" | "normal" | "bold";
  enter?: MotionSpec | null;
  exit?: MotionSpec | null;
  loop?: MotionSpec | null;
  emphasis?: MotionSpec | null;
  stagger?: { interval: Time; order?: "forward" | "reverse" | "center" | "rows" } | null;
  choreography?: ChoreographyName | null;
}
```

`MotionSpec` — имя (включая alias `flip`) либо `{name,duration?,delay?,intensity?,direction?,at?}`.
`direction` — `up|down|left|right|in|out`.
`at` — `Time` относительно **node.from** либо `{event,offset?,cardId?,actionId?,slotId?}` относительно scene-local события. Offset использует неотрицательный `Time`.
События: `scene.start`, `card.reveal`, `timer.start`, `answer.reveal`, все существующие `board.*`. Селекторы уточняют board event; неизвестный/отсутствующий event даёт diagnostic, несовместимое семантическое окно тоже.

Канал проверяется по каталогу: первые 16 и text-* — enter/exit; float…orbit — loop; pulse…wiggle — emphasis. Текстовые эффекты разрешены на text/badge, counter — только числовой текст. Каталог содержит `blocks`, `nodes`, `channels`, `parameters`, `description`, `example`. `getMotionCatalogEntry(name, category?)` поддерживает alias и disambiguation (`flash` есть effect и transition).

Иерархия: document → format → scene → round/participant → group/card → authored node. Локальное отсутствие наследует, `null` выключает канал/рецепт; authored node приоритетнее рецепта. Глобальные настройки применяются к листовым узлам; explicit `container.motion` анимирует контейнер, не передаёт этот transform детям. Это предотвращает двойной глобальный entrance в дереве.

### Motion IR

```ts
CompiledNode.motion?: {
  name: MotionName;             // flip уже нормализован в flip-y
  channel: "enter"|"exit"|"loop"|"emphasis";
  from: number;                // scene-local integer frame
  durationInFrames: number;    // >= 1, integer
  profile: MotionProfile;
  intensity: number;           // subtle=.5, normal=1, bold=1.5
  direction: MotionDirection;
  window: {from:number;to:number};  // half-open semantic visibility window
  fragments?: number;          // text renderer expansion hint
}[];
```

Рендерер **не** разрешает события и **не** выбирает рецепт. Вне окна клип не должен скрывать чужое видимое окно узла. До enter внутри его окна — начальная поза, после завершения — конечная; exit обращает эту семантику. Для duration=1 нужен завершённый результат на единственном кадре. Loop использует duration как период, остаётся ограничен window.

Движение — отдельный слой поверх ручных animation: x/y/rotate складываются, opacity/scale умножаются; blur/mask/glow отдельны. `animation`, rect, visible, activeWindow, phases, audio, число кадров и исходы доски post-pass не переписывает. Вход generated card ограничен его active/reveal окном. Каскады сжимаются внутри существующих окон. Совместные enter/exit оставляют хотя бы один hold frame, когда окно содержит >=3 кадров.

### Фон

`Settings.backdrop?: BackdropSettings|null`; null выключает наследование.
Поля: `{preset,source?,asset?,colors?,blur?,dim?,motion?,intensity?,particles?}`. Preset — `art-blur|gradient-flow|light-orbs|particles|vignette`. Source — `current-card|round|asset`.

Явный asset допустим только с `source:"asset"` или без source (тогда нормализуется asset). `source:"asset"` требует asset. Missing explicit asset — error стандартного resolver; optional unavailable current art — нейтральная подложка.

```ts
CompiledScene.backdrop?: {
  preset; source; colors:string[]; blur:number; dim:number;
  motion:boolean; intensity:number; particles:number;
  layers: {from:number;to:number;fadeInFrames:number;media:CompiledMedia}[];
};
```

Все окна scene-local half-open. Слои упорядочены, следующий рисуется поверх предыдущего с fade-in `(frame-from)/fadeInFrames`. Предыдущий слой удерживается до завершения fade-in нового (его `to` продлён), поэтому стык плавный. Пустой layers означает нейтральный/процедурный фон. Новая source не появляется раньше её `from`. В decision current-card использует round/template background либо нейтральный фон; winner берётся только начиная с answerStartFrame, включая frame0 отдельной answer-сцены. В top — текущий участник. Видео слоя проигрывается относительно layer.from с его стандартным CompiledMedia offset/loop/freeze.

**Traversal для контроллера:** resolved background asset хранится непосредственно в `scene.backdrop.layers[].media.asset`, не в `scene.nodes`. Нужно обновить snapshot/watch/offline/retarget/download/upcoming/render path rewriting и poster/slice/hash traversal так же, как для обычного CompiledMedia. `collectVideoAssetKeys` уже собирает backdrop.asset на всех авторских settings-уровнях. Этот cross-cutting участок намеренно оставлен root по разделению файлов.

### Виджеты и переходы

- `type:"timer"`: прежний `timerFrames` сохранён. Optional `node.timer` — `Required<TimerSettings>`: `{variant,color,trackColor,strokeWidth,showValue,warningSec}`. Без новых настроек это поле не записывается, старый таймер digits.
- `type:"versus"`: `node.versus={variant,color}`, variant `clean|neon|slash|impact`.
- `type:"badge"`: `node.badge={kind,color?}`, содержимое в `node.text`; kind `rank|round|winner|label`. Без explicit text rank/round вычисляются из контекста, winner ждёт answer. Неразрешимый auto-binding диагностируется. Explicit text разрешает свободную плашку любого kind и не требует auto event.
- `type:"progress"`: `node.progress={scope,color,trackColor,strokeWidth,from,durationInFrames}`. from **scene-local**. Scene scope from=0/duration=scene.duration. Video scope **from=-scene.from, duration=итоговая общая video duration**, включая все offsets v2. Рендерить `(sceneFrame-progress.from)/progress.durationInFrames`, clamp [0,1].
- transition содержит старые `{type,durationInFrames}` и optional direction/color. Новые types: wipe/zoom/push/flash/iris/split/blur/crossfade. Продолжительность ограничена входящей сценой. Отдельных новых audio окон нет. Удержание outgoing last frame реализует Task2; none/fade/slide требуют прежней семантики.

### Бюджеты, пресеты и совместимость

Частицы ≤32; текстовые fragments ≤500 **на всю сцену**, один IR text не разворачивается в сотни узлов. Бюджет считает максимум фрагментов на узел при нескольких каналах, не дублирует enter+exit. Количество каналов закрыто (4), окон — исходная bounded компиляция; существующие authored/expanded/time budgets действуют. Каскадные ranks вычисляются один раз с ограниченной сортировкой, подсчёт fragments — инкрементально.

Preset extraction превращает backdrop.asset в generic slot, применение сохраняет destination assignment, v2 namespaces slots. Реальные backdrop media keys запрещены в media-free preset schema. Badge content sanitization/transfer работает аналогично обычному text. Event card/action/slot selectors удаляются при extraction и запрещены в reusable preset, чтобы не сохранять идентичности чужого проекта.

Без новых полей optional motion/backdrop/widget IR-поля не добавляются. Старые sdk/segments/board/resource тесты прошли. Все 5 fps × 3 формата покрыты конечными нормализованными значениями.

## Fix round 1/5 — findings R1–R6

База `415ac78`. Прочитан свежий `task-1-review.md`, проверены R1–R5 и уточнение P02/T03. Дополнительно root подтвердил R6: порядок VS/карточек и номера/арта должен быть реальной последовательностью. IR-типы и renderer-контракт этого раунда не менялись.

### Исправления и покрытие

- **R1:** при применении пресета общий abstract backdrop slot больше не подменяет отдельное назначение format/scene. Если generic slot уже получил другое destination binding, уровень сохраняет свой destination media key. Первичное назначение и не конфликтующие generic slots продолжают работать как раньше. Проверены разные document, format, scene backgrounds; v2 — дополнительно независимые назначения обоих segment settings и их сцен. Два regression-теста используют исходный preset с намеренно общим slot и destination с разными asset.
- **R2:** `mergeSettings` нормализует переключение источника: явный `round/current-card` очищает inherited asset, локальный asset без source выбирает `source:"asset"`. `compileBackdrop` разрешает explicit asset только при эффективном asset source. Regression-тесты используют отсутствующий old asset, чтобы доказать отсутствие ненужного resolution/error при обоих переключениях, и отдельно проверяют local asset без source поверх inherited round.
- **R3:** номер `round-intro` для board берётся из `template.board.rounds` по `scene.roundId`. Empty/summary сцены без текущего раунда не получают выдуманный badge. Тест проходит все сцены доски с двумя раундами, проверяя 1/2 либо отсутствие badge.
- **R4:** авторские узлы определяются по compile provenance, а не исключаются по диапазону layer. Explicit motion работает на −100, −101, −1000; штатный generated background продолжает исключаться из inherited motion. Четыре теста.
- **R5:** собственные authored параметры узла сохраняются отдельно от effective inheritance во внутренних WeakMap (не сериализуются). Контейнер наследует profile/intensity/duration, но transform-каналы имеет только свои explicit. Его stagger — оркестрация анимированных потомков: группы и ranks вычисляются отдельно; статические дети и внешние соседи не занимают места в группе. Ближайший контейнер задаёт локальную группу; explicit child stagger/null приоритетнее. Один stagger не создаёт эффекты, transform контейнера не копируется детям. Проверены четыре порядка, inherited leaf enter без parent enter, отсутствие анимации от stagger, отдельный parent fade и child pop.
- **R6 — root finding:** `rank-reveal` начинает badge с frame0, затем card wipe (delay .15 sec), затем отдельные text узлы (.3 sec). Нормализация автоматически вписывает это и в 2/3-кадровые сцены. `versus-impact` после нормализации card clips ставит вход VS не раньше завершения последнего card enter и не позже timer boundary, с сокращением самого входа по доступному окну. Explicit node.motion.enter у VS приоритетнее recipe coordination. Тесты доказывают относительные from в обычном и коротком picker, fit VS в сцену и неизменность duration/phases/audio; отдельно rank order/fit на 2, 3 и 30 кадрах.

Изменены только SDK-файлы: `src/video/motion-compiler.ts`, `src/video/motion.test.ts`, `src/video/nodes.ts`, `src/video/presets.ts`, `src/video/settings.ts`. Renderer/MCP/UI не менялись; product/tech и другие чужие `.ai` изменения не включены в коммит.

### RED → GREEN

Первый запуск после добавления regression-тестов R1–R5, до правок product-кода:

```sh
npx vitest run src/video/motion.test.ts
```

**15 failed / 51 passed** (`/tmp/douga-motion-review-round1-red.txt`). Все пять находок подтверждены падающими assertions: destination binding, source resolution, board badge, missing low-layer clips, cascade from/parent transform. После R1–R4 оставалось **6 failed / 60 passed** — только R5 (`/tmp/douga-motion-review-round1-progress.txt`). После исправления R5 — **66/66 GREEN** (`/tmp/douga-motion-review-round1-green1.txt`). Два новых отрицательных контрольных сценария (служебный фон и stagger без анимаций) проходили с самого начала и закрепляют границы изменения.

Отдельный RED R6: **5 failed / 66 passed**, до изменения recipes. Фактически VS начинался с 0 вместо ≥89/≥4, rank badge запаздывал на 1/2/4 кадра. Лог `/tmp/douga-motion-review-round1-r6-red.txt`. После исправления **71/71 GREEN**, лог `/tmp/douga-motion-review-round1-r6-green.txt`.

Последняя проверка на неподвижном финальном коде:

```sh
npx vitest run src/video/motion.test.ts src/video/sdk.test.ts src/video/segments.test.ts src/video/board-compiler.test.ts src/video/resource-limits.test.ts src/video/invariants.test.ts
npx tsc --noEmit
```

**6 файлов / 182 теста GREEN**: motion 71, sdk 21, segments 34, board-compiler 7, resource-limits 7, invariants 42. Лог `/tmp/douga-motion-review-round1-targeted-final.txt`. `tsc` — exit 0, лог `/tmp/douga-motion-review-round1-tsc.txt`; `git diff --check` — без ошибок. Полный suite в этом раунде не запускался по прямому указанию root; итоговый QG остаётся после интеграции.

Коммит исправлений round 1: `a17fc01` — `fix(video): preserve motion inheritance and choreography sequencing`.

## Fix round 2/5 — scoped R6/R7

База `a17fc01`; прочитан `task-1-rereview-1.md`. R1–R5 reviewer отметил ADDRESSED. В этом раунде меняются только coordination в `src/video/motion-compiler.ts` и regression-тесты `src/video/motion.test.ts`; типы, узлы/окна, phases и audio не меняются.

- **R6:** readiness каждого card теперь включает node.from, фактический первый непустой visible interval, activeWindow.from и завершение существующих enter clips. Последняя статическая карточка с `enter:null` больше не исключается из порядка. Отключённый enter остаётся отключённым; дополнительных эффектов не создаётся. Проверены last-card null и null у обеих карточек.
- **R7:** каждый recipe-managed VS enter после координации повторно ограничивается одновременно clip.window, node.from/duration, длительностью сцены и границей таймера. Граница таймера допускает начало ровно на ней, но half-open semantic window обязан содержать хотя бы один кадр. Вход укорачивается по доступному остатку. Если readiness карточек не пересекается с допустимым окном VS, выдаётся error `MOTION_CHOREOGRAPHY_INCOMPATIBLE` (ready=false); исходный клип остаётся внутри собственного окна, узел не переносится. Explicit authored VS enter по-прежнему приоритетнее recipe coordination.

Покрыты конкретный провал `[0,10)`, окно `[80,89)`, заканчивающееся ровно в card readiness (89), и окно `[150,160)`, начинающееся после timer boundary (135). Все три отклоняются без переноса узла, изменения visible, phases, audio или scene duration. Положительные края: `[80,90)` укорачивается до одного кадра с from89; `[89,90)` и `[135,136)` допускают один кадр; explicit fade в коротком окне остаётся самостоятельным override.

### Наблюдаемый RED

После добавления тестов, до изменения coordination:

```sh
npx vitest run src/video/motion.test.ts
```

**6 failed / 74 passed** (`/tmp/douga-motion-review-round2-red.txt`). R6: получены VS.from29 / VS.from0 вместо ≥75 для статической последней карточки. R7: три невозможных окна возвращали ready=true, а valid short window `[80,90)` получал clip end99 вне собственного node/window end90. Положительные boundary/explicit-override контроли прошли сразу.

После исправления **80/80 GREEN**, лог `/tmp/douga-motion-review-round2-green.txt`.

### Финальная проверка на неподвижном коде

```sh
npx vitest run src/video/motion.test.ts src/video/sdk.test.ts src/video/segments.test.ts src/video/board-compiler.test.ts src/video/resource-limits.test.ts src/video/invariants.test.ts
npx tsc --noEmit
```

**6 файлов / 191 тест GREEN**: motion80, sdk21, segments34, board-compiler7, resource-limits7, invariants42. Лог `/tmp/douga-motion-review-round2-targeted.txt`. `tsc` exit0, лог `/tmp/douga-motion-review-round2-tsc.txt`; `git diff --check` чистый. Полный suite не запускался согласно поручению root, итоговый QG остаётся после интеграции.

Коммит исправлений round 2: `eba8ec3` — `fix(video): bound versus coordination to semantic readiness windows`.
