# Рендер видео

Как Douga превращает план студии в MP4: одна композиция Remotion `Studio` в headless Chrome. Очередь, бюджеты и воркер описаны в [studio-sdk.md](studio-sdk.md). Нарезка офлайн-`.html` живёт отдельно.

## Моушен и resolved media

- [`motion-frame.ts`](../../src/remotion/motion-frame.ts) оценивает 40 закрытых
  эффектов по scene-local frame/fps; движение складывается с keyframes.
  [`MotionText.tsx`](../../src/remotion/MotionText.tsx) сохраняет пробелы,
  графемы Unicode и конечное число; [`MotionWidgets.tsx`](../../src/remotion/MotionWidgets.tsx)
  рисует timer/VS/badge/progress, [`MotionBackdrop.tsx`](../../src/remotion/MotionBackdrop.tsx)
  — пять фонов из seed/кадра. CSS animations и wall-clock не используются.
- [`motion-transition.ts`](../../src/remotion/motion-transition.ts) соединяет
  соседние сцены wipe/zoom/push/flash/iris/split/blur/crossfade. Outgoing удерживает
  последний кадр и Freeze context (включая source frame видео), без собственного
  fade/slide и без повторного аудио. Временной разрыв не перескакивается.
  Старые none/fade/slide сохраняют прежнюю математику.
- У crossfade/zoom/blur outgoing непрозрачен под incoming до конца перехода:
  одновременные opacity .5/.5 дают провал покрытия и здесь запрещены.
  Цвет с alpha строится через `studio-paint.ts:colorWithAlpha`, а не добавлением
  hex-суффикса к произвольному валидному CSS color. Новые VS/badge имеют fallback
  fontSize от rect; explicit style.fontSize приоритетнее.
- [`compiled-media.ts`](../../src/video/compiled-media.ts): `compiledMediaUsages(plan)`
  — общий обход audio, nodes.media и backdrop.layers.media. Его используют
  worker rewrite, watch rewrite/preload и offline slices/posters/retarget/unresolved.
  Фоновые видео не должны пропадать, даже если scene.nodes.media пуст.
  Offline клонирует asset на usage: общий источник с разными обрезками не должен
  перезаписывать src/duration соседнего usage. При rewrite shared asset обходится один раз.
- Проверка задачи 30: старые picker answer/board move дают 5/5 одинаковых
  декодированных RGBA кадров; новые эффекты требуют настоящего MP4 и live watch/offline.

## Где код
- [`src/remotion/index.ts`](../../src/remotion/index.ts) → [`Root.tsx`](../../src/remotion/Root.tsx) — одна композиция `Studio` (`STUDIO_COMPOSITION_ID`). `calculateMetadata` берёт `durationInFrames`, `fps`, `width` и `height` из `props.plan`
- [`src/remotion/StudioVideo.tsx`](../../src/remotion/StudioVideo.tsx) — кадр студии; `style.blur` применяется к картинке, видео и карточке. V1 без blur сохраняет прежний стиль. У `<Img>` стоит `pauseWhenLoading`, но только пока адрес не декодирован заранее (`imageDecoded` из [`image-ready.ts`](../../src/remotion/image-ready.ts)). Покадровый MP4 ждёт кадр через `delayRender`. `premountFor` (2 с, [`premount.ts`](../../src/remotion/premount.ts)) Remotion применяет только в Player
- [`src/server/studio/render.ts`](../../src/server/studio/render.ts) и [`engine.ts`](../../src/server/studio/engine.ts) — выбор композиции `Studio`, сборка бандла и `renderMedia`
- [`src/lib/audio.ts`](../../src/lib/audio.ts) — `probeMediaInfo`, `extractPoster`, `decodePcm`, `findActiveSnippet`. Активный фрагмент топа считается здесь и кэшируется в `StudioAnalysis` по хэшу ассета
- [`src/lib/domain/rms.ts`](../../src/lib/domain/rms.ts) — окно с максимальной RMS-энергией
- [`src/lib/domain/download-name.ts`](../../src/lib/domain/download-name.ts) — основа имени скачиваемого файла (`downloadTitleStem`), ей пользуется офлайн-плеер
- Конфиг: [`next.config.mjs`](../../next.config.mjs) выносит `@remotion/bundler`, `@remotion/renderer` и `ffmpeg-static` из серверного бандла Next

## Данные
- Задание студии — `StudioJob` ([schema](../../prisma/schema.prisma)): статус, прогресс, `outputPath`, `outputBytes`. Финальный MP4 и клипы лежат в `storage/studio-jobs/<userId>/<jobId>`
- Встроенный тик студии — `storage/studio/builtin/tick.wav`, его пишет студия сама
- Бандл Remotion кэшируется по `engineId`: хэш `src/remotion`, `src/video`, `src/lib` и `package-lock.json`. Первое задание после правки этих файлов пересобирает бандл (до 120 с)

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
