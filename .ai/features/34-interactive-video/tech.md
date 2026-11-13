# Технические решения

Решения приняты агентом 2026-11-13 в автономном режиме стадии `tech`
(разрешение — в [brief.md](brief.md#разрешение-автономности)). Сторона asobiba
(мост, видео-контракт игр, Quizor, сайт и MCP asobiba) описана в парной задаче
`asobiba/.ai/features/07-video-games/tech.md`. Общий контракт двух репозиториев
задан здесь, в T06–T09 и T13: его типы живут в пакетах douga.

## Исходная система

Проверено в коде ветки `main` (`b4020b3`) и в карточках [studio-sdk](../../map/studio-sdk.md),
[render](../../map/render.md), [mcp](../../map/mcp.md).

**Домен `src/video/`.**
- Ни один нетестовый файл не импортирует `@/lib`, `@/server`, `node:*`, Prisma или `server-only`.
- Из внешних пакетов используются только `zod` (`content.ts`, `motion-schema.ts`, `schema.ts`,
  `typography-schema.ts`) и `zod-to-json-schema` (`schema.ts:19`).
- [`index.ts`](../../../src/video/index.ts) реэкспортирует только чистые модули. Но любой импорт
  значения из `@/video` тянет схему, а с ней zod и zod-to-json-schema.
- `typography-schema.ts:133` требует `Intl.Segmenter`.
- `getVideoDocumentJsonSchema` — `schema.ts:1041`.
- `videoDocumentSchema` — это `z.custom(preflight).pipe(documentObject.superRefine(...))` (`schema.ts:699`).

**Рендерер `src/remotion/`.**
- Нетестовые файлы импортируют только `react`, `remotion`, `./*` и `../video/*`.
- [`studio-frame.ts`](../../../src/remotion/studio-frame.ts) зависит от `remotion` (`spring`)
  и экспортирует `evaluateNode(node, frame, fps)` (`:54`), `transitionAt`, `playerMediaSync`
  и другие функции кадра.
- Hit-test и прямоугольника узла на кадре нет нигде. `node.rect` статичен,
  а смещения даёт `evaluateNode`.
- [`Root.tsx`](../../../src/remotion/Root.tsx) регистрирует композиции `Studio` и `StoryboardSheet`
  для бандлера.

**Замер текста.**
- [`src/server/studio/typography-fonts.ts`](../../../src/server/studio/typography-fonts.ts)
  импортирует `server-only`, `node:*`, `fontkit` и `@/lib/storage`.
- `createTypographyMeasureText({directory?})` (`:18`) читает шрифты из
  `public/fonts/typography-v1` (`:12`), сверяя байты и SHA-256 с `typographyFontAssets`
  ([`font-manifest.ts`](../../../src/video/font-manifest.ts)).
- `compileVideo(input, manifest, {measureText?})` (`compiler.ts:31`). Провайдер нужен, только
  если документ использует типографику (`assets.ts:568`).
- В каталоге 10 TTF на 25 МБ, из них `noto-sans-jp` 9,6 МБ и `noto-serif-jp` 13,6 МБ.

**Снимок и публикация.**
- `freezeStudioProject(userId, id, {expectedVersion?, revision?, idempotencyKey?})` (`revisions.ts:52`).
  Снимок (`types.ts:175`) хранит:
  - `document` и `resolvedDocument`;
  - `manifest`;
  - `files: Record<hash, {path, hash, bytes, posterPath?, posterHash?}>`;
  - `fontFiles`, `plan`, `validation`, `hash`.
- Хэши файлов перепроверяются перед записью (`:125`). `StudioSnapshot` (`schema.prisma:276`)
  держит `payloadJson`.
- `StudioPublication` (`:290`): `projectId @unique`, `token @unique`, `snapshotId`, `revision`.
  Токен — `randomBytes(16).base64url` ([`publication.ts:196`](../../../src/server/studio/publication.ts)).
  Публикует только владелец с `media:upload` (`shared.ts:20`).
- [`watch-public.ts`](../../../src/server/studio/watch-public.ts) называет файлы `<hash><ext>`.
  `rewritePlanMedia` ([`src/watch/model.ts:253`](../../../src/watch/model.ts)) переписывает `src`
  на `/api/watch/<token>/media/<file>`. Файлы отдаёт `streamStudioFile`
  (`http-media.ts:73`: Range, ETag, immutable).

**Движок.** `engineId` хэширует `package-lock.json`, `public/fonts/typography-v1`, `src/remotion`,
`src/video` и `src/lib` ([`engine.ts:29`](../../../src/server/studio/engine.ts)).
`verifyEngine` сверяет `VERSION` Remotion.

**Плеер `/watch`** ([`WatchPlayer.tsx`](../../../src/watch/WatchPlayer.tsx)).
- `<Player component=StudioVideo inputProps={plan, assetMode:"url"} controls={false} clickToPlay={false}
  numberOfSharedAudioTags=sharedAudioTagCount(plan) acknowledgeRemotionLicense …/>`.
- Из `PlayerRef` используются `play`, `pause`, `seekTo`, `getCurrentFrame`, громкость и mute.
  Из событий — `frameupdate`, `waiting`, `resume`, `ended` и другие.
- Внешних часов нет. Предзагрузка и общие аудио-теги — задача 25.

**Источник и привязки.**
- `reconcileSource` ([`sources.ts:109`](../../../src/server/studio/sources.ts)) сопоставляет участников
  по id, перезаписывает `label`, `rank`, `score` и метаданные и сохраняет оформление через spread.
- Текстовые привязки (`nodes.ts:84`, enum `schema.ts:230`): `document.title`; `participant.label`,
  `displayLabel`, `rank`, `comment`, `album`, `score`, `subtitle`, `tier`; `segment.title`, `subtitle`,
  `number`, `count`; `round.prompt`; `group.label`.
- Токены медиа: `$participant.visual`, `$participant.audio`, `$segment.poster`.

**Picker и события.**
- `compilePicker` (`blocks.ts:238`) даёт `phases = {revealStartFrame, timerStartFrame, answerStartFrame?}`.
- Кадры событий `scene.start`, `card.reveal`, `timer.start`, `answer.reveal` считает `anchorFrame`
  (`motion-compiler.ts:60`). В плане хранятся только `CompiledScene.boardEvents`.

**MCP.**
- Только stdio (`StdioServerTransport`, [`src/mcp/server.ts:311`](../../../src/mcp/server.ts)).
- Актёр — `MCP_ACTOR_EMAIL` ([`actor.ts:11`](../../../src/mcp/actor.ts)), права перепроверяются
  на каждый вызов.
- Инструмента или сервиса копии проекта нет.
- Установлен `@modelcontextprotocol/sdk` 1.29.0: в нём есть `streamableHttp` и
  `webStandardStreamableHttp` (Request/Response).

**Окружение.**
- react и react-dom 18.3.1; remotion и `@remotion/*` 4.0.475 (в `package.json` `^4.0.230`);
  zod ^3.23.8; next ^14.2.35.
- Алиас `@/*` → `src/*`.
- В `next.config.mjs` нет `transpilePackages`.

**Asobiba** (парная задача) использует React 19, Zod 4, Vite 8 и tsx.
Её `tsconfig` строже: `verbatimModuleSyntax`, `isolatedModules`, `module: Preserve`.

## Решения

### T01. Как отдать ядро douga в asobiba

- Варианты:
  - а) npm workspaces в douga, пакеты с исходниками TS; asobiba подключает их из соседней папки через `file:`;
  - б) публикация собранных пакетов в реестр (npm или GitHub Packages);
  - в) asobiba вызывает API douga;
  - г) копия кода в asobiba.
