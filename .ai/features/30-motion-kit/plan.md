# Моушен-кит — план реализации

> Для исполнителей: superpowers:subagent-driven-development; задачи выполняются
> последовательно в основном checkout, без worktree по правилу Douga.

**Цель:** реализовать принятый расширенный моушен-кит SDK/MCP во всех выходах видео.
**Архитектура:** строгий авторский JSON компилируется в optional IR-клипы;
покадровый renderer оценивает их поверх существующих keyframes. Общий каталог
питает MCP и галерею на настоящем Player.
**Стек:** текущие TypeScript/Zod/Remotion/React/Next/Vitest, без новых зависимостей.
**Спецификация:** [product.md](product.md), [tech.md](tech.md).

## Global Constraints

- Без новых полей существующие v1/v2 документы сохраняют прежний IR и поведение.
- Произвольный JS/CSS из JSON запрещён; кадр — чистая функция frame/fps/seed/IR.
- Хореографии не меняют рейтинг, ответ, действия доски, число кадров и аудиоокна.
- Ручные keyframes и перемещение доски сохраняются; motion — отдельный слой.
- Частицы ≤32, визуальные текстовые фрагменты ≤500; развёртка ограничена бюджетами.
- Новые переходы занимают начало входящей сцены и удерживают последний кадр предыдущей.
- В decision-фазе current-card не выбирает будущего победителя.
- Основной checkout; чужие проекты/медиа не меняем; секреты не печатаем.
- Доки и UI по-русски, идентификаторы и conventional commits по-английски.

## Review Focus

1. Короткая сцена и каскад из многих карточек: каждый элемент успевает появиться.
2. Отдельная answer-сцена и board move: motion не теряет семантические окна/геометрию.
3. Переход на границе сегментов: настоящий outgoing без повторного fade и аудио.
4. Замороженный snapshot, watch/offline: новые медиа фона переписываются и доступны.
5. Длинный текст, разные fps и повторная перемотка: ограниченный DOM и тот же кадр.

---

### Task 1: SDK, каталог и компилятор

**Файлы:** новые `src/video/motion-types.ts`, `motion-schema.ts`,
`motion-catalog.ts`, `motion-compiler.ts`, `motion.test.ts`; изменения
`types.ts`, `schema.ts`, `compiler.ts`, `nodes.ts`, `settings.ts`, `index.ts`,
при необходимости `resource-limits.ts`, `blocks.ts`, `assets.ts`, `presets.ts`.

**Interfaces:** consumes VideoDocument/CompileContext/CompiledScene;
produces exported MotionName/MotionSpec/MotionSettings/CompiledMotion,
motionCatalog/getMotionCatalogEntry, applySceneMotion, typed widgets/backdrop,
закрытые Zod-схемы. Поля и семантика — T02, точные типы авторитетны после этой задачи.

- [x] RED: schema отвергает неизвестное имя/CSS, принимает 40 имён и alias flip;
  каталог содержит 10 хореографий, новые переходы, 5 фонов и виджеты.
- [x] RED: compile без motion идентичен старому; enter/exit ограничены окном,
  cascade forward/reverse/center/rows, null отключает наследование, node overrides.
- [x] RED: event timer/answer/board разрешается в scene-local frame;
  missing/incompatible event — diagnostic; ручные keyframes не меняются.
- [x] RED: фон не раскрывает ответ до answer; явный missing asset — error;
  ресурсы/длинный текст/много эффектов ограничены; все fps/форматы конечны.
- [x] Реализовать типы/схемы/каталог и post-pass компилятора; нормализованные
  optional IR-поля; виджеты и хореографии работают с generated и custom узлами.
- [x] GREEN: `npx vitest run src/video/motion.test.ts src/video/sdk.test.ts
  src/video/segments.test.ts src/video/board-compiler.test.ts src/video/resource-limits.test.ts`.
- [x] Коммит `feat(video): add declarative motion kit and choreography compiler`.
- [x] Свежий task review; исправить существенное, записать точные контракты в execution.md.

### Task 2: Покадровый рендерер

