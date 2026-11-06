# Финальный fix wave — отчёт исполнителя

**DONE.** Все FR-01 / FR-02 / FR-03 исправлены. Source-коммит:
`5a92ab0` — `fix(motion): preserve backdrop identity and adjacent transition continuity`.
База поручения `9bbc328`; изменения source только в восьми файлах ниже.
Подагенты, dev-сервер и общий worker не запускались. Рабочая БД и проекты
владельца не изменялись. Проверки используют синтетические документы и media
из `storage/verification/30-motion-kit/assets/`.

## Изменения

- `src/remotion/MotionBackdrop.tsx`: original index слоя сохраняется до фильтрации
  активного множества и становится React key. From/media/timing/opacity остаются
  прежними. Одинаковые from и assetId у нескольких слоёв не дают коллизию ключей.
- `src/remotion/studio-frame.ts`: pure `legacyExitReplaced(scene,next)` проверяет
  непосредственную смежность, положительное окно следующей сцены и положительную
  длительность нового adjacent transition. Optional `transitionAt(...,suppressExit)`
  оставляет legacy enter и отключает только exit.
- `src/remotion/StudioVideo.tsx`: контекст следующей смежной сцены передаётся в
  `StudioSceneFrame` через optional `suppressTransitionExit`. Held outgoing
  сохраняет прежние freeze/media/last-local-frame и отключение собственного
  перехода. Поиск идёт в плоском плане, поэтому работает между segments.
- `src/video/motion-compiler.ts`: явный `card.reveal.cardId` ищет card node текущей
  сцены и берёт его active/visible start в scene-local времени. Неизвестный или
  недоступный target даёт существующий `MOTION_EVENT_UNAVAILABLE`, без fallback.
  Без cardId сохраняется прежняя current-node/scene семантика. Offset/delay
  применяются существующим caller ровно один раз; node.from не добавляется.
- `src/video/motion-schema.ts`: три строгие ветви anchors: phase events без
  selectors, card.reveal с optional cardId, board.* со всеми тремя selectors.
  Несовместимые selectors дают `SCHEMA_INVALID` и ready=false. Новых полей нет.
- Регрессии: `src/remotion/motion-frame.test.ts`,
  `src/remotion/studio-frame.test.ts`, `src/video/motion.test.ts` — 13 новых
  тестов. Дополнительно проверены прежние unselected anchors и board selectors,
  включая отдельное несовпадение cardId/actionId/slotId.

IR, окна, число кадров, audio, права и квоты не менялись. Без положительного
нового adjacent transition legacy exit остаётся прежним: duration0, gap,
legacy→legacy, последняя сцена. Duration1 — opt-in. Документацию политики
обновляет root в своей docs wave; чужие `.ai/` файлы исполнитель не редактировал.

## RED до production fixes

```
npx vitest run src/video/motion.test.ts src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts
```

Наблюдаемый RED: **11 failed / 196 passed / 207 total, 3 files failed**.
Лог: `storage/verification/30-motion-kit/final-fix-red.log`.

- FR-01: continuing key менялся `0-1 → 0-0`.
- FR-02: при подавлении exit fade оставался opacity0.1, slide x=-576;
  отсутствовал adjacency helper. Enter прежний.
- FR-03: label имел from17 вместо35 (target30 + offset2 + delay3), неизвестный
  cardId оставлял ready=true, пять неподдерживаемых selectors принимались схемой.

```
node storage/verification/30-motion-kit/final-fix-backdrop-probe.mjs
```

RED exit1: actual Chromium + real MotionBackdrop + native video:
forward/backward `sameB=false`, `oldConnected=false`; assertions проверяют identity.

Actual render RED выполнен bundle, собранным до source fixes. Сохранённые данные:
`final-fix-mixed-render-red.json`; явная проверка ожидаемых белых samples упала
exit1 на fade→push frame58: `[57,61,67]` вместо `[255,255,255]`;
frame59 `[33,36,44]`, frame60 `[255,255,255]`.
Лог assertion: `final-fix-pixel-red-assert.log`.
Первый guard optIn в probe ошибочно смотрел подстроку имени case, его ранний
PASS не засчитан; guard исправлен на реальные length/gap/incoming, RED assertion
проверен отдельно по сохранённым RGB. Финальный GREEN ниже повторяет корректные
assertions на свежем source bundle. SSR не использовался как pixel evidence.

## GREEN после последних source edits

```
npx vitest run src/video/motion.test.ts src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/watch/backdrop-media.test.ts src/watch/model.test.ts src/watch/offline.test.ts src/mcp/motion-discovery.test.ts src/mcp/instructions.test.ts
npx tsc --noEmit
git diff --check
```

