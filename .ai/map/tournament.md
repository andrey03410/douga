# Турнир сравнений

Путь Douga «топ из личных предпочтений». Участник турнира — трек (аудио или видео) или картинка (задача 33): персонажи и аниме из Shikimori, арты пула, файлы и архивы картинок. Участники делятся на независимые сегменты. Алгоритм выбирает человек у каждого сегмента уже после создания: 8 алгоритмов с настройками, один на все сегменты или свой. Экран — ранжирование группы до 7, «выбери лучшего» или корзина для одного участника. Движок выводит строгий топ без общих мест, а у корзин и сетки часть участников остаётся без мест. Базу удобно собирает агент через MCP, места определяет только человек. Дальше видео собирает SDK: кнопка «Создать видео через SDK» или агент, который находит турнир по названию.

## Где код

- [`src/lib/domain/engines/`](../../src/lib/domain/engines/) — Engine v2 ([`types.ts`](../../src/lib/domain/engines/types.ts)): `next(input) → Question {kind: rank|pick|tier, items}`, `result(input) → {placed, unplaced[{id, tier?, stage?}]}`, `plannedScreens`, `maxGroupSize`, `partial`. `createEngine`, `engineGroupSize`, `plannedScreens` — в [`index.ts`](../../src/lib/domain/engines/index.ts). Движки: [`merge`](../../src/lib/domain/engines/merge.ts), [`swiss`](../../src/lib/domain/engines/swiss.ts), [`round-robin`](../../src/lib/domain/engines/round-robin.ts), [`insertion`](../../src/lib/domain/engines/insertion.ts), [`top-k`](../../src/lib/domain/engines/top-k.ts), [`tiers`](../../src/lib/domain/engines/tiers.ts), [`rating`](../../src/lib/domain/engines/rating.ts), [`bracket`](../../src/lib/domain/engines/bracket.ts); [`pair-index.ts`](../../src/lib/domain/engines/pair-index.ts) — быстрый поиск пар в логе
- [`src/lib/domain/scheme-settings.ts`](../../src/lib/domain/scheme-settings.ts) — `SCHEME_INFO` (название, экран, точность, «когда»), строгие zod-схемы настроек (`k` у top_k, `tiers`/`rankTop` у корзин, `accuracy` у рейтинга, `thirdPlace` у сетки), `parseSchemeSettings`/`readSchemeSettings`/`defaultSchemeSettings`
- [`src/lib/domain/segment-run.ts`](../../src/lib/domain/segment-run.ts) — одна чистая функция `runSegment` для сервиса, страниц и прогресса: действующий алгоритм (`effectiveScheme`: свой у сегмента, иначе турнирный, `null` пока ждём выбора), корзины из tier-экранов (`tierMap`), исключённые, вставка новичков в готовый порядок (overlay), `estimatedScreens`, `canExtend`
- [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts) — `Scheme` (8), статусы, `Comparison {a, b, result}` (`a`|`b`|`draw`)
- [`src/lib/domain/comparisons.ts`](../../src/lib/domain/comparisons.ts) — `lookup` (побеждает первый ответ), очки 1/0.5/0, `rankByScore` (очки → личная встреча → победы → порядок загрузки), `opponentCounts` (разные соперники, а не ряды)
- [`src/lib/domain/group-answer.ts`](../../src/lib/domain/group-answer.ts) — `MIN/MAX_GROUP_SIZE` = 2/7, `clampGroupSize`, `decodeGroupAnswer`, `validateGroupAnswer`, `targetComparisonsPerItem` = ⌈log₂ N⌉, `plannedScreens`
- [`src/lib/domain/order-coverage.ts`](../../src/lib/domain/order-coverage.ts) — `orderCoverage`: доля расставленных пар, противоречия, треки в циклах
- [`src/server/tournaments.ts`](../../src/server/tournaments.ts) — сервис: `createTournament`, `getTournament`, `nextComparison`, `recordAnswer` (rank/pick/tier; `recordGroupAnswer` — старая обёртка), `undoLastAnswer`, `setGroupSize`, `extendPlan`, `finalize`, `reorderRanking`, `setSegmentScheme`, `setTier`, `reopenForNewcomers`, `deleteTournament`
- [`src/server/tournament-items.ts`](../../src/server/tournament-items.ts) — участники: `itemSourceSchema` (`{shikimori:{type,id}}`, `{assetId}`, `{path}` + `title/subtitle/note`), `webItemSourceSchema` (сайт: без `path`), `resolveItemSources`, `addParticipants`, `deleteParticipants`, `setExcluded`; [`tournament-upload.ts`](../../src/server/tournament-upload.ts) — форма создания и добавления (архивы, файлы, черновик источников); [`participant-dto.ts`](../../src/lib/participant-dto.ts) — участник для сайта и HTTP (`imageUrl`/`thumbUrl`, у картинки `audioUrl: null`); [`tournament-errors.ts`](../../src/lib/tournament-errors.ts) — коды сервиса → русские сообщения
- [`src/server/tournament-segments.ts`](../../src/server/tournament-segments.ts) — `ensureTournamentSegments`, загрузка полного турнира, прогресс сегментов и `updateTournamentSegments`; [`track-metadata.ts`](../../src/server/track-metadata.ts) — строгая схема и `updateTrackMetadata`
- [`src/lib/upload.ts`](../../src/lib/upload.ts) — `extractTracksFromZip`/`extractTrackFromBuffer`: теги music-metadata, альбом и встроенная обложка; картинки png/jpg/webp/gif до 32 МБ становятся участниками `kind:"image"` с именем по файлу; `archiveFolders`/`groupArchiveTracks` — разбивка без общего корня, `inspectTrackArchive` — просмотр структуры ZIP (`kind: media|images`)
- [`src/app/api/tournaments/`](../../src/app/api/tournaments/) — `POST` создание (повторные multipart `file`, JSON `segmentTitles`, `splitFolders=true`, JSON `sources` — черновик `[{assetId}|{shikimori}, segment?]`, необязательные `scheme`, `groupSize`, `blindMode`) → `{id, trackCount, skipped}`; `POST inspect` → `{folders,trackCount,kind}` без создания. В `[id]/`: `PATCH {groupSize}`, `DELETE`, `GET next`, `POST compare {ranked,rest}|{pick}|{itemId,tier}`, `POST scheme {scheme,settings?,segmentId?,allSegments?}`, `POST tier {itemId,tier,segmentId?}` (доска корзин), `POST items` (multipart как создание + `segmentId`/`segmentTitle`), `DELETE items {trackIds,confirmReset?}`, `POST undo|extend|finalize|reorder`, `GET/PUT segments`. [`/api/shikimori/characters?animeId&role`](../../src/app/api/shikimori/characters/route.ts) — персонажи тайтла для формы
- [`src/app/api/tracks/[id]/route.ts`](../../src/app/api/tracks/[id]/route.ts) — `PATCH {title?,artist?,comment?,bestMomentSec?,coverArtId?,subtitle?,note?,excluded?}`: сначала подписи, потом исключение; [`cover/route.ts`](../../src/app/api/tracks/[id]/cover/route.ts) — `GET` обложки или картинки участника с Range, только владельцу; `?size=thumb` — JPEG 480px в `thumbs/`, делается один раз (временный файл + rename, не больше двух ffmpeg сразу)
- [`src/app/api/tracks/[id]/audio/route.ts`](../../src/app/api/tracks/[id]/audio/route.ts) — отдаёт файл трека (и видео) с Range, только владельцу
- UI [`src/app/tournaments/`](../../src/app/tournaments/): список и [`CreateTournamentForm.tsx`](../../src/app/tournaments/CreateTournamentForm.tsx) с [`ParticipantSources.tsx`](../../src/app/tournaments/ParticipantSources.tsx) (табы «Файлы и архивы · Пул · Shikimori», черновик с повторами, «Каждый тайтл — свой сегмент»; алгоритма в форме нет), обзор [`[id]/page.tsx`](../../src/app/tournaments/[id]/page.tsx) с [`SchemeChooser.tsx`](../../src/app/tournaments/SchemeChooser.tsx) (карточки алгоритмов с оценкой экранов, настройки, «Для всех сегментов»), [`ParticipantGrid.tsx`](../../src/app/tournaments/ParticipantGrid.tsx) («Состав»: поиск, правка, исключение, удаление, добавление) и [`TierBoard.tsx`](../../src/app/tournaments/TierBoard.tsx) (доска корзин), экран [`[id]/compare/page.tsx`](../../src/app/tournaments/[id]/compare/page.tsx) (картинки крупно, лупа и долгое нажатие, предзагрузка, корзины), топ-N, места и «Без мест» [`[id]/ResultsPanel.tsx`](../../src/app/tournaments/[id]/ResultsPanel.tsx). Чистые помощники: [`scheme-chooser.ts`](../../src/app/tournaments/scheme-chooser.ts), [`compare-state.ts`](../../src/app/tournaments/compare-state.ts), [`participant-draft.ts`](../../src/app/tournaments/participant-draft.ts). [`SegmentEditor.tsx`](../../src/app/tournaments/SegmentEditor.tsx) — разбивка, drag и мультивыбор; [`TrackControls.tsx`](../../src/app/tournaments/TrackControls.tsx) — прослушивание и metadata; [`ImageChoice.tsx`](../../src/app/tournaments/ImageChoice.tsx) — картинка из пула/импорта. На результатах drag мест, стрелки и кнопка SDK
- Права и квоты: [`src/lib/domain/permissions.ts`](../../src/lib/domain/permissions.ts) — `tournament:create`; у пользователя 1 турнир и архив до 100 МБ, у админа число не ограничено, архив до 10 ГБ

