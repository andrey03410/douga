# Окружение разработки

Карточка о том, как поднять Douga локально, где лежат база и файлы и чем проверять изменения. Сайт (`next dev`), очередь SDK (`studio:worker`) и MCP-сервер (`mcp`) — это отдельные процессы. Все три работают с одной SQLite-базой `prisma/dev.db` и одним каталогом `storage/`.

## Где код

- [`package.json`](../../package.json) — скрипты:
  - `dev` (это `prisma generate && next dev`, порт 3000), `build`, `start`;
  - `test` (`vitest run`), `test:watch`, `db:push` (`prisma db push && prisma generate`), `db:generate`;
  - `postinstall` генерирует Prisma-клиент;
  - `studio:worker` и `mcp` запускаются через `tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json`.
- [`.env.example`](../../.env.example) — шаблон `.env`. Сам `.env` лежит в `.gitignore`.
- [`prisma/schema.prisma`](../../prisma/schema.prisma) — схема. Каталога миграций нет, схема применяется только через `db push`. Prisma 7.10.1, генератор `prisma-client`: клиент генерируется в `src/generated/prisma` (в `.gitignore`), импорт — `@/generated/prisma/client`, не `@prisma/client`.
- [`prisma.config.ts`](../../prisma.config.ts) — конфиг CLI Prisma 7: схема и адрес базы. Сам читает `.env`, явно заданные переменные важнее. В схеме адреса больше нет (P1012).
- [`src/lib/db.ts`](../../src/lib/db.ts) — общий `PrismaClient` и `createPrismaClient(url)`. Клиент кэшируется в `globalThis` всегда: `next start` вычисляет модуль в каждом слое сборки (страницы, обработчики, server actions), а соединение на процесс должно быть одно.
- [`src/lib/sqlite-adapter.ts`](../../src/lib/sqlite-adapter.ts) — адаптер `better-sqlite3` с обёрткой: формат дат, очередь вокруг транзакций, откат после неудачного `COMMIT` (см. «Грабли»).
- [`src/lib/database-url.ts`](../../src/lib/database-url.ts) — `DATABASE_URL` → абсолютный `file:` адрес для CLI и рантайма.
- [`scripts/script-db.mjs`](../../scripts/script-db.mjs) — клиент и удаление тестовых аккаунтов для `e2e-setup.mjs` и `clean-test-data.mjs`. Обычный `node` грузит TypeScript-клиент встроенным снятием типов (Node ≥ 22.18).
- [`src/lib/storage.ts`](../../src/lib/storage.ts) — `STORAGE_ROOT = <cwd>/storage`, `absPath` и пути треков, артов и рендеров.
- [`src/lib/api-errors.ts`](../../src/lib/api-errors.ts) — `serverError`: отдаёт JSON 500 с подсказкой `staleClientHint` из [`prisma-drift.ts`](../../src/lib/domain/prisma-drift.ts).
- [`src/lib/ytdlp.ts`](../../src/lib/ytdlp.ts) — `ensureYtDlp` ищет бинарник по порядку: `YTDLP_PATH`, затем `storage/bin/yt-dlp`, иначе скачивает релиз с GitHub.
- [`scripts/studio-worker.ts`](../../scripts/studio-worker.ts) — цикл очереди SDK, флаги `--once` и `--job ID`.
- [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs) — проверка задания SDK через настоящий MCP ([studio-sdk.md](studio-sdk.md)).
- [`next.config.mjs`](../../next.config.mjs) — Remotion, `ffmpeg-static`, `music-metadata` и `esbuild` исключены из серверного бандла. `esbuild` — прямая зависимость: им собирается офлайн-плеер.
- [`tsconfig.mcp.json`](../../tsconfig.mcp.json) — для процессов под tsx подменяет `server-only` стабом [`src/test/server-only-stub.ts`](../../src/test/server-only-stub.ts).

## Переменные `.env`

- База и вход: `DATABASE_URL` (путь `file:./dev.db` отсчитывается от `prisma/`, как в Prisma 5: так считает `database-url.ts`, сама Prisma 7 считала бы от корня; без переменной — `prisma/dev.db`), `AUTH_SECRET`, `AUTH_TRUST_HOST`, `ADMIN_EMAILS` ([roles.md](roles.md)).
- Рендер: `REMOTION_BROWSER_EXECUTABLE` — путь к Chrome или Chromium.
- Импорт по ссылке:
  - `YTDLP_PATH`;
  - `YTDLP_PROXY` — нужен, когда сеть блокирует googlevideo.com;
  - `MEDIA_URL_ALLOW_PRIVATE=1` разрешает приватные адреса при импорте картинок. В шаблоне этой переменной нет, она описана в README.
