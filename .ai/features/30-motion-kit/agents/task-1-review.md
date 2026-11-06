# Task 1 — свежий review SDK/schema/compiler/catalog

**Base:** `c5f7b8b`. **Head:** `415ac78`.

**Spec: ❌. Quality: Needs fixes.**

Проверены brief, report, product/tech и весь пакет `task-1-review.diff`.
Отдельно прочитаны обрезанный контекст изменённых функций и непосредственно
связанные `context.ts` / участки `board-compiler.ts`. Renderer и traversal медиа
относятся к Task 2; их отсутствие не считается дефектом Task 1.

## Подтверждённые находки

### R1 — Important: применение пресета подменяет самостоятельный фон сцены общим

**Место:** `src/video/presets.ts:559`, `src/video/presets.ts:565`.

`safeSettings` создаёт один generic slot для одного исходного asset, включая
document/format/scene settings. При применении пресета новые вызовы `bind`
сначала назначают этому slot общий фон destination. Последующее назначение
сцены пропускается из-за `!bindings[slot]` на строке 555.

Воспроизведение: извлечь пресет из документа, где document backdrop и scene
backdrop используют asset `a`. Применить к документу той же структуры, в котором
document backdrop использует `a`, а scene backdrop — `b`, оба с pool bindings.
Ожидается сохранение сцены с `b`, как требует контракт переноса назначений.
Фактически оба backdrop используют `slot:visual:0`, привязанный к `a`.
`b` остаётся в bindings, но сцена перестаёт его показывать. Ошибки нет.

Focused probe через публичные `extractVideoPreset` / `applyVideoPreset` подтвердил:

```json
{"resultDefault":{"asset":"slot:visual:0"},"resultScene":{"asset":"slot:visual:0"},"bindings":{"slot:visual:0":{"kind":"pool","assetId":"a"}}}
```

Проверка альтернативы: наличие destination binding `b` не помогает; `bind`
не рассматривает его после первого назначения общего slot. Перенос обычных
custom media nodes не закрывает этот путь — backdrop хранится в settings.

**Исправление:** сохранять назначения каждого settings-уровня независимо,
разделяя generic slots при конфликте либо оставляя соответствующий destination
asset. Не молча выбирать первое назначение. Проверить также format overrides
и v2 segment settings.

### R2 — Important: локальная смена backdrop source не отключает унаследованный asset

**Место:** `src/video/motion-compiler.ts:506`.

Допустимый document backdrop `{preset:"art-blur",source:"asset",asset:"old"}`
и допустимый scene override `{preset:"art-blur",source:"current-card"}`
объединяются `mergeSettings` в объект с новым source и старым asset.
`compileBackdrop` вычисляет `source="current-card"`, но безусловно выбирает
`b.asset` раньше проверки source.

Ожидается фон текущей карточки, либо нейтральный фон в custom scene без карточки.
Фактически `ready=true`, IR сообщает `source:"current-card"`, а `layers`
содержит `old` на всё окно сцены. Аналогично ломается переключение на `round`.
Пользователь получает прежнюю картинку вместо выбранного локального источника;
если старый asset отсутствует, возникает уже ненужная ошибка его разрешения.

Focused probe: custom scene длиной 30 кадров, приведённые выше настройки,
manifest `old={id:"old",kind:"image",src:"/old.png"}`. Получено:

```json
{"source":"current-card","layers":[{"from":0,"to":30,"media":{"asset":{"id":"old","src":"/old.png"}}}],"ready":true}
```

Проверка альтернативы: refinement схемы не запрещает этот вход — он проверяет
каждый авторский settings-объект отдельно. `asset:null` не предусмотрен схемой,
поэтому простое локальное переключение source нельзя выразить очисткой asset.

**Исправление:** нормализовать source/asset при наследовании либо выбирать
asset только при эффективном `source:"asset"`; обеспечить согласованность IR
source с фактическими layers.

### R3 — Important: round-intro показывает первый номер во всех раундах доски

**Место:** `src/video/motion-compiler.ts:637`–`640`.

Каталог разрешает `round-intro` на board, но номер badge вычисляется только
из `PickerRound` аргумента. Для board `compiler.emit` вызывает post-pass без
этого аргумента: board rounds находятся в `template.board.rounds`, а текущий
раунд обозначен `scene.roundId`. Поэтому всегда выбирается fallback `0 + 1`.

Focused probe: board с раундами `r1` и `r2`, глобальный
`motion.choreography="round-intro"`. Компиляция завершилась с `ready=true`
и без diagnostics. Для `roundId:"r2"` в reveal/think/result сценах
сформирован `badge.text="1"` вместо `"2"`.

Проверка альтернативы: штатный board compiler действительно сохраняет
`scene.roundId` у этих сцен, поэтому данные для правильного номера доступны;
исправление не зависит от renderer. Рецепт дополнительно создаёт «1» в empty
и summary сценах, где текущий раунд вообще не определён.

**Исправление:** разрешать номер board round по `template.board.rounds` и
`scene.roundId`; не придумывать номер для сцен без соответствующего раунда.

### R4 — Important: motion авторского узла исчезает на слоях −100 и ниже

**Место:** `src/video/motion-compiler.ts:643`–`644`.

Фильтр кандидатов использует `layer > -100` для всех узлов. Однако публичная
схема разрешает произвольный целочисленный layer, включая −100: это нормальное
размещение авторской фоновой графики. Здесь нет проверки, что узел является
именно служебным background, и explicit `node.motion` исключение не получает.

