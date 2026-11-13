# План

**Цель:** ядро douga — пакеты `@douga/*`, которые используют и сайт douga, и asobiba.
Интерактивный слой, данные партии, нарезка, hit-test, управляемый плеер, интерактивный снимок,
копия проекта и MCP — по [tech.md](tech.md).

**Подход:** сначала механический перенос в пакеты с проверкой, что IR и кадры не изменились.
Потом новые возможности поверх пакетов, каждая — с тестами. Живая проверка сквозная,
вместе с asobiba 07.

## Задачи

- [x] **1. Workspaces и перенос.**
  - Файлы: `package.json` (`workspaces`), `packages/{video,render,player,node}/package.json`,
    `git mv src/video packages/video/src`, `git mv src/remotion packages/render/src`
    (кроме `Root.tsx`/`index.ts` → `src/remotion-entry/`), `src/watch/model.ts` → `packages/player/src/`.
  - Замена импортов `@/video`, `@/remotion`, `../video`, `../src/video`. Правки в `next.config.mjs`
    (`transpilePackages`), `vitest.config.ts`, `engine.ts`, `studio-render-child.ts`.
  - Тесты: весь `npm test`, IR всех пресетов × FPS до и после (снимок JSON), `npm run test:visual`.
  - Готово, когда IR побайтно равен, визуальная регрессия зелёная, `build` и `tsc` зелёные.
- [x] **2. `@douga/node`.**
  - `createMeasureTextFromFiles(files)` с проверкой SHA-256. `typography-fonts.ts` строится на нём.
  - Тесты: прежние тесты типографики и новый на неверный хэш.
- [x] **3. Интерактивный слой и `MatchData`.**
  - `packages/video/src/interactive*.ts`: схема, `applyMatchData`, привязки `participant.votes`,
    `participant.pickedBy`, `player.*`, `match.text.*`, контейнер `repeat:"players"`, `order:"rank"`.
  - Тесты: схема и ошибки, no-op без слоя, перестановка по rank, привязки, бюджеты.
- [x] **4. План с интерактивом и нарезка.**
  - `plan.interaction` (моменты через `anchorFrame`, выборы), `slicePlan`.
  - Тесты: кадры моментов, выборы по карточкам picker и топа, нарезка медиа, шрифтов, аудио и переходов.
- [x] **5. `hitTest` и `InteractivePlayer`.**
  - `packages/render/src/hit-test.ts`, `packages/player/src/InteractivePlayer.tsx` и общий хук
    предзагрузки. `WatchPlayer` на том же ядре.
  - Тесты: hit-test на анимированных карточках, целевой кадр по часам и hold.
- [x] **6. Интерактивная публикация и формат снимка.**
  - Модель `StudioInteractivePublication`, сервис публикации с кадрами сцен, манифест
    `douga-interactive-snapshot@1`, маршруты `/api/interactive/<token>/…`, защита снимка.
  - Тесты: формат и хэши, статусы, 404 и 409, снятие.
- [x] **7. Копия проекта и `matchData` в заданиях.**
  - `copyStudioProject`, маршрут HTTP. `matchData` в storyboard, review, still, clip, audio и timeline.
  - Тесты: копия не трогает исходник, `matchData` не пишется в документ, ключ повторного задания его учитывает.
- [x] **8. Рецепты и короткая форма.**
  - 15 рецептов `recipe.interactive.*`, часть `interactive` в `video_content_set`,
    визуальные фикстуры на новые рецепты.
- [x] **9. MCP.**
  - `video_project_copy`, `video_interactive_publish/get/unpublish`, раздел `interactive`
    в `video_capabilities`, `matchData`.
  - HTTP-транспорт `/api/mcp` с токенами `dga_…` (модель `ApiToken`, выпуск в кабинете).
- [x] **10. Проверка.**
  - QG по `verify`. Живьём: копия, раскадровка на данных, публикация, импорт в asobiba,
    клип и кадры, HTTP MCP по токену.
  - Ревью, исправления, `verify.md`.
- [x] **11. Знания.** Карточки `studio-sdk`, `render`, `mcp`, `roles`, `dev-env`, строка в `AGENTS.md`.

## Живые проверки

- `npm run test:visual` и сравнение IR до и после переноса.
- Сайт douga: студия, `/watch`, офлайн-`.html` после переноса.
- Сквозной путь с asobiba: интерактивная копия, публикация, импорт по токену, партия.
- MCP: stdio-драйвер и HTTP по токену.