- Shikimori:
  - `SHIKIMORI_BASE_URL` — домен сервиса периодически переезжает;
  - `SHIKIMORI_USER_AGENT`;
  - `SHIKIMORI_RETRY_MS` — тестовый хук, сокращает паузы между повторами.
- MCP: `MCP_ACTOR_EMAIL` ([mcp.md](mcp.md)), `MCP_LOCAL_MEDIA_DIRS` (папки через `:`, `~/` поддерживается; если пусто, доступа к диску нет) и `DOUGA_PUBLIC_URL` — база ссылки `/watch/…`, которую возвращает `video_publish`.
- Как читается `.env`: Next загружает его сам, `studio:worker` и `mcp` — через флаг `--env-file-if-exists`. Явно переданные переменные окружения важнее. Скрипты `scripts/e2e-*.mjs` берут адрес сервера из `BASE`.

## Данные

- SQLite-база `prisma/dev.db`, модели описаны в [schema](../../prisma/schema.prisma). Копии базы в `storage/backups/` сделаны вручную, код туда не пишет.
- `storage/` лежит в `.gitignore`. Пути в БД хранятся относительно него:
  - `tournaments/<id>/tracks/` — треки архивов и встроенные обложки `<trackId>-cover.<ext>`; `arts/<userId>/` — пул медиа вместе с постерами;
  - `downloads/tmp/<jobId>/` — загрузки yt-dlp; `tmp/` — импорт по ссылке и с диска; `bin/yt-dlp` — собственный бинарник;
  - `studio/<userId>/<projectId>/versions/…` и `studio/builtin/` — студия SDK; `studio-jobs/<userId>/<jobId>` — результаты заданий; `studio-engines/` — собранные движки;
  - `studio-verification/<run>` — куда `verify-studio.mjs` пишет результат по умолчанию;
  - `verification/<задача>/` — изолированные копии БД, целевые логи и доказательства проверок (например задача 27).
- `output/` тоже в `.gitignore`, но код его не использует: в `src/` и `scripts/` нет ни одной ссылки на него. Это ручная папка для готовых роликов.

## Как устроено

- Первый запуск: `npm install` (сам генерирует клиент), `cp .env.example .env`, `npm run db:push`, `npm run dev`.
- Схема: после правки `schema.prisma` выполни `npm run db:push` (push и generate) и перезапусти dev-сервер. Если запущены `studio:worker` и `mcp`, их тоже. Сам `npm run dev` делает только `generate`.
- Сегменты (задача 27) применяются аддитивно: новая `TournamentSegment`, nullable `segmentId` у Track/ComparisonBatch/Ranking и metadata трека. `db push` добавляет схему, а содержимое старых турниров лениво получает «Все треки» через `ensureTournamentSegments` при чтении турнира/источника Studio. Отдельного массового пересчёта сравнений и рейтингов нет. `coverArtId`/`posterArtId` защищены FK Restrict к Art.
- Для изолированного целевого прогона сначала скопируй `prisma/dev.db` в `storage/verification/<задача>/…db`, примени новую схему к этой копии явным `DATABASE_URL=file:/abs/copy.db npx prisma db push`, затем используй `TEST_DATABASE_URL=file:/abs/copy.db npx vitest run <файлы>`. `prisma generate` обновляет клиент этого чекаута (`src/generated/prisma`) даже при работе с копией БД; согласуй это с агентом, который держит dev, убедись, что рабочая БД тоже обновлена, и перезапусти активные процессы.
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
- Клиент базы — Prisma 7 через адаптер `better-sqlite3`, одно соединение на процесс ([`sqlite-adapter.ts`](../../src/lib/sqlite-adapter.ts)):
  - даты хранятся целыми миллисекундами (`timestampFormat: "unixepoch-ms"`), как писала Prisma 5. Умолчание адаптера — ISO-строки, а смесь форматов ломает сравнения: SQLite считает любое число меньше любой строки;
  - транзакции внутри процесса идут строго по очереди, а запросы вне транзакции ждут, пока открытая транзакция закончится. Без этой очереди они выполнились бы внутри чужой транзакции и откатились бы вместе с ней. В Prisma 5 пул соединений пускал чтения рядом с пишущей транзакцией, теперь ждут и они; Поэтому тест в одном процессе не ловит гонку записи. Гонка возможна только между процессами (сайт, MCP, воркер), от неё защищает первая запись в транзакции, которая берёт блокировку;
  - внутри `$transaction(async (db) => …)` — только `db`. Запрос через общий `prisma` там ждёт саму транзакцию до её таймаута (5 с) и роняет её, а после отката выполняется сам по себе: запись получается частичной. Хелперы `actor`, `owned`, `view`, `references`, `jobActor`, `ownedJob`, `jobView`, `importBudget`, `assertExportRoom`, `releaseSnapshotIfFree` без аргумента берут общий клиент, а `reconcileSource` без `db` открывает свою транзакцию: внутри транзакции передавай им `db` (аудит задачи 28);
  - `createTournament` сохраняет файлы архива внутри транзакции (таймаут 120 с). Пока она идёт, остальные запросы процесса ждут, а чужие `$transaction` через 2 с (`maxWait`) падают с P2028;
  - `better-sqlite3` синхронный: ожидание блокировки другого процесса (до 5 с) держит event loop, а не поток движка, как в Prisma 5;
  - если `COMMIT` упёрся в блокировку другого процесса, обёртка сама шлёт `ROLLBACK`. Клиент Prisma в этом случае зовёт только `rollback()` адаптера, а тот ничего не отправляет, и соединение осталось бы внутри транзакции.