**263/263, 9/9 files, exit0; tsc exit0; diff-check exit0.**
Логи: `final-fix-targeted.log`, `final-fix-tsc.log`.
Две дополнительные проверки совместимости увеличили первоначальный GREEN
трёх файлов207 до209; полный заданный targeted набор —263.
Первичная версия нового board compatibility test ожидала ready=true для
шаблона, повторённого во всех board scenes; это неверный fixture assumption:
на прочих сценах событие недоступно. Тест уточнён до matching action scene,
приёмки схемой и отрицательных selectors; production logic board.* не менялась.

## Живые доказательства

Все пути ниже внутри `storage/verification/30-motion-kit/`.

1. `node final-fix-backdrop-probe.mjs` — exit0. JSON
   `final-fix-backdrop-probe.json`: forward/backward sameB=true,
   oldConnected=true. Реальный DOM/native video остаётся тем же объектом при
   frame15→21→15; закончившийся A убирается и возвращается при seek.
2. `node --import tsx final-fix-mixed-render.mts` — exit0, **6 cases / 36
   actual renderStill captures / 30 unique PNG**, декодирование RGB через ffmpeg.
   `final-fix-mixed-render.json`, `final-fix-pixel-green.log`.
   Fade→push10, slide→crossfade10 на segment boundary, fade→crossfade1 на segment
   boundary: samples x20/160/300,y90 белые на58/59/60/61 и повторном59.
   Frame5 сохраняет старый enter. Duration0/gap2/slide→slide сохраняют тёмный
   fade exit или прежнее slide displacement на59. PNG `final-mixed-*.png`;
   frame59 slide→crossfade дополнительно просмотрен исполнителем.
3. `node final-fix-mounted.mjs` — exit0. Реальный mounted Remotion Player и
   StudioVideo: те же **6 cases**, последовательный seek58→59→60→61→59→60
   (с учётом gap), screenshot RGB assertions. `final-fix-mounted.json/.log`.
   У отдельного синтетического native video held outgoing на60/65/69 и повторном60
   `currentTime=1.133333` (=34/30), readyState4, muted=true, paused=true.
   На70 outgoing video отсутствует; после обратного seek held frame остаётся
   прежним. JS errors=[]; собственной аудиодорожки у визуального узла не включено.
4. `node --import tsx final-fix-anchor-probe.mts` — exit0, **6 SDK cases**.
   `final-fix-anchor-probe.json`: selected target30/label30; offset+delay при
   node.from5 →35; unselected →12. Missing target ready=false с
   MOTION_EVENT_UNAVAILABLE; phase/card incompatible selectors — SCHEMA_INVALID.
   У валидных примеров phases/audio/duration совпадают с исходными.
5. `node --import tsx final-fix-legacy-json.mts` — exit0,
   **285/285 exact JSON parity** против предоставленного baseline: builtins,
   fps24/25/30/50/60 и mixed v2 segments. `final-fix-legacy-json.json`.
6. `node --import tsx final-fix-legacy-rgba.mts` — exit0,
   **5/5 exact decoded RGBA parity** против предоставленного baseline bundle:
   реальные picker separate-answer/legacy slide и board кадры.
   `final-fix-legacy-rgba.json/.log`, `final-fix-legacy-frames/`.

Команды probes запускались из корня репозитория с префиксом полного относительного
пути `storage/verification/30-motion-kit/` перед именем скрипта.

## Self-review и ограничения

Все три исходных дефекта воспроизведены и адресно закрыты. Проверены отсутствие
новых authored fields, arbitrary JS/CSS, retiming/audio/IR изменений и неизменность
legacy документов. Selector schema остаётся закрытой и видимой через существующую
MCP schema/discovery поверхность; targeted discovery/instructions проходят.

DOM probe FR-01 доказывает identity и connectivity, не измеряет buffering/lost
frames. Mounted видео FR-02 действительно декодировано, но общая A/V-синхронизация
всех пользовательских роликов здесь не измерялась. Pixel cases синтетические,
320×180; стили/рендерер настоящие. Живой MCP-сервис и пользовательский сайт в этой
fix wave не перезапускались; shared renderer и SDK проверены локально, штатные
MCP/watch/offline тесты зелёные. Эти границы не оставляют открытых FR.

Полная тройка npm test → build → tsc **не запускалась исполнителем по прямому
поручению**: root повторит её после scoped re-review. До этого отчёт не является
разрешением объявить итоговый QG всей ветки зелёным или вливать её.
