# Доски слотов — план реализации

> Исполнитель: `superpowers:executing-plans`, задачи последовательно, TDD;
> независимый свежий ревьюер проверяет всю ветку перед PR.

**Цель:** восемь семейств досок в SDK с правилами, бюджетом, событиями и живым рендером.

**Архитектура:** типизированный board → чистые состояния → стандартные сцены/узлы/аудио.
Новые документы v2, старые top/picker сохраняют свой путь. Новых зависимостей нет.

**Стек:** TypeScript, Zod 3, Vitest, существующий Remotion 4.

**Спеки:** [product.md](product.md), [tech.md](tech.md).

## Общие ограничения

- Только SDK, без интерактивного интерфейса.
- Восемь семейств × wide/vertical/square.
- Никакого исполнения кода из документа; медиа только через bindings.
- Совместимость старых документов, те же технические бюджеты.
- Не менять медиа владельца; доказательства в storage/.
- Финальный QG: npm test → npm run build → npx tsc --noEmit.

## Фокус ревью

- Невалидная замена/обмен не оставляет частично изменённое состояние или бюджет.
- Сбросы, carry и повторные появления не путают ID и не раскрывают будущие карточки.
- Применение личного пресета не теряет назначения и медиа.
- Большие доски останавливаются бюджетом до дорогой развёртки.
- Реальный PNG/MP4/Player воспроизводит движение, подписи и звук одного плана.

### Задача 1. Контракт и правила

Файлы: `src/video/types.ts`, `schema.ts`, новые `board-state.ts`, `board-state.test.ts`,
`board-schema.test.ts`, `patches.ts`, `assets.ts`, `resource-limits.ts`, `index.ts`.

Интерфейсы: BoardDefinition/BoardRound/BoardCard/BoardAction/BoardState;
`createBoardState`, `applyBoardAction`, `resolveBoard` по tech T02.

- [x] RED: тесты вместимости, атомарной замены, возврата стоимости, блокировки,
  сброса/carry, недоступной карточки и дублей ID; схема принимает board и отвергает CSS/лишние поля.
- [x] GREEN: типы, строгие схемы, reducer/resolver, asset keys, стабильные патчи и preflight.
- [x] Проверка: `npx vitest run src/video/board-state.test.ts src/video/board-schema.test.ts`.
  Готово: корректные состояния/диагностика, вход не изменён, все тесты зелёные.
- [x] Коммит `feat(video): add declarative board rules and schema`.

### Задача 2. Компиляция досок

Файлы: новый `board-compiler.ts`, `board-compiler.test.ts`, `compiler.ts`, `audio.ts`,
при необходимости метаданные событий в types/schema.

Потребляет BoardResolution; выдаёт обычные CompiledScene[] и ctx.audio.

- [x] RED: итоговые позиции, промежуточное движение, очистка раунда/carry, скрытые
  будущие кандидаты, матрица, бюджетный счётчик, звук активного кандидата и события.
- [x] GREEN: фазы, раскладка rows/grid/free, анимация действий, комментарии,
  фокус слотов, отложенное раскрытие, аудио и совместимость сегментов.
- [x] Проверка: `npx vitest run src/video/board-compiler.test.ts src/video/segments.test.ts`.
  Готово: конечный и промежуточный кадры правильны, время и события детерминированы.
- [x] Коммит `feat(video): compile board sequences into video scenes`.

### Задача 3. Пресеты и публичный SDK

Файлы: `board-presets.ts`, `board-presets.test.ts`, `presets.ts`, `builders.ts`,
`src/mcp/studio-tools.ts`, `src/server/studio/types.ts`, `projects.ts`,
существующие подписи kind в StudioWorkspace/ProjectList.

Интерфейсы: createVideoDocument(kind:board, board?), catalog, extract/apply;
публичные schema/examples через существующий MCP.

- [x] RED: каждый из 24 пресетов даёт готовый документ; extraction не хранит
  участников/медиа; apply сохраняет назначения и отклоняет несовместимость;
  смешанный документ board/top/picker работает.
- [x] GREEN: фабрика, канонические и короткие ID, extraction/apply, schema/catalog/examples,
  серверные типы и корректные подписи существующих проектов.
- [x] Проверка: `npx vitest run src/video src/mcp/instructions.test.ts`.
- [x] Коммит `feat(studio): expose board presets and SDK recipes`.

### Задача 4. Проверка и знания

Файлы: `verify.md`, `execution.md`, карточки studio-sdk/mcp/render; проверочные
драйверы/медиа в storage/verification/29-slot-boards/.

- [x] Пройти `verify`: обязательная тройка в заданном порядке.
- [x] Через настоящий MCP создать проверочный проект, сохранить, запустить worker;
  получить реальные PNG/MP4 с разными состояниями, извлечь кадры и декодировать звук.
- [x] Проверить 8 форматов досок, разные пропорции, публикацию/офлайн-HTML для одного примера.
- [x] Свежий ревьюер всей ветки; существенные замечания исправить и повторить QG.
- [x] Обновить карточки зон, записать цифры/пути доказательств и сценарии ручной проверки.
- [x] PR → stage review → запись history/merged → merge в main по автономному разрешению.