## Данные

- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `Tournament` — алгоритм по умолчанию `scheme` + `schemeSettings` (JSON), `schemePending` (база от агента ждёт выбора человека, `scheme` тогда заглушка), `blindMode`, `groupSize` (по умолчанию 4 у картинок, 2 у треков); `status` агрегирует сегменты. Старые `topSize`/`bonusOpponents` сохраняются для совместимости одного сегмента
  - `TournamentSegment` — `tournamentId`, `title`, `subtitle`, `posterArtId`, `order`, свои `status`, `topSize`, `bonusOpponents`; свой алгоритм `scheme`/`schemeSettings` (null — турнирный); `insertBase` — JSON `{base, pending, reopenedAt}`, пока новички вставляются в готовый порядок
  - `Track` — nullable `segmentId`, `kind` (`audio`|`video`|`image`), `order` внутри сегмента; `album`, `sourceFolder`, `comment`, `bestMomentSec`, `coverPath` (у картинки — сам файл), `coverArtId`; задача 33: `subtitle`, `sourceUrl`, `sourceKey` (повторы: `shikimori:character:1`, `art:<id>`), `note` (основание агента), `excluded`
  - `ComparisonBatch` — один экран: nullable `segmentId`, `size`, `itemIds` (JSON в порядке показа), `kind` (`rank`|`pick`|`tier`), `tier` (у tier-экрана; −1 — «не участвует»)
  - `Comparison` — `trackAId`, `trackBId`, `result`; `batchId` пуст у рядов до фазы 18
  - `Ranking` — nullable `segmentId`, `@@unique([tournamentId, trackId])`; места локальны сегменту
  - `posterArtId` и `coverArtId` — FK к `Art` с `onDelete: Restrict`; сервис принимает только собственные картинки
