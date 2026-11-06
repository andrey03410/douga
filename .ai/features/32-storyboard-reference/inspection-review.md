# Независимое ревью inspection / queue / review

Дата: 2026-11-06. Основание: `main..0926302`, пакет
`storage/verification/32-storyboard/review/core.diff`, текущие исходники и связанные
guards. Требования: T02–T05, P03–P12. Код не менялся; записан только этот отчёт.

## Подтверждённые находки

### IR-01 · IMPORTANT / P2 — Историческая ревизия повторно разрешает текущие медиа

**Место:** `src/server/studio/storyboard.ts:48–55` (особенно 51 и 55).

Ветка `revision` берёт только `documentJson`, затем вызывает обычный `evaluate`.
Она не использует сохранённые `assetsJson`, `planJson`, frozen font ledger.
`evaluate → resolveAssets → bindingFile` для track-cover читает нынешний
`track.coverArtId` (`assets.ts:213–222`). При этом существующий
`freezeStudioProject({revision})` читает сохранённые ресурсы ревизии
(`revisions.ts:117–152`). Получаются разные изображения для одной ревизии в
старом preview/render и новой раскадровке.

**Сценарий:** сохранить ревизию с binding `{kind:"track", media:"cover", ...}`
без обязательного hash; заменить обложку того же трека штатным
`updateTrackMetadata({coverArtId: B})`; запросить `video_storyboard` с прежним
`revision` либо использовать его как `compareRevision`. Сторона «до» показывает
B вместо замороженной A. С binding.hash вместо неверной картинки будет ошибка
`ASSET_HASH_MISMATCH`, хотя файлы исторической ревизии доступны.

**Почему существенно:** сравнение с историей скрывает изменения медиа и не
воспроизводит выбранную ревизию. P08/P12 требуют явно закреплённые origin;
существующий контракт ревизий хранит их файлы именно для воспроизведения.
Нужно читать сохранённый frozen материал ревизии без commit/reconcile и
проверять его хеши. Текущий draft может продолжать live evaluation.

**Проверка:** прослежены обе ветки и публичная операция смены cover; owner
data не менялись, реальный рендер специально не запускался.

### IR-02 · IMPORTANT / P2 — Готовые suggestion IDs не проходят схему apply

**Место:** `src/server/studio/review.ts:30`; источник ID:
`src/video/video-review.ts:489`.

ID предложения — вложенный JSON с issue ID, scene/node ID и target, но
`suggestionIds` принимает строки не длиннее 200. Сами авторские scene/node ID
допускают по 200 символов. Пример с `scene-` + 40 букв и `label-` + 40 букв
полностью валиден и порождает compact-label ID длиной **288**. Этот ID
возвращается в `suggestions` и готовом `nextAction`, но apply отвергает его
до чтения проекта как `SCHEMA_INVALID`.

**Сценарий:** custom-сцена с указанными ID и переполненной label; получить
quick review и выполнить его готовый `video_review_apply`.

**Почему существенно:** поддерживаемое предложение нельзя применить через
заявленный маршрут ни HTTP, ни MCP. Нужен ограниченный непрозрачный стабильный
ID (например, digest) либо согласованный с генератором лимит схемы.

**Проверка:** read-only `tsx` probe создал валидный canonical document,
вызвал compile/review и `applyStudioReviewSchema.safeParse`. Результат:
`suggestionLength: 288`, `acceptedByApply: false`; других compiler diagnostics,
кроме ожидаемого overflow, нет.

### IR-03 · IMPORTANT / P2 — Неудачное исправление принимается и предлагается снова

**Место:** `src/server/studio/review.ts:111–116`; генератор compact-label:
`src/video/video-review.ts` в ветке `TEXT_OVERFLOW`.

Проверка после patch отвергает лишь *новые* ошибки. Сохранение исходного
`TEXT_OVERFLOW` считается допустимым, и draft записывается. `reviewVideo`
предлагает compact-label заново даже когда те же свойства уже установлены и
текст всё ещё не помещается. Нет проверки исчезновения целевой проблемы,
канонически пустого patch или сохранённой неудачной попытки.

