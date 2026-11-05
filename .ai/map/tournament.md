# Турнир сравнений

Путь Douga «топ из личных предпочтений». Пользователь грузит один или несколько ZIP с OST (аудио и/или видео), делит треки на независимые сегменты и слушает их. На каждом экране он выбирает лучший из пары или ранжирует группу до 7 треков. Движок выводит строгий топ без общих мест. Дальше видео собирает SDK: кнопка «Создать видео через SDK» или агент, который находит турнир по названию.

## Где код

- [`src/lib/domain/engines/`](../../src/lib/domain/engines/) — интерфейс `Engine` и `createEngine` ([`index.ts`](../../src/lib/domain/engines/index.ts)), движки [`swiss.ts`](../../src/lib/domain/engines/swiss.ts), [`round-robin.ts`](../../src/lib/domain/engines/round-robin.ts), [`merge.ts`](../../src/lib/domain/engines/merge.ts)
- [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts) — `Scheme`, статусы, `Comparison {a, b, result}` (`a`|`b`|`draw`)
- [`src/lib/domain/comparisons.ts`](../../src/lib/domain/comparisons.ts) — `lookup` (побеждает первый ответ), очки 1/0.5/0, `rankByScore` (очки → личная встреча → победы → порядок загрузки), `opponentCounts` (разные соперники, а не ряды)
- [`src/lib/domain/group-answer.ts`](../../src/lib/domain/group-answer.ts) — `MIN/MAX_GROUP_SIZE` = 2/7, `clampGroupSize`, `decodeGroupAnswer`, `validateGroupAnswer`, `targetComparisonsPerItem` = ⌈log₂ N⌉, `plannedScreens`
- [`src/lib/domain/order-coverage.ts`](../../src/lib/domain/order-coverage.ts) — `orderCoverage`: доля расставленных пар, противоречия, треки в циклах
- [`src/server/tournaments.ts`](../../src/server/tournaments.ts) — сервис: `createTournament`, `getTournament`, `nextComparison`, `recordGroupAnswer`, `undoLastAnswer`, `setGroupSize`, `extendPlan`, `finalize`, `reorderRanking`, `deleteTournament`
- [`src/server/tournament-segments.ts`](../../src/server/tournament-segments.ts) — `ensureTournamentSegments`, загрузка полного турнира, прогресс сегментов и `updateTournamentSegments`; [`track-metadata.ts`](../../src/server/track-metadata.ts) — строгая схема и `updateTrackMetadata`
- [`src/lib/upload.ts`](../../src/lib/upload.ts) — `extractTracksFromZip`/`extractTrackFromBuffer`: теги music-metadata, альбом и встроенная обложка; `archiveFolders`/`groupArchiveTracks` — разбивка без общего корня, `inspectTrackArchive` — просмотр структуры ZIP
- [`src/app/api/tournaments/`](../../src/app/api/tournaments/) — `POST` создание (повторные multipart `file`, JSON `segmentTitles`, `splitFolders=true`, `scheme`, `groupSize`, `blindMode`); `POST inspect` → `{folders,trackCount}` без создания. В `[id]/`: `PATCH {groupSize}`, `DELETE`, `GET next`, `POST compare|undo|extend|finalize|reorder`, `GET/PUT segments`
- [`src/app/api/tracks/[id]/route.ts`](../../src/app/api/tracks/[id]/route.ts) — `PATCH {title?,artist?,comment?,bestMomentSec?,coverArtId?}`; [`cover/route.ts`](../../src/app/api/tracks/[id]/cover/route.ts) — `GET` обложки с Range, только владельцу
- [`src/app/api/tracks/[id]/audio/route.ts`](../../src/app/api/tracks/[id]/audio/route.ts) — отдаёт файл трека (и видео) с Range, только владельцу
- UI [`src/app/tournaments/`](../../src/app/tournaments/): список и [`CreateTournamentForm.tsx`](../../src/app/tournaments/CreateTournamentForm.tsx) (оценка экранов), обзор [`[id]/page.tsx`](../../src/app/tournaments/[id]/page.tsx), экран [`[id]/compare/page.tsx`](../../src/app/tournaments/[id]/compare/page.tsx), топ-N и ручной порядок [`[id]/ResultsPanel.tsx`](../../src/app/tournaments/[id]/ResultsPanel.tsx). [`SegmentEditor.tsx`](../../src/app/tournaments/SegmentEditor.tsx) — разбивка, drag и мультивыбор; [`TrackControls.tsx`](../../src/app/tournaments/TrackControls.tsx) — прослушивание и metadata; [`ImageChoice.tsx`](../../src/app/tournaments/ImageChoice.tsx) — картинка из пула/импорта. На результатах drag мест, стрелки и кнопка SDK
- Права и квоты: [`src/lib/domain/permissions.ts`](../../src/lib/domain/permissions.ts) — `tournament:create`; у пользователя 1 турнир и архив до 100 МБ, у админа число не ограничено, архив до 10 ГБ

