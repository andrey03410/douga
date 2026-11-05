# Рендер видео

Как Douga превращает план студии в MP4: одна композиция Remotion `Studio` в headless Chrome. Очередь, бюджеты и воркер описаны в [studio-sdk.md](studio-sdk.md). Нарезка офлайн-`.html` живёт отдельно.

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
