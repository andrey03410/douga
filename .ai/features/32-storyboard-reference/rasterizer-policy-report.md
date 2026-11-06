# Воспроизводимый rasterizer для golden PNG

Диагностика без допуска и без изменения эталонов:
`storage/verification/32-storyboard/drift-probe/{batch.ts,default-results.json,swangle-results.json}`.
Проверены **все 21 кадр** двух проблемных fixtures, **3 полных batch на fixture**:
63 default renders и 63 SW renders. Между SW batch 0/1/2 все RGBA точно совпали
(changedPixels 0/maxDelta 0); сравнение 42 повторных кадров с первыми 21 — exact.

Default batches тоже были стабильны локально: kmk@725 все 3 раза отличаются от
старого baseline на 455 pixels/maxDelta 3; manga@186 все 3 совпали с baseline.
Интермиттирующий tiny-glyph drift полного прогона локальным batch не повторён;
механическая причина GPU/compositor этим исследованием не доказана.
SW меняет paint: kmk все 11 кадров отличаются от default baseline (@725: 4417 px,
maxDelta 60), manga 7/10 (@186: 664856 px/maxDelta 68). Эти сравнения **не** называются
зелёными. Caption crops baseline/SW просмотрены, потери глифов в выбранном ROI нет.

Принятая координатором политика: золотые PNG используют software ANGLE SwiftShader.
Установленный Remotion 4.0.475 отображает `gl:'swangle'` в
`--use-gl=angle --use-angle=swiftshader` (локальный open-browser.js:33–39).
Алгоритм engine source hash не менялся; изменение src/video metadata естественно
может дать новый engineId как provenance.

API: `renderStudioFrames({...request,rasterizer?:'swangle'})`. Только при опции
shared browser получает `chromiumOptions:{gl:'swangle'}`; default worker остаётся
с прежними options. Visual CLI всегда передаёт swangle и записывает
`environment.rasterizer:'swangle'`. Environment comparator проверяет поле строго:
old/default undefined против swangle — environment-mismatch даже при тех же RGBA.

TDD: RED 2/11 (software option не дошла до browser; одинаковые пиксели ошибочно
проходили при разном rasterizer) → **GREEN 18/18**, 4 targeted файла, 3.97 с;
`tsc --noEmit` exit 0. Проверен и прежний default browser path. Логи
`drift-probe/rasterizer-{red,green,typecheck}.log`.

Эталоны/fixtures/current actual/report не менялись, full tests/build не запускались.
Политика требует нового полного SW render → просмотра → explicit accept → свежего
полного repeat/check. Именно этот прогон подтвердит повторяемость всей матрицы.

## Последующая проверка: bundled headless-shell вместо system Chrome

Полный SW/system-Chrome 157 repeat дал 21 расхождение на 1675 кадрах. Это отменяет
предположение, что одного SW backend достаточно: scoped 21×3 выше не доказывал
повторяемость всей матрицы. First-frame prewarm тоже провалился; private hooks
и допуски не включались в production.

Новый supported кандидат: bundled Chrome for Testing 149.0.7790.0, revision,
проверяемый установленным Remotion. `ensureBrowser({chromeMode:'headless-shell'})`
без browserExecutable нашёл его в кеше. Все 37 кадров четырёх проблемных fixtures
в трёх полных batches (111 renders, 74 повторных сравнения) совпали точно при SW,
одном capture и без private hooks/prewarm/double. Старый baseline 157 отдельно
остаётся несовпадающим. Evidence и ограничение scope: `storage/headless-probe/`.

API `prepareStudioRender`/`renderStudioFrames` дополнен internal trusted
`browserExecutable?:string`. Override одинаков для selectComposition/openBrowser;
без него worker сохраняет прежний REMOTION_BROWSER_EXECUTABLE fallback.
Visual CLI сам resolve bundled browser, одним path вычисляет version/binary SHA
и рендерит, не меняя process.env при импорте или вызове. Существующий environment
fingerprint строго отличает bundled 149 от system 157; rasterizer exact check сохранён.

TDD: explicit override flow RED 1/4 → GREEN 4/4 browser adapter tests; подтверждены
select/open path, отсутствие изменения env и worker fallback. Совместно
**20/20 PASS**, 4 targeted файла, 4.02 с; `tsc --noEmit` exit 0. Логи
`storage/headless-probe/browser-policy-{red,green,typecheck}.log`.
Полный bundled render/view/explicit accept/fresh repeat и последняя QG тройка
остаются у координатора. Готовность всей матрицы по 37 samples не объявляется.