## Данные

- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `Tournament` — общие `scheme`, `blindMode`, `groupSize` (по умолчанию 2); `status` агрегирует сегменты. Старые `topSize`/`bonusOpponents` сохраняются для совместимости одного сегмента
  - `TournamentSegment` — `tournamentId`, `title`, `subtitle`, `posterArtId`, `order`, свои `status`, `topSize`, `bonusOpponents`
  - `Track` — nullable `segmentId`, `kind` (`audio`|`video`), `order` внутри сегмента; `album`, `sourceFolder`, `comment`, `bestMomentSec`, `coverPath`, `coverArtId`
  - `ComparisonBatch` — один экран: nullable `segmentId`, `size`, `itemIds` (JSON в порядке показа)
  - `Comparison` — `trackAId`, `trackBId`, `result`; `batchId` пуст у рядов до фазы 18
  - `Ranking` — nullable `segmentId`, `@@unique([tournamentId, trackId])`; места локальны сегменту
  - `posterArtId` и `coverArtId` — FK к `Art` с `onDelete: Restrict`; сервис принимает только собственные картинки
- Файлы: `storage/tournaments/<tournamentId>/tracks/<trackId><ext>`, встроенная обложка — `<trackId>-cover.<ext>`. `Track.sizeBytes` включает её размер. Файлы удаляются вместе с турниром

## Как устроено