- Рекомендация: а. Один код, новинки появляются после пересборки, без шага публикации.
  Такой же приём asobiba использует для своих пакетов: `exports` ведут на `./src/*.ts`.
  Вариант б оставляем на случай, если сервисы разъедутся по разным машинам. Вариант в
  противоречит P02 asobiba (партия без douga). Вариант г — дублирование.
- **Решение:** а. Корень douga остаётся Next-приложением и становится корнем workspaces
  `["packages/*"]`. Пакеты:

| Пакет | Откуда | Что внутри | Зависимости |
|---|---|---|---|
| `@douga/video` | `src/video/*` | схема, компилятор, пресеты, рецепты, моушен, типографика, доски, патчи, `compiled-media`; новое: интерактивный слой, данные партии, `slicePlan`, формат снимка | `zod` 3, `zod-to-json-schema` |
| `@douga/node` | часть `typography-fonts.ts` | `createTypographyMeasureText` по списку файлов шрифтов, чтение и проверка интерактивного снимка | `fontkit`, `@douga/video` |
| `@douga/render` | `src/remotion/*`, кроме `Root.tsx`/`index.ts` | `StudioVideo`, Motion*, Typography*, `studio-frame`, `studio-paint`, `image-ready`, `premount`; новое: `hitTest` | peer: `react`, `react-dom`, `remotion` |
| `@douga/player` | ядро `src/watch/WatchPlayer.tsx` и `model.ts` | общий плеер, предзагрузка, `InteractivePlayer` | peer: `react`, `react-dom`, `remotion`, `@remotion/player` |

  В приложении остаются:
  - `src/remotion-entry/` (`Root.tsx`, `index.ts`) — регистрация композиций для бандлера;
  - оболочка `/watch` с кнопками, главами и клавишами;
  - всё серверное (`src/server`, `src/lib`) и UI.

