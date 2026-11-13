# Рендер видео

Как Douga превращает план студии в MP4: композиция Remotion `Studio` в headless Chrome.
Вторая закрытая композиция `StoryboardSheet` собирает PNG-сетку из уже полученных
кадров того же renderer. Очередь, бюджеты и воркер описаны в [studio-sdk.md](studio-sdk.md).
Нарезка офлайн-`.html` живёт отдельно.

## Раскадровка и pixel regression (задача 32)

[`render-frames.ts`](../../src/server/studio/render-frames.ts) — общая подготовка
frozen media/fonts и renderStudioFrames для worker и regression runner.
Один openBrowser переиспользуется для нескольких PNG. Preview кадры ≤720 long edge;
эталоны всегда lossless scale1. [`storyboard-render.ts`](../../src/server/studio/storyboard-render.ts)
собирает ≤24 плитки в PNG≤12MiB, сохраняет отдельные кадры с hash ledger,
в compare может добавить pixelDiff:true: третья плитка RGBA-разницы и PSNR,
missing/dimensions явно notComparable. Считает суммарные output bytes и удаляет временные копии bundle после успеха.

`video_review mode:deep` использует те же private frozen inputs без auto-commit.
Клип декодируется ffmpeg, mean/peak/silent измерены по реальным audio samples;
визуальная/художественная оценка остаётся отдельной. Задание, декодированное без
ошибки, не объявляет плавность доказанной.

[`visual-fixtures.ts`](../../packages/video/src/visual-fixtures.ts) содержит непустые fixed
fixtures всех 54 прежних пресетов,33 рецептов,67 motion entries и типографики:
локальные SVG/PCM, RU/JP, границы, dense/empty. Матрица хранит available/selected
events и честно отмечает representative sampling (≤12 кадров/fixture).
[`visual-regression.ts`](../../packages/video/src/visual-regression.ts) считает PSNR,
changed ratio/maxDelta и ROI на RGBA, различает missing baseline/размер/среду.
EngineId — provenance, его изменение не отключает сравнение.

- `npm run test:visual` — fresh full render и check.
- `npm run visual:render -- --filter … --limit …` — ограниченная диагностика,
  не полный зелёный результат.
- `npm run visual:check` — HTML reference/actual/diff и JSON в storage/verification/32-storyboard.
- `npm run visual:accept -- --confirm --reason "…"` — только после просмотра;
  baseline в .ai/features/32-storyboard-reference/baselines версионируется.

SDK/project comparator сравнивает RGBA точно. Эталонный CLI после измерений
использует фиксированный предел: максимум4 изменённых пикселя и maxDelta≤1
на весь кадр; raw metrics/exactFrames/boundedNoiseFrames сохраняются. Записанные
ROI остаются exact0,но построены по compiled rect и не учитывают motion;
движущиеся области сохраняют тот же глобальный предел4×1. Крупные/структурные
изменения и любые превышения остаются FAIL. Режим закреплённой среды обязателен. У baseline есть browser/platform/node/fonts
и условия RGBA; несовместимая среда даёт отдельный отказ, не pass. Новый каталог
без fixture обнаруживается автоматическими тестами. Проверка маленькой пропавшей
подписи не прячется за высоким средним PSNR всего кадра.

## Моушен и resolved media

- [`motion-frame.ts`](../../packages/render/src/motion-frame.ts) оценивает 40 закрытых
  эффектов по scene-local frame/fps; движение складывается с keyframes.
  [`MotionText.tsx`](../../packages/render/src/MotionText.tsx) сохраняет пробелы,
  графемы Unicode и конечное число;
  переводы строк остаются в общем inline flow, а нейтральная поза возвращает
  исходный text node для сохранения кернинга; [`MotionWidgets.tsx`](../../packages/render/src/MotionWidgets.tsx)
  рисует timer/VS/badge/progress, [`MotionBackdrop.tsx`](../../packages/render/src/MotionBackdrop.tsx)
  — пять фонов из seed/кадра. CSS animations и wall-clock не используются.
- [`motion-transition.ts`](../../packages/render/src/motion-transition.ts) соединяет
  соседние сцены wipe/zoom/push/flash/iris/split/blur/crossfade. Outgoing удерживает
  последний кадр и Freeze context (включая source frame видео), без собственного
  fade/slide и без повторного аудио. Временной разрыв не перескакивается.
  Новый переход duration>0 у непосредственно следующей сцены заменяет только
  legacy exit предыдущей: её enter сохраняется, стык не возвращает уже исчезнувший
  контент. Duration0, разрыв, последняя сцена и legacy→legacy сохраняют старую математику.
  Ключ backdrop layer берётся из исходного массива до active filtering: продолжающий
  video слой не перемонтируется, когда соседний слой заканчивает crossfade.