- При первой загрузке старого турнира `ensureTournamentSegments` создаёт «Все треки» и переносит туда треки, батчи и рейтинги. Сохранённый ручной порядок и очки не пересчитываются. Сегмент с одним треком готов сразу; пустой сегмент допустим как черновик.
- `getTournament(userId,id,segmentId?)` возвращает совместимый с движком активный срез `tracks/comparisons/batches/rankings`, его `status/topSize/bonusOpponents`, `activeSegmentId`, агрегат `tournamentStatus` и полный `segments[]`. Каждый сегмент содержит `tracks`, `trackCount`, `answeredScreens`, `progress`. Без ID выбирается первый сегмент; неизвестный/чужой ID даёт `null`.
- Сайт хранит выбор в `?segmentId=…`. Маршруты сравнений/результатов принимают его в query, мутации также в body; старые вызовы без него работают с первым сегментом. `next` отдаёт `segmentTitle` и metadata треков.
- `GET segments` отдаёт `{segments,activeSegmentId}`. `PUT` принимает полный состав `{segments:[{id?,title,subtitle?,posterArtId?,trackIds}],confirmReset?}`. Каждый трек обязан встретиться ровно один раз; дубликаты, пропуски и чужие ID отклоняются.
- При переносе снимаются целые экраны, чьи `ComparisonBatch.itemIds` содержат перенесённый трек, и отдельные legacy-пары с ним. Сначала ответ `{requiresConfirmation:true,answersToReset:N}`; N — экраны, не число пар. Применение с `confirmReset:true` заново проверяет состав и N под writer-lock в транзакции. Остальные ответы сохраняются; рейтинги, topSize и бонус изменённых сегментов сбрасываются.
- Импорт: несколько архивов становятся сегментами с именами файлов/`segmentTitles`; один делится по папкам только при `splitFolders=true`, иначе «Все треки». `POST inspect` читает только ZIP entries и возвращает доступные папки без общего корня. HTTP проверяет сумму размеров архивов; сервис заново проверяет роль, число турниров и сумму распакованных треков с обложками по `maxArchiveBytes`.
- `PATCH` трека меняет только разрешённые metadata; лучший момент неотрицателен и не превышает известную длительность. Обложка из пула приоритетнее встроенной. Подготовка через MCP описана в [mcp.md](mcp.md); агент не отвечает на сравнения и не задаёт места.
- Движки чистые. Ответ выводится только из треков (в порядке загрузки) и лога сравнений. Чтобы продолжить турнир, лог проигрывается заново.
- Экран отправляется как `POST compare {ranked, rest, segmentId?}`. Сервис сверяет его с тем, о чём движок спрашивает сейчас; устаревший экран получает `GROUP_MISMATCH`. Перед проверкой сервис перечитывает актуальный сегмент под writer-lock. Затем `decodeGroupAnswer` раскладывает ответ в C(k,2) пар: `ranked` выигрывает у всех, `rest` — ничьи между собой. Пары, которые уже есть в логе, пропускаются. Всё пишется в одну `ComparisonBatch` в транзакции. Ничья в паре — это `ranked: []`, `rest: [a, b]`.
- Швейцарка сортирует кандидатов: меньше соперников, потом больше очков, потом раньше загружен. Сид группы — первый трек, у которого меньше ⌈log₂ N⌉ + `bonusOpponents` разных соперников. Группу добирают треками, которые ни с кем из неё ещё не встречались.
- Круговая жадно идёт в порядке загрузки, пока не сыграны все пары. Merge — сортировка слиянием через `NeedComparison` с `maxGroupSize = 2`.
- Действующий k = min(`clampGroupSize`, `engine.maxGroupSize`). Его меняют на ходу через `PATCH`; новый k действует со следующего экрана.
- «Ещё раунд» (`extend`) прибавляет к `bonusOpponents` k − 1 соперников. Бонус считается в соперниках, а не в раундах. Кнопка доступна, только пока движку есть что спросить.
- Прогресс считается в экранах: батчи плюс старые ряды без `batchId`. Оценка = max(сделано + текущий экран, `plannedScreens`).
- `finalize`:
  - первый вызов пишет `Ranking` и ставит `status=completed` выбранному сегменту; повторные меняют только его `topSize`;
  - `reorderRanking` задаёт ранги вручную;
  - рейтинг SDK читает сам (`reconcileSource`), отдельная копия порядка не хранится.

## Грабли

- Лог и батчи читай с сортировкой `[{createdAt: "asc"}, {id: "asc"}]`. SQLite хранит время с точностью до миллисекунды. От порядка зависят `lookup` (побеждает первый ответ) и то, какой экран снимет undo.
- Не возвращай швейцарке симуляцию расписания по раундам. После смены k посреди прогона она восстановит расписание, которого не было. При k=2 порядок вопросов тоже немного отличается от старой парной схемы: очки обновляются внутри раунда.
- Завершённый сегмент не открывается от обычных сравнений; изменение состава может снять его готовность:
  - `nextComparison` при `completed` отдаёт `question: null`;
  - undo отвечает `ALREADY_FINALIZED`;
  - `finalize` не перепроверяет движок: старая швейцарка по новому правилу может оказаться на одно сравнение короче;
  - ranking не пересчитывается, чтобы не стереть ручной порядок.