### T02. Импорты внутри douga

- Варианты:
  - а) приложение импортирует пакеты по имени (`@douga/video`), Next транспилирует их через `transpilePackages`;
  - б) алиас `@/video` в `tsconfig.paths` на папку пакета.
- Рекомендация: а. Имена пакетов одинаково резолвятся в Next, бандлере Remotion, esbuild-бандле
  офлайн-плеера, tsx и Vitest без настройки алиасов в каждом.
- **Решение:** а.
  - Внутри пакетов только относительные импорты и импорты по имени пакета, без `@/`.
  - В `next.config.mjs` добавляется `transpilePackages` для четырёх пакетов, а `fontkit`
    остаётся во внешних серверных пакетах.
  - Импорты `@/video` и `@/remotion` в приложении заменяются механически.
  - Vitest собирает тесты из `packages/*/src`.

### T03. Совместимость пакетов с asobiba

- **Решение:**
  - **React и Remotion.** `@douga/render` и `@douga/player` объявляют `react`/`react-dom` `>=18.3 <20`,
    а `remotion` и `@remotion/player` — точной версией douga, и всё это как peerDependencies.
    `@douga/render` экспортирует `REMOTION_VERSION`: по нему asobiba проверяет, что её Remotion
    той же версии.
  - **Клиент без zod.** Клиентские пакеты берут из `@douga/video` только типы (`import type`)
    и чистые модули по подпутям: `@douga/video/compiled-media`, `/font-manifest`, `/motion-types`,
    `/interactive-types`. Это закрепляет `exports` вида `"./*": "./src/*.ts"`. В бандл сайта
    asobiba схема и zod 3 не попадают. Тест на граф импортов следит за этим, как
    `server-boundary.test.ts`.
  - **Строгость TS.** Код пакетов проходит и `tsconfig` douga, и более строгий `tsconfig` asobiba:
    `verbatimModuleSyntax`, `import type` для типов, без опоры на глобальный `React`.
    У каждого пакета свой `tsconfig.json` с этими флагами, и общий `npx tsc --noEmit` douga
    проверяет пакеты через project references или `include`.

### T04. Zod 3 остаётся

- Варианты:
  - а) пакеты остаются на zod 3;
  - б) перевести douga на Zod 4 в этой задаче.
- Рекомендация: а. Asobiba не валидирует документы douga: документ правит MCP douga.
  Сервер asobiba получает zod 3 из `douga/node_modules` и проверяет им формат снимка.
  Сайт asobiba zod douga не грузит (T03). Миграция трогает 109 `.strict()`, `z.custom().pipe`,
  `zod-to-json-schema` и пресеты, а это большой риск для неизменности линейных роликов.