- Файлы: `storage/tournaments/<tournamentId>/tracks/<trackId><ext>`, встроенная обложка — `<trackId>-cover.<ext>`, миниатюры — `thumbs/<trackId>-<artId|own>.jpg`. `Track.sizeBytes` включает обложку. Файлы удаляются вместе с турниром

## Как устроено

- При первой загрузке старого турнира `ensureTournamentSegments` создаёт «Все треки» и переносит туда треки, батчи и рейтинги. Сохранённый ручной порядок и очки не пересчитываются. Сегмент с одним треком готов сразу; пустой сегмент допустим как черновик.
- `getTournament(userId,id,segmentId?)` возвращает совместимый с движком активный срез `tracks/comparisons/batches/rankings`, его `status/topSize/bonusOpponents`, `activeSegmentId`, агрегат `tournamentStatus` и полный `segments[]`. Каждый сегмент содержит `tracks`, `trackCount`, `answeredScreens`, `progress`. Без ID выбирается первый сегмент; неизвестный/чужой ID даёт `null`.
- Сайт хранит выбор в `?segmentId=…`. Маршруты сравнений/результатов принимают его в query, мутации также в body; старые вызовы без него работают с первым сегментом. `next` отдаёт `segmentTitle` и metadata треков.
- `GET segments` отдаёт `{segments,activeSegmentId}`. `PUT` принимает полный состав `{segments:[{id?,title,subtitle?,posterArtId?,trackIds}],confirmReset?}`. Каждый трек обязан встретиться ровно один раз; дубликаты, пропуски и чужие ID отклоняются.
- При переносе снимаются целые экраны, чьи `ComparisonBatch.itemIds` содержат перенесённый трек, и отдельные legacy-пары с ним. Сначала ответ `{requiresConfirmation:true,answersToReset:N}`; N — экраны, не число пар. Применение с `confirmReset:true` заново проверяет состав и N под writer-lock в транзакции. Остальные ответы сохраняются; рейтинги, topSize и бонус изменённых сегментов сбрасываются.
- Импорт: несколько архивов становятся сегментами с именами файлов/`segmentTitles`; один делится по папкам только при `splitFolders=true`, иначе «Все треки». `POST inspect` читает только ZIP entries и возвращает доступные папки без общего корня. HTTP проверяет сумму размеров архивов; сервис заново проверяет роль, число турниров и сумму распакованных треков с обложками по `maxArchiveBytes`.
- `PATCH` трека меняет только разрешённые metadata; лучший момент неотрицателен и не превышает известную длительность. Обложка из пула приоритетнее встроенной. Подготовка через MCP описана в [mcp.md](mcp.md); агент не отвечает на сравнения и не задаёт места.
- Движки чистые. Ответ выводится только из треков (в порядке загрузки) и лога сравнений. Чтобы продолжить турнир, лог проигрывается заново.
- Экран отправляется как `POST compare {ranked, rest}`, `{pick}` или `{itemId, tier}` (+ `segmentId?`); всё пишет `recordAnswer`. Сервис сверяет ответ с тем, о чём движок спрашивает сейчас; устаревший экран получает `GROUP_MISMATCH`. Старый `{ranked}` на pick-экране засчитывается как выбор первого, tier на rank-экране отклоняется. Перед проверкой сервис перечитывает актуальный сегмент под writer-lock. Затем `decodeGroupAnswer` раскладывает ответ в C(k,2) пар: `ranked` выигрывает у всех, `rest` — ничьи между собой. Пары, которые уже есть в логе, пропускаются. Всё пишется в одну `ComparisonBatch` в транзакции. Ничья в паре — это `ranked: []`, `rest: [a, b]`.
- Швейцарка сортирует кандидатов: меньше соперников, потом больше очков, потом раньше загружен. Сид группы — первый трек, у которого меньше ⌈log₂ N⌉ + `bonusOpponents` разных соперников. Группу добирают треками, которые ни с кем из неё ещё не встречались.
- Круговая жадно идёт в порядке загрузки, пока не сыграны все пары. Merge — сортировка слиянием через `NeedComparison` с `maxGroupSize = 2`.
- Действующий k = min(`clampGroupSize`, `engine.maxGroupSize`). Его меняют на ходу через `PATCH`; новый k действует со следующего экрана.
- «Ещё раунд» (`extend`) прибавляет к `bonusOpponents` k − 1 соперников. Бонус считается в соперниках, а не в раундах. Кнопка доступна, только пока движку есть что спросить.
- Прогресс считается в экранах: батчи плюс старые ряды без `batchId`. Оценка — `estimatedScreens`: max(сделано + текущий экран, план). У вставки новичков план считается от экранов до `reopenedAt` (`screensBefore`), поэтому оценка не растёт с каждым ответом.
- `finalize`:
  - первый вызов пишет `Ranking` (только `result.placed`; «без мест» у корзин и сетки не пишутся) и ставит `status=completed` выбранному сегменту; повторные меняют только его `topSize`, ограничивая числом мест;
  - `reorderRanking` задаёт ранги вручную;
  - рейтинг SDK читает сам (`reconcileSource`), отдельная копия порядка не хранится.

