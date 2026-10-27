# MCP-сервер

Stdio MCP-сервер `douga` позволяет внешнему ИИ (Claude Code или Desktop, Codex, Cursor) самому собирать ролики. Он ищет материал в Shikimori, импортирует медиа в пул и собирает прежние пикеры и ручные топы. Семейство `video_*` даёт доступ к проектам AI Video SDK ([studio-sdk.md](studio-sdk.md)).
Сервер работает от имени одного аккаунта Douga, поэтому всё созданное видно на сайте этого аккаунта.

## Где код
- [`src/mcp/server.ts`](../../src/mcp/server.ts) — точка входа (`McpServer` + `StdioServerTransport`), 30 прежних инструментов. Обёртка `guard` перечитывает роль при каждом вызове, ошибку отдаёт как `{error}` с `isError`. Группы инструментов:
  - поиск в Shikimori, только чтение: `shikimori_search`, `_find_studio`, `_studio_animes`, `_anime_characters`, `_anime`, `_character`, `_person`, `_find_user`, `_user_anime_list`, `_user_favourites`, `_user_history` (подробности — [shikimori.md](shikimori.md));
  - пул и импорт: `list_pool` (отдаёт абсолютный `filePath`), `import_shikimori_poster`, `import_youtube_audio`, `list_local_media`/`import_local_media` (только из `MCP_LOCAL_MEDIA_DIRS`, до 50 файлов за вызов, в пул уходит копия);
  - прежний пикер (`VideoProject`, kind `picker`): `create_picker_project`, `add_round`/`set_round`/`delete_round`, `add_group`/`set_group`/`delete_group`, `add_tile`/`add_tile_from_shikimori`, `set_playlist`, `set_project`, `get_project`;
  - прежний ручной топ: `create_top_project`, `set_top_items` (атомарно заменяет все позиции, до 200), `get_project`.
