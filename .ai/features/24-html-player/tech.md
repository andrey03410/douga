# Техника

> Вводные для исполнителя (Cursor, автономный режим). Их собрал агент Claude Code на коммите
> `90c11a7`. Решения T01… ещё не приняты: исполнитель сверяет вводные с кодом, правит неверное,
> принимает решения и записывает их здесь. Рекомендации ниже — отправная точка, не приказ.

## Исходная система

Факты собраны по коду на `90c11a7`. Номера строк могли сдвинуться, ориентируйся на имена функций.

### Как превью студии получает медиа

- Plan в режиме `"url"` содержит относительные адреса. Их строит `resolveAssets`
  в `src/server/studio/assets.ts`:
  - ревизия с каталогом версии (commit, freeze, смена источника) даёт
    `/api/studio/media?path=<путь в storage>`;
  - черновик без каталога даёт `/api/arts/<artId>`, `/api/tracks/<id>/audio`
    и `/api/studio/builtin/<name>`;
  - постеры всегда идут через `/api/studio/media?path=`.
- `/api/studio/media` проверяет по порядку:
  1. `userOr401`;
  2. `actor()` с `media:upload`;
  3. путь должен совпасть с `files[*].path` или `posterPath` ревизии или снимка этого пользователя
     (`src/server/studio/http-media.ts`, `ownedStudioMedia`);
  4. `safeFile` в `assets.ts` удерживает realpath внутри `storage/`.

  Отдаёт `streamStudioFile`: он стримит файл и правильно разбирает Range,
  включая суффиксный и выход за конец.
- `StudioVideo.tsx`, функция `resolveAsset`: в `"static"` вызывает `staticFile(src)`,
  в `"url"` берёт `src` как есть. Других различий по `assetMode` в композиции нет.
- Весь `/api/studio/*` идёт через catch-all `src/app/api/studio/[[...path]]/route.ts` → `studioHttp`
  (`src/server/studio/http.ts`), а тот первым делом вызывает `userOr401`. Публичный маршрут
  поэтому должен жить вне `/api/studio/`. `middleware.ts` в проекте нет: страницы защищают себя
  сами. Корневой `src/app/layout.tsx` рисует шапку `.topbar` на всех страницах и вызывает
  `currentUser()`.
- Проверка `Origin` у мутаций — `http-origin.ts`, сверка с `x-forwarded-host`/`host`.

### Снимок ревизии

- `StudioSnapshot` содержит `id`, `projectId` (Cascade), `revisionId` (Restrict), `payloadJson`, `bytes`
  и `createdAt`. В `payloadJson` лежит `StudioFrozenRevision` (`src/video/types.ts`):
  `document`, `resolvedDocument`, `manifest`, `files[{path, hash, bytes, posterPath?…}]`, `plan`,
  `validation`, `runtime`, `hash`. Пути `files` по комментарию в типах — только для сервера.
- Файлы ревизии лежат в `storage/studio/<userId>/<projectId>/versions/<uuid>/<sha256><ext>`.
  Это **полные копии** исходников из пула: ничего не нарезано и не перекодировано.
  Снимок свои файлы не копирует, а использует каталог ревизии.
- `freezeStudioProject` (`src/server/studio/revisions.ts`) **коммитит сохранённый на сервере черновик
  новой ревизией** с reason `freeze`. Несохранённый локальный буфер редактора на сервер не попадает.
- MP4-рендер (`src/server/studio/render.ts`):
  1. копирует проверенный бандл движка;
  2. кладёт файлы снимка в `serve/public/<digest><ext>`;
  3. переписывает `src` и `posterSrc` плана на имя файла;
  4. рендерит с `assetMode: "static"`.
- Кто удаляет снимки:
  - `deleteStudioSnapshot`;
  - `deleteStudioJob`, когда удаляется последнее задание снимка;
  - `releaseUnclaimedSnapshot` в `jobs.ts`: снимок без заданий удаляется;
  - удаление проекта (оно отказывает, пока у проекта есть задания);
  - `deleteUser` в `src/server/users.ts`: одна транзакция, задания → снимки → проекты.

  Ревизию нельзя удалить, пока на неё ссылается снимок.

### Как композиция играет в браузере