### Алгоритмы и состав (задача 33)

| Схема | Экран | Результат |
|---|---|---|
| `round_robin` Круговая | группы, пока не встретятся все пары | строгий, точнее всех; до ~12 |
| `merge` Слияние | только пары | строгий |
| `swiss` Швейцарка | группы, «Ещё раунд» | приблизительный |
| `insertion` Вставка | новичок + опорные участники топа | строгий, топ виден всегда |
| `top_k` Лучшие K (`k`) | rank и pick | строгие K мест, остальные «не вошли» |
| `tiers` Корзины (`tiers` 2–7, `rankTop`) | tier: один участник крупно | тир-лист; верхние `rankTop` корзин упорядочиваются |
| `rating` Рейтинг (`accuracy`) | группы близкой силы | строгий по силе; оценка до n=24 — сухой прогон (мемоизирован) |
| `bracket` Олимпийская сетка (`thirdPlace`) | pick в группе, финал rank | места финалистов, остальные «вылет в раунде N» |

- Алгоритм выбирает человек на странице турнира (`POST scheme`), для сегмента или `allSegments`. Ответы при смене сохраняются: новый движок дозадаёт только недостающее. Смена в готовом сегменте открывает его снова.
- Создание без `scheme` (форма сайта, MCP) ставит `schemePending`: `next` отдаёт `schemeRequired:true`, экраны начинаются после выбора. Старые клиенты со `scheme` в форме работают как раньше.
- Исключение (`excluded`) обратимо: лог остаётся, движок не видит участника; в готовом сегменте места ниже сдвигаются. «Не участвует» на корзинах — то же исключение.
- Новички и вернувшиеся в готовый сегмент встают в сохранённый порядок вставкой (`insertBase` = `{base, pending, reopenedAt}`), ручной порядок старых сохраняется, `topSize` тоже (кроме автоматической 1 у сегмента из одного участника). Корзины и сетка просто открываются. У `top_k` `runSegment` игнорирует вставку, если последний старый участник в списке вставки стоит выше K-го места, а снаружи ждут другие (кого-то исключили): тогда лог проигрывается заново, а ручной порядок не сохраняется. Это же происходит при возврате исключённого, если снаружи ждут другие. Поле меньше K и новичок выше K-го места сохраняют вставку и ручной порядок.
- Удаление с ответами, в том числе с ответом-корзиной, требует `confirmReset` (снимаются целые экраны). Повтор в сегменте по `sourceKey` отклоняется (`DUPLICATE_ITEM:<имя>`).
- Редактор разбивки (`PUT segments`, MCP `tournament_segments_update`) спрашивает и перед повторным открытием готового топа человека: `segmentsToReopen` рядом с `answersToReset`. Сегмент из одного участника «готов» автоматически и не спрашивает.
- Отмена снимает последний батч сегмента, в том числе перенос на доске корзин. Ответы, данные до вставки новичков (батчи до `reopenedAt`), не отменяются (`UNDO_BEFORE_REOPEN`); `next.canUndo` гасит кнопку и Backspace. `canUndo` читает `reopenedAt` из сохранённого `insertBase`, а не из прогона: переигранный `top_k` вставку игнорирует, а отмена её помнит.

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
- Ответы пишет только `recordAnswer` (`POST compare`). Старый попарный `recordComparison` удалён в задаче 23.
- Сайт никогда не читает диск: HTTP-источники — только пул и Shikimori (`webItemSourceSchema`). `{path}` из `MCP_LOCAL_MEDIA_DIRS` доступен лишь MCP.
- `segmentProgress` прогоняет `runSegment` по всем сегментам на каждую загрузку. На сотнях участников это миллисекунды; у рейтинга на n=2000 — около 0,3 с.
- Турнир, на который ссылается `StudioAssetReference`, не удаляется: ответ 409 `STUDIO_SOURCE_IN_USE`. Studio читает `Ranking` и `topSize` ([`sources.ts`](../../src/server/studio/sources.ts)). `reorderRanking` меняет только локальные ранги сегмента и обновляет `Tournament.updatedAt`.
- ZIP целиком читается в память. Модули `src/server/*` с `import "server-only"` не грузятся вне Next. Для tsx используй `tsconfig.mcp.json`, для Vitest стаб уже задан в конфиге.
- [`scripts/e2e-run.mjs`](../../scripts/e2e-run.mjs) проходит турнир по HTTP: при `schemeRequired` выбирает `merge` для всех сегментов, отвечает по `questionKind` (`{pick}`, `{itemId, tier:0}` или `{ranked: question.map(t => t.id), rest: []}`). `BASE` по умолчанию `http://localhost:3000`.