- **Решение:** а. Миграция на Zod 4 — отдельная задача, записывается в «Хвосты».

### T05. `engineId` и бандлы

- **Решение:**
  - `sourceId()` в `engine.ts` хэширует `packages/video/src`, `packages/render/src` и прежние
    `public/fonts/typography-v1`, `src/lib`, `package-lock.json`, а также `src/remotion-entry`;
  - бандл офлайн-плеера (esbuild) хэширует `packages/player/src`;
  - первое задание после переноса пересоберёт бандл: это ожидаемо и не меняет кадры (T19).

### T06. Интерактивный слой документа

- Варианты:
  - а) необязательный раздел `interactive` в документе v2;
  - б) отдельный тип документа v3.
- Рекомендация: а (P01 продукта). Патчи, CAS, история, пресеты и рецепты работают как есть.
- **Решение:** а, версия контракта `INTERACTIVE_CONTRACT = 1`. Схема — строгий zod,
  документ v1 слой не принимает.

```ts
interactive?: {
  version: 1;
  moments: {                      // где ролик встаёт и ждёт игру
    id: string;
    sceneId: string;              // исходная сцена (или её компилированный id для repeat)
    at: { event: "scene.start" | "card.reveal" | "timer.start" | "answer.reveal"
                 | "scene.end" | BoardEvent["event"]; cardId?: string }
      | { time: Time };           // от начала сцены
  }[];
  choices: {                      // какие карточки можно нажать
    id: string;
    sceneId: string;
    cards: "all" | string[];      // id карточек picker, participantId топа, cardId доски
  }[];
  templates: {                    // сегменты и сцены, которым нужны данные партии
    segmentId?: string; sceneId?: string;
    uses: ("players" | "votes" | "rank" | "score" | "pickedBy" | "answer" | "texts")[];
    order?: "rank";               // переставить участников сегмента по rank данных
  }[];
  sample: MatchData;              // примерные данные для раскадровки и линейного рендера
}
```

  Проверка: сцены, события, карточки и сегменты существуют; событие доступно в сцене
  (те же правила, что у `motion.at`: недоступное событие — диагностическая ошибка).
  `uses` согласован с привязками сцены. Бюджеты: до 200 моментов, до 200 выборов,
  `sample` до 256 КиБ.

### T07. Данные партии

- Варианты:
  - а) чистая функция `applyMatchData(document, data)` правит источник и привязки до компиляции;
  - б) «живые» узлы, которые плеер заполняет в браузере.
- Рекомендация: а. Это тот же приём, что `reconcileSource`: данные — в источнике, оформление —
  по id. Замер текста остаётся на сервере (задача 31), браузер переносов не считает.
  Вариант б сломал бы типографику и совпадение кадров с MP4.
- **Решение:** а.

```ts
interface MatchData {
  players?: { id: string; name: string; score?: number; rank?: number }[];  // ≤ 16
  participants?: Record<string, {           // ключ — participantId
    votes?: number; score?: number; rank?: number;
    pickedBy?: string[];                    // id игроков
    comment?: string;
  }>;
  rounds?: Record<string, { answer?: { cardIds?: string[]; groupIds?: string[] } }>;
  texts?: Record<string, string>;           // ≤ 32 ключей, ≤ 500 символов
}
```

  - `applyMatchData` переписывает `participant.score`, `rank` и `comment` и `round.answer`.
    Для `templates[].order:"rank"` он переставляет участников сегмента по `rank`, как
    `reconcileSource` переставляет по рейтингу.
  - Новые текстовые привязки: `participant.votes`, `participant.pickedBy` (имена через запятую),
    `player.name`, `player.score`, `player.rank` внутри контейнера `repeat:"players"`
    и `match.text.<key>`.
  - Без `interactive` функция ничего не меняет, даже ссылку на объект.
  - Сайт и задания студии компилируют интерактивный документ через `applyMatchData(doc, sample)`.
    Поэтому сцены-шаблоны в линейном ролике, раскадровке и клипе идут с примерными данными
    (P01, P05).

### T08. План с интерактивом

