# Обновление знаний по задаче 35

Изменены только README.md, AGENTS.md, `.ai/README.md` и карточки зон
`.ai/map/{studio-sdk,render,mcp,dev-env}.md`. Код, скиллы и остальные документы
задачи не редактировались; коммит не создавался, тесты/рендер/QG не запускались.

Документы сверены с `authoring.ts`, composition presets/settings/compiler,
MCP instructions/tools, серверным create/content, tech.md и тремя implementation
reports. Описаны kind-first top/picker/tier-list, 12 curated compositions,
style decision по guide, mandatory actual storyboard/clip review и повторная
проверка после исправлений. Сохранён явный raw SDK/legacy read/copy/restore;
старый low-level default builder отделён от нового intent factory.

Исправлены примеры README с retired picker.classic и прежняя таблица ролей.
Указаны budgets 2M values / 100k nodes / 32 МиБ UTF-8, границы pure estimate,
content groups/OST/null/tiers, pinned fonts и opt-in marker. В документации
нет заявления о выполненном общем QG или собственной художественной приёмке.

После подтверждения root добавлены ссылка на baseline35 и команды cohort:
`visual:render` / `visual:check -- --filter preset.composition.`. Описаны
129 native lossless frames, отдельное хранение legacy32 и полный cohort из
12 композиций для accept. `selectionPassed:true, complete:false` означает
успех выборки; общий passed/CLI exit остаётся false/1 из-за неполноты каталога.
Эта семантика сверена непосредственно с `scripts/visual-regression.ts`.

Локальные Markdown-ссылки и anchors проверены скриптом по всем семи назначенным
документам; отсутствующих путей/anchors нет. Финальные числа и журнал находятся
в `storage/feature-35-implementation/knowledge-links.json`.
`git diff --check` назначенных документов — без замечаний.