- У crossfade/zoom/blur outgoing непрозрачен под incoming до конца перехода:
  одновременные opacity .5/.5 дают провал покрытия и здесь запрещены.
  Цвет с alpha строится через `studio-paint.ts:colorWithAlpha`, а не добавлением
  hex-суффикса к произвольному валидному CSS color. Новые VS/badge имеют fallback
  fontSize от rect; explicit style.fontSize приоритетнее.
- [`compiled-media.ts`](../../packages/video/src/compiled-media.ts): `compiledMediaUsages(plan)`
  — общий обход audio, nodes.media и backdrop.layers.media. Его используют
  worker rewrite, watch rewrite/preload и offline slices/posters/retarget/unresolved.
  Фоновые видео не должны пропадать, даже если scene.nodes.media пуст.
  Offline клонирует asset на usage: общий источник с разными обрезками не должен
  перезаписывать src/duration соседнего usage. При rewrite shared asset обходится один раз.
- Проверка задачи 30: старые picker answer/board move дают 5/5 одинаковых
  декодированных RGBA кадров; новые эффекты требуют настоящего MP4 и live watch/offline.

## Где код
- [`src/remotion-entry/index.ts`](../../src/remotion-entry/index.ts) → [`Root.tsx`](../../src/remotion-entry/Root.tsx) — одна композиция `Studio` (`STUDIO_COMPOSITION_ID`). `calculateMetadata` берёт `durationInFrames`, `fps`, `width` и `height` из `props.plan`
- [`packages/render/src/StudioVideo.tsx`](../../packages/render/src/StudioVideo.tsx) — кадр студии; `style.blur` применяется к картинке, видео и карточке. V1 без blur сохраняет прежний стиль. У `<Img>` стоит `pauseWhenLoading`, но только пока адрес не декодирован заранее (`imageDecoded` из [`image-ready.ts`](../../packages/render/src/image-ready.ts)). Покадровый MP4 ждёт кадр через `delayRender`. `premountFor` (2 с, [`premount.ts`](../../packages/render/src/premount.ts)) Remotion применяет только в Player
- [`src/server/studio/render.ts`](../../src/server/studio/render.ts) и [`engine.ts`](../../src/server/studio/engine.ts) — выбор композиции `Studio`, сборка бандла и `renderMedia`
- [`src/lib/audio.ts`](../../src/lib/audio.ts) — `probeMediaInfo`, `extractPoster`, `decodePcm`, `findActiveSnippet`. Активный фрагмент топа считается здесь и кэшируется в `StudioAnalysis` по хэшу ассета
- [`src/lib/domain/rms.ts`](../../src/lib/domain/rms.ts) — окно с максимальной RMS-энергией
- [`src/lib/domain/download-name.ts`](../../src/lib/domain/download-name.ts) — основа имени скачиваемого файла (`downloadTitleStem`), ей пользуется офлайн-плеер
- Конфиг: [`next.config.mjs`](../../next.config.mjs) выносит `@remotion/bundler`, `@remotion/renderer` и `ffmpeg-static` из серверного бандла Next

## Данные
- Задание студии — `StudioJob` ([schema](../../prisma/schema.prisma)): статус, прогресс, `outputPath`, `outputBytes`. Финальный MP4 и клипы лежат в `storage/studio-jobs/<userId>/<jobId>`
- Встроенный тик студии — `storage/studio/builtin/tick.wav`, его пишет студия сама
- Бандл Remotion кэшируется по `engineId`: хэш `src/remotion-entry`, `packages/render/src`, `packages/video/src`, `src/lib` и `package-lock.json`. Первое задание после правки этих файлов пересобирает бандл (до 120 с)

## Как устроено
- Сайт и MCP только ставят задание. Выполняет его отдельный процесс `npm run studio:worker`
- Финальный `kind:"render"` требует право `render:run` (только админ). Клип, still и audio доступны автору
- Браузер берётся из `REMOTION_BROWSER_EXECUTABLE`. Без переменной Remotion пытается скачать chrome-headless-shell
- Нарезка офлайн-`.html` не перекодирует звук теми же фейдами, что раньше делал отдельный конвейер: плеер читает исходные файлы

## Грабли
- Правка `src/remotion` или `package-lock.json` меняет `engineId`, и первое студийное задание пересобирает бандл
- Осмотр картинки через ffmpeg — без input seek (`-ss`), даже к нулю: крупный JPEG теряет единственный кадр ([`studio/inspection.ts`](../../src/server/studio/inspection.ts))
- Финальный рендер только для админа. У роли user кнопка скрыта, а `video_job_start kind:"render"` отвечает `FORBIDDEN`
- Системных ffmpeg и ffprobe может не быть. Кадры и громкость снимает бинарник `node_modules/ffmpeg-static/ffmpeg`