- **Решение:** IR остаётся `schemaVersion: 1`, `compilerVersion: "1.0.0"`. Только у интерактивного
  документа план получает необязательное поле:

```ts
interaction?: {
  contract: 1;
  scenes: {
    id: string;                 // компилированный id сцены
    sourceSceneId: string; segmentId?: string; roundId?: string; participantId?: string;
    holds: { momentId: string; frame: number }[];   // кадры от начала плана
    choices: { choiceId: string; nodeId: string; cardId?: string; participantId?: string }[];
  }[];
}
```

  - Кадры моментов считает тот же `anchorFrame`, что и для `motion.at`.
  - `scene.end` — последний кадр сцены.
  - `StudioVideo` поле не читает.
  - Неинтерактивный документ даёт план байт в байт как раньше (T19).

### T09. Нарезка плана

- **Решение:** чистая `slicePlan(plan, {sceneIds} | {segmentId} | {from, to})` в `@douga/video`.
  - Результат — самостоятельный план [from, to): сцены и аудио-реплики перебазированы
    к кадру 0, реплика, начатая до окна, получает `offsetSec`.
  - В нём остаются только используемые медиа (через `compiledMediaUsages`) и шрифты `plan.fonts`.
  - `segments` и `interaction` фильтруются.
  - Входящий переход первой сцены превращается в склейку: предыдущей сцены в куске нет.
  - Нарезка по границам сцен: середину сцены резать нельзя.

### T10. Hit-test

- **Решение:** `hitTest(plan, frame, {x, y}) → {nodeId, cardId?, participantId?} | null`
  в `@douga/render`.
  - Работает только по узлам `interaction.scenes[].choices` текущей сцены.
  - Берёт `node.rect` и `evaluateNode` (смещение, масштаб, поворот, видимость, прозрачность > 0.05)
    и рамку контейнера-родителя.
  - Учитывает `layer`.
  - Координаты задаются в пространстве композиции, плеер переводит в них клик.
  - Для тестов есть `choiceRects(plan, frame)` — прямоугольники выбора на кадре.

### T11. Плеер

- **Решение:** `@douga/player` разделяется на две части.
  - Ядро: `Player` с `StudioVideo`, `sharedAudioTagCount`, предзагрузка картинок и звука
    из задачи 25, `rewritePlanMedia(plan, srcOf)` с внешней функцией адреса.
    `WatchPlayer` приложения строится на этом ядре.
  - `InteractivePlayer` получает `plan`, `startedAt` (мс сервера, кадр 0), `now()` (часы сервера),
    `holdFrame?`, `paused`, `muted`, `volume`, `onEvent(e)`, `onPick(hit)`, `onReady`, `onError`.
  - Синхронизация: целевой кадр — `min(holdFrame, floor((now() − startedAt) · fps / 1000))`.
    При расхождении больше 6 кадров делается `seekTo`, меньше — плеер идёт сам. В `holdFrame`
    плеер стоит на кадре, `paused` замораживает его.
  - Кнопок нет. Клик переводится в координаты композиции, проходит через `hitTest`
    и вызывает `onPick`.
  - Автозвук запрещён — плеер играет без звука и сообщает `onEvent({type:"audio-blocked"})`.
  - `acknowledgeRemotionLicense` остаётся.

### T12. Шрифты для компиляции вне douga

- Варианты:
  - а) снимок несёт все начертания семейств документа и JP-запасной;
  - б) asobiba берёт шрифты из папки douga.
- Рекомендация: а. Данные партии (имена игроков, японские названия) приходят после
  публикации, а снимок должен быть самодостаточным (P04 продукта). Вариант б привязал бы
  партию к папке douga на диске.
- **Решение:** а. В снимке есть `runtimeFonts`: все грани семейств из `settings.typography`
  и `node.typography`, плюс `noto-sans-jp` или `noto-serif-jp` по виду семейства.
  `@douga/node` `createTypographyMeasureText({files: [{faceId, path, sha256}]})` проверяет хэши,
  как прежний `directory`-вариант. Плееру уходят только `plan.fonts`, то есть реально нужные грани.

