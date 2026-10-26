# Заметка: headless-рендер Remotion

## Контекст

Серверный рендер (`@remotion/renderer`) требует headless-браузер
(**chrome-headless-shell**). При первом запуске Remotion пытается скачать его с
`remotion.media`.

## Что проверено

Пайплайн рендера отработан до шага запуска браузера:
- нарезка аудио через `ffmpeg-static` (декод + fade) — ✅;
- сборка Remotion-бандла (`@remotion/bundler`) — ✅;
- джоба, прогресс (2% → 50% на нарезке), статусы, обработка ошибок — ✅;
- запуск браузера — упирается в окружение (см. ниже).

## Подводные камни окружения

1. **Скачивание headless-shell**: если сеть блокирует `remotion.media`, загрузка
   падает. Решение: `npx remotion browser ensure` в окружении с доступом, либо
   заранее положить chrome-headless-shell в кэш Remotion.
2. **Системный Chrome слишком новый**: при `browserExecutable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
   с Chrome ≥ 132 падает с «Old Headless mode has been removed». Remotion 4.0.x
   запускает старый headless-режим — нужен именно `chrome-headless-shell`, а не
   обычный Chrome.

## Решение (применено)

Проблема снята без скачивания headless-shell:
- Remotion обновлён до 4.0.475 (диапазон `^4.0.230` так и разрешился);
- в `src/server/render.ts` для `selectComposition`/`renderMedia` задан
  **`chromeMode: "chrome-for-testing"`** — это новый headless-режим, совместимый с
  современным Chrome;
- путь к браузеру берётся из `REMOTION_BROWSER_EXECUTABLE` (в `.env` указан
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).

Проверено end-to-end: рендер доходит до 100%, на выходе валидный MP4
(H.264 1920×1080 @30fps + AAC stereo).

## Рекомендация для продакшна

- Либо `chromeMode: "chrome-for-testing"` + системный Chrome (как сейчас),
- либо `npx remotion browser ensure` (скачает chrome-headless-shell) — на выбор.
