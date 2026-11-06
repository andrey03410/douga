# Проверка задачи 32

Статус: финальная проверка после1d6f94e выполняется. Предыдущая тройка PASS;
последний полный SW/Chrome157 visual QG FAIL (22/1675). Новый bundled149
профиль проходит полную матрицу. Merge запрещён до полного green.
Продукт принят, автономный режим до merge. Независимое ревью исправлений PASS.

## Обязательная тройка

Предыдущая тройка после4f2ded8/rootintegration — строго по порядку. После
нового browser pin1d6f94e тройка повторяется; старые логи сохранены с suffix
before-browser-pin, окончательные результаты будут записаны ниже.

- `npm test` — **122 файла,1413 тестов PASS**,382.93sec,exit0.
- `npm run build` — production build PASS,exit0,новые routes собраны.
- `npx tsc --noEmit` — PASS,0 diagnostics,exit0 после build.

Наш Next dev остановлен до тройки. Временный listener3000 принадлежал нашему
Remotion render CLI и не использовал .next. Логи:
`storage/verification/32-storyboard/qg-{test,build,tsc}.log`.
Первый fulltest1409/1410 выявил сокращение get в initialize; адресный
RED→GREEN3files/20tests. Промежуточный прогон захватил новый env-test до его
реализации и не считается финальным. Исходные логи сохранены отдельно;
финальная тройка начата после всех изменений исходников.

## Настоящий MCP и renderer

Последний полный `scripts/verify-storyboard.ts`:
`storage/verification/32-storyboard/live-da636332-6f31-48ac-8719-f63c4607524f/`.

- PASS: 61 tool,106 настоящих stdio вызовов,113 assertions,6/6 сценариев
  top/picker/board × wide/vertical по опубликованным content forms.
- 12 PNG-сеток,12 отдельных tile PNG и отдельный native diff PNG,
  2 настоящих MP4 с decoded frames/PCM. Ресурсы сверены по SHA256 и bytes.
- Кэш возвращает тот же job.26 сцен покрыты страницами24+2 через готовый
  nextPageAction/sourceJobId; origin сохраняется. Review и deep читают frozen
  storyboard, даже после изменения live content; engine тоже закреплён.
- Отдельный native recipe stdio smoke после SW accept:3 вызова,7 image/png
  (top3,picker3,board1),previewOrder и ready статусы совпали,bytes сверены.
  Evidence `storage/verification/32-storyboard/recipe-native/`.
- Compare содержит разные origins, changed properties и измеренный pixel diff.
  Measured overflow устранён selected suggestion; текст/source/media сохранены.
  Ответ содержит точный before backup и готовое restore действие.
- Inspection/deep не меняют project row/version/revision/source/snapshot count.
  Чужие IDs, неправильный expectedVersion и malformed draft отвергаются.
- Два клипа: каждый290816 PCM samples,6.059sec,peak−19.31dBFS,RMS0.04342,
  silent=false. Container flag не использован как доказательство звука.
  Извлечённые кадры просмотрены; successful decode не считается доказательством
  художественной плавности, прослушивание агентом не заявляется.

Предыдущий полный прогон `live-4ca970ae-3737-48cf-84d1-8424bd5361cf/`:
103calls/106assertions PASS. Самый первый `live-817d…` сохранил RED дефекта MIME
отдельного tile; повтор после исправления прошёл. Неудачные логи не скрыты.
Секреты уникальных проверочных аккаунтов остаются только в ignored storage.

## Контроль слабым агентом

Отдельный `gpt-6-luna`,reasoning medium, получил только задачу собрать шесть
роликов и MCP транспорт. Исходники/чужие отчёты читать запрещено; подсказок по
формам не давалось. Результат6/6: filled content→nativePNG→review ready,
без ручных nodes/bindings/координат и без исправления JSON владельцем.

Были исправляемые ошибки аргументов, опечатка job ID и два отказа параллельного
create; последовательный повтор прошёл. Все уложились в≤2 попытки на случай,
ручных подсказок0. Это контроль конкретной модели/инструкции, не гарантия любой
модели и не автоматическая оценка вкуса. Trace/results/images:
`storage/verification/32-storyboard/weak-agent/`.

## Браузер и восстановление

Puppeteer-core, настоящий локальный Next и отдельные проверочные аккаунты:

- Галерея с принятыми native thumbnails, живой recipe example, storyboard,
  замечания и тройки before/after/pixel diff.
- Desktop1440×1000/mobile390×844: pageErrors0,unexpected HTTP errors0,
  horizontal overflow=false, pixelDiffShown=true.
- Реальный клик «Следующая» отправил sourceJobId исходного job,page1,pageSize24;
  показал2 оставшиеся сцены,originStable=true,errors0.
- Доказательства: `storage/verification/32-storyboard/ui-final/`,
  drivers `ui-probe.mjs` и `ui-continuation.mjs` рядом.
- Полный live restore: собственный проектv5→applyv6→restorev7,revision1,
  before/restored hashes равны;Rubik52/yellow/source text восстановлены,
  95 остальных проектов не изменены. Evidence `ui-restore/`,
  [отчёт](ui-restore-report.md).

