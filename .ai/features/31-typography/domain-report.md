# Домен типографики

Задача 1 реализована в `src/video/`, без правок серверов, renderer и ресурсов шрифтов.
Интерфейсы согласованы с ресурсным и renderer агентами.

## Решения

- `compileVideo(document, manifest?, {measureText}?)` остаётся чистым и синхронным;
  включённый scope без провайдера получает `TEXT_LAYOUT_REQUIRED`. Legacy-планы не
  получают новых полей, implicit `DEFAULT_SETTINGS` не считаются overrides.
- 7 font IDs, 12 стилей, 6 тем, 8 ролей, 4 полных примера. Метаданные faces
  подключены из `font-manifest.ts` ресурсного агента; `plan.fonts` — отдельные копии.
- Строгая схема: закрытые ID, конечные числа, проверенные цвета, плоские rich runs,
  не более 100 runs и 10000 графем, не более 12 заданных строк. Bindings разрешаются
  до измерения; rich captions карточек включают отдельный префикс ранга.
- Глубокое наследование, null scopes/roles/effects, локальные legacy overrides и
  явные новые поля. SDK helpers `applyTypographyTheme` / `applyTypographyStyle`
  поддерживают immutable preserve/replace и document/segment/scene/node scopes.
- IR содержит typography/textRuns/textLayout. Геометрия layout.rect относительно
  node, line.x/y относительно rect, run.x относительно line. lineHeight в IR — px,
  в typography — коэффициент. Реальные метрики измеряются до компиляции анимаций.
- Графемы, kinsoku, word/char/none, явные newlines, balance, padding и bounds двух
  обводок/теней/плашки, shrink/fixed, читаемые minima по формату/роли, error/ellipsis/clip.
  Последние две политики дают предупреждение. Explicit fitGroup действует внутри
  сегмента через scenes; автоматические compatible picker groups — внутри раунда.
- Timer/progress/counter резервируют ширину допустимых значений заранее. До 10000
  значений проверяются реальные строки, большие диапазоны используют консервативный
  максимум цифры на разряд. Исходный target counter остаётся в node.text.
- Выгрузка личного preset очищает приватные rich literals/group IDs, сохраняя
  типографику и оформление фрагментов.

## Проверки

Все новые поведения прошли RED → GREEN. Первые 20 тестов зафиксировали отсутствие
schema/compile/layout; последующие RED покрыли helpers/examples/counter/minima,
rich card bindings, rich preset extraction, aggregate budget, segment fit groups
и предупреждения explicit overflow.

После последних правок выполнены:

- `npx vitest run src/video`: 16 файлов, 354 теста, все зелёные.
- `npx tsc --noEmit --project /tmp/douga31-domain.tsconfig.json`: зелёный;
  конфигурация расширяет проектную и включает `src/video/**/*.ts`.
- Все 54 legacy presets × 3 формата проверены без provider: новых IR-полей нет.
- 4 примера, все темы и стили проверены pixel provider в доменном suite.
- Root сообщил о зелёной проверке Fontkit: 4 примера; 54 presets с clean;
  6 themes / 12 styles / 7 fonts × 3 формата.

Общий QG и живая проверка выполняются root после интеграции. Полный suite/build
этим агентом не запускались согласно делегированным границам.

## Исправления независимого ревью F31-03 / F31-05

Основание: `.ai/features/31-typography/review.md`; исходный доменный коммит
`8734801`. Два воспроизведённых разрыва закрыты отдельным scoped fix.

- F31-03: timer/progress и числовой text-counter всегда получают одну готовую
  строку (`wrap:none`, `maxLines:1`). Default shrink доходит до читаемого минимума;
  явный fixed сохраняется. Непоместившееся число даёт `TEXT_OVERFLOW`.
  Явный ellipsis/clip для динамического числа отвергается понятной ошибкой
  `TEXT_DYNAMIC_OVERFLOW_POLICY`, IR нормализован к error для диагностического кадра.
  Такой же style остаётся при повторной подгонке explicit fitGroup через scenes.
- Резерв counter включает точный исходный final text (плюс, ведущие нули,
  whitespace), и canonical формы renderer: Number(trim/decimal comma), finite и
  непустой ввод, toFixed с precision ≤12, сохранённые внешние пробелы. Ограниченное
  количество отображаемых значений перечисляется, более широкий диапазон имеет
  консервативный резерв десятичной и, при необходимости, научной формы. Нечисловой
  текст не переводится в числовую однострочную раскладку. Проверены `.001` и `1e3`.
