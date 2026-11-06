# Визуальные эталоны

`manifest.json` и `frames/` создаёт только явное принятие полного актуального
прогона после просмотра изображений. Отсутствующий эталон — ошибка проверки.
Результаты и диагностические файлы находятся в `storage/verification/32-storyboard/`.

Из корня репозитория:

```sh
npx tsx --tsconfig tsconfig.mcp.json scripts/visual-regression.ts render
npx tsx --tsconfig tsconfig.mcp.json scripts/visual-regression.ts check
npx tsx --tsconfig tsconfig.mcp.json scripts/visual-regression.ts accept --confirm --reason 'Причина принятия после просмотра'
npx tsx --tsconfig tsconfig.mcp.json scripts/visual-regression.ts check
```

`render --filter TEXT --limit N` ограничивает дорогой диагностический прогон.
В manifest сохраняется полная матрица каталога; неполная выборка имеет
`complete:false`, не считается успешным полным набором и не может быть принята.
`check` сохраняет HTML с reference/actual/diff и JSON с метриками каждого кадра
и каждой текстовой ROI. SDK comparator по умолчанию требует точное совпадение RGBA. Golden CLI
использует явный фиксированный предел4пикселя×1уровень на весь кадр; записанные
статические ROI остаются exact0. В отчёте отдельно exact и bounded-noise counts.
Другая среда, размер, содержимое fixture, отсутствующий файл или кадр дают отказ.
Смена `engineId` фиксируется как происхождение и не отменяет сравнение.

Локальные SVG и PCM создаются чистой функцией `visualFixtureMedia()`, шрифты
копируются из проверенного штатного каталога. Медиа владельца и сеть не нужны.
Сначала измеряется повторяемость рендера. Допуски из памяти не вводятся.

Эталонный CLI явно использует штатный headless-shell закреплённой версии
Remotion и программный Chromium rasterizer `swangle` через
общий `renderStudioFrames`. Режим входит в environment identity: другой режим
даёт environment-mismatch даже при совпадающих пикселях. Штатный worker
сохраняет прежний default; это настройка воспроизводимых эталонов. SDK/project сравнение и записанные ROI остаются точными. Golden CLI имеет
фиксированный измеренный глобальный предел4пикселя×1уровень; raw metrics и
число bounded-noise frames видны в отчёте. ROI статические, не следуют motion;
движущиеся области тоже ограничены глобальными4×1, а не объявляются точными.
