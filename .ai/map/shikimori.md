# Shikimori

Источник материала для роликов Douga: поиск аниме и персонажей, постеры в пул медиа, а для MCP — обход студий, ролей, профилей и списков пользователей.
Используется только публичное API (REST v1 + GraphQL) без OAuth, поэтому всё доступно лишь на чтение.

## Где код
- [`src/lib/shikimori.ts`](../../src/lib/shikimori.ts) — HTTP-клиент: базовый URL и User-Agent из env, общая очередь `throttle`, повторы при 429, обёртки над `/api/*` и `/api/graphql`.
- [`src/lib/domain/rate-limit.ts`](../../src/lib/domain/rate-limit.ts) — чистая политика лимитов: `nextDelayMs` (пауза + скользящее окно), `trimHistory`, `retryDelayMs` (`Retry-After`/расписание).
- [`src/lib/domain/shikimori.ts`](../../src/lib/domain/shikimori.ts) — чистый маппинг ответов (аниме, персонаж, юзер, запись списка, избранное, роли, профили) и SSRF-гарды `isSafeImagePath`/`isSafePosterUrl`/`resizeImagePath`.
- [`src/server/shikimori.ts`](../../src/server/shikimori.ts) — сервисы: `search`, `findStudio`, `studioAnimes`, `animeCharacters`, `animeProfile`, `characterProfile`, `personProfile`, `findUser`, `userAnimeList`, `userFavourites`, `userHistory`, `importPoster`.
- [`src/app/api/shikimori/search/route.ts`](../../src/app/api/shikimori/search/route.ts), [`import/route.ts`](../../src/app/api/shikimori/import/route.ts) — HTTP для UI; оба требуют `media:upload`, коды ошибок переводятся в русские сообщения.
- [`src/app/components/ImportSources.tsx`](../../src/app/components/ImportSources.tsx) — `ShikimoriSource`: таб «Shikimori» (рядом «Файлы» и «Ссылка»). Ввод с дебаунсом 300 мс, прошлый запрос отменяется, в выдаче мини-постер и факты, кнопка «⬇ В пул». Открывается из [`ArtGalleryModal`](../../src/app/tournaments/[id]/render/ArtGalleryModal.tsx) в конструкторах топа и пикера.
- MCP-инструменты `shikimori_*`, `import_shikimori_poster`, `add_tile_from_shikimori` лежат в [`src/mcp/server.ts`](../../src/mcp/server.ts) и [`src/mcp/compose.ts`](../../src/mcp/compose.ts), см. [mcp.md](mcp.md).

## Данные
- Своих моделей нет. Постер становится `Art` с `kind=image` через `createArt` ([schema](../../prisma/schema.prisma)): файл `shikimori-<type>-<id>.<ext>`, квота пула роли учитывается (`POOL_QUOTA`).
- Env ([`.env.example`](../../.env.example)):
  - `SHIKIMORI_BASE_URL`, по умолчанию `https://shikimori.io`. Домен переезжает (.one → .io): меняйте только эту переменную.
  - `SHIKIMORI_USER_AGENT`, по умолчанию `douga`.
  - `SHIKIMORI_RETRY_MS="10,20"` — тестовый хук, сокращает паузы между повторами.

## Как устроено
- Все запросы процесса идут через одну очередь:
  - API: пауза 250 мс и не больше 80 запросов в скользящем окне 60 с (запас к лимитам сервиса 5/с и 90/мин);
  - картинки: только пауза 250 мс, в минутный бюджет не входят;
  - у API-запросов таймаут 10 с отсчитывается уже после ожидания в очереди.
- REST-ответ 429 повторяется через 2, 8 и 20 с. Если `Retry-After` больше 0 и не больше 120 с, ждём его. После трёх повторов — ошибка `RATE_LIMITED`, любой другой не-2xx статус — `SHIKIMORI_HTTP_<код>`.
- Поиск: аниме — `/api/animes?search=`, персонажи — `/api/characters/search`, отдаётся до 8 результатов. `label` — русское имя, иначе оригинальное; `thumbUrl` строится из `preview`. Студии ищутся локально по полному `/api/studios`: отдельного поиска у Shikimori нет.
- `importPoster` (синхронно, без фоновой задачи):
  1. `posterPath` должен пройти `isSafeImagePath`: `/system/(animes|characters)/(original|preview)/<id>.<jpg|png|webp>`;
  2. через GraphQL берётся `poster.originalUrl` — файл из `/uploads/poster/...` в полном разрешении. Гард `isSafePosterUrl` пускает только тот же origin, что `SHIKIMORI_BASE_URL`;
  3. если свежего URL нет, он не скачался или ведёт на чужой хост — откат на legacy-копию `/system` (старая и уменьшенная).
