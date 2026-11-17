# Реализация задачи 2: ёмкость и адресные бюджеты

Исполнитель `resource_budgets`, ветка задачи 35. Коммитов и общего QG не делал;
процессы владельца не останавливал. Изменения переданы root для интеграции.

## Реализовано

- `maxAuthoredValues = 2_000_000`, `maxExpandedNodes = 100_000`.
- Сохранены maxDepth 32 для дерева узлов, структурный JSON guard 96,
  2 000 expanded scenes, 20 000 audio cues, 200 000 policy windows,
  7 200 секунд и прежний frame guard 864 000. Отдельный allocation guard
  board factory 20 000 также сохранён. Число 300 не стало пределом.
- Один предел `studioDocumentMaxBytes = 33_554_432` байта UTF-8 применяется
  к результату `JSON.stringify` и к строке `saveStudioDraftSchema.text`.
  Подсчёт выполняется `Buffer.byteLength(text, "utf8")` и учитывает экранирование
  одиночных суррогатов при сериализации JSON.
- `RESOURCE_BUDGET_EXCEEDED` сохранён. В `Diagnostic.message` находятся
  `resource=<name>; used=<number>; limit=<number>`, `path` указывает конкретное
  поле/узел/правило. Actual timeline/audio/aggregate segment guards используют
  тот же helper. Индексы сегментов в бюджетных ошибках учитывают disabled segments.
- Обход неизвестного документа использует итераторы и индексный обход массивов,
  не создаёт стек из всех authored values сразу. Cycles обнаруживаются по текущей
  цепочке предков; повторная нециклическая ссылка считается каждый раз, как в JSON.
- `canonical`/`requestHash` также обнаруживают cycles и возвращают совместимый
  `StudioError("DOCUMENT_TOO_LARGE", diagnostics)` вместо переполнения стека.
  Каноническое представление обычного JSON и семантика hash не менялись.
- Фабрики picker/board до аллокации выбрасывают `VideoResourceBudgetError`
  с прежним prefix сообщения, code и diagnostics. Их пороги/семантика сохранены.

Основные файлы: `packages/video/src/resource-limits.ts`, `audio.ts`, `compiler.ts`,
`board-state.ts`, `builders.ts`, `board-presets.ts`; серверные `shared.ts`, `types.ts`,
новый `document-size.ts`. Core `types.ts`, `schema.ts`, `index.ts` SDK не редактировались.

## Интерфейсы для root/MCP

Импорт из `@douga/video/resource-limits`:

```ts
estimateVideoResources(input: unknown): VideoResourceEstimate
resourceBudgetDiagnostic(resource: string, used: number, limit: number, path: string): Diagnostic
class VideoResourceBudgetError extends Error {
  readonly code = "RESOURCE_BUDGET_EXCEEDED";
  readonly diagnostics: Diagnostic[];
}
interface VideoResourceEstimate {
  authoredValues: number;
  authoredDepth: number;
  nodeDepth: number;
  expandedScenes: number;
  expandedNodes: number;
  audioCues: number;
  complete: boolean;
  diagnostics: Diagnostic[];
  limits: typeof videoResourceLimits;
}
```

Это чистая консервативная предварительная оценка, без схемы, manifest и I/O.
`complete: false` означает ранний отказ guard; counters содержат частичный расход
оценки к месту отказа. `audioCues` здесь считает authored `audio.cues` с expansion
anchors. Неявная музыка блоков, playlist, длительность итогового таймлайна и
retained audio policies проверяются компилятором после разрешения медиа.
Поэтому `complete: true` не заменяет compile/validation.

Из `src/server/studio/document-size.ts` доступны `studioDocumentMaxBytes` и
`documentSizeDiagnostic(text, path = "document")`.

Фикстуры `largeKeyframeDocument()` и `largePickerDocument()` находятся в
`packages/video/src/resource-limits.test-fixtures.ts`; их можно переиспользовать
в приёмочном драйвере. Picker содержит 300 раундов, по шесть карточек в трёх
группах по две, OST назначен каждому раунду через одну общую binding.

