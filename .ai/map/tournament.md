# Турнир сравнений

Путь Douga «топ из личных предпочтений». Пользователь грузит ZIP с OST (аудио и/или видео) и слушает треки. На каждом экране он выбирает лучший из пары или ранжирует группу до 7 треков. Движок выводит строгий топ без общих мест. Топ уходит в конструктор рендера и в источники Studio.

## Где код
- [`src/lib/domain/engines/`](../../src/lib/domain/engines/) — интерфейс `Engine` и `createEngine` ([`index.ts`](../../src/lib/domain/engines/index.ts)), движки [`swiss.ts`](../../src/lib/domain/engines/swiss.ts), [`round-robin.ts`](../../src/lib/domain/engines/round-robin.ts), [`merge.ts`](../../src/lib/domain/engines/merge.ts)
- [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts) — `Scheme`, статусы, `Comparison {a, b, result}` (`a`|`b`|`draw`)
- [`src/lib/domain/comparisons.ts`](../../src/lib/domain/comparisons.ts) — `lookup` (побеждает первый ответ), очки 1/0.5/0, `rankByScore` (очки → личная встреча → победы → порядок загрузки), `opponentCounts` (разные соперники, а не ряды)
- [`src/lib/domain/group-answer.ts`](../../src/lib/domain/group-answer.ts) — `MIN/MAX_GROUP_SIZE` = 2/7, `clampGroupSize`, `decodeGroupAnswer`, `validateGroupAnswer`, `targetComparisonsPerItem` = ⌈log₂ N⌉, `plannedScreens`
- [`src/lib/domain/order-coverage.ts`](../../src/lib/domain/order-coverage.ts) — `orderCoverage`: доля расставленных пар, противоречия, треки в циклах
- [`src/server/tournaments.ts`](../../src/server/tournaments.ts) — сервис: `createTournament`, `getTournament`, `nextComparison`, `recordGroupAnswer`, `undoLastAnswer`, `setGroupSize`, `extendPlan`, `finalize`, `reorderRanking`, `deleteTournament`
- [`src/lib/upload.ts`](../../src/lib/upload.ts) — `extractTracksFromZip`: теги music-metadata, у видео название из имени файла, сортировка по имени
- [`src/app/api/tournaments/`](../../src/app/api/tournaments/) — `POST` создание (multipart: ZIP, `scheme`, `groupSize`, `blindMode`); в `[id]/`: `PATCH {groupSize}`, `DELETE`, `GET next`, `POST compare|undo|extend|finalize|reorder`. `render/` относится к рендеру
- [`src/app/api/tracks/[id]/audio/route.ts`](../../src/app/api/tracks/[id]/audio/route.ts) — отдаёт файл трека (и видео) с Range, только владельцу
- UI [`src/app/tournaments/`](../../src/app/tournaments/): список и [`CreateTournamentForm.tsx`](../../src/app/tournaments/CreateTournamentForm.tsx) (оценка экранов), обзор [`[id]/page.tsx`](../../src/app/tournaments/[id]/page.tsx), экран [`[id]/compare/page.tsx`](../../src/app/tournaments/[id]/compare/page.tsx), топ-N и ручной порядок [`[id]/ResultsPanel.tsx`](../../src/app/tournaments/[id]/ResultsPanel.tsx). Конструктор рендера `[id]/render/` — другая зона
- Права и квоты: [`src/lib/domain/permissions.ts`](../../src/lib/domain/permissions.ts) — `tournament:create`; у пользователя 1 турнир и архив до 100 МБ, у админа число не ограничено, архив до 10 ГБ

## Данные
- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `Tournament` — `scheme`, `blindMode`, `status` (`draft`|`in_progress`|`completed`), `topSize`, `groupSize` (по умолчанию 2), `bonusOpponents`. Поле `engineState` в коде не используется
  - `Track` — `kind` (`audio`|`video`); `order` = порядок загрузки, по нему разрешаются ничьи
  - `ComparisonBatch` — один экран: `size`, `itemIds` (JSON в порядке показа)
  - `Comparison` — `trackAId`, `trackBId`, `result`; `batchId` пуст у рядов до фазы 18
  - `Ranking` — `@@unique([tournamentId, trackId])`
- Файлы: `storage/tournaments/<tournamentId>/tracks/<trackId><ext>`. Удаляются вместе с турниром