**Сценарий:** label с очень длинным текстом, box 240×65 px, fontSize 36,
minFontSize 20, первоначально fixed/maxLines 1. После первой compact-label
переполнение остаётся; вторая ещё уменьшает authored fontSize до уже
измеренных 20; третья предлагает буквально то же состояние. Каждое apply
проходит guard старой ошибки и увеличивает project version.

**Почему существенно:** обычный цикл «отчёт → рекомендуемая правка → отчёт»
зацикливается, а интерфейс продолжает предлагать бесполезное изменение.
Это прямо противоречит P07 («Повторять одинаковую неудачную правку нельзя»).
Неуспешную правку нужно отклонять/помечать и давать следующий диагностический
шаг; как минимум не записывать пустой patch и не повторять тот же suggestion.

**Проверка:** отдельный read-only probe с детерминированным MeasureText,
compile/review/patch. Для трёх итераций overflow=true; на третьей
`canonical(next) === canonical(current)`, suggestion ID прежний. Прогон
не доказывает конкретные пиксели, но доказывает дефект управляющего контракта:
любое оставшееся переполнение проходит показанную серверную проверку.

### IR-04 · IMPORTANT / P2 — Apply не сохраняет состояние черновика «до»

**Место:** `src/server/studio/review.ts:99–116`, итоговый вызов на 116.

Quick review ничего не сохраняет. Apply передаёт в transform только identity
и новый документ. `writeDraft` перезаписывает единственный `draftText`, а
mutation receipt содержит только `saved` (состояние после),
`projects.ts:578–604`. Вызов с `idempotencyKey` не спасает старое состояние;
без ключа нет даже receipt. Inspection job перед apply не обязателен и
автоматически не создаётся.

**Сценарий:** вручную сохранить ещё не committed draft с локальными настройками
подписи; quick review; применить `return-label-theme` без предварительного
storyboard. Значения override исчезают из draft, последняя ревизия их не
содержит. Report возвращает имена overrides и новые operations, но не прежние
значения. Штатного точного восстановления состояния перед исправлением нет.

**Почему существенно:** P07 требует возможность восстановления до правки,
T05 явно обещает сохранение before через mutation receipt/inspection result.
Нужно атомарно сохранять before-document/обратный patch в доступной операции
восстановления, не создавая побочный commit; обеспечить это и без явного ключа.

**Проверка:** прослежена вся цепочка quick review → apply → transform →
writeDraft → receipt. Внешние данные не изменялись.

## Покрытие и ограничения

- Прочитаны все восемь файлов core.diff, текущие render/measurement adapters,
  asset evaluation/copy/fonts, project CAS/receipts, revision freeze,
  общий worker и quota/ownership guards, pure storyboard/review.
- Прямых source/draft/revision writes от `loadInspectionProject` и quick review
  не найдено. `evaluate` может обновлять кеш active audio analysis; это не запись
  проекта. Для malformed draft предыдущий preview не подставляется.
- Общий heavy lease, heartbeat, abort, fencing публикации, scoped ownership и
  путь frame через manifest сохранены. Отдельной подтверждённой регрессии этих
  guards не найдено. Копии медиа и шрифтов проверяются renderer по hash.
- Сомнения в общем учёте сохранённых input bytes и проверке бюджета лишь после
  копирования не включены в находки: account-wide storage policy требует
  отдельной сверки, а часть поведения существовала до этой фичи.
- Missing glyph блокируется `loadInspectionProject` как VALIDATION_FAILED и
  не попадает в обычный review DTO; это ограничение текущего T03 (renderable
  diagnostic path только для TEXT_OVERFLOW), поэтому не выдано за доказанную
  регрессию.
- Переданный результат 25 targeted tests — PASS. Полный QG, настоящий MCP,
  renderer и браузер **не запускались повторно** по условию задания.
  Собственные прогоны — только два небольших read-only tsx probes, описанных
  выше; ни БД, ни owner media они не меняли.