## RED → GREEN

Первый целевой RED подтвердил прежний отказ authored values и порога сериализации,
generic paths/errors и отсутствие адресной cycle ошибки. Отдельные RED прогоны:

- playlist/policy windows: `storage/feature-35-implementation/budgets-red-audio.log`;
- jsonText/canonical/requestHash cycles: `budgets-red-cycles.log`;
- numeric path cumulative duration для v1/v2: `budgets-red-duration-path.log`;
- picker/board factory rejection: `budgets-red-factories.log`.

Финальный целевой GREEN после последних правок: **108/108, 8 файлов**, 15,97 с.
Лог: `storage/feature-35-implementation/budgets-final-targeted.log`.

```sh
TEST_DATABASE_URL=file:/Users/gel/my_projects/douga/storage/feature-35-implementation/budgets.sqlite \
npx vitest run \
  packages/video/src/resource-limits.test.ts \
  src/server/studio/shared.test.ts \
  src/server/studio/resource-limits.integration.test.ts \
  packages/video/src/studio-domain.test.ts \
  packages/video/src/segments.test.ts \
  packages/video/src/board-schema.test.ts \
  packages/video/src/board-state.test.ts \
  packages/video/src/board-presets.test.ts
```

SQLite-копия создана через readonly `better-sqlite3` backup рабочей базы.
Интеграционные прогоны запускались только с указанным TEST_DATABASE_URL.
Тесты создают и удаляют собственный аккаунт/проекты/каталог; задания worker не создают.

Покрытие: exact 2 000 000/2 000 001 values, depth 32/33 и 96/97,
scenes/nodes/cues, exact 100 000/100 001 node estimate, finite timeline guards,
playlist/policy windows, repeated anchors, cycles/shared refs; exact 32 МиБ и
один байт сверху для ASCII, кириллицы, surrogate pairs и JSON-escaped lone surrogates.
Прежний тест фабрики с 20 002 карточками обновлён на 100 002: прежняя фикстура
теперь входит в поднятый технический бюджет.

## Реальные операции хранения и метрики

Три интеграционных сценария проходят на SQLite:

1. Документ с **1 040 835 authored values**, 100 text nodes × 2 600 distinct explicit
   frame keyframes, **8 221 771 UTF-8 bytes**: save text → evaluate ready → commit →
   get project → чтение сохранённой revision; все данные и keyframes сохранены.
2. **300×6 + группы 3×2 + OST**: create → save object → commit → read;
   300 раундов, 1 800 card nodes и 300 music cues сохранены без обрезания.
3. Отказ text/object >32 МиБ оставляет прежние draft text, version, revision и preview.

Чистые compile metrics: `storage/feature-35-implementation/budgets-metrics.json`.
Keyframes: estimate 1 scene / 110 nodes; actual 1 scene / 100 nodes / 2 600 frames,
compile около 629 мс. Picker: 274 738 bytes, estimate 600 scenes / 31 800 nodes,
actual 300 scenes / 3 000 nodes / 300 music cues / 16 200 frames, около 107 мс.
Это разовые локальные замеры, не performance benchmark.

## Интеграция и оставшаяся приёмка

- Root уведомлён, что `VideoResourceBudgetError` надо преобразовать в `StudioError`
  на общем create path, чтобы ожидаемый factory overbudget не стал HTTP 500.
- Прямой `videoDocumentSchema` пока имеет прежний generic custom issue для бюджетов;
  root уведомлён о preflight перед raw parse на create path. Compile/evaluate уже
  возвращают конкретный diagnostic. Изменение схемы относится к другому исполнителю.
- Эта проверка picker использует общий встроенный OST; 2 100 различных реальных
  media refs, storyboard pagination, клипы начала/середины/конца, настоящий MCP,
  HTTP, offline HTML и decoded audio остаются общей живой приёмкой root.
- Полную тройку `npm test → npm run build → npx tsc --noEmit`, карточки зон и
  финальное ревью/PR/merge выполняет root после объединения изменений.
