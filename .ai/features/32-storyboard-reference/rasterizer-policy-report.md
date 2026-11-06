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
