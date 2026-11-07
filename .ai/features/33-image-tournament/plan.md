# План

Порядок — снизу вверх: домен → данные и сервис → API и MCP → сайт → SDK → проверка.
Новое поведение пишется через TDD: сначала красный тест.

## 1. Engine v2 и прежние алгоритмы

- [x] Файлы: `src/lib/domain/engines/{index,types,merge,swiss,round-robin}.ts`,
  `src/lib/domain/scheme-settings.ts`, `src/lib/domain/group-answer.ts`, `src/lib/domain/types.ts`.
- [x] Тесты: `engines.test.ts` и `group.test.ts` переписаны на `EngineInput` с прежними
  утверждениями. Новый `scheme-settings.test.ts` проверяет настройки по умолчанию и отказы.
- Готово: три прежних движка на новом входе, `SCHEME_INFO` и `plannedScreens` через движок,
  юниты зелёные.

## 2. Новые алгоритмы и симуляция

- [x] Файлы: `engines/{insertion,top-k,tiers,rating,bracket}.ts`, `engines/pair-index.ts`
  (быстрый поиск ответа), `decodePickAnswer` в `group-answer.ts`.
- [x] Тесты: по одному файлу на движок (ручные случаи) и `engines/simulation.test.ts`
  (T19: точность, завершение, бюджет экранов, смена алгоритма, шумный оракул).
- Готово: восемь движков, симуляция зелёная, реальные числа экранов записаны в `verify.md`.

## 3. Данные и сервис турнира

- [x] `prisma/schema.prisma`:
  - Track: `subtitle`, `sourceUrl`, `sourceKey`, `note`, `excluded`;
  - Segment: `scheme`, `schemeSettings`, `insertBase`;
  - Tournament: `schemePending`, `schemeSettings`;
  - Batch: `kind`, `tier`.
  Затем `npm run db:push`.
- [x] `src/server/tournaments.ts`, `src/server/tournament-segments.ts`:
  - схема сегмента, срез без исключённых;
  - `nextComparison` с видами вопроса;
  - `recordAnswer` (rank, pick, tier), undo корзины;
  - `setSegmentScheme`, `setTier`;
  - исключение и возврат, `insertBase`;
  - `finalize` и рейтинг только placed, `reorderRanking`.
- [x] Тест: `src/integration/tournament-algorithms.integration.test.ts`. Пять сценариев:
  - pick/tier и undo;
  - смена алгоритма без потери ответов;
  - «для всех сегментов»;
  - исключение в готовом сегменте;
  - добавление в готовый сегмент вставкой.
  Регрессия: прежние интеграционные тесты турнира.
- Готово: сервис проходит новые и старые интеграционные тесты.

## 4. Участники-картинки: импорт

- [x] Файлы:
  - `src/lib/upload.ts` — картинки архива и россыпь, `inspect`;
  - `src/server/tournament-items.ts` — источники, Shikimori пачками, пул, диск, повторы,
    `skipped`, добавление и удаление;
  - `src/lib/shikimori.ts` — `fetchShikimoriCards`;
  - `src/server/track-metadata.ts` — `subtitle`, `note`, `excluded`;
  - создание турнира с картинками.
- [x] Тесты: `upload` (юнит, архив картинок), `tournament-items.integration.test.ts`
  на локальном стенде Shikimori.
- Готово: картинки из архива, пула, диска и Shikimori становятся участниками с обложкой,
  повтор отклонён, сбой одного Shikimori-участника уходит в `skipped`.

## 5. HTTP API

- [x] Файлы:
  - маршруты `next`, `compare`, `scheme`, `tier`, `items`, `tracks/[id]`, `tournaments` (POST),
    `inspect`;
  - `tracks/[id]/cover?size=thumb`;
  - `shikimori/characters`;
  - `scripts/e2e-run.mjs`.
- [x] Тест: HTTP-интеграция `tournament-images-http.integration.test.ts`. Создание из картинок,
  pick/tier через `compare`, `scheme`, миниатюра.
- Готово: HTTP-контракт T14.

## 6. MCP

- [x] Файлы: `src/mcp/tournament-tools.ts` (items, три новых инструмента, рецепт),
  `src/mcp/instructions.ts`, тесты списка имён.
- [x] Тест: `tournament-mcp.integration.test.ts` дополнен Shikimori-, pool- и path-картинками,
  `items_add/update/remove`, отсутствием ответов у агента.
- Готово: настоящий stdio создаёт базу персонажей.

## 7. Сайт

- [x] Файлы:
  - `CreateTournamentForm.tsx` — источники и черновик;
  - `SchemeChooser.tsx`;
  - `ParticipantGrid.tsx` — «Состав»;
  - `compare/page.tsx` — rank/pick/tier, картинки, увеличение, предзагрузка;
  - `TierBoard.tsx`;
  - `ResultsPanel.tsx`, `[id]/page.tsx`;
  - `SegmentEditor.tsx` — превью;
  - стили.
- [x] Тесты: чистые помощники клиента (`compare-state`, `scheme-chooser`) юнитами.
  Живой прогон — в QG.
- Готово: сценарии 1–6 спеки проходят в браузере на 390px и на десктопе.

## 8. SDK

- [x] Файлы: `src/video/{types,schema,nodes}.ts` (поля и источники участника),
  `src/server/studio/sources.ts`, `src/video/examples` (`top-images`), выдача `video_source_list`.
- [x] Тесты: `segments.test.ts` и `instructions.test.ts` (пример компилируется),
  `studio-segments.integration.test.ts` (источник из картинок без звука, подписи, корзина).
- Готово: проект по турниру картинок валиден, кадр показывает картинку и подпись.

## 9. QG и ревью

- [x] Тройка: `npm test` → `npm run build` → `npx tsc --noEmit`.
- [x] Живые проверки по `verify`:
  - сайт — сценарии 1, 3–6 и 390px;
  - настоящий MCP — сценарий 1 на живом Shikimori с профилем владельца;
  - SDK — проект по турниру картинок, кадры и звук музыки.
- [x] Ревью свежим субагентом, исправления, «Что посмотреть руками» в `verify.md`.

## 10. Знания

- [x] Карточки `.ai/map/`: `tournament.md`, `media.md`, `shikimori.md`, `mcp.md`,
  `studio-sdk.md`, `dev-env.md`. Гид агента [sdk-guide.md](sdk-guide.md).
  Строка в `.ai/history.md` при вливании.