Focused probe: custom shape `{id:"background",type:"shape",shape:"rect",
layer:-100,motion:{enter:"fade"}}` в 30-кадровой сцене. Ожидается motion clip;
фактически узел присутствует, но `motion` отсутствует, `ready=true`, diagnostics
пусты. Перенос того же узла на обычный слой попадает в обработку.

Проверка альтернативы: узел не скрыт и не находится вне сцены; он исключён
до `compileChannel`. Для такого входа Task 2 уже не получает информации,
что нужно анимировать. Это нарушает контракт локальной анимации custom узлов.

**Исправление:** исключать служебный background по происхождению/роли, а не
по диапазону пользовательских слоёв; как минимум всегда обрабатывать явно
заданный motion авторского узла.

### R5 — Important: stagger контейнера не каскадирует детей и включает лишний transform родителя

**Место:** `src/video/motion-compiler.ts:646`, `src/video/motion-compiler.ts:650`,
`src/video/motion-compiler.ts:686`.

Эта находка оценивается по уточнённому во время review контракту: координатор
явно поручил учитывать добавленные требования product P02 / tech T03.
`container.motion.stagger` должен оркестрировать дочерние анимированные элементы,
не копируя собственные transform-каналы контейнера детям; неявный глобальный
enter применяется только к листьям.

Первый focused probe: контейнер с `motion.stagger.interval={frame:3}`,
два text child с собственным `motion.enter="pop"`. Ожидается локальный каскад.
Фактически оба клипа получают `from=0`: ranks создаются для всей сцены, а
настройка stagger контейнера не поступает к дочерним клипам.

Второй focused probe: глобальный `settings.motion.enter="pop"`, тот же
контейнер с одним stagger, дети без явных motion. Ожидается stagger листьев
без transform контейнера. Фактически **контейнер и оба ребёнка** получают
одинаковый enter pop `from=0,durationInFrames=14`. Наличие любого authored
motion делает контейнер кандидатом, после чего `local.motion` возвращает ему
глобальный enter. Итоговый IR задаёт вложенное двойное движение вместо каскада.
Оба сценария компилируются с `ready=true`.

Проверка альтернативы: отдельная передача node motion в `nodes.ts` специально
не копирует контейнерный transform детям, но не создаёт ни отдельной группы
каскада, ни запрета повторно наследовать глобальные каналы на сам контейнер
в post-pass. Renderer уже не сможет восстановить отсутствующую оркестрацию.

**Исправление:** разделить собственные каналы контейнера и orchestration
дочерней группы; рассчитывать локальные ranks и переносить только stagger
в эту группу. Контейнер с одним stagger не должен получать глобальный enter.

## Что сделано хорошо

- Закрытые имена, строгие схемы объектов и ограниченные параметры отделены
  от renderer; произвольные CSS/JS поля не принимаются. Alias `flip`
  нормализуется в `flip-y`.
- Post-pass добавляет отдельные motion clips, не переписывая animation,
  rect, phases, board actions и audio. Глобальный progress повторно
  нормализуется после v2 offsets и определения общей длины.
- Каналы и текстовые эффекты проверяются на совместимость; недоступный event
  и event вне смыслового окна имеют отдельные diagnostics.
- Ограничения частиц ≤32 и общего текстового бюджета ≤500 выражены в коде;
  несколько каналов одного узла учитывают максимум fragments, а не сумму.
- Нормализация enter/exit ограничивает длительность окнами, сохраняет hold
  для парных длинных краёв; явные channel/choreography null сохраняются.
- Разделение reveal/decision/answer в backdrop не выбирает победителя во
  время decision. Для explicit missing asset используется обычный resolver.
- Покрытие тестов включает v2 progress, события, short windows, inherited null,
  preset sanitization, custom containers и все fps/форматы.

## Cannot verify / границы вывода

- Визуальное различие эффектов, чистота frame/fps/seed вычислений, композиция
  с ручными keyframes, удержание outgoing кадра, итоговая картинка таймеров,
  offline/watch/MP4 и traversal backdrop media требуют Task 2 и живого QG.
  По отсутствию этих частей в Task 1 замечания не выставлялись.
- Полная идентичность старого IR для всех v1/v2 документов не доказывается
  только отсутствием полей в одном тесте. В diff не обнаружено подтверждённой
  регрессии старого IR без opt-in; прямого сравнения с base на широкой выборке
  в этом review не проводилось.
- Первоначальная неоднозначность container stagger разрешена прямым уточнением
  координатора в ходе review и записана в P02/T03; результат адресной проверки
  отражён отдельно в R5. R1–R4 не зависят от этого уточнения требований.

## Проверки и независимость

По переданному отчёту: целевой набор **6 файлов / 160 тестов GREEN**, tsc GREEN.
Полный итоговый QG ещё не заявлен пройденным. Наборы тестов в этом review
не запускались согласно поручению.

Фактически выполнены только адресные read-only probes через
`node_modules/.bin/tsx -e` и публичные SDK-функции: конфликт preset backdrop
slots; смена inherited source; board round numbering; low-layer motion;
container stagger. Все probes завершились exit 0 и дали результаты выше.
Checkout, index, git и product-код не менялись.

Кандидаты повторно проверены самим reviewer по вызывающим, schema и причинам
в diff. Второй независимый проверяющий кандидатов не запускался: поручение
явно запрещает subagents. Этот review выполнен отдельно от автора Task 1.