- Транзитивный вывод не делаем. `orderCoverage` строит замыкание на битсетах. Ничья не задаёт порядок. Пары, достижимые в обе стороны, идут в `contradictory`, а не разрешаются. Живые предпочтения нетранзитивны.
- Undo снимает экран целиком: `ComparisonBatch` удаляется вместе со своими `Comparison`. Если время совпадает, батч считается новее старого ряда.
- Ответы пишет только `recordGroupAnswer` (`POST compare {ranked, rest}`). Старый попарный `recordComparison` удалён в задаче 23.
- Турнир, на который ссылается `StudioAssetReference`, не удаляется: ответ 409 `STUDIO_SOURCE_IN_USE`. Studio читает `Ranking` и `topSize` ([`sources.ts`](../../src/server/studio/sources.ts)). `reorderRanking` меняет только локальные ранги сегмента и обновляет `Tournament.updatedAt`.
- ZIP целиком читается в память. Модули `src/server/*` с `import "server-only"` не грузятся вне Next. Для tsx используй `tsconfig.mcp.json`, для Vitest стаб уже задан в конфиге.
- [`scripts/e2e-run.mjs`](../../scripts/e2e-run.mjs) проходит турнир по HTTP: читает `next.question` и ранжирует экран в порядке показа (`{ranked: question.map(t => t.id), rest: []}`). `BASE` по умолчанию `http://localhost:3000`.

## Как проверить

- Юниты: `npx vitest run src/lib/domain/engines src/lib/domain/comparisons.test.ts src/lib/domain/group-answer.test.ts src/lib/domain/order-coverage.test.ts`
- Интеграция (пишет в `prisma/dev.db`, ту же базу, что у dev-сайта): `npx vitest run src/integration/group-ranking.integration.test.ts src/integration/flow.integration.test.ts src/integration/tournament-segments.integration.test.ts src/integration/tournament-segments-http.integration.test.ts`
- Живая проверка:
  - `node scripts/e2e-setup.mjs` создаёт пользователя `e2e@test.local` и `/tmp/e2e/ost.zip`;
  - проверь несколько ZIP с именами, один ZIP с папками и редактор разбивки: мультивыбор/drag, альбомы, постер, подтверждение числа снимаемых экранов;
  - открой разные сегменты, проверь независимый прогресс и результаты, drag мест, прослушивание, лучший момент, комментарий и обложку;
  - создай турнир в `/tournaments`, затем открой `/tournaments/<id>/compare` с k > 2;
  - проверь клики по порядку, цифровые клавиши, «Остальные примерно равны», селектор «Сравнивать за раз», undo и «Ещё раунд»;
  - рецепт — [`.claude/skills/verify/SKILL.md`](../../.claude/skills/verify/SKILL.md).

## История

- [спека 01](../specs/01-phase-tournament.md) — три схемы, выбор лево/ничья/право, слепой режим, ничьи без общих мест
- [спека 04](../specs/04-video-support.md) — видео-треки и смешанные турниры
- [спека 05](../specs/05-roles-cabinet.md) — роли и квоты на архивы
- [спека 18](../specs/18-group-ranking.md) + [задачи фазы 18](../phases/phase-18-tasks.md) — группы 2–7, `ComparisonBatch`, швейцарка от лога, `bonusOpponents`, определённость порядка
- [задача 27](../features/27-segments/README.md) — независимые сегменты, импорт, редактор, metadata и подготовка через MCP

## Плеер турнира

[`MediaPlayer.tsx`](../../src/app/tournaments/MediaPlayer.tsx) — общий тёмный плеер сравнений, результатов и редактора: play/pause, время, range seek, mute и volume.
HTMLAudio/Video декодируют медиа без нативной белой панели. Длительность сначала из импорта, затем из реальной metadata; известное аудио preload:none.
Запуск одного трека ставит остальные на паузу. Клавиши range работают нативно; лучший момент читает currentTime того же media element.
Тесты: `src/app/tournaments/media-player.test.ts`; живая проверка — seek до старта, переключение, volume0→unmute, лучший момент, раскладки 390px и desktop.