## Как проверить

- Юниты: `npx vitest run src/lib/domain/engines src/lib/domain/comparisons.test.ts src/lib/domain/group-answer.test.ts src/lib/domain/order-coverage.test.ts src/lib/domain/scheme-settings.test.ts src/app/tournaments src/lib/participant-dto.test.ts`. `engines/simulation.test.ts` — точность и завершение всех восьми схем на честных ответах
- Интеграция (пишет в `prisma/dev.db`, ту же базу, что у dev-сайта): `npx vitest run src/integration/group-ranking.integration.test.ts src/integration/flow.integration.test.ts src/integration/tournament-segments.integration.test.ts src/integration/tournament-segments-http.integration.test.ts src/integration/tournament-algorithms.integration.test.ts src/integration/tournament-items.integration.test.ts src/integration/tournament-images-http.integration.test.ts`
- Живая проверка:
  - `node scripts/e2e-setup.mjs` создаёт пользователя `e2e@test.local` и `/tmp/e2e/ost.zip`;
  - проверь несколько ZIP с именами, один ZIP с папками и редактор разбивки: мультивыбор/drag, альбомы, постер, подтверждение числа снимаемых экранов;
  - открой разные сегменты, проверь независимый прогресс и результаты, drag мест, прослушивание, лучший момент, комментарий и обложку;
  - создай турнир в `/tournaments`, затем открой `/tournaments/<id>/compare` с k > 2;
  - проверь клики по порядку, цифровые клавиши, «Остальные примерно равны», селектор «Сравнивать за раз», undo и «Ещё раунд»;
  - картинки: создай турнир из Shikimori (тайтл → «+ главные персонажи»), выбери алгоритм, пройди экраны rank/pick/tier, лупу и долгое нажатие, доску корзин, «Состав» (правка, исключение, добавление в готовый сегмент), результаты и «Без мест»; повтори на 390px;
  - рецепт — [`.claude/skills/verify/SKILL.md`](../../.claude/skills/verify/SKILL.md).

