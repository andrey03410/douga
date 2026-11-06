# P08: измеренная пиксельная разница проекта

Добавлен optional `pixelDiff?: boolean` в storyboard API. Поле **без default**,
допустимо только в compare; continuation наследует его через pinned scope.
При pixelDiff страница содержит тройки before/after/diff, число пар равно
`floor(pageSize/3)`; обычное сравнение использует `floor(pageSize/2)`.
Общий cap 24 плитки сохранён. pageSize меньше 3 для pixelDiff и меньше 2 для
обычного compare отклоняется, в том числе после наследования continuation.

```ts
{ projectId, mode: "compare", compareRevision: 1, pixelDiff: true, pageSize: 12 }
// или compareJobId вместо compareRevision
{ projectId, sourceJobId, page: 1 } // наследует compare, pixelDiff, pageSize/scope
```

`scope.pixelDiff` и готовый `nextPageAction.arguments.pixelDiff` сохраняют выбор.
Третья плитка имеет `side:"diff"`, `source:2`, исходный stable state. Source 2
никогда не передаётся renderStudioFrames: worker использует уже отрендеренную
реальную before/after пару. При одинаковом RGBA создаётся чёрная absolute-diff
PNG; alpha-only изменения тоже отображаются. Diff попадает в frame ledger,
проверяется обычным native frameId/hash маршрутом и учитывается storageBytes.

Результат:

```ts
result.storyboard.pixelComparisons?: [{
  beforeFrame: number | null, afterFrame: number | null,
  status: "identical" | "different" | "notComparable",
  metrics?: { psnr: number | "Infinity", changedPixelRatio: number, maxDelta: number },
  reason?: string
}]
```

Это описание различий произвольного авторского контента, **не** оценка красоты
и не regression verdict. Missing before/after и разные размеры дают явный
notComparable. Для такой пары нет diff PNG/ledger frame; сетка показывает missing
slot, а UI должен учитывать notComparable и не запрашивать отсутствующий frameId.
Причины: missing-before, missing-after, dimension-mismatch.

Новый server-only image-pixels.ts читает/пишет PNG через ffmpeg-static с
фиксированным RGBA, лимитами 12 MiB input/output, 1920² pixels и 30 секунд на процесс.
Decode выполняется из проверенного bytes buffer; optional ожидаемый SHA256
отсекает подмену. Метрики/absolute map вычисляются существующим compareVisualFrame
в одной worker среде. Декодированные bytes и PNG output ограничены до сохранения.

## Проверка

Исходный RED: нового codec нет, pixelDiff не принимается существующим входом.
Затем targeted GREEN:

- настоящий PNG roundtrip, одинаковые изображения → identical/Infinity/black PNG;
- изменение одного alpha channel → different, ratio 1/16, maxDelta 255;
- missing/dimension mismatch → notComparable;
- неверный SHA256 и превышение pixel budget → отказ;
- адресный **настоящий runStudioWorkerOnce** выполнил red→blue compare:
  ledger содержит before/after/diff, native diff frameId 2 отдаёт проверенный PNG
  720×405, центр absolute map magenta, changedPixelRatio≈0.997 и maxDelta 255.
  Незначительная неизменная граница растра учитывается измерением, а не скрывается
  округлением до 100%. storageBytes равен grid bytes + всем трём frame bytes;
- version/full project row после inspection/worker не меняются;
- готовая следующая страница и sourceJobId continuation сохраняют pixelDiff;
  слишком маленькие бюджеты отклоняются.

Команда:

```sh
npx vitest run src/server/studio/image-pixels.test.ts src/integration/storyboard-pixel-diff.integration.test.ts src/integration/storyboard-continuation.integration.test.ts src/integration/storyboard-history.integration.test.ts src/integration/storyboard.integration.test.ts
```

Логи: `storage/verification/32-storyboard/pixel-diff-{red,green}.log`;
`pixel-diff-typecheck.log`. Нативные worker fixtures используют уникальный аккаунт
и удаляют только собственные данные. Remotion Root/StoryboardSheet, engine source,
CLI, review, UI/MCP и baseline этим изменением не правились.

Последний совместный targeted результат: **25/25 PASS**, 5 файлов, 6.93 с.
`tsc --noEmit` завершился с exit0 после этих изменений. Полные tests/build и
baseline не запускались этим агентом; итоговый QG выполняет координатор.
