# Task 1 — scoped re-review исправлений, раунд 1

**Base:** `415ac78`. **Head:** `a17fc01`.

**Spec: ❌. Quality: Needs fixes.** Открыты R6 и новая R7.

Проверены прежний `task-1-review.md`, дополнение fix round 1 в
`task-1-report.md` и весь `task-1-fix-1.diff` (795 строк). Область ограничена
закрытием R1–R6 и регрессиями этих исправлений. Повторного общего review
неизменённого кода не проводилось.

## Статус прежних findings

| ID | Статус | Доказательство по исправлению |
| --- | --- | --- |
| R1 | **ADDRESSED** | Новый `bindBackdrop` в `src/video/presets.ts` сохраняет destination asset при конфликте уже назначенного abstract slot. Исходный сценарий default A / scene B больше не выбирает A для сцены. Regression-тесты проверяют document/format/scene и v2 common/segment/scene назначения. |
| R2 | **ADDRESSED** | `src/video/settings.ts` очищает inherited asset при явном non-asset source; локальный asset без source нормализуется в asset source. `compileBackdrop` выбирает asset по эффективному source. Тесты проверяют оба переключения с отсутствующим старым asset, а также обратное переключение на asset. |
| R3 | **ADDRESSED** | `src/video/motion-compiler.ts:625` разрешает board round по `scene.roundId`; `:633` не создаёт badge вне раунда. Тест проходит все сцены двух раундов и требует 1/2 либо отсутствие badge. |
| R4 | **ADDRESSED** | `src/video/motion-compiler.ts:657` допускает авторский узел независимо от layer через compile provenance. Тесты проверяют −100/−101/−1000 и исключение generated background из inherited motion. |
| R5 | **ADDRESSED** | `src/video/motion-compiler.ts:669` удаляет неявные channels контейнера, а `:724`–`:756` строят отдельные группы каскада по ближайшему authored stagger. Исходные explicit-child и global-enter сценарии покрыты проверками ranks, отсутствия parent transform и неизменности внешних/статических узлов; собственный transform родителя остаётся отдельным. |
| R6 | **NOT ADDRESSED — исправлено частично** | Порядок rank badge → card исправлен через delays. Обычный VS теперь ждёт завершения enter clips карточек. Однако последняя карточка без enter вообще исключена из расчёта готовности, поэтому VS всё ещё может появиться до неё; подробности ниже. |

## Открытые findings

### R6 — Important: VS опережает появление последней карточки с enter:null

**Место:** `src/video/motion-compiler.ts:775`–`783`.

Новый `lastCardEnter` считает только существующие motion clips. Локальное
`card.settings.motion.enter=null` выключает анимацию, но сохраняет штатное
позднее reveal/visible начало карточки. Этот момент отсутствует в расчёте,
поэтому порядок «карточки → VS» остаётся нарушенным.

Focused probe через публичный SDK:

- picker с двумя участниками и карточками `ca`, `cb`;
- `settings.motion.choreography="versus-impact"`;
- у `cb`: `settings.motion.enter=null`;
- обычные тайминги, без media.

Получено `ready=true`:

```text
ca: enter.from=15, duration=14, activeWindow=[15,75)
cb: motion отсутствует, visible=[75,285), activeWindow=[75,135)
VS: enter.from=29, duration=14
timerStartFrame=135
```

VS начинает вход за **46 кадров до появления второй карточки**. Пользователь
отключил только движение карточки, а получил нарушенную последовательность
дуэли. Введённые тесты R6 оставляют enter у обеих карточек, поэтому этот путь
ими не проверяется.

Проверка альтернативы: fallback `0` в Math.max не представляет reveal;
`visible`/`activeWindow` у cb действительно сохранены. Обработка renderer
не может вывести карточку до её semantic window и не исправляет порядок IR.

**Исправление:** учитывать готовность каждой участвующей карточки, включая
её фактическое начало видимости/reveal без enter, плюс завершение существующих
enter clips. Не включать обратно явно отключённую анимацию.

### R7 — Important: coordination VS выводит уже нормализованный клип за окно узла

**Место:** `src/video/motion-compiler.ts:795`–`805`.

Новый post-pass сдвигает `enter.from`, ограничивая его только timer boundary
и длительностью сцены. Ограничение `enter.window` и собственные
`node.from` / `node.durationInFrames`, уже проверенные `compileChannel`,
повторно не учитываются.

Focused probe: обычный двухкарточный picker с `versus-impact`, авторский
узел `{id:"vs",type:"versus",timing:{duration:{frame:10}}}` и без собственного
`motion.enter`. Наличие этого узла штатно предотвращает создание второго VS.
Обе карточки используют обычные входы.

Получено `ready=true`, diagnostics пусты:

```text
VS node: from=0, durationInFrames=10, visible=[0,10)
VS enter: from=89, durationInFrames=10, window=[0,10)
```

Клип полностью находится после конца собственного window. Уважающий IR
renderer никогда не проиграет этот вход в видимом окне узла. В base415ac78
клип оставался внутри `[0,10)`; именно новый coordination сдвиг выводит его
наружу, поэтому это регрессия fixdiff, а не соседнее старое замечание.

Проверка альтернативы: узел является допустимым custom VS без explicit enter,
значит ранний выход `ownMotion.enter !== undefined` его не исключает.
Обычные тесты R6 используют generated VS на всю сцену и проверяют только
scene duration, не более короткое окно авторского узла.

**Исправление:** согласовывать choreography с исходным semantic window.
Если в этом окне нельзя соблюсти «карточки → VS», выдавать incompatibility
diagnostic либо применять явно определённую политику, не нарушающую
node visibility; не оставлять успешный IR с клипом вне window.

## Проверки, плюсы и ограничения

- Переданные результаты автора: RED R1–R5 — 15 failures; отдельный RED R6 —
  5 failures; финальный fresh targeted прогон **6 файлов / 182 теста GREEN**,
  `tsc` exit 0. Это результаты отчёта, а не повторный запуск reviewer.
- В этом re-review выполнены только два focused SDK probes через
  `node_modules/.bin/tsx -e`, оба exit 0: last-card enter null и short custom
  VS window. Код, index, git и checkout не изменялись.
- Исправления R1–R5 адресуют причины прежних находок; добавленные тесты
  проверяют пользовательские сценарии и важные отрицательные границы.
  R6 сохраняет phases/audio/duration и уважает explicit VS enter, но
  нуждается в двух описанных граничных исправлениях.
- Renderer, визуальная плавность, live QG и media traversal не входят в этот
  scoped re-review. Невозможность подтвердить их здесь не объявляется
  дополнительным дефектом Task 1.
- Случайных замечаний вне scope не обнаружено. Кандидаты перепроверены по
  причинам в fixdiff; второй subagent не запускался согласно поручению.