- Кандидаты перепроверены вторым самостоятельным проходом исходников.
  Отдельного субагента-проверяющего не было по прямому ограничению задания;
  этот отчёт передан координатору для независимой проверки кандидатов.

STATUS: FAIL

## Повторная проверка исправлений IR-01–04

Дата: 2026-11-06. Область ограничена исходными четырьмя сценариями и связями
их исправлений. Основание: `inspection-fixes.diff`, коммиты `21dc3c2`,
`f90e4f6`, `60d606e` и текущие рабочие правки review/filter/API/restore.
Первоначальный отчёт выше сохранён как история; актуальный вердикт ниже.

| ID | Вердикт | Доказательство закрытия исходного сценария |
| --- | --- | --- |
| IR-01 | Исправлена | `storyboard.ts:52–92`: historical branch читает сохранённые plan/manifest/files/resolvedDocument/runtime, проверяет ссылки именно scope `revision:N`, хеши media/poster, наличие ledger и frozen fonts. Ветка возвращается до live `evaluate`. Смена нынешнего cover A→B больше не меняет выбранную историю и сторону `compareRevision`. |
| IR-02 | Исправлена | `video-review.ts:123`: issue/suggestion получают непрозрачные ограниченные digest IDs; разные fingerprints проверяются на коллизию внутри отчёта. Повтор исходного probe даёт suggestion длиной 43 и `applyStudioReviewSchema.safeParse(...).success === true`. |
| IR-03 | Исправлена | `review.ts:35–49,60`: до предложения выполняются настоящий compile/measure/review и проверка исчезновения целевой проблемы. `review.ts:134–141`: применение всей выбранной комбинации повторно отвергает no-op, новые ошибки и сохранённые целевые issues до записи draft. `video-review.ts:528,609`: пустые кандидаты не предлагаются, authored fontSize не подменяется уже уменьшенным измеренным размером. |
| IR-04 | Исправлена | `projects.ts:510,592–608`: backup создаётся после CAS в той же транзакции, до публикации draft receipt, независимо от наличия клиентского idempotencyKey. `review-backups.ts:61–111`: сохранён before-document с origin/hash, зарегистрированы references, лимиты count/bytes отказывают без удаления старых точек. `review-backups.ts:113–145`: чтение проверяет actor/project/user, членство backup и хеши. HTTP и MCP возвращают backup; восстановление идёт обычным owned/CAS draft-write. |

В IR-04 дополнительно прослежены повтор receipt (возвращает прежний
`draftBackupId`), rollback при ошибке публикации references, удаление backup
при удалении проекта, HTTP `review-backups/:id`, MCP
`video_document_get(reviewBackupId)` → готовый `video_draft_replace`, UI
«вернуть состояние до исправлений». Это восстановление авторского документа;
историю ревизий apply не пополняет.

Собственный фактический прогон: один read-only `tsx` probe исходной длинной
подписи с настоящим `getTypographyMeasureText`, без БД/файловых записей.
Результат: `suggestionLength:43`, `acceptedByApply:true`,
`afterOverflow:true`, `targetIssueRemains:true`, `offeredAgain:false`.
Оставшийся целевой issue теперь является прямым основанием серверного фильтра
и apply rejection; первоначальный цикл больше не допускается.

Прочитаны адресные regression tests истории, ограниченных ID, ineffective
suggestion и backup/reference/CAS/quota. Переданные координатором результаты:
77 targeted tests / 9 files PASS, query 4 PASS, real stdio 106 assertions /
6 cases, контрольный агент 6/6. Эти прогоны **не выполнялись мной повторно**.
Полный QG и baseline остаются отдельной проверкой координатора; этот вердикт
не подменяет их и не распространяется на новый широкий scope.

Все IR-01–04 закрыты. Новых существенных регрессий в проверенных исправлениях
не обнаружено. Код не изменён; дополнен только этот отчёт.

STATUS: PASS (повторная проверка IR-01–04)
