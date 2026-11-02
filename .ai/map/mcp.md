# MCP-сервер

Stdio MCP-сервер `douga` позволяет внешнему ИИ самому собирать ролики. Он ищет материал в Shikimori, кладёт медиа в пул и собирает видео только инструментами `video_*` AI Video SDK ([studio-sdk.md](studio-sdk.md)). При `initialize` сервер отдаёт короткую инструкцию с тремя путями: топ по турниру, свой топ и пикер.

Сервер работает от имени одного аккаунта Douga, поэтому всё созданное видно на сайте этого аккаунта.

## Где код
- [`src/mcp/server.ts`](../../src/mcp/server.ts) — точка входа. `new McpServer({name, version}, {instructions})` и `StdioServerTransport`. Обёртка `guard` перечитывает роль при каждом вызове
- [`src/mcp/instructions.ts`](../../src/mcp/instructions.ts) — текст инструкции и список из 46 имён. Инструкция не длиннее 3 КБ
- Инструменты в `server.ts`:
  - 11 `shikimori_*`: поиск, студии, аниме, персонажи, люди, списки и избранное ([shikimori.md](shikimori.md));
  - 5 инструментов пула: `list_pool`, `import_shikimori_poster`, `import_youtube_audio`, `list_local_media`, `import_local_media`. В описаниях сказано, что `artId` пула — это `assetId` привязки `{kind:"pool"}`
- [`src/mcp/studio-tools.ts`](../../src/mcp/studio-tools.ts) — `registerStudioTools`: 30 инструментов `video_*` и ресурсы `video://`. `video_examples` содержит пример `top-manual`: три участника, `rank`, медиа пула и `settings.top.snippet.mode:"active"`
- [`src/mcp/actor.ts`](../../src/mcp/actor.ts) — `resolveActor()` по `MCP_ACTOR_EMAIL`
- [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) — `import_youtube_audio`: ждёт `DownloadJob` до 180 с
- Запуск: `npm run mcp`. Нужен ещё `npm run studio:worker`, иначе задания остаются в очереди

## Данные
Своих таблиц у MCP нет. Инструменты пишут в `Art`, `DownloadJob` и модели студии ([schema](../../prisma/schema.prisma)).

## Как устроено
- Актор: при старте `resolveActor()` ищет пользователя по `MCP_ACTOR_EMAIL`. Если переменной или аккаунта нет, процесс пишет причину в stderr и завершается с кодом 1
- Каждый вызов заново читает роль. Чужой id даёт `NOT_FOUND`. Квоты пула — из `quotasFor(role)`
- Три рецепта из инструкции:
  - топ по турниру: `video_source_list` → `video_project_create` с `presetId` топа и `sourceId` (без `presetId` `sourceId` не принимается) → оформление → `video_project_validate` → `video_draft_commit` → `video_job_start`;
  - свой топ: медиа в пул, документ `source.kind:"manual"`, участники с `rank` и привязками `pool`, фрагмент `active`;
  - пикер: пресеты `picker.*` и `video_examples`
- Правки идут через CAS по `expectedVersion`. Повтор того же шага — с тем же `idempotencyKey`
- `video_job_start kind:"render"` без права `render:run` даёт `FORBIDDEN`. Клип доступен автору

## Грабли
- Уже запущенная сессия клиента не подхватывает новый код сервера. Нужен перезапуск или stdio-драйвер
- Без `--silent` баннер npm попадает в stdout и ломает протокол
- `import_youtube_audio` качает внутри процесса MCP. На аккаунт не больше двух активных загрузок
- Не держите общий `studio:worker` во время интеграционных тестов: он перехватывает их задания
- Пример драйвера — [`scripts/verify-studio.mjs`](../../scripts/verify-studio.mjs)

## Как проверить
- `npx vitest run src/mcp/instructions.test.ts` — длина инструкции, пример `top-manual` проходит схему и компилируется
- `npx vitest run src/integration/mcp.e2e.test.ts` — ровно 46 имён, инструкция в `initialize`, Shikimori и импорт с диска
- `npx vitest run src/integration/studio-mcp.integration.test.ts` — `video_*`
- Вживую: stdio-клиент с `MCP_ACTOR_EMAIL` и запущенным воркером собирает клип по каждому из трёх рецептов. Кадры и `volumedetect` — в [render.md](render.md)

## История
- [спека 10](../specs/10-mcp-server.md), [спека 22](../specs/22-ai-video-sdk-contract.md), [спека 23](../specs/23-ai-video-service-contract.md)
- Задача 26 оставила 46 инструментов и инструкцию сервера. Прежние инструменты сборки пикера и ручного топа удалены