- Версии Prisma закреплены точно (`7.10.1`): тег `latest` у `prisma` указывает на кандидат Prisma 8 — другую ORM, чей SQLite не читает наши даты (задача 28). Подсказка CLI «npm i prisma@latest» ведёт туда же.
- `better-sqlite3` — нативный модуль: после смены версии Node нужен `npm rebuild`.
- Полный `npm test` занимает `prisma/dev.db` и идёт около 7 минут (978 тестов на фазе 21). Если тесты падают на блокировке SQLite, а на 3000 работает dev-сервер владельца, спроси владельца, прежде чем его останавливать.
- Тесты импорта (`downloads`, `studio-imports`) требуют настоящий `storage/bin/yt-dlp` и сами его не скачивают. На свежем клоне положи бинарник в `storage/bin/yt-dlp`. Туда же его скачивает `ensureYtDlp`, если `YTDLP_PATH` не задан.
- Перезапуск dev-сервера обрывает идущие `DownloadJob`. Задание, которое не обновлялось дольше 10 минут, показывается как failed.
- Уже запущенная сессия Claude Code не подхватывает [`.mcp.json`](../../.mcp.json) (сервер `douga` → `npm run --silent mcp`). Перезапусти клиент или гоняй сервер stdio-драйвером.
- `e2e-setup.mjs` удаляет `e2e@test.local` со всеми данными и создаёт заново с ролью admin. `e2e-run` по умолчанию обращается к `http://localhost:3000`, другой адрес задаётся через `BASE`.
- `npx tsc --noEmit` не проверяет `storage/`: там лежат данные и разовые скрипты, не исходники.

## Как проверить

- Итоговый QG: `npm test` → `npm run build` → `npx tsc --noEmit`, строго в этом порядке после последних правок. Целевая проверка схемы: `npx vitest run src/lib/prisma-client.test.ts src/lib/domain/prisma-drift.test.ts`; она не заменяет QG.
- Живой сайт: по [verify-скиллу](../../.claude/skills/verify/SKILL.md). Тестовый аккаунт: `node scripts/e2e-setup.mjs`. Турнир по HTTP проходит `scripts/e2e-run.mjs` ([tournament.md](tournament.md)).
- SDK: `node scripts/verify-studio.mjs --actor <email> --project ID --kind clip --seconds 3 --output storage/studio-verification/<run>`. Код выхода 2 означает, что результат больше 12 MiB и скачивать его нужно на сайте.

## История

- [спека 02](../specs/02-phase-render.md) и [исследование](../research/remotion-headless-render.md) — рендер через Remotion в headless Chrome.
- [спека 08](../specs/08-url-import.md) — yt-dlp в `storage/bin` и `YTDLP_PATH`.
- [спека 10](../specs/10-mcp-server.md) — stdio MCP, `npm run mcp`, `MCP_ACTOR_EMAIL`.
- [спека 24](../specs/24-ai-video-job-contract.md) — устойчивая очередь и `studio:worker`.
- [журнал фазы 21](../phases/phase-21-verification.md) — последние итоговые прогоны тройки проверок.
- [задача 27](../features/27-segments/README.md) — аддитивная схема сегментов, ленивая совместимость старых турниров и изолированные целевые проверки на копиях БД
- [задача 28](../features/28-prisma-7/README.md) — Prisma 7.10.1: `prisma.config.ts`, клиент в `src/generated`, адаптер SQLite с прежним форматом дат и очередью вокруг транзакций
