# Окружение разработки

Карточка о том, как поднять Douga локально, где лежат база и файлы и чем проверять изменения. Сайт (`next dev`), очередь SDK (`studio:worker`) и MCP-сервер (`mcp`) — это отдельные процессы. Все три работают с одной SQLite-базой `prisma/dev.db` и одним каталогом `storage/`.

## Где код
- [`package.json`](../../package.json) — скрипты:
  - `dev` (это `prisma generate && next dev`, порт 3000), `build`, `start`;
  - `test` (`vitest run`), `test:watch`, `db:push`, `db:generate`;
  - `studio:worker` и `mcp` запускаются через `tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json`.
- [`.env.example`](../../.env.example) — шаблон `.env`. Сам `.env` лежит в `.gitignore`.
- [`prisma/schema.prisma`](../../prisma/schema.prisma) — схема. Каталога миграций нет, схема применяется только через `db push`.
- [`src/lib/db.ts`](../../src/lib/db.ts) — общий `PrismaClient`. В dev он кэшируется в `globalThis`.
- [`src/lib/storage.ts`](../../src/lib/storage.ts) — `STORAGE_ROOT = <cwd>/storage`, `absPath` и пути треков, артов и рендеров.
- [`src/lib/api-errors.ts`](../../src/lib/api-errors.ts) — `serverError`: отдаёт JSON 500 с подсказкой `staleClientHint` из [`prisma-drift.ts`](../../src/lib/domain/prisma-drift.ts).
- [`src/lib/ytdlp.ts`](../../src/lib/ytdlp.ts) — `ensureYtDlp` ищет бинарник по порядку: `YTDLP_PATH`, затем `storage/bin/yt-dlp`, иначе скачивает релиз с GitHub.
- [`scripts/studio-worker.ts`](../../scripts/studio-worker.ts) — цикл очереди SDK, флаги `--once` и `--job ID`.
- [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs) — проверка задания SDK через настоящий MCP ([studio-sdk.md](studio-sdk.md)).
- [`next.config.mjs`](../../next.config.mjs) — Remotion, `ffmpeg-static` и `music-metadata` исключены из серверного бандла.
- [`tsconfig.mcp.json`](../../tsconfig.mcp.json) — для процессов под tsx подменяет `server-only` стабом [`src/test/server-only-stub.ts`](../../src/test/server-only-stub.ts).

## Переменные `.env`
- База и вход: `DATABASE_URL` (путь `file:./dev.db` отсчитывается от `prisma/`), `AUTH_SECRET`, `AUTH_TRUST_HOST`, `ADMIN_EMAILS` ([roles.md](roles.md)).
- Рендер: `REMOTION_BROWSER_EXECUTABLE` — путь к Chrome или Chromium.
- Импорт по ссылке:
  - `YTDLP_PATH`;
  - `YTDLP_PROXY` — нужен, когда сеть блокирует googlevideo.com;
  - `MEDIA_URL_ALLOW_PRIVATE=1` разрешает приватные адреса при импорте картинок. В шаблоне этой переменной нет, она описана в README.
- Shikimori:
  - `SHIKIMORI_BASE_URL` — домен сервиса периодически переезжает;
  - `SHIKIMORI_USER_AGENT`;
  - `SHIKIMORI_RETRY_MS` — тестовый хук, сокращает паузы между повторами.
- MCP: `MCP_ACTOR_EMAIL` ([mcp.md](mcp.md)) и `MCP_LOCAL_MEDIA_DIRS` (папки через `:`, `~/` поддерживается; если пусто, доступа к диску нет).
- Как читается `.env`: Next загружает его сам, `studio:worker` и `mcp` — через флаг `--env-file-if-exists`. Явно переданные переменные окружения важнее. Скрипты `scripts/e2e-*.mjs` берут адрес сервера из `BASE`.

## Данные
- SQLite-база `prisma/dev.db`, модели описаны в [schema](../../prisma/schema.prisma). Копии базы в `storage/backups/` сделаны вручную, код туда не пишет.
- `storage/` лежит в `.gitignore`. Пути в БД хранятся относительно него:
  - `tournaments/<id>/tracks/` — треки архивов; `arts/<userId>/` — пул медиа вместе с постерами;
  - `renders/<jobId>.mp4` и `renders/tmp/<jobId>/` — прежний рендер; `assets/tick.wav` — тик таймера пикера;
  - `downloads/tmp/<jobId>/` — загрузки yt-dlp; `tmp/` — импорт по ссылке и с диска; `bin/yt-dlp` — собственный бинарник;
  - `studio/<userId>/<projectId>/versions/…` и `studio/builtin/` — студия SDK; `studio-jobs/<userId>/<jobId>` — результаты заданий; `studio-engines/` — собранные движки;
  - `studio-verification/<run>` — куда `verify-studio.mjs` пишет результат по умолчанию.
- `output/` тоже в `.gitignore`, но код его не использует: в `src/` и `scripts/` нет ни одной ссылки на него. Это ручная папка для готовых роликов.