- F31-05: общий sanitizer сохраняет color/weight/italic/decoration rich card runs,
  удаляет private literals/group selectors/prefixes и подставляет безопасную
  participant binding. Apply переносит destination copy в rich style template;
  при отсутствии explicit label сохраняет binding шаблона. Participant ID назначения
  остаётся от destination.

RED: 20 новых тестов воспроизвели неправильные две строки, ложную готовность,
потерянные плюс/нули/пробелы, reflow и потерю rich оформления/небезопасное содержимое.
GREEN после исправления и форматирования, под Node 22:

- `npx vitest run src/video`: 16 файлов, 374 теста, все зелёные.
- `npx tsc --noEmit --project /tmp/douga31-domain.tsconfig.json`: зелёный.
- Полный QG и настоящий renderer остаются у root; renderer/сервисы не менялись.

## Повторное ревью F31-05 и Unicode диагностика

Повторное чтение выявило регрессию первого F31-05 fix (`4a4f616`): safe fallback
в каждом rich run повторял имя. RED compile-roundtrip заменил ошибочное ожидание
двух bindings; default caption теперь содержит ровно один name binding, остальные
style slots имеют пустой текст. Если исходный run уже был привязан к имени,
сохраняется его позиция и оформление; иначе выбирается первый непустой слот.
Явный destination rich text снова заполняет все соответствующие style slots.

Добавлен согласованный binding `participant.displayLabel` = `caption ?? label`.
Именно он служит default label сохранённого card preset. Благодаря разрешению
binding при компиляции default caption корректен как у конкретной карточки,
так и внутри repeat participants; подпись не превращается в статическую копию
и не меняется с nickname на полное исходное имя. Explicit destination label и
текст его runs сохраняются. Проверены отсутствие private prefix, ровно одно имя,
caption concrete/repeated карточек, fallback на label и оформление всех slots.

`FONT_GLYPH_MISSING` теперь показывает до 20 entries как `символ (U+XXXX)`;
codePointAt сохраняет полный supplementary code point. Существующий тест проверяет
`𰻞 (U+30EDE)`, nodeId/path продолжают приходить через штатный diagnostic.

После последних правок под Node 22.23.2:

- `npx vitest run src/video`: 16 файлов, 377 тестов, все зелёные.
- `npx tsc --noEmit --project /tmp/douga31-domain.tsconfig.json`: зелёный.

## Читаемость миниатюрных карточек доски

Fresh QG на `d930ddb` обнаружил один реальный fail factory `board.tier`: постоянный
caption inset 10 px оставлял миниатюрным карточкам меньше места, чем две строки
читаемого минимума. Existing `studio-boards.integration.test.ts:17` воспроизведён
RED; новая доменная регрессия 80×100 px также сначала дала ready=false.

В новой типографике внешний inset подписи карточки равен
`min(10, width * .03, height * .03)`: рамка текста имеет x=inset, y=height/2,
width=width−2×inset, height=height/2−inset. Min font size не снижен; геометрия
самой карточки, media и legacy path не менялась. Для 400×500 px прежние 10 px
проверены отдельной регрессией.

Реальные Fontkit метрики записаны в `storage/typography-card-insets.json`:

- 80×100 px: inset 2.4, text rect 75.2×47.6, Oswald 21.25 px при min=20;
  две строки по 23.8 px занимают ровно 47.6 px, ширины 41.0975/47.685 px.
- 400×500 px: inset 10, text rect 380×240, штатный размер 36 px, overflow=false.
- Минимальная overview-карточка board.tier 87.0912×108.864 px: min=20,
  fitted size 23.13 px, text height 51.8193, две строки по 25.9056 px,
  ready=true и ни одного error на всём board plan.

После последних правок под Node 22.23.2:

- `npx vitest run src/video src/integration/studio-boards.integration.test.ts`:
  17 файлов, 381 тест, все зелёные (включая оба existing board integration cases).
- Изолированный domain TypeScript: зелёный.
- Root дополнительно сообщил о зелёной реальной matrix 54 populated presets ×
  3 формата с clean, уже после responsive fix; общий fresh QG выполняет root.