## Эталоны

Полная матрица:187fixtures/1675uniquePNG,≤12 выбранных кадров на fixture.
Все54 прежних пресета,33 рецепта,67motion entries,типографика и границы RU/JP.
Available/selected events сохранены; representative sampling не выдаётся за
проверку каждого кадра или всех комбинаций. Все187 representative samples
просмотрены на8 contact sheets; initial explicit accept сохранён в manifest.
Это автономная приёмка синтетических образцов, а не утверждение вкуса владельца.

Первый fresh default-raster repeat:1673/1675exact,2FAIL (455px/max3 и100px/max177).
Растровая нестабильность исследована в isolated и повторных полных batch;
программныйswangle дал exact3/3 между собой на всех21 кадрах двух проблемных
fixtures. 4f2ded8 закрепил rasterizer с environment guard; новый fullSWrender завершён,
все187 representative образцов просмотрены заново и приняты явно с reason.
Fresh полный SW repeat/check выполняется, старый default не выдаётся за PASS.
Первый отказ сохранён в repeat-first-report.json,дрейф — drift-probe/.

Отрицательные контроли уже обнаружили исчезнувшую подпись (caption ROI failed,
PSNR25.74) и застывший переход (frame426,PSNR17.89). Изменённые actual/diff/reference
сохранены в regression-control/,исходные файлы восстановлены. После нового backend оба контроля снова обнаружены; исходные файлы
восстановлены. Финальный полный check выполняется.
Предыдущая matrix1561 была предварительной; её не принимали. Эталоны в
[baselines/](baselines/), runtime evidence в `storage/verification/32-storyboard/`.
По умолчанию exact RGBA, scale1, pinned environment. EngineId не отменяет diff.

## Адресные проверки исправлений

- FR01 preserve/replace: исходные intro+main остаются510frames,13sec,override77;
  try-on и запись используют один helper. Legacy replacement отдельно сохранён.
- FR02 адресный deep включает scene/segment/frame риска; generic sampled scope
  по-прежнему явно ограничен. RED→GREEN с исходным пропуском s2.
- FR03 continuation/history/current tests и real worker: замена live cover
  не меняет pinned pages/review/deep. Оба сравниваемых origin закреплены.
- PixelDiff: same/different/alpha/missing/dimensions/hash/budgets и настоящий
  worker/ledger/storageBytes —5files/25tests PASS. Missing/размеры notComparable.
- Неэффективные/пустые suggestions не выдаются/не применяются, IDs ограничены,
  before backup атомарен с CAS/ownership/quota. Generated content IDs длиной200
  остаются допустимыми; controlled digest не удлиняет canonical keys.
- RecipeApplyError mapping: meaningful instanceof assertion RED7/8→GREEN8/8.
  Historical nextAction: RED4/5→GREEN5/5, не отправляет inspect на live draft.

## Независимое ревью

[inspection-review.md](inspection-review.md): IR01–04 воспроизведены/исправлены,
повторный PASS. [final-review.md](final-review.md): широкий просмотр выявил
FR01–03; после исправлений адресное повторное ревью PASS по всем существенным
находкам, P08/properties/pixel/nextPageAction/long IDs. Сам ревьюер не присваивает
себе QG/рендер координатора. Существенных открытых замечаний нет.

## Что посмотреть руками

1. `/studio/recipes`: направление,живой пример,до трёх read-only примерок;
   отдельное применение preserve/replace сохраняет сцены и тайминги.
2. `/studio/<id>/storyboard`: весь ролик/страницы,состояния сцены,полный PNG,
   отдельный кадр,переход в Player только при совпадении origin.
3. Замечания→selected fixes→повторная проверка/до-после/pixel diff;
   «Вернуть состояние до исправлений» возвращает точный before в новый draft.
4. `npm run test:visual`: fresh render/check,HTML reference/actual/diff.

## Знания и ограничения

Обновлены map/studio-sdk,mcp,render,dev-env и [SDK-гид](sdk-guide.md).
Проверены208 локальных ссылок в29 документах,broken0; также обновлён README.
Сетка не проверяет художественный вкус/плавность/весь звук; отчёты сохраняют
notChecked,окна deep ограничены15sec/720. Exact baseline требует среды manifest;
другая среда получает отдельный отказ. Baseline не обновляется автоматически.

## Замечания владельца

Нет; разрешена автономная приёмка до вливания этой задачи.

## Повтор SW: отрицательный результат и текущая диагностика

Полный SWrepeat тоже обнаружил pixel drift; это не принято как green и не
лечится silentaccept или ослаблением ROI. `repeat-swangle-first-report.json`
сохранён. Главная разница — AA-края SVG/рамок; missing font/image не подтверждён.
Prewarm только первого кадра и explicit deviceScaleFactor1 не исправили drift.
FromSurfacefalse дал9 capture errors/0PNG; OOM по тексту обёртки не доказан.
Doublecapture всего batch37frames×3 дал111chosenexact; это локальная выборка,
не доказательство всей матрицы. Проверяются headlessshell и paint settling.
Источники/принятые эталоны на этой диагностике не менялись.
