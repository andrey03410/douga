# Сегменты — план реализации

> Исполнитель: TDD по `superpowers:test-driven-development`; независимые домены можно
> делегировать по `superpowers:dispatching-parallel-agents`. Интеграцию и живой сайт ведёт
> основной агент. Итоговое ревью — свежему ревьюеру. Всё в основном checkout `feat/27-segments`.

**Цель:** один турнир с удобными независимыми сегментами, который агент превращает в смешанный ролик.

**Архитектура:** аддитивная таблица сегментов ограничивает вход существующих движков.
V2 описывает последовательность сегментов, а v1 сохраняет прежний путь компиляции.
Источник синхронизирует готовые сегменты по стабильным ID; план общий для MP4 и HTML.

**Стек:** Next 14, React 18, Prisma 5/SQLite, Zod, Vitest, Remotion 4; новых зависимостей нет.

**Спецификация:** [product.md](product.md), интерфейсы — [tech.md](tech.md).

## Общие ограничения

- Доки и UI по-русски; код и conventional-коммиты по-английски.
- Агент не отвечает на сравнения и не ставит места (P08).
- Каждый трек всегда лежит ровно в одном сегменте.
- Схема, размер группы и слепой режим общие на весь турнир.
- Финальный render только админу. Владение и квоты проверяются сервисами.
- Пользовательские проекты/медиа владельца не менять; фикстуры только своего аккаунта в storage.
- Перед dev проверить 3000; dev/worker не держать на итоговых тестах и сборке.
- QG строго `npm test` → `npm run build` → `npx tsc --noEmit` после последних правок.
- Ворктри не создавать: .env, storage, база и node_modules используются из основного checkout.

## Фокус ревью

1. Перенос после групповых ответов: сниматься должен целый затронутый экран; другие сегменты сохраняются.
2. Старый завершённый турнир: миграция не пересчитывает ручной порядок, не открывает сравнения.
3. Параллельное редактирование: проверка состава и числа снимаемых ответов внутри транзакции.
4. Новый готовый сегмент: приезжает в уже оформленный проект, не дублирует сцены и не ломает интро/аутро.
5. Развёртка v2: бюджеты суммарные, ID уникальны; v1 сохраняет кадры и звук.

## Задачи

### 1. Турнир, импорт, сервисы и MCP

**Файлы:** `prisma/schema.prisma`, `src/lib/upload.ts`, `src/server/tournaments.ts`,
новые модули сегментов/метаданных рядом с ним, `src/server/local-media.ts`,
`src/app/api/tournaments/**`, `src/app/api/tracks/**`, `src/mcp/tournament-tools.ts`,
`src/mcp/server.ts`, `src/mcp/instructions.ts`, тесты в `src/integration/` и рядом с upload.

**Интерфейсы:** T01–T05. `getTournament(userId,id,segmentId?)` отдаёт срез с activeSegmentId,
полный segments и совместимые поля движка. `updateTournamentSegments(userId,id,{segments,confirmReset?})`.
HTTP `GET/PUT /api/tournaments/:id/segments`; PUT принимает полный состав.
`PATCH /api/tracks/:id` принимает title/artist/comment/bestMomentSec/coverArtId.
`GET /api/tracks/:id/cover` раздаёт обложку. Multipart file[] + segmentTitles + splitFolders.

- [x] Написать и запустить красные тесты независимых сегментов, старой миграции, singleton,
  переноса с подтверждением, дубликатов/чужих ID, группового undo и metadata.
- [x] Реализовать аддитивную схему, импорт тегов/обложек, срез движка и атомарную разбивку.
- [x] Добавить HTTP и четыре MCP-инструмента, не давая MCP отвечать и ранжировать.
- [x] Зелёные целевые тесты; commit `feat(tournament): add independent segments and agent preparation`.

### 2. V2, примитивы, рендер и главы

**Файлы:** `src/video/*`, `src/remotion/StudioVideo.tsx`, `src/watch/model.ts`,
`src/server/studio/timeline.ts`, `src/mcp/studio-tools.ts`, тесты SDK/рендерера/глав.

**Интерфейсы:** T06–T07. VideoSegment (id,kind,title,subtitle?,poster?,sourceSegmentId?,
participantIds?,roundIds?,scenes,settings?,audio?); SourceSegment (id,title,subtitle?,poster?,participantIds).
`CompiledVideo.segments` интервалы `[from,to)`, у сцен segmentId/segmentTitle.
`participant.bestMomentSec` > автоматического фрагмента. Остальное наследуется от документа.