### T13. Интерактивная публикация и формат снимка

- **Решение:**
  - **Модель.** Новая модель `StudioInteractivePublication`: `id`, `projectId @unique`, `userId`,
    `token @unique`, `snapshotId`, `revision`, `status` (`preparing|ready|failed`), `manifestHash`,
    `stillJobId?`, даты.
  - **Защита снимка.** Снимок под интерактивной публикацией защищён так же, как под обычной
    (`PUBLICATION_IN_USE`). Удаление проекта и аккаунта сначала снимает её.
  - **Публикация.** `freezeStudioProject` с номером ревизии, затем одно задание кадров
    (общий тяжёлый слот, квоты превью). На каждую компилированную сцену берётся кадр:
    момент, если он есть, иначе устойчивое состояние из `storyboard.ts`; сцены-шаблоны —
    на `sample`, ≤ 720 по длинной стороне. После кадров статус `ready`.
  - **Формат** `douga-interactive-snapshot@1`, один JSON:

```ts
{
  format: "douga-interactive-snapshot"; version: 1; contract: 1;
  engine: { remotion: string; compilerVersion: "1.0.0"; packages: string /* хэш packages/*/src */ };
  project: { id: string; title: string; revision: number };
  document: VideoDocument;                // resolved, с interactive
  manifest: AssetManifest;                // src = "sha256:<hash><ext>"
  files: { hash: string; ext: string; bytes: number; kind: "image"|"video"|"audio"|"poster"|"font"|"still" }[];
  runtimeFonts: { faceId: string; hash: string }[];
  scenes: { id; sourceSceneId; segmentId?; title; from; to;
            holds: {momentId; frame}[]; choices: {choiceId; cardId?; participantId?; label}[];
            uses: string[]; still: string /* hash */ }[];
  sample: MatchData;
  hash: string;                           // sha256 канонического JSON без поля hash
}
```

  - **Маршруты** (только токен, без сессии, как `/watch`):
    - `GET /api/interactive/<token>/manifest`;
    - `GET /api/interactive/<token>/files/<hash><ext>` через `streamStudioFile`;
    - для `preparing` — `409 SNAPSHOT_NOT_READY`, для снятого или чужого — 404.
  - **Повторная публикация** меняет снимок и оставляет токен, снятие удаляет строку.

### T14. Копия проекта

- **Решение:** `copyStudioProject(userId, id, {revision?, title?, idempotencyKey?})`.
  - Новый проект с документом головы или указанной ревизии получает новые `StudioAssetReference`
    (head/draft) и прежний `source`: связь с турниром сохраняется.
  - История начинается с ревизии 1, причина — `copy`. Публикации не копируются.
  - Есть HTTP-маршрут и инструмент MCP `video_project_copy`.
  - Права: владелец исходного проекта с `media:upload`, квоты проектов прежние.

### T15. Раскадровка, ревью и задания с данными

- **Решение:**
  - `video_storyboard`, `video_review`, `video_job_start` (`still|clip|audio`) и `video_timeline_get`
    принимают необязательный `matchData`. Он проходит проверку той же схемой, что `sample`,
    и в документ не записывается.
  - Frozen input задания хранит его рядом со снимком, а ключ повторного задания его учитывает.
  - Ревью дополнительно проверяет вытеснение текста на худших данных: самые длинные имена
    из `sample` и `matchData` и 16 игроков.

### T16. Интерактивные рецепты и короткая форма

- **Решение:**
  - Рецепты `recipe.interactive.<flow>.<format>`, где flow — `quiz-question`, `quiz-media`,
    `quiz-reveal`, `vote-result`, `scoreboard`, а format — `wide|vertical|square`. Это 15 рецептов
    в одном стиле.
  - Каждый рецепт несёт разметку `interactive` с метаданными `contentForm` и `examples`,
    как рецепты задачи 32.
  - `video_content_set` получает часть `interactive` (режимы `merge`/`replace`, как у остальных
    частей): агент задаёт моменты, выбор и `sample` короткой формой, без ручных nodes.
  - Визуальные фикстуры задачи 32 расширяются на новые рецепты.

