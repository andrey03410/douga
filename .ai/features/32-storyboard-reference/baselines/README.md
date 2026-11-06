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
и каждой текстовой ROI. По умолчанию требуется точное совпадение RGBA.
Другая среда, размер, содержимое fixture, отсутствующий файл или кадр дают отказ.
Смена `engineId` фиксируется как происхождение и не отменяет сравнение.

Локальные SVG и PCM создаются чистой функцией `visualFixtureMedia()`, шрифты
копируются из проверенного штатного каталога. Медиа владельца и сеть не нужны.
Сначала измеряется повторяемость рендера. Допуски из памяти не вводятся.