- `fetchFreshPosterUrls` разбивает id на пачки по 50 и обязательно передаёт `limit`: без него GraphQL возвращает только 2 записи.
- Список пользователя:
  - сначала `findUser`: число ищется по id, строка — с `?is_nickname=1`; 404 → `USER_NOT_FOUND`;
  - затем один запрос `anime_rates?limit=5000`;
  - фильтр по статусу и `minScore`, сортировка `score|updated|name` и обрезка `limit ≤ 500` делаются локально, поэтому сортировка честная по всему списку;
  - оценка 0 → `userScore: null`, манга и неизвестные статусы отбрасываются, `countsByStatus` считается по всему списку.
- Избранное: у аниме и персонажей API отдаёт только миниатюру `x64`, `resizeImagePath` переписывает её в путь `/system/.../original/...`, готовый к импорту. `people` и `seiyuu` (в API ключ `seyu`) приходят без постеров, со ссылкой `/people/<id>`.
- Профили и история:
  - `characterProfile`: аниме персонажа от старых к новым, записи без даты выброшены. `debutYear` — год первого появления, то есть эпоха персонажа, а не год сезона, из которого взят постер;
  - `animeProfile`: студии без спонсоров (`real: false`), год, оценка, жанры;
  - `personProfile`: работы с ролями;
  - `userHistory`: постранично, `nextPage: null` означает конец.
- Если арта нет (заглушка `/assets/globals/missing_original.jpg` или любой нераспознанный путь), `posterPath` равен `null`.

## Грабли
- Shikimori не отдаёт пол персонажа, в DTO этого поля нет: деление на «мужской/женский» размечается только вручную.
- Запись с `posterPath: null` импортировать нельзя. `importPoster` требует валидный `/system`-путь, даже когда качает `/uploads`-файл, иначе `BAD_IMAGE_PATH`.
- GraphQL не повторяет 429, а ошибку получения URL глотает: под нагрузкой постер молча приезжает legacy-копией низкого разрешения. Для пачки получите URL заранее и передайте `posterUrl` во вход `importPoster`.
- Очередь живёт в памяти процесса: сайт и каждый запущенный MCP-сервер (в том числе поднятый драйвером) считают бюджет раздельно. Если они работают параллельно, Shikimori может ответить 429.
- `userAnimeList`, `userFavourites` и `userHistory` сначала вызывают `findUser`, то есть каждый тратит два API-запроса. При обходе сотен аниме минутный бюджет кончается быстро, и вызовы ждут до минуты.
- Без `label` подписью арта станет имя файла (`shikimori-anime-123`), поэтому передавайте `label`.
- У записей с `kind` `music`/`pv`/`cm` персонажей нет: отсейте их до `shikimori_anime_characters`.
- `description` персонажа — исходный BBCode Shikimori, может содержать спойлеры.

## Как проверить
- Юнит-тесты: `npx vitest run src/lib/domain/shikimori.test.ts src/lib/domain/rate-limit.test.ts src/lib/shikimori-queue.test.ts`.
- Интеграционные тесты: `npx vitest run src/integration/shikimori.integration.test.ts src/integration/mcp-compose.integration.test.ts`. Вместо Shikimori — локальный HTTP-стенд через `SHIKIMORI_BASE_URL`, база — реальная `prisma/dev.db`.
- Вживую: в конструкторе пикера `/projects/<id>` откройте модалку медиа → «Shikimori». Поиск должен показать превью, «⬇ В пул» — добавить карточку в пул. Через MCP то же проверяется вызовами `shikimori_search` → `import_shikimori_poster`.

## История
- [спека 09](../specs/09-shikimori-import.md) — поиск с живым превью и синхронный импорт постера в пул.
- [спека 13](../specs/13-shikimori-user-lists.md) — профиль, список с оценками и статусами, избранное в MCP.
- [спека 14](../specs/14-shikimori-robustness.md) — оба лимита со скользящим окном и `Retry-After`, свежий постер через GraphQL.
- [спека 16](../specs/16-group-comparison.md) — `shikimori_character` (`debutYear`) и `shikimori_anime` (студии) для групповых раундов.
- [спека 19](../specs/19-mcp-manual-top.md) — исполнители и сэйю в избранном, `shikimori_person`, `description`, `shikimori_user_history`.