### T17. MCP

- **Решение:**
  - Новые инструменты: `video_project_copy`, `video_interactive_publish({projectId, revision?})`
    (возвращает token, status, url), `video_interactive_get`, `video_interactive_unpublish`.
  - `video_capabilities` получает раздел `interactive`: схему слоя, `MatchData`, привязки
    и маршрут в asobiba.
  - Аргумент `matchData` у инструментов из T15.
  - Инструкция `initialize` остаётся ≤ 3 КиБ, подробный маршрут — в SDK-гиде задачи.

### T18. MCP по HTTP к хостингу

- Варианты:
  - а) отдельный процесс `npm run mcp:http` на `node:http` с `StreamableHTTPServerTransport`;
  - б) маршрут Next `src/app/api/mcp/route.ts` на `WebStandardStreamableHTTPServerTransport`.
- Рекомендация: б. Один процесс сайта, тот же origin и reverse proxy, транспорт в SDK 1.29.0
  работает с Request/Response. Режим без сессий, как в asobiba. Вариант а — запасной,
  если Next мешает долгим ответам.
- **Решение:** б, с личными токенами.
  - Модель `ApiToken` (`tokenHash`, `prefix`, `revokedAt`, `lastUsedAt`), выпуск в кабинете,
    формат `dga_…`.
  - Актёр — владелец токена. Гостям токены не выдаются.
  - Инструменты регистрируются той же функцией, что и в stdio: `createMcpServer(actor)`.
  - stdio с `MCP_ACTOR_EMAIL` остаётся.
  - Мутации HTTP MCP не проверяют `Origin`: запрос идёт от агента с Bearer-токеном,
    а не от браузера с cookie.

### T19. Неизменность линейных роликов и проверка

- **Решение:**
  - До и после переноса в пакеты полный JSON плана всех 87 пресетов × 5 FPS совпадает
    (проверка задачи 30).
  - `npm run test:visual` зелёный.
  - Тест: `applyMatchData` без `interactive` возвращает тот же объект, а план без `interactive`
    не содержит `interaction`.
  - Новые тесты: схема слоя и `MatchData`, `anchorFrame` для моментов, `slicePlan`
    (медиа, шрифты, аудио, переходы), `hitTest` на анимированных карточках, формат снимка
    и проверка хэшей, копия проекта, интеграция публикации с кадрами.
  - Живая проверка: интерактивная копия, раскадровка на `sample` и на `matchData`,
    публикация, загрузка манифеста и файлов по токену, импорт в asobiba (парная задача),
    клип и MP4 интерактивного проекта совпадают с раскадровкой.
  - Пакеты проходят `tsc` asobiba: это проверяет её QG.

## Затронутые зоны

- [`.ai/map/studio-sdk.md`](../../map/studio-sdk.md) — пакеты, интерактивный слой, данные партии,
  нарезка, снимок, копия.
- [`.ai/map/render.md`](../../map/render.md) — рендерер в пакете, `hitTest`, `engineId`, точка входа бандлера.
- [`.ai/map/mcp.md`](../../map/mcp.md) — новые инструменты, `matchData`, HTTP-транспорт и токены.
- [`.ai/map/roles.md`](../../map/roles.md) — личные токены MCP, права интерактивной публикации.
- [`.ai/map/dev-env.md`](../../map/dev-env.md) — workspaces, пакеты, `transpilePackages`,
  соседняя asobiba, запуск MCP по HTTP.
- `AGENTS.md` — строка про пакеты в карте и командах.

## Риски

- Перенос `src/video` и `src/remotion` трогает сотни импортов. Делается отдельным механическим
  коммитом с проверкой IR и визуальной регрессии до любых новых возможностей.
- Remotion Player на React 19 в asobiba проверяется спайком до основной работы
  (шаг 1 парной задачи).
- Next 14 и `transpilePackages` с TSX из пакетов. Бандлер Remotion (webpack) и esbuild офлайн-плеера
  должны резолвить пакеты по симлинкам. Проверяется сборкой, MP4 и офлайн-`.html` сразу после переноса.