## История

- [спека 01](../specs/01-phase-tournament.md) — три схемы, выбор лево/ничья/право, слепой режим, ничьи без общих мест
- [спека 04](../specs/04-video-support.md) — видео-треки и смешанные турниры
- [спека 05](../specs/05-roles-cabinet.md) — роли и квоты на архивы
- [спека 18](../specs/18-group-ranking.md) + [задачи фазы 18](../phases/phase-18-tasks.md) — группы 2–7, `ComparisonBatch`, швейцарка от лога, `bonusOpponents`, определённость порядка
- [задача 27](../features/27-segments/README.md) — независимые сегменты, импорт, редактор, metadata и подготовка через MCP
- [задача 33](../features/33-image-tournament/README.md) — участники-картинки, Engine v2 и 8 алгоритмов с настройками, выбор алгоритма у сегмента после создания, исключение и вставка новичков, доска корзин, база от агента

## Плеер турнира

[`MediaPlayer.tsx`](../../src/app/tournaments/MediaPlayer.tsx) — общий тёмный плеер сравнений, результатов и редактора: play/pause, время, range seek, mute и volume.
HTMLAudio/Video декодируют медиа без нативной белой панели. Длительность сначала из импорта, затем из реальной metadata; известное аудио preload:none.
Запуск одного трека ставит остальные на паузу. Клавиши range работают нативно; лучший момент читает currentTime того же media element.
Тесты: `src/app/tournaments/media-player.test.ts`; живая проверка — seek до старта, переключение, volume0→unmute, лучший момент, раскладки 390px и desktop.