- [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `registerStudioTools`: 27 инструментов `video_*` и ресурсы `video://` (схемы, примеры, байты заданий, фрагменты ассетов). Схемы zod строгие. Ответ содержит `structuredContent` и тот же JSON текстом, ошибка — `{error:{code,diagnostics}}`. Группы:
  - справка: `capabilities`, `schema_get`, `examples`, `preset_list`/`preset_get`/`preset_save`;
  - проект и черновик: `project_create`/`project_list`/`project_get`, `document_get`, `draft_replace`/`draft_patch`, `preset_apply`, `project_validate`, `draft_commit`, `revision_restore`, `history_list`, `timeline_get`;
  - источники и медиа: `source_list`/`source_get`, `asset_list`/`asset_inspect`;
  - очередь: `job_start`/`job_get`/`job_cancel`/`job_inspect`, `import_start`.
- [`src/mcp/actor.ts`](../../src/mcp/actor.ts) — `resolveActor()` по `MCP_ACTOR_EMAIL`.
- [`src/mcp/compose.ts`](../../src/mcp/compose.ts) — `addTileFromShikimori`: импорт постера и карточка одним вызовом.
- [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) — `import_youtube_audio`: запускает `DownloadJob` (yt-dlp, только звук) и опрашивает его до 180 с.
- [`src/mcp/project-summary.ts`](../../src/mcp/project-summary.ts) — ответ `get_project` для пикера: раунды, блоки, фон, `playlistSec`, плановый `durationSec`.
- [`src/mcp/top-summary.ts`](../../src/mcp/top-summary.ts) — ответ `get_project` для ручного топа: фрагменты, таймлайн, `readyToRender`, `warnings`.
- Логика лежит в сервисах: [`projects.ts`](../../src/server/projects.ts), [`manual-top.ts`](../../src/server/manual-top.ts), [`local-media.ts`](../../src/server/local-media.ts), [`downloads.ts`](../../src/server/downloads.ts), [`src/server/studio/`](../../src/server/studio/).
- Запуск: `npm run mcp`, то есть `tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json src/mcp/server.ts`. Сервер для Claude Code прописан в [`.mcp.json`](../../.mcp.json) (`npm run --silent mcp`), конфиг для Claude Desktop — в [README](../../README.md), раздел «MCP-сервер».

## Данные
- Своих таблиц у MCP нет, инструменты пишут в модели продукта ([schema](../../prisma/schema.prisma)):
  - прежние проекты: `VideoProject`, `PickerRound`, `PickerGroup`, `PickerTile`, `PickerPlaylistItem`, `RenderConfig`/`RenderItem` (ручной топ), `Art`, `DownloadJob`;
  - студия: `StudioProject`, `StudioRevision`, `StudioPreset`, `StudioMutation`, `StudioJob`.

## Как устроено
- Актор: при старте `resolveActor()` ищет `User` по `MCP_ACTOR_EMAIL` через `findUserByEmail` ([roles.md](roles.md)), регистр не важен. Email должен совпадать с веб-аккаунтом. Если переменной или аккаунта нет, процесс пишет причину в stderr и завершается с кодом 1.
- Права: каждый вызов заново читает роль из БД (`actor()` в [`studio/shared.ts`](../../src/server/studio/shared.ts), нужен `media:upload`). Квоты пула берутся из `quotasFor(role)` ([permissions](../../src/lib/domain/permissions.ts)). Владение проверяет сам сервис: чужой id даёт `NOT_FOUND`. Ни актор, ни квоты, ни пути вне allowlist клиент не передаёт.
- Рендер:
  - прежние проекты: MCP-инструмента рендера нет, финал рендерят в UI `/projects/<id>` (`render:run`, только админ);
  - студия: `video_job_start kind:"render"` без `render:run` даёт `FORBIDDEN`, still/clip/audio автору доступны.
- `video_job_start` и `video_import_start` только ставят задание в очередь. Выполняет его отдельный процесс `npm run studio:worker`.
- Обычные ответы `video_*` нейтральны: ID, версии, счётчики. Содержимое отдают только явные `video_document_get`, `video_source_get` и `video_*_inspect`. Правки идут через CAS по `expectedVersion` (это не `revision`); при повторе передавайте тот же `idempotencyKey`.
- Процесс запускается через `tsx`, не через Next: `server-only` подменён стабом в [`tsconfig.mcp.json`](../../tsconfig.mcp.json), сессии Auth.js нет.

## Грабли
- Запущенная сессия Claude Code не подхватывает новый или изменённый проектный сервер из `.mcp.json`, нужен перезапуск клиента. Правки кода сервера тоже не видны, пока процесс не перезапущен (`tsx` без watch).
- Чтобы не блокироваться, гоняйте сервер драйвером по stdio:
  - `Client` + `StdioClientTransport` из `@modelcontextprotocol/sdk` спавнят `npm run --silent mcp` или `tsx … src/mcp/server.ts` и сами проходят handshake;
  - вручную: JSON-RPC 2.0, одно сообщение на строку: `initialize` → `notifications/initialized` → `tools/call`;
  - без `--silent` баннер npm попадает в stdout и ломает протокол;
  - пример — [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs); разовые драйверы производства лежат в игнорируемой `.ai/production/*/mcp.mjs`;
  - для сотен вызовов драйвер удобнее живых инструментов: пишите состояние в файл, чтобы докатить прогон после обрыва.
- `add_round` с `mode:"groups"` создаёт только ДВА пустых блока (`MIN_GROUPS`). Третий добавляется через `add_group`. Предел — 3 блока по 5 карточек, всего не больше 15.
- `create_picker_project` сразу создаёт пустой раунд: заполните его по `firstRoundId` или удалите `delete_round`.
- `set_round` с `mode` пересобирает раунд:
  - в `groups` плитки нарезаются по 5 и теряют `isAnswer`;
  - обратно в `single` блоки удаляются вместе с названиями и ответом.
- `add_tile_from_shikimori` не атомарен. Если карточка не встала (`TOO_MANY_TILES`: 9 в обычном раунде, 5 в блоке), постер всё равно остаётся в пуле и занимает квоту.
- В групповом раунде ответ ставится на блок через `set_group({isAnswer})`, а не на карточку.
- `import_youtube_audio` качает внутри процесса MCP. На аккаунт допускается не больше двух активных загрузок (`TOO_MANY_ACTIVE`).
- Первый `get_project` ручного топа рассчитывает активные фрагменты по RMS, это может занять минуты.
- Префикс инструментов в Claude Code берётся из ключа сервера в `.mcp.json` (`mcp__douga__…`). Переименование сервера меняет имена инструментов у клиента.
- Не держите общий `studio:worker` во время интеграционных тестов: он может перехватить их задания.

## Как проверить
- Тесты сервисов: `npx vitest run src/mcp/project-summary.test.ts src/integration/mcp-actor.integration.test.ts src/integration/mcp-compose.integration.test.ts src/integration/mcp-top.integration.test.ts src/integration/mcp-youtube.integration.test.ts`.
- Настоящий stdio:
  - `npx vitest run src/integration/mcp.e2e.test.ts` — прежние сценарии против локального стенда Shikimori;
  - `npx vitest run src/integration/studio-mcp.integration.test.ts` — `video_*`, ресурсы и старый handshake `2024-11-05`;
  - оба теста пишут в `prisma/dev.db`.
- Студия вживую: `node scripts/verify-studio.mjs --actor you@example.com --project ID --kind clip --seconds 3 --output storage/studio-verification/<run>`. Код 2 означает, что результат больше 12 MiB.

## История
- [спека 10](../specs/10-mcp-server.md) — сервер, актор, поиск по студиям, сборка пикера с ответами.
- [спека 13](../specs/13-shikimori-user-lists.md) — пользователь Shikimori: список и избранное.
- [спека 15](../specs/15-mcp-local-media.md) — чтение пула, фон и настройки проекта, локальные медиа по allowlist.
- [спека 16](../specs/16-group-comparison.md) — групповые раунды: `add_group`/`set_group`/`delete_group`, `groupId` в `add_tile*`.
- [спека 19](../specs/19-mcp-manual-top.md) — ручной топ (`create_top_project`/`set_top_items`) и расширенные профили Shikimori.
- [спека 22](../specs/22-ai-video-sdk-contract.md), [спека 23](../specs/23-ai-video-service-contract.md) — адаптер `video_*` и сервисы студии, которые он вызывает.