## Как устроено
- Первый запуск: `npm install`, `cp .env.example .env`, `npx prisma generate`, `npx prisma db push`, `npm run dev`.
- Схема: после правки `schema.prisma` выполни `npx prisma db push && npx prisma generate` и перезапусти dev-сервер. Если запущены `studio:worker` и `mcp`, их тоже. Сам `npm run dev` делает только `generate`.
- Устаревший клиент Prisma падает с `Unknown argument <поле>`. `serverError` превращает это в ответ 500 с текстом `staleClientHint`, а [`prisma-client.test.ts`](../../src/lib/prisma-client.test.ts) ловит забытый `generate` в `npm test`.
- Рендер MP4 (Remotion) берёт браузер из `REMOTION_BROWSER_EXECUTABLE`. Без переменной Remotion скачивает chrome-headless-shell из сети; скачать заранее можно командой `npx remotion browser ensure`. Без браузера работает всё, кроме рендера.
- Очередь SDK: сайт и MCP только ставят задание, выполняет его `npm run studio:worker`. В разработке нужны два терминала: `dev` и воркер. Тяжёлый слот один на всех (`StudioWorkerLease`). Одно задание отдельно: `npm run studio:worker -- --once --job JOB_ID`.
- Node 22: флаг `--env-file-if-exists` есть не во всех версиях Node. Команды SDK проверены на 22.23.2.
- Тесты, настройки в [`vitest.config.ts`](../../vitest.config.ts):
  - файлы `src/**/*.test.ts`, среда node, `fileParallelism: false`, `server-only` заменён стабом;
  - `DATABASE_URL` указывает на `prisma/dev.db`, то есть тесты пишут в ту же базу, что и dev-сайт. `TEST_DATABASE_URL=file:/abs/copy.db` направляет прогон в копию базы: так несколько агентов гоняют свои файлы параллельно. Итоговый QG идёт на `dev.db`;
  - юниты лежат рядом с кодом, интеграционные — в [`src/integration/`](../../src/integration/), хелперы — в [`src/test/`](../../src/test/).
- Обязательная тройка после последних правок, в этом порядке: `npm test` → `npm run build` → `npx tsc --noEmit`. Для правок только в доках её не гоняют. Подробнее — в [verify](../../.claude/skills/verify/SKILL.md).

## Грабли
- Порт 3000. Перед `npm run dev` выполни `lsof -nP -iTCP:3000 -sTCP:LISTEN`: у владельца часто уже работает свой сервер, тогда пользуйся им. Второй Next уйдёт на 3001, но каталог `.next` у них общий. Процессы перетирают друг другу CSS-чанки, и вёрстка ломается. Если серверы всё же пересеклись: останови все процессы `next`, выполни `rm -rf .next`, подними один сервер и проверь, что CSS-чанк из HTML отдаёт 200.
- `npm run build` пишет в тот же `.next`, поэтому после сборки dev-сервер нужно перезапустить. `npx tsc --noEmit` запускай, когда build закончится: пока `.next/types` пересоздаётся, tsc падает с TS6053 (журнал фазы 21).
- Не держи общий `studio:worker` запущенным во время интеграционных тестов и `verify-studio.mjs`: он перехватывает их задания.
- Полный `npm test` занимает `prisma/dev.db` и идёт около 7 минут (978 тестов на фазе 21). Если тесты падают на блокировке SQLite, а на 3000 работает dev-сервер владельца, спроси владельца, прежде чем его останавливать.
- Тесты импорта (`downloads`, `studio-imports`) требуют настоящий `storage/bin/yt-dlp` и сами его не скачивают. На свежем клоне положи бинарник в `storage/bin/yt-dlp`. Туда же его скачивает `ensureYtDlp`, если `YTDLP_PATH` не задан.
- Перезапуск dev-сервера обрывает идущие `DownloadJob`. Задание, которое не обновлялось дольше 10 минут, показывается как failed.
- Уже запущенная сессия Claude Code не подхватывает [`.mcp.json`](../../.mcp.json) (сервер `douga` → `npm run --silent mcp`). Перезапусти клиент или гоняй сервер stdio-драйвером.
- `e2e-setup.mjs` удаляет `e2e@test.local` со всеми данными и создаёт заново с ролью admin. `e2e-run` и `e2e-render` по умолчанию обращаются к порту 3100, `e2e-verify` — к 3300, поэтому задавай `BASE`.

## Как проверить
- Тесты: `npm test`, точечно `npx vitest run src/lib/prisma-client.test.ts src/lib/domain/prisma-drift.test.ts`. Затем `npm run build` и `npx tsc --noEmit`.
- Живой сайт: по [verify-скиллу](../../.claude/skills/verify/SKILL.md). Тестовый аккаунт: `node scripts/e2e-setup.mjs`. `scripts/e2e-run.mjs` устарел: он ждёт `next.pair`, а API теперь отдаёт `question` ([tournament.md](tournament.md)).
- SDK: `node scripts/verify-studio.mjs --actor <email> --project ID --kind clip --seconds 3 --output storage/studio-verification/<run>`. Код выхода 2 означает, что результат больше 12 MiB и скачивать его нужно на сайте.

## История
- [спека 02](../specs/02-phase-render.md) и [исследование](../research/remotion-headless-render.md) — рендер через Remotion в headless Chrome.
- [спека 08](../specs/08-url-import.md) — yt-dlp в `storage/bin` и `YTDLP_PATH`.
- [спека 10](../specs/10-mcp-server.md) — stdio MCP, `npm run mcp`, `MCP_ACTOR_EMAIL`.
- [спека 24](../specs/24-ai-video-job-contract.md) — устойчивая очередь и `studio:worker`.
- [журнал фазы 21](../phases/phase-21-verification.md) — последние итоговые прогоны тройки проверок.
