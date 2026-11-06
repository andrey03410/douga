# Задача 3: fixtures и pixel regression

Реализованы browser-safe `src/video/visual-fixtures.ts` и
`src/video/visual-regression.ts`, серверный CLI `scripts/visual-regression.ts`.
Новые зависимости не добавлены. Общие index/presets/renderer/package.json
не изменены этой задачей.

## Интерфейсы

- `buildVisualFixtures(): VisualFixture[]`: id, канонический document, synthetic
  manifest, frames, coverage и sampling. Документы независимы между вызовами.
- `visualFixtureMedia()`: четыре непустых SVG-арта и локальный 48 kHz PCM WAV
  (440 Hz, две секунды), фиксированные без сети/даты/случайного генератора.
- `visualFixtureCoverage(fixtures)`: все legacy presets, recipes, motion entries,
  typography examples/styles/themes и особые случаи.
- `compareVisualFrame({actual,reference,environment,referenceEnvironment,rois,…})`:
  RGBA PSNR/MSE/changedPixelRatio/maxDelta, абсолютный diff и метрики каждой ROI.
  Точное совпадение даёт PSNR=Infinity; JSON сохраняет его строкой `Infinity`.
- `summarizeVisualSuite(results)`: любой mandatory failure красит весь набор;
  пустой набор не может пройти.
- CLI экспортирует `freezeVisualFixture`, `decodeVisualPng`, `encodeVisualPng`,
  `renderVisualFixtures`, `checkVisualFixtures`, `acceptVisualFixtures`.
  Рендер использует штатный `renderStudioFrames`, scale1/full resolution,
  `prepareStudioEngine`, fontkit measurement и `freezeTypographyFonts`.

## Матрица и решение об экономии эталонов

На интегрированном каталоге: **187 fixtures / 1561 уникальный кадр / максимум11
кадров на fixture**. Покрытие: **54 прежних пресета,33 рецепта,67 записей motion,
4 typography examples ×3 формата,12 typography styles,6 themes**. Особые случаи:
длинные RU/JP, смешанный текст, край кадра, плотный вертикальный пикер и допустимое
пустое состояние доски. Даже legacy fixtures используют закреплённые Arimo/Noto
шрифты; сервер копирует/проверяет байты шрифтов и лицензий.

Решение основного агента от 2026-11-06: хранить максимум9–12 детерминированных
репрезентативных кадров на fixture, а не каждый кадр каждого повторения.
`sampling.strategy=representative-events-v1` сохраняет все доступные semantic
points (`available`), фактические номера (`selected`) и честный `sampled`.
Приоритеты: обзор/появление, before/during/after представительного board action,
answer или motion, переход второй сцены, финальная сводка и границы.
Полный fixtureCoverage остаётся в manifest даже при `--filter/--limit`.
Это выборка для защиты renderer; полнота пользовательской раскадровки остаётся
обязанностью storyboard paging и не заявляется этим набором.

## Строгие отказы

Отсутствующий эталон, несовместимое окружение, другой размер и pixel failure
имеют различные статусы. Hash mismatch/отсутствующий actual/изменённый fixture
не становятся passed. Окружение закрепляет Node, OS/arch, версию и SHA256
браузера, Remotion, SHA256 ffmpeg и использованных шрифтов, RGBA/sRGB/scale1.
`engineId` сохраняется как происхождение, его смена не отключает сравнение.

CLI пишет actual/frozen inputs/diff/HTML/JSON только в
`storage/verification/32-storyboard/`. Версионируемые baseline manifest и PNG
записываются под `baselines/` только `accept --confirm --reason …` после полного
актуального рендера. Неполная диагностическая выборка видна в отчёте, завершается
exit1 при check и не принимается. Manifest checkpoint сохраняется до/во время
рендера с complete=false: упавший прогон не подменяется прежним готовым результатом.
Порогов из памяти нет: default exact RGBA, ROI тоже exact независимо от допуска
на весь кадр. Один высокий средний PSNR не скрывает маленькую пропавшую подпись.

## Проверка RED → GREEN

1. Исходный targeted RED: оба модуля отсутствуют, импорты новых тестов падают.
2. После реализации pixel checks:8 PASS; fixture compile вскрыл неверные pool
   asset IDs, blind-rank capacity и несовместимую versus choreography. Исправлены
   synthetic binding IDs, штатное число board cards и подходящий сценарий.
3. Реальный fontkit измеритель подтвердил типографику. Найденное переполнение
   маленьких board labels устранено короткими закреплёнными японскими именами;
   длинные имена остаются отдельным boundary fixture.
4. Отдельный RED на dense/empty coverage → добавлены плотный пикер и допустимый
   board round без cards/actions. Отдельный RED на sampling → ограничение12,
   сохранение available/selected и явный sampled.
5. Последний targeted GREEN:
   `npx vitest run src/video/visual-fixtures.test.ts src/video/visual-regression.test.ts src/video/visual-runner.test.ts`
   — **14/14 PASS**. Проверяются vanished1px ROI, alpha, dimensions/missing/env,
   engine provenance, aggregate fail, invalid buffers/ROIs, PNG RGBA roundtrip,
   acceptance flags и реальные замороженные SVG/PCM/fonts с SHA256.
6. CLI реально отрендерил `preset.top.classic.wide` (1920×1080 PNG); кадр6
   просмотрен. Непустой artwork и подпись присутствуют. Повторный render и decode
   кадра6: **2073600 pixels, MSE0, PSNR Infinity, changedPixels0, maxDelta0**.
   Доказательство: `storage/verification/32-storyboard/repeatability.json`;
   воспроизводящий скрипт лежит рядом. Это измерение одного контрольного случая,
   полная repeatability матрицы остаётся QG задачи6.
7. CLI `check --filter preset.top.classic.wide --limit 1` с отсутствующим baseline
   вернул exit1 и отдельный missing-baseline по каждому проверенному кадру,
   сохранил report.json/report.html. Baseline PNG этим агентом не генерировались.

Полная тройка и полный render/check/explicit acceptance переданы основному агенту
для общей стадии QG. Последний tsc не нашёл ошибок в файлах этой задачи; во время
проверки оставался незавершённый импорт основного MCP storyboard-tools.