- `StudioVideo` использует `Audio`, `Freeze`, `Img`, `Loop`, `OffthreadVideo`, `Sequence`, `staticFile`.
  В плеере видео — немой `OffthreadVideo` (вне рендера Remotion рисует обычный HTML5 video)
  с `trimBefore/trimAfter` внутри `Sequence`/`Loop`. Звук видео-карточки идёт отдельным cue.
- У всех медиа уже стоят `pauseWhenBuffering: true` и `acceptableTimeShiftInSeconds: 2/fps`
  (`src/remotion/studio-frame.ts`).
- Громкость = `cue.volume × fadeIn × fadeOut × duck`, в окнах mute — 0. Ducking музыки под
  primary/voice — в `src/video/audio.ts`.
- Шрифт только системный: `"Arial", "Helvetica Neue", sans-serif` (константа `FONT`
  в `StudioVideo.tsx`). `@font-face`, google-fonts и `delayRender` нет.
- `StudioPreview.tsx` не задаёт `numberOfSharedAudioTags`, значит действует дефолт 4.x — 5.

### План и главы

- `CompiledVideo.scenes[]` — `CompiledScene` с полями `id`, `kind` (`custom|top|picker|answer`),
  `from` (абсолютный кадр), `durationInFrames`, `participantId?`, `roundId?` и `phases`
  (`revealStartFrame?`, `timerStartFrame?`, `answerStartFrame?` — локальные кадры сцены).
- Индекса раунда нет, сцены идут по порядку. Раунд с отдельной сценой ответа даёт две сцены
  с одним `roundId`. Таймер — узел `type: "timer"` с `timerFrames`.

### Студия, задания, квоты, MCP

- Панель «Задания» и кнопка «Финальный MP4» — в `src/app/studio/[id]/StudioWorkspace.tsx`.
  Кнопки выключены при `busy`, грязном буфере или конфликте, отправляют `expectedVersion`.
  Состояние берётся из `meta.revision`, `meta.hasDraft`, `buffer.dirty` и `previewRevision`.
- Виды заданий: `still|clip|audio|render` и `import`. `studioJobLimits` — в `job-types.ts`.
  Квота 512 МиБ на результаты заданий для ролей без `render:run`.
- `usageSummary().studio` считает `bytes` по файлам ревизий (без дублей по пути) и `resultBytes`
  по заданиям. Публикация поверх файлов ревизии новых байт не добавляет.
- MCP: обёртка `register(name, desc, schema, fn)` в `src/mcp/studio-tools.ts`, все инструменты
  с префиксом `video_`. Актор — `MCP_ACTOR_EMAIL`, права проверяют сервисы. Переменной
  с публичным адресом сайта нет: из адресов в `.env.example` есть только `DATABASE_URL`
  и `SHIKIMORI_BASE_URL`.
- Бандлеры: `esbuild` 0.28 и `webpack` 5 есть только транзитивно (`@remotion/bundler`, `tsx`),
  в `package.json` их нет. `engineId` — SHA-256 `package-lock.json` и файлов `src/remotion`,
  `src/video`, `src/lib` (`src/server/studio/engine.ts`). `next.config.mjs` выносит из бандла
  `@remotion/bundler`, `@remotion/renderer`, `ffmpeg-static` и `music-metadata`.
- `mediaResponse` в `src/lib/api.ts` получает файл целиком (`readFile` на каждый запрос)
  и неверно разбирает суффиксный Range `bytes=-N`. Для публичного маршрута бери логику
  `streamStudioFile`, а не `mediaResponse`.

## Внешние ограничения (сверено с документацией 2026-10-28)

### Remotion Player