## Пакет `@douga/render` (задача 34)

`StudioVideo`, кадровая математика и типографика переехали в [`packages/render/src/`](../../packages/render/src/),
точка входа Remotion — в [`src/remotion-entry/`](../../src/remotion-entry/). Новое: [`hit-test.ts`](../../packages/render/src/hit-test.ts)
находит нажатую карточку на анимированном кадре. Его зовёт `InteractivePlayer` ([`@douga/player`](../../packages/player/src/)).
Рендер финального MP4 не изменился и остаётся у админа.

## Как проверить
- Юниты пробы и RMS: `npx vitest run src/lib/audio-probe.test.ts src/lib/domain/rms.test.ts src/lib/domain/download-name.test.ts`
- Живой ролик: `npm run studio:worker` и `node scripts/verify-studio.mjs --actor you@example.com --project ID --kind clip --seconds 3 --output storage/studio-verification/<run>`
- Кадры: `node_modules/ffmpeg-static/ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png`
- Звук: `… -ss <t> -t <dur> -i out.mp4 -af volumedetect -f null -`. Середина позиции должна быть громче тишины

## История
- [спека 02](../specs/02-phase-render.md) — первый асинхронный рендер и RMS-фрагмент
- [спека 24](../specs/24-ai-video-job-contract.md) — очередь и бюджеты студийного рендера
- Задача 26 убрала прежний конвейер топа и пикера. Осталась композиция `Studio`

## Сегменты v2 (задача 27)

Один общий план содержит интервалы сегментов; рендер MP4, watch и offline используют те же сцены.
Таймкоды — абсолютные кадры, интервалы [from,to). Документ v1 и v2 компилируются в IR v1.
Привязки participant/segment и наборы разворачивает компилятор, renderer не читает исходный турнир.
Приёмка: [verify.md](../features/27-segments/verify.md). Сравниваются lossless PNG и PCM;
побитовое равенство H.264 не требуется (при одинаковых lossless кадрах encoder может давать малую chroma-разницу).

## Доски (задача 29)

`board-compiler.ts` выдаёт обычные shape/text/card/media/timer узлы и анимации x/y/scale.
Отдельного renderer для доски нет: Player, PNG, MP4 и offline используют тот же план.
`CompiledScene.boardState` — состояние после действия, `boardEvents` — локальные кадры
событий. Фазы движения используют scene-local кадры; аудио после объединения сегментов —
composition-absolute. Проход по слотам заканчивается повторным обзором всей доски.
Проверка: реальный MP4 со всеми семействами, кадры до/во время/после действия,
вертикальная матрица, квадратный бюджетный драфт и декодированный звук.

## Типографика (задача 31)

`TypographyText.tsx` рисует подготовленные сервером textLayout lines/runs; браузер
не считает новые переносы. Это общий путь text/card/group/timer/badge/VS/progress.
`typography-fonts.tsx` / TypographyFontGate ждёт selected plan.fonts через FontFace,
управляет delayRender/Player buffering, таймаутом и явной ошибкой. Синтез начертаний
выключен, legacy путь остаётся прежним.

Градиентная заливка и text-shadow рисуются раздельными слоями: иначе прозрачный
background-clip:text позволяет тени закрыть градиент. Обводки/тени декоративные
aria-hidden слои, основной текст доступен один раз. Текстовые анимации сохраняют
полную раскладку, text-lines использует фактические строки; цифры резервируют
однострочную максимальную ширину.

Шрифты входят в engineId и bundle/public; snapshot.fontFiles хранит выбранные
ресурсы/лицензии с проверкой hash. Renderer копирует frozen ресурсы в свой public
каталог и переписывает URL. Старое задание закреплено за прежним engineId/снимком.

Проверка: реальные still/clip/MP4, кадры before/during/after text motion, JP/rich
strings и эффекты у края. Compare watch/offline строки и координаты на тех же
кадрах, загрузи HTML с network offline; проверь document.fonts и отсутствие HTTP.
Артефакты задачи 31: `storage/verification/31-typography/`.

Эталонный CLI явно использует штатный headless-shell закреплённой версии
Remotion и программный Chromium rasterizer `swangle` через
общий `renderStudioFrames`. Режим входит в environment identity: другой режим
даёт environment-mismatch даже при совпадающих пикселях. Штатный worker
сохраняет прежний default; это настройка воспроизводимых эталонов. Критерий
SDK/project RGBA и записанные ROI остаются точными; golden CLI имеет
измеренный глобальный предел4пикселя×1уровень с явным отчётом.