## Как устроено
- Движки чистые. Ответ выводится только из треков (в порядке загрузки) и лога сравнений. Чтобы продолжить турнир, лог проигрывается заново.
- Экран отправляется как `POST compare {ranked, rest}`. Сервис сверяет его с тем, о чём движок спрашивает сейчас; устаревший экран получает `GROUP_MISMATCH`. Затем `decodeGroupAnswer` раскладывает ответ в C(k,2) пар: `ranked` выигрывает у всех, `rest` — ничьи между собой. Пары, которые уже есть в логе, пропускаются. Всё пишется в одну `ComparisonBatch` в транзакции. Ничья в паре — это `ranked: []`, `rest: [a, b]`.
- Швейцарка сортирует кандидатов: меньше соперников, потом больше очков, потом раньше загружен. Сид группы — первый трек, у которого меньше ⌈log₂ N⌉ + `bonusOpponents` разных соперников. Группу добирают треками, которые ни с кем из неё ещё не встречались.
- Круговая жадно идёт в порядке загрузки, пока не сыграны все пары. Merge — сортировка слиянием через `NeedComparison` с `maxGroupSize = 2`.
- Действующий k = min(`clampGroupSize`, `engine.maxGroupSize`). Его меняют на ходу через `PATCH`; новый k действует со следующего экрана.
- «Ещё раунд» (`extend`) прибавляет к `bonusOpponents` k − 1 соперников. Бонус считается в соперниках, а не в раундах. Кнопка доступна, только пока движку есть что спросить.
- Прогресс считается в экранах: батчи плюс старые ряды без `batchId`. Оценка = max(сделано + текущий экран, `plannedScreens`).
- `finalize`:
  - первый вызов пишет `Ranking` и ставит `status=completed`; повторные меняют только `topSize`;
  - `reorderRanking` задаёт ранги вручную;
  - оба синхронизируют `RenderConfig.items` топа-N.

## Грабли
- Лог и батчи читай с сортировкой `[{createdAt: "asc"}, {id: "asc"}]`. SQLite хранит время с точностью до миллисекунды. От порядка зависят `lookup` (побеждает первый ответ) и то, какой экран снимет undo.
- Не возвращай швейцарке симуляцию расписания по раундам. После смены k посреди прогона она восстановит расписание, которого не было. При k=2 порядок вопросов тоже немного отличается от старой парной схемы: очки обновляются внутри раунда.
- Завершённый турнир не открывается заново:
  - `nextComparison` при `completed` отдаёт `question: null`;
  - undo отвечает `ALREADY_FINALIZED`;
  - `finalize` не перепроверяет движок: старая швейцарка по новому правилу может оказаться на одно сравнение короче;
  - ranking не пересчитывается, чтобы не стереть ручной порядок.
- Транзитивный вывод не делаем. `orderCoverage` строит замыкание на битсетах. Ничья не задаёт порядок. Пары, достижимые в обе стороны, идут в `contradictory`, а не разрешаются. Живые предпочтения нетранзитивны.
- Undo снимает экран целиком: `ComparisonBatch` удаляется вместе со своими `Comparison`. Если время совпадает, батч считается новее старого ряда.
- `recordComparison` в сервисе — старый попарный путь, вызовов у него нет. Ответы пишет только `recordGroupAnswer`.
- Турнир, на который ссылается `StudioAssetReference`, не удаляется: ответ 409 `STUDIO_SOURCE_IN_USE`. Studio читает `Ranking` и `topSize` ([`sources.ts`](../../src/server/studio/sources.ts)). `reorderRanking` не обновляет `Tournament.updatedAt`.
- ZIP целиком читается в память. Модули `src/server/*` с `import "server-only"` не грузятся вне Next. Проверки на реальной БД собирай из `src/lib/domain/*`.
- [`scripts/e2e-run.mjs`](../../scripts/e2e-run.mjs) устарел (по коду; не запускался). Он ждёт `next.pair` и шлёт `{a, b, result}`. API отдаёт `question` и принимает `{ranked, rest}`.

## Как проверить
- Юниты: `npx vitest run src/lib/domain/engines src/lib/domain/comparisons.test.ts src/lib/domain/group-answer.test.ts src/lib/domain/order-coverage.test.ts`
- Интеграция (пишет в `prisma/dev.db`, ту же базу, что у dev-сайта): `npx vitest run src/integration/group-ranking.integration.test.ts src/integration/flow.integration.test.ts`
- Живая проверка:
  - `node scripts/e2e-setup.mjs` создаёт пользователя `e2e@test.local` и `/tmp/e2e/ost.zip`;
  - создай турнир в `/tournaments`, затем открой `/tournaments/<id>/compare` с k > 2;
  - проверь клики по порядку, цифровые клавиши, «Остальные примерно равны», селектор «Сравнивать за раз», undo и «Ещё раунд»;
  - рецепт — [`.claude/skills/verify/SKILL.md`](../../.claude/skills/verify/SKILL.md).

## История
- [спека 01](../specs/01-phase-tournament.md) — три схемы, выбор лево/ничья/право, слепой режим, ничьи без общих мест
- [спека 04](../specs/04-video-support.md) — видео-треки и смешанные турниры
- [спека 05](../specs/05-roles-cabinet.md) — роли и квоты на архивы
- [спека 18](../specs/18-group-ranking.md) + [задачи фазы 18](../phases/phase-18-tasks.md) — группы 2–7, `ComparisonBatch`, швейцарка от лога, `bonusOpponents`, определённость порядка
