# Task 3 — MCP discovery, примеры и галерея

Статус: src-реализация и адресные проверки завершены. Живая проверка gallery/MCP, общий QG и независимое review — у root.

Коммит: `d3aae860c49bc329388d2c0b9bb20eccf918f2d3` — `feat(studio): expose motion catalog and live preview gallery`.
В коммите только 13 своих src-файлов; `.ai`/plan/state не добавлялись.

## Контракты MCP

Оба новых tool используют существующий register-wrapper, freshActor и стандартный структурированный/text response. В list нет `example`, whole document или медиа.

`video_motion_list({category?, limit?:1..100=20, cursor?:string})`:

```json
{
  "version": 1,
  "total": 40,
  "items": [{"name":"fade","category":"effect","description":"…","channels":["enter","exit"],"blocks":["custom","top","picker","board"],"nodes":["…"],"parameters":["…"]}],
  "nextCursor": "effect:slide-left"
}
```

Категории: `effect`, `choreography`, `transition`, `backdrop`, `widget`. `total` — число после фильтра. Cursor — последний `category:name` в выбранной категории/общем списке. Последняя страница возвращает null. Несуществующий cursor — `NOT_FOUND`, неверный limit/category — `SCHEMA_INVALID`. Виджеты timer/versus дополнительно имеют `variants`.

`video_motion_get({name,category?})`:

```json
{
  "version": 1,
  "entry": {"name":"flash","category":"effect","description":"…","channels":["emphasis"],"blocks":["…"],"nodes":["…"],"parameters":["…"],"example":{"motion":{"emphasis":"flash"}}},
  "exampleKind":"authoring-fragment",
  "completeExampleId":"motion-effect-text-slam",
  "completeExampleNote":"Whole-document recipe for this category; entry.example is the selected technique fragment."
}
```

`flash` без category возвращает `isError:true`, `{error:{code:"MOTION_CATEGORY_REQUIRED",diagnostics:[{severity:"error",code:"MOTION_CATEGORY_REQUIRED",path:"category",message:"Укажите category: effect или transition"}]}}`. С category обе записи доступны отдельно. `flip` нормализуется в `flip-y`. Неизвестное имя/пара имя+category — `NOT_FOUND`.

`video_capabilities.motion`: `{catalogVersion:1,count:67,list:"video_motion_list",get:"video_motion_get",examples:"video_examples",gallery:"/studio/motion",profiles:["smooth","snappy","bouncy","cinematic"],intensities:["subtle","normal","bold"]}`.

`MCP_TOOL_NAMES` содержит 52 tools в порядке регистрации. `MCP_INSTRUCTIONS` — **2324 UTF-8 bytes**, лимит 3072 сохранён.

`video_examples` обратно совместимо принимает `{}`; дополнительно принимает `{id}` и возвращает тот же envelope с одним item либо `NOT_FOUND`. Старые 15 примеров сохранены, добавлены **12 whole documents** (итого27). Каждый новый item содержит `id`, `document`, `standInManifest`, `manifestNote`. В MCP stand-in manifest указывает синтетические `demo-0.svg`…`demo-2.svg`, id=`synthetic-0`…`synthetic-2`, kind=image, width640/height800. Это явные compiler stand-ins, не реальные pool assets/URL. Для сохранения пользователь должен заменить pool bindings своими assetId; схема и compileVideo с указанным manifest проходят без ошибок.

IDs:

- `motion-choreography-versus-impact`
- `motion-choreography-picker-cascade`
- `motion-choreography-winner-spotlight`
- `motion-choreography-rank-reveal`
- `motion-choreography-podium-finale`
- `motion-choreography-board-place`
- `motion-choreography-board-swap`
- `motion-choreography-title-reveal`
- `motion-choreography-cinematic-pan`
- `motion-choreography-round-intro`
- `motion-effect-text-slam`
- `motion-widget-backdrop-transition-sampler`

`completeExampleId` для хореографии указывает её документ; для effect — текстовый effect recipe, для backdrop/transition/widget — sampler (ring/segments/bar, gradient-flow/light-orbs/particles, wipe/crossfade). Это прямо подписанные примеры соответствующей категории, точный приём находится в `entry.example`. Не выдаём67 больших whole documents в default response. Локальный preview builder покрывает все67.

## Галерея