- [x] Красные тесты смешанного v2, привязок, динамических медиа, наборов, blur, patch segment,
  пресета на всех сегментах, суммарных бюджетов; контрольный v1 план неизменен.
- [x] Реализовать типы/схему/компиляцию/патчи/пресеты, четыре рецепта V11.
- [x] Добавить blur в рендерер, интервалы в timeline, названия глав в watch/offline.
- [x] Зелёные целевые тесты; commit `feat(video): support segments and composable participant scenes`.

### 3. Удобный сайт

**Файлы:** `src/app/tournaments/CreateTournamentForm.tsx`, `[id]/page.tsx`,
`[id]/compare/page.tsx`, `ResultsPanel.tsx`, новые SegmentEditor/TrackEditor, `globals.css`.

**Потребляет:** HTTP и activeSegmentId задачи 1. Сегмент в URL `?segmentId=…` и телах мутаций.
Постер/обложка выбирается из пула; импорт Shikimori доступен в том же контексте.

- [x] Красные тесты утилит перестановки/разбивки и передачи segmentId в навигации.
- [x] Несколько архивов с именами сегментов, предложение разбить папки, обзор с прогрессом.
- [x] Редактор: создать/удалить/переставить сегменты; drag и мультивыбор треков; по альбомам;
  подтверждение снятия N ответов; проигрывание трека.
- [x] Результаты: drag мест и клавиатурные стрелки, ▶, лучший момент с текущего времени,
  title/artist/comment, обложка; сравнения в выбранном сегменте и лучший момент.
- [x] Целевые проверки; commit `feat(tournament): add segment editor and track controls`.

### 4. Источник студии

**Файлы:** `src/server/studio/sources.ts`, `projects.ts`, `queries.ts`, `assets.ts`,
`src/server/arts.ts`, integration studio source, формы `src/app/studio/new` при необходимости.

**Потребляет:** полный segments из БД задачи 1; типы v2 задачи 2. `track` binding получает
`media?: "cover"`; разрешение обложки учитывает coverArtId/coverPath и владение.

- [x] Красные тесты частичной готовности, metadata/постера/лучшего момента,
  прихода нового сегмента, сохранения оформления, смены рейтинга и прежнего v1.
- [x] Создавать v2 по турнирному sourceId, синхронизировать готовые сегменты и media.
- [x] Защитить удаление используемых cover/poster пула; актуализировать выдачу источников.
- [x] Зелёные целевые тесты; commit `feat(studio): reconcile completed tournament segments`.

### 5. QG, ручная приёмка и свежее ревью

**Файлы:** `verify.md`; доказательства и одноразовые драйверы — `storage/verification/27-segments/`.

- [x] Зафиксировать baseline v1 кадра и звук на прежнем движке, не меняя проект владельца.
- [x] Итоговая тройка в нужном порядке с логами и цифрами.
- [x] Пройти реальный сайт в браузере: все три входа; исправить неудобства; desktop и узкий экран.
- [x] Пройти сравнения по разным сегментам, перенос с ответами, результаты и Б1–Б6.
- [x] Настоящий stdio MCP: подготовить сегментный турнир, смонтировать топ+пикер+интро+аутро,
  проверить patch segment, metadata/наборы/blur/рецепты, auto-reconcile нового сегмента.
- [x] Реальные кадры MP4 и декодированный звук по сценам, главы watch; структура offline проверена (живой file:// заблокирован),
  сравнение v1 с baseline. Вписать пути и наблюдения в verify.md.
- [x] Свежий ревьюер смотрит всю ветку; существенное исправить и повторить необходимый QG.

### 6. Знания и вливание

- [x] Обновить `.ai/map/tournament.md`, `media.md`, `studio-sdk.md`, `render.md`, `mcp.md`, `dev-env.md`.
- [ ] Push, PR `27: Сегменты турнира и видео`; записать PR и stage: review отдельным коммитом.
- [ ] Зелёный QG и ревью → history, stage: merged, дата; commit `docs(27): merged`.
- [ ] Merge PR с удалением ветки, обновить main. Автономное разрешение уже дано.

## Принятое дополнение к задаче 3

- [x] Общий `MediaPlayer.tsx` вместо нативных контролов: тёмная тема, play/pause,
  время, seek, mute/volume; TrackControls и сравнения используют один компонент.
  RED→GREEN: SSR доступных контролов и начального времени, конечные длительности;
  вживую: play, pause другого трека, клавиши seek, mute/volume, лучший момент,
  узкая раскладка. Небольшая правка переносов шапки устраняет overflow на 390 px.
