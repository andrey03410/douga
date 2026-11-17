# Локальное руководство производства пикеров

Обновлены четыре файла персонального скилла владельца:
`.claude/skills/picker/{SKILL.md,design.md,design-example.json,scripts/assemble.mjs}`.
Они уже исключены личным `.git/info/exclude` и в публичный PR не добавляются;
исключение не менялось. Публичный контракт находится в MCP/design guide, README
и AGENTS.md. Это дополнительное локальное улучшение, не зависимость новой студии.

Новый маршрут: design guide → kind picker → curated composition → содержание →
согласованные палитра/шрифты/движение → реальные кадры/клип/звук → исправление.
Сборщик наследует полноценную основу `createVideoFromIntent`, поддерживает группы,
отдельную музыку, пустой design и повтор без дубля. Существующее производство без
marker и явный composition:null сохраняют прежний raw путь.

Исполнитель проверил 7 dry/Fontkit compile сценариев (3 формата 3×2+OST, пустой
новый дизайн, его повтор, прежний state, explicit null), node syntax, YAML и ссылки.
Настоящий stdio MCP на отдельной SQLite-копии подтвердил guide/create(kind)/draft/
commit и повтор с тем же проектом. QA-копия scripts перенаправляла только свою БД;
production окружение MCP, .env и БД владельца не менялись. Проверочный аккаунт и
его проекты/медиа удалены. Доказательства: `storage/feature-35-implementation/picker-skill/`
(`verification.json`, `skill-verification.json`, `live-*.log`).
