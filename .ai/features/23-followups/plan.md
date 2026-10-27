# План

**Цель:** закрыть находки задачи 22 (T01–T16 в [tech.md](tech.md)) и влить их в `main`.

**Подход:** основу делаю сам: схему, конфиг тестов, восстановление заданий и главную.
Потом четыре агента параллельно чинят непересекающиеся зоны. Каждый пишет тесты (TDD)
и гоняет свои файлы на своей копии базы через `TEST_DATABASE_URL`. В конце на `dev.db`
идёт полный QG, затем живые проверки и свежее ревью.

## Задачи

- [x] **1. Основа.**
  - Файлы: `prisma/schema.prisma` (без `engineState`, затем `db push`), `vitest.config.ts`
    (`TEST_DATABASE_URL`), `src/server/render-jobs.ts` (`failStaleRenderJobs`), вызовы в
    `render.ts`, `render-jobs/[id]/route.ts` и `users.ts` (`listRenderRows`, `deleteRenderJob`),
    `src/app/page.tsx` → `/projects`.
  - Тесты: `render-jobs.integration.test.ts` — устаревшее задание становится failed и
    удаляется, свежее остаётся `running`.
  - Готово, когда тесты зелёные и база без колонки.
- [x] **2. SSRF yt-dlp (T01).**
  - Файлы: `src/server/media-url.ts` (экспорт `assertPublicUrl`), `downloads.ts`,
    `api/downloads/route.ts`, `src/mcp/youtube.ts`, студийный импорт.
  - Тесты: loopback, LAN и имя, которое резолвится в приватный адрес, отклоняются во всех
    трёх входах. Флаг снимает запрет.
  - Готово, когда задание не создаётся, а пользователь видит понятный текст.
- [x] **3. Рендер и пикер (T04–T06).**
  - Файлы: `render.ts`, `picker-render.ts`, `picker-plan.ts`, `render-jobs/[id]/download`,
    UI предупреждения.
  - Тесты: после рендера tmp удалён, `Content-Disposition` содержит название, у превью и
    рендера одна пригодность.
- [x] **4. Роли и кабинет (T07–T10).**
  - Файлы: `roles.ts`, `users.ts` (`setUserRole`, `deleteUser`), регистрация и вход, MCP-актор,
    админка, `/account`, контракт 24.
  - Тесты: запрет понижения, вход в другом регистре, старый аккаунт со смешанным регистром,
    удаление аккаунта с завершёнными и активными заданиями.
- [x] **5. Медиа, MCP, Shikimori, турнир (T02, T11–T13).**
  - Файлы: `art-usage.ts`, `add_tile_from_shikimori`, Shikimori GraphQL, `tournaments.ts`,
    `api/tournaments/route.ts`, `scripts/e2e-*`, `CreateProjectForm.tsx`.
  - Тесты: текст удаления для звука позиции, откат постера, повтор 429 в GraphQL.
- [x] **6. QG и ревью.** `npm test` → `npm run build` → `npx tsc --noEmit` на `dev.db`.
  Живые проверки по [verify](../../../.claude/skills/verify/SKILL.md), затем свежее ревью
  диффа ветки.
- [x] **7. Знания.** Обновить карточки `media`, `render`, `classic-video`, `roles`,
  `tournament`, `mcp`, `shikimori`, `dev-env`, `studio-sdk`, а также `history.md`.

## Живые проверки

- Сайт:
  - главная после входа ведёт на `/projects`;
  - `/api/downloads` с `http://127.0.0.1/…` отвечает 400 с текстом;
  - в кабинете есть блок «Студия»;
  - в админке у email из `ADMIN_EMAILS` стоит пометка, понизить его нельзя.
- `scripts/e2e-run.mjs` проходит против живого сервера.
- MCP: `import_youtube_audio` на приватный адрес отдаёт ошибку с текстом.
- Рендер пикера: MP4 скачивается с названием проекта, `renders/tmp/<jobId>` удалён.