Authenticated `/studio/motion`: `currentUser()` → redirect `/login`, если пользователь отсутствует. Ссылки добавлены из `/projects` и `/studio/new`.

- Wrapper: `[data-motion-gallery]`; область единственного настоящего Player: `[data-motion-preview]`.
- Категории — кнопки с `aria-pressed`, nav `aria-label="Категория моушена"`.
- Обычные label/select: `motion-name` («Приём»), `motion-profile` («Профиль движения»), `motion-intensity` («Сила движения»), `motion-variant` («Вариант виджета», timer/versus).
- Имена ограничены выбранной категорией; collision effect/transition flash не смешивается.
- 4 профиля и 3 силы; профиль выключен вне effect/choreography, сила — вне effect/choreography/backdrop, поскольку другие категории этих авторских настроек не поддерживают.
- Timer selector: digits/ring/segments/bar; versus selector: clean/neon/slash/impact. Переключение пересобирает единственный Player.
- Описание, параметры, каналы, длительность/fps; кнопка «Копировать JSON», role=status для результата, selectable JSON в pre. Копируется явно подписанный `{fragmentKind:"node"|"settings"|"scene",fragment:{…}}` соответствующий текущим настройкам. Это фрагмент для merge в указанную область, не whole document.
- `createMotionExample` → `parseVideoDocument` → общий `compileVideo` → `StudioPreview` → `StudioVideo`/Remotion Player. SVG только локальные data URI, owner assets/сеть не используются. Нет собственных CSS animations/transitions.

Для эффектов используется синтетический постер с подписью либо типографика; хореографии получают реальные top/picker/board структуры с ответом/действиями; переходы — две разные соседние сцены; фоны — процедурная сцена либо синтетический art-blur; виджеты — полноценные узлы. Дополнительный тест проверяет наличие именно выбранного effect/recipe/transition/backdrop/widget в IR, а не только ready=true.

Timeline дополнен composition-absolute точками из scene-local `clip.from`, последнего кадра клипа, следующего кадра, границ motion window; transition last/next boundary. Все recommendedFrames ограничены `[scene.from,scene.from+duration)`; node.from повторно к motion не прибавляется.

## RED → GREEN

Наблюдаемый первоначальный RED:

```sh
npx vitest run src/mcp/motion-discovery.test.ts
```

**5 failed / 0 passed**, лог `/tmp/douga-task3-red.txt`: tools не зарегистрированы, capabilities.motion отсутствует, нет motion examples, timeline helper не включает новые границы/не экспортирован. После реализации исправлены всплывшие strict-schema проверки demo (неподдерживаемые typography поля), ID manifest/binding и уникальность node IDs между сценами; production schema/renderer не ослаблялись.

Финальный неподвижный адресный набор после последних правок:

```sh
npx vitest run src/mcp/motion-discovery.test.ts src/mcp/instructions.test.ts src/video/motion.test.ts src/remotion/motion-frame.test.ts
```

**4 файла / 176 tests passed**: discovery8, instructions9, SDK motion80, renderer motion79. Duration2.65s, лог `/tmp/douga-task3-final.txt`.

Внутри discovery8: все67 preview cases ×4profiles ×3intensities (**804 компиляции**), **8 widget variants**, все12 whole motion examples schema+compile ready, осмысленный IR всех67, paging/filter/bounds, collisions/alias/unknown, optional-id examples, instructions<=3KB, реальные motion/transition timeline boundaries при ненулевых node.from/scene.from.

```sh
npx tsc --noEmit
```

**exit0**, в том числе отдельный свежий прогон после коммита. Лог первого итогового прогона `/tmp/douga-task3-tsc-final.txt` (пустой).

`git diff --check` — **exit0**.

## Остатки и границы утверждений

По заданию root общий `npm test → npm run build → npx tsc --noEmit`, а также authenticated browser/MCP probes выполняет контроллер; свой dev на3000 не запускался. Живая gallery/read/copy/Player проверка и независимое review ещё не заявлены пройденными.

Root сообщил renderer LT-01 (переводы строк у text-words/text-letters) и чинит его отдельно исходным renderer implementer. Renderer/core compiler/types этой задачей не изменялись, пример text-lines остаётся многострочным. Обновления карточек mcp/studio-sdk/render поручены root как общий docs-коммит.