Установлены `@remotion/player` и `remotion` версии 4.0.475, `esbuild` 0.28.0 (транзитивно,
через `@remotion/bundler`). Источник — [Player API](https://www.remotion.dev/docs/player/player).

- Свои контролы можно сделать двумя путями: `controls={false}` и своя панель-сосед через
  `PlayerRef`, либо `renderCustomControls` (с 4.0.418), `renderPlayPauseButton`,
  `renderFullscreenButton`, `renderMuteButton`, `renderVolumeSlider`.
  Встроенное автоскрытие — `hideControlsWhenPointerDoesntMove` (по умолчанию 3000 мс).
- `PlayerRef`: `play()`, `pause()`, `toggle()`, `seekTo(frame)`, `getCurrentFrame()`, `isPlaying()`,
  `mute()`/`unmute()`, `setVolume()`, `requestFullscreen()`/`exitFullscreen()`/`isFullscreen()`,
  `getContainerNode()`. События: `frameupdate`, `timeupdate`, `seeked`, `play`, `pause`, `ended`,
  `waiting`, `resume` (с 4.0.111), `fullscreenchange`, `error`, `mutechange`, `volumechange`.
- Обложка: `renderPoster`, `showPosterWhenUnplayed`, `showPosterWhenPaused`,
  `showPosterWhenBuffering`, `posterFillMode`.
- [Лучшие практики](https://www.remotion.dev/docs/player/best-practices):
  - `inputProps` мемоизировать;
  - часто меняющееся состояние (текущее время) держать в соседнем компоненте, а не в родителе
    `<Player>`, иначе плеер перерисовывается каждый кадр;
  - событие клика передавать в `play(e)` / `toggle(e)`.
- [Автоплей](https://www.remotion.dev/docs/player/autoplay):
  - `autoPlay` со звуком браузер заблокирует, старт нужен по клику;
  - в 4.x плеер держит `numberOfSharedAudioTags` = 5 общих `<audio>`, которые «прогреваются»
    первым кликом. Если одновременно играет больше пяти `<Html5Audio>`, плеер **бросает ошибку**,
    и число нужно поднять. Его нельзя менять после монтирования;
  - Safari строже всех.
- [Буферизация](https://www.remotion.dev/docs/player/buffer-state):
  - `<Html5Audio>`, `<Html5Video>` и `<OffthreadVideo>` ставят плеер на паузу при недогрузке
    только с `pauseWhenBuffering`, `<Img>` — с `pauseWhenLoading`. Компоненты `@remotion/media`
    делают это сами;
  - индикатор показывается через `bufferStateDelayInMilliseconds` (300 мс), его можно рисовать
    в `renderPlayPauseButton` (параметр `isBuffering`) или через обложку при буферизации.
- [`prefetch()`](https://www.remotion.dev/docs/prefetch) из `remotion` загружает ассет в память
  (`blob-url` или `base64`), и компоненты сами подхватывают blob по исходному URL. Память
  держится до `free()`. У blob пропадает расширение, поэтому нужен `contentType`. Если звук
  в Safari заикается, советуют `base64`.
- `acknowledgeRemotionLicense` убирает предупреждение о лицензии в консоли. Для личного проекта
  лицензия бесплатная, но перед публичным деплоем стоит перечитать условия Remotion.

### Браузеры

- **Полный экран на iPhone.** По [WebKit bug 240312](https://bugs.webkit.org/show_bug.cgi?id=240312)
  и [форуму Apple](https://developer.apple.com/forums/thread/133248?page=3) на iPhone полный экран
  доступен только `<video>`, на iPad и в Safari для macOS с 16.4 работает Fullscreen API.
  Свидетельств, что это поменялось в iOS 18, нет. По P10 там, где `document.fullscreenEnabled`
  ложно, кнопку полного экрана прячем.
- **Полный экран своей обёртки.** `PlayerRef.requestFullscreen()` разворачивает контейнер плеера.
  Своя панель, если она лежит снаружи, в полный экран не попадёт. Разворачивать нужно общую
  обёртку плеера и панели через `element.requestFullscreen()`.
- **`file://`.** В Chrome `fetch()` по `file://` не работает, ES-модули из соседних файлов
  блокируются CORS (страница с диска имеет origin `null`). Поэтому весь код — обычные inline
  `<script>`, без `type="module"` с внешними импортами. Всё медиа, шрифты и данные лежат внутри
  файла (`data:` или base64, раскрываемый в `Blob` + `URL.createObjectURL`), без запросов в сеть
  и к соседним файлам. Источники — сообщения сообщества (например, [MDN: CORS request not HTTP](https://developer.mozilla.org/docs/Web/HTTP/CORS/Errors/CORSRequestNotHttp)),
  поэтому исполнителю нужно проверить вживую: открыть файл из временной папки в Chrome
  с выключенной сетью.

## Развилки (решает исполнитель)

Формат записи решения — как в скилле `feature`: вопрос → варианты → рекомендация → **решение**.
Ниже рекомендации агента, решения исполнитель записывает сам.

### T01. Модель публикации

- Рекомендация:
  - новая модель `StudioPublication`: `id`, `projectId` (unique — одна публикация на проект),
    `userId`, `token` (unique, не меньше 128 бит из `crypto.randomBytes`, base64url), `snapshotId`
    (FK на `StudioSnapshot`, Restrict), `revision`, `createdAt` и `updatedAt`;
  - «Обновить» меняет `snapshotId`, токен остаётся. «Снять» удаляет строку, повторная публикация
    создаёт новый токен;
  - несуществующий и снятый токен показывают одно сообщение «Ролик снят с публикации»,
    чтобы не выдавать, существовала ли ссылка.
- После правки `schema.prisma` — `npx prisma db push && npx prisma generate` и перезапуск dev.

### T02. Что публикуется и как снимок не потеряется

- Рекомендация:
  - публикация делает `freezeStudioProject` по тем же правилам, что задание рендера: сохранённый
    черновик коммитится ревизией `freeze`, грязный локальный буфер блокирует кнопку,
    как у заданий;
  - **обязательно** научить `releaseUnclaimedSnapshot`, `deleteStudioJob` и `deleteStudioSnapshot`
    не удалять снимок, на который ссылается публикация. Иначе удаление последнего задания
    убьёт живую ссылку;
  - старый снимок после «Обновить» освобождается по тем же правилам;
  - удаление проекта и `deleteUser` сначала удаляют публикации, потом снимки. Удаление проекта
    из-за публикации не блокируется (P11);
  - удаление ревизии, которая опубликована, отказывает с понятным текстом.

### T03. Публичная страница

- Рекомендация:
  - маршрут `src/app/watch/[token]/page.tsx`: серверный компонент находит публикацию по токену,
    не вызывая `currentUser`/redirect, и отдаёт клиенту **только** `plan`. `document`, `manifest`
    и пути `files` наружу не отдаются;
  - `src` и `posterSrc` в плане переписываются на `/api/watch/<token>/media/<sha256><ext>`;
  - шапку сайта убрать проще всего полноэкранным `position: fixed; inset: 0` слоем поверх
    `.topbar`. Чище — route groups с отдельным root layout, но это переезд всех страниц.
    Выбери и запиши;
  - `<meta name="robots" content="noindex">`, `Referrer-Policy: no-referrer`, токен не логировать.

### T04. Публичная раздача медиа

- Рекомендация:
  - маршрут вне `/api/studio/`, например `src/app/api/watch/[token]/media/[file]/route.ts`;
  - разрешены только файлы и постеры из `files` снимка публикации, сверка по хэшу,
    затем `safeFile`;
  - стриминг с Range по образцу `streamStudioFile`, без чтения файла целиком;
  - `Cache-Control` такой, чтобы снятая ссылка не жила в кэше прокси (например, `private`).

### T05. Плеер-оболочка

Один компонент для страницы и для файла.

- Рекомендация:
  - `controls={false}` и своя панель-сосед на `PlayerRef` (события `frameupdate`/`timeupdate`,
    `waiting`/`resume`, `play`/`pause`, `fullscreenchange`). Встроенное автоскрытие не умеет
    правило «на паузе видна всегда» и главы;
  - полный экран — на общей обёртке, а не через `PlayerRef.requestFullscreen()`. Без
    `document.fullscreenEnabled` кнопку прячем;
  - `numberOfSharedAudioTags` = максимум одновременно звучащих cue по `plan.audio` с запасом.
    Считать до монтирования: после него число не меняется, а превышение бросает ошибку;
  - главы: первая сцена каждого нового `roundId` (пикер) или `participantId` (топ).
    ⏮ на первой главе ведёт в 0;
  - клик передаётся в `play(e)`/`toggle(e)` (`onClickCapture` ради Safari);
  - индикатор загрузки — по `waiting`/`resume` или `isBuffering`.

### T06. Шрифты в файле

Композиция и рендер используют системный Arial. На Windows и macOS он есть, поэтому паритет
там получается сам. Встроить сам Arial нельзя по лицензии.

- Варианты:
  - (а) оставить системный стек: на Linux и Android будет замена;
  - (б) встроить Arimo (Apache-2.0, метрически совместим с Arial) **после** Arial
    в `font-family` только в HTML-оболочке. Тогда замена у машин без Arial предсказуема,
    а у остальных ничего не меняется.
- Рекомендация: (б), если вес шрифта приемлем. Решение и отступление от слов P06 «шрифты внутри»
  записать.

### T07. Сборка одного `.html`

- Рекомендация:
  - отдельная точка входа (плеер + оболочка + `StudioVideo`), собранная esbuild в один IIFE.
    esbuild поставить прямой зависимостью и вынести в `serverComponentsExternalPackages`;
  - бандл собирать лениво и кэшировать по хэшу исходников, как `engineId`. Либо собирать
    при `npm run build`, но тогда он нужен и в `npm run dev`. Выбери и запиши;
  - медиа кладётся отдельными блоками base64 (по одному на ассет) и при загрузке раскрывается
    в `Blob` + `URL.createObjectURL` с правильным MIME. План переписывается на blob-адреса.
    Одна гигантская строка недопустима: у V8 есть предел длины строки (по памяти агента,
    около 2^29 символов — проверить);
  - никаких внешних URL в файле. Тест — проверка собранного файла на отсутствие `http(s)://`
    в ресурсах;
  - файл собирается по запросу и отдаётся потоком или из временного каталога, который
    удаляется. В квоту он не идёт, раз не хранится.

### T08. Нарезка медиа для файла

Файлы ревизии — полные копии исходников, поэтому без нарезки пикер с видео весит сотни мегабайт.

- Рекомендация:
  - по плану вычислить используемые окна каждого файла (cue звука с trim, видео-узлы
    с `trimBefore/trimAfter`/`Loop`), вырезать их с небольшим запасом ffmpeg-static
    и сдвинуть смещения в плане;
  - звук — AAC/m4a;
  - видео — перекодирование H.264 для точного старта либо `-c copy` от ближайшего ключевого
    кадра с пробой реального старта. Выбор между скоростью и точностью записать.
    Грабли `clipVideo` и чёрных кадров — в `.ai/map/render.md`;
  - картинки — как есть;
  - результат нарезки кэшировать по хэшу снимка. Порог размера, после которого
    предупреждаем или не собираем, выбрать по замеру и записать.

### T09. API и UI

- Рекомендация:
  - мутации публикации (опубликовать или обновить, снять) и `GET` статуса — внутри `studioHttp`
    (`/api/studio/projects/<id>/publication`), с проверкой `Origin`;
  - скачивание файла — `GET /api/studio/projects/<id>/export.html` с `Content-Disposition`,
    имя по названию проекта, как у `renderDownloadDisposition`. Размер до скачивания —
    отдельной оценкой или заранее собранным файлом. Выбери и запиши;
  - блок «Публикация» в панели «Задания» `StudioWorkspace.tsx`. Ссылку для копирования
    собирать из `window.location.origin`;
  - в `/account` — секция «Публикации» по образцу ленивых списков `AccountManager.tsx`
    с размером (байты файлов снимка) и снятием.

### T10. MCP

- Рекомендация:
  - `video_publish` (опубликовать или обновить, вернуть ссылку и ревизию), `video_unpublish`,
    по желанию — чтение статуса;
  - публичного адреса процесс MCP не знает. Добавить `DOUGA_PUBLIC_URL` (по умолчанию
    `http://localhost:3000`) в `.env.example` и README.

### T11. Права и квоты

- Рекомендация:
  - публиковать может автор с `media:upload` через `actor()`/`owned`, а не `render:run`;
  - квоту отдельно не считать: байты файлов ревизии уже учтены в `usageSummary().studio.bytes`.
    Если для файла появится постоянный кэш нарезки — учесть и его.

## Меняемые зоны

- [studio-sdk.md](../../map/studio-sdk.md) — публикация, снимки, HTTP, UI, экспорт.
- [roles.md](../../map/roles.md) — право публикации, публичная страница без входа, удаление аккаунта.
- [mcp.md](../../map/mcp.md) — новые инструменты и `DOUGA_PUBLIC_URL`.
- [render.md](../../map/render.md) — если меняются `src/remotion` или нарезка через `src/lib/audio.ts`.
- [media.md](../../map/media.md) — если меняется `mediaResponse` или отдача файлов.
- [dev-env.md](../../map/dev-env.md) — если появляется новая зависимость или переменная окружения.

## Как доказать готовность

Каждый пункт — с цифрами и путём к доказательству в `verify.md`. Доказательства кладутся
в `storage/verification/24-html-player/`. Тестовый проект собирай под своим проверочным
пользователем, чтобы в нём были картинки, видео-карточка со звуком, плейлист с кроссфейдом,
таймер с тиком и интро/аутро. Подойдёт пикер по пресету `picker.*.wide` и вертикальный вариант.

1. **Тройка** после последних правок: `npm test` → `npm run build` → `npx tsc --noEmit`, числа тестов.
2. **Паритет картинки.** Для одной ревизии сделай MP4-рендер и HTML-публикацию. На 6+ моментах
   (интро, появление карточки, середина таймера, подсветка ответа, стык раундов, аутро) сними
   кадр MP4 (`node_modules/ffmpeg-static/ffmpeg -ss <t> -i out.mp4 -frames:v 1`) и скриншот
   плеера после `seekTo(frame)` в том же размере. Сложи пары рядом, посмотри глазами, запиши PSNR
   (`ffmpeg -i a.png -i b.png -lavfi psnr -f null -`). Низкий PSNR без видимой причины — повод
   разобраться, а не записать как есть.
3. **Синхронность звука.** Во время проигрывания на странице и в файле каждые 2 с сверяй
   `currentTime` активных `<audio>`/`<video>` с ожидаемым по кадру плеера. Расхождение должно
   быть не больше 0,1 с. За полный прогон с локального сервера не должно быть событий `waiting`.
   Плюс `volumedetect` по фрагментам звука, вложенным в файл, против тех же окон MP4.
4. **Гость по ссылке.** Чистый контекст браузера без кук открывает `/watch/<токен>`: все медиа
   отвечают 200/206, ни одного 401/404, ошибок в консоли нет.
   - Медиа другого пользователя и медиа вне снимка через публичный маршрут — 404.
   - Снятая и несуществующая ссылки показывают «Ролик снят с публикации».
   - Обновление публикации оставляет ссылку прежней, а показывает новую ревизию.
   - Снятие и повторная публикация дают новую ссылку, старая мертва.
5. **Файл офлайн.** Скопируй `.html` во временную папку и открой через `file://` в puppeteer
   с `page.setOfflineMode(true)`. Ролик играет от начала до конца, сетевых запросов, кроме
   `data:`/`blob:`, нет, ошибок в консоли нет. Размер в интерфейсе совпадает с размером файла.
   Замерь вес файла у пикера с видео-карточкой.
6. **Скорость.** Время публикации и сборки файла против времени MP4-рендера того же проекта.
   Оба должны быть заметно быстрее рендера, цифры в `verify.md`.
7. **Контролы.** Автоскрытие через ~2,5 с без движения во время игры, на паузе панель видна.
   Работают клавиши Space, ←/→, F, M, PageUp/PageDown. Метки глав на полосе совпадают
   с началами раундов или позиций. Полный экран разворачивает и плеер, и панель.
8. **Телефон.** Эмуляция iPhone и Android: ролик вписан в экран, касание показывает контролы,
   кнопки полного экрана нет там, где браузер его не даёт.
9. **Студия и кабинет.** Кнопки публикации, копирования, обновления, снятия и скачивания
   работают. Предупреждение о несохранённых правках есть. В `/account` видны публикации
   с размером, снятие оттуда работает. Роль user публикует, квота учитывается.
10. **MCP.** Настоящий stdio-вызов нового инструмента публикует ревизию и возвращает ссылку,
    ссылка открывается.
11. **Удаление.** Удаление проекта и аккаунта с публикацией проходит без ошибок внешних ключей,
    файлы публикации уходят, ссылка мертва.
12. **Рендер не сломан.** После правок в `src/remotion`, `src/video` или `src/lib` студийный
    MP4-рендер того же проекта проходит (`npm run studio:worker -- --once --job <id>`),
    кадры и звук в порядке.