**Файлы:** новые `src/remotion/motion-frame.ts`, `MotionBackdrop.tsx`,
`MotionWidgets.tsx`, `MotionText.tsx`, `motion-frame.test.ts`; изменения
`studio-frame.ts`, `StudioVideo.tsx`, при необходимости watch/offline helpers.

**Interfaces:** consumes IR из Task 1; produces evaluateMotion/transition helpers
и тот же StudioVideo/StudioSceneFrame для всех поверхностей. Старый transitionAt
сохраняется для none/fade/slide. Никакой логики разрешения событий в React.

- [ ] RED: каждый эффект имеет ожидаемые начало/середину/конец; повторный seek
  даёт то же состояние; opacity/scale ограничены, нет NaN/Infinity.
- [ ] RED: новые transition outgoing/incoming закрывают кадр; первая сцена,
  короткие окна, направления, сегментная граница; старые переходы неизменны.
- [ ] RED: ring/segments/bar используют frame/fps, круг остаётся круглым;
  текстовые эффекты сохраняют текст/пробелы, число заканчивается заданным значением.
- [ ] Реализовать все 40 эффектов, композицию с keyframes, маски/3D/blur/glow,
  текст, пять фонов, все виджеты и настоящие переходы соседних сцен.
- [ ] GREEN: `npx vitest run src/remotion/motion-frame.test.ts
  src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/video/motion.test.ts`.
- [ ] Коммит `feat(render): render motion effects transitions and widgets`.
- [ ] Свежий task review; исправить существенное.

### Task 3: MCP и живая галерея

**Файлы:** `src/mcp/studio-tools.ts`, `instructions.ts`, tests;
новые `src/video/motion-examples.ts`, `src/app/studio/motion/page.tsx`,
`MotionGallery.tsx`; `src/server/studio/timeline.ts`; ссылки в UI студии.

**Interfaces:** consumes Task 1 catalog и Task 2 renderer; produces
`video_motion_list`, `video_motion_get`, capabilities metadata, validated examples;
authenticated `/studio/motion` с настоящим Remotion Player и копированием JSON.

- [ ] RED: tools доступны и возвращают bounded summaries/filter/get/error;
  все выдаваемые примеры schema-valid и compile ready; инструкции короткие.
- [ ] RED: timeline включает начала/концы motion anchors и стыки переходов.
- [ ] Реализовать каталог, маршруты, примеры всех категорий и выбор профиля;
  превью использует тот же compiler/renderer, без CSS animation и внешних медиа.
- [ ] GREEN: targeted MCP/timeline/example tests; browser-safe bundle.
- [ ] Коммит `feat(studio): expose motion catalog and live preview gallery`.
- [ ] Свежий task review; исправить существенное.

### Task 4: Живая проверка и QG

**Файлы:** `scripts/verify-motion.mjs` при необходимости,
`.ai/features/30-motion-kit/verify.md`, evidence только в storage.

- [ ] Создать отдельный проверочный аккаунт/медиа; настоящий stdio MCP:
  catalog/schema/examples/create/validate/stable patch/commit/jobs.
- [ ] Render showcase с хореографиями, эффектами, фонами, переходами и звуком;
  извлечь и просмотреть кадры начала/середины/конца и стыков; декодировать аудио.
- [ ] Проверить portrait/square, настоящие board actions и separate answer.
- [ ] Браузер: галерея, Studio, watch, offline без сети; seek и playback;
  screenshots и page errors. Исправления — через RED→GREEN.
- [ ] После последних правок `npm test` → `npm run build` → `npx tsc --noEmit`;
  проверить порт/процессы, писать полные логи в storage.
- [ ] Свежий review всей ветки и устранение существенного; обновить verify.md.

### Task 5: Знания и вливание

**Файлы:** `.ai/map/studio-sdk.md`, `render.md`, `mcp.md`, README задачи,
`.ai/history.md`, SDK-гид задачи по необходимости.

- [ ] Обновить карточки по фактическому коду, описать API и ограничения.
- [ ] Сверить ссылки, отметить выполнение плана и evidence.
- [ ] Push, PR `30: Моушен-кит Video SDK`; stage review, ссылка и результаты QG.
- [ ] В автономном режиме после зелёных QG/review: stage merged, history,
  commit/push, `gh pr merge --merge --delete-branch`, main/pull.
