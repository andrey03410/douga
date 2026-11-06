# Финальное независимое ревью ветки 32

Дата: 2026-11-06. Основание: `c0dcd1c..566830c`, полный diff без PNG,
текущие исходники и принятые product.md / tech.md / plan.md. Проверка только
чтением; код не изменён. Этот отчёт не подменяет выполняемые координатором
полный QG и приёмку эталонов.

## Подтверждённые существенные находки

### FR-01 · IMPORTANT / P1 — Применение рецепта удаляет авторскую структуру и меняет время

Новый вход: `src/app/studio/recipes/RecipeGallery.tsx:228–235`;
примерка: `src/server/studio/recipe-preview.ts:151`.
Цепочка записи: `applyStudioPreset` → `applyVideoPreset`,
`src/video/presets.ts:655–658`.

Галерея обещает применить оформление, но передаёт рецепт в прежнюю полную
замену пресета. Та без режима сохранения заменяет `settings`, `formatSettings`
и весь `scenes`. Согласие в UI говорит об обновлении оформления и конфликте
версий, но не о потере авторских сцен и изменении длительности. MCP использует
тот же путь. Отдельного режима замены/сохранения для recipe нет.

**Воспроизводимый сценарий:** top из `recipe.clean.top.wide`, один участник,
длительность main 13 секунд, scene override `card.borderRadius=77`, перед main
авторское custom-вступление с текстом длительностью 4 секунды. Применить
`recipe.cinematic.top.wide` обычной операцией галереи.

**Ожидание P02:** сохранить вступление, 13 секунд и локальный override;
изменение структуры/времени предложить явно. **Факт read-only probe:**
`scenes: [intro, main] → [main]`, `durationInFrames: 510 → 240`,
`top.durationSec: 13 → 8`, scene override отсутствует. Текст вступления теряется
при записи черновика. Это новая доступность опасного поведения через recipe
workflow, а не претензия к старому контракту полной замены legacy preset.

Нужен отдельный сохраняющий режим применения рецепта (и та же семантика
примерки), явная замена и отчёт изменённых/сохранённых свойств. Проверить
сценарий и через MCP/HTTP запись, сохранив legacy preset behavior.

### FR-02 · IMPORTANT / P2 — Готовая команда проверки проблемы рендерит другие сцены

Место: `src/server/studio/review.ts:68–69,94–110`.

Для `TEXT_READABLE_WINDOW` отчёт предлагает готовое действие с названием
«Проверить момент в движении». Оно вызывает `video_review mode:deep`, но
теряет `sceneId/nodeId/frame` конкретной проблемы. `deepReviewJobs` выбирает
только индексы `0`, `floor(N/2)`, `N−1`. В схеме review нет адресного scope,
поэтому даже повтор этой рекомендованной команды не приближает к нужному месту.

**Сценарий:** пять custom-сцен, обычные сцены по 10 секунд с короткой подписью,
только s2 длится секунду и имеет длинную подпись. **Probe:** единственный
`TEXT_READABLE_WINDOW` относится к `s2/node/n2`, frame314; отбор deep даёт
`[s1,s3,s5]`. **Ожидание P05/P09:** готовое действие показывает проблемное
место в настоящем клипе. **Факт:** все три дорогих клипа проходят мимо него.
Честный sampledScenes не исправляет неверную семантику recommended action.

Нужен адресный scene/event/window в deep и готовых аргументах либо приоритет
конкретной проблемы при отборе; при общем обзоре оставить явный выборочный
охват. Отдельно проверить переходы/поздние действия длинной board-сцены:
выбор центра сцены сам по себе не гарантирует их попадание в окно15 секунд.

### FR-03 · IMPORTANT / P2 — Продолжение раскадровки не закреплено за первым frozen input

Место: `src/server/studio/storyboard.ts:23–32,157–159`;
потребители: `src/mcp/storyboard-tools.ts:33–48` и
`src/app/studio/[id]/storyboard/StoryboardWorkspace.tsx:303–324`.

Каждая page заново вызывает live `loadInspectionProject/evaluate`; вход не
позволяет продолжить чтение исходного frozen job. `expectedVersion` закрепляет
версию документа, но не разрешённые ресурсы.

**Сценарий:** длинный tournament top с track-cover A; запросить page0 текущего
draft, затем штатно заменить обложку трека на B, запросить page1 с тем же
`expectedVersion`. Замена cover не требует изменения project.version; этот
случай уже использован `storyboard-history.integration.test.ts:51–63`.
**Факт по цепочке:** page1 проходит CAS, разрешает B и получает новый contentHash.
MCP возвращает её как обычную следующую страницу. UI сравнивает хеши лишь после
создания нового job и отказывается показывать страницу; продолжить старый
frozen лист невозможно, хотя полный frozen plan/media есть в job page0.

**Ожидание P12 и общего ограничения плана:** страницы одного просмотра используют
один origin, план, media/fonts и renderer. Нужен continuation через owned job
или отдельный inspection ID с использованием сохранённого frozen материала
и engineId; новый live просмотр должен быть отдельной операцией. Обычная
идемпотентность повторов одной страницы эту проблему не закрывает.

## Дополнительные расхождения и небольшой крайний случай

Это отдельные пункты полноты продукта, а не недоказанные причины трёх находок:

- P08: сравнение формирует пары кадров, но нет отчёта изменённых свойств,
  resolved/new issues относительно стороны «до». `apply` в UI заменяет старый
  report новым; DTO сравнения хранит origins/selection, без исходного review.
- P04/P05: ready storyboard MCP рекомендует review даже если остаются страницы;
  готовое действие продолжения с аргументами следующей страницы не возвращается.
- Небольшой подтверждённый edge-case content form: `src/video/content.ts:238`
  склеивает `roundId:card:participantId`, хотя входные ID могут иметь по200 знаков,
  а итоговый card ID ограничен200. Probe с round100/participant120: input schema
  принимает форму, build отклоняет её `too_big` по source.rounds[0].cards[0].id.
  Аналогично нужно ограничить генерируемые `content:<participant>:visual` ключи
  (:186). Рекомендуется стабильный ограниченный digest для generated IDs.

## Что проверено и что не считается находкой

- Прочитаны SDK recipe/content/storyboard/review/fixtures/pixel metrics,
  их тесты; серверы content/recipe-preview/storyboard/review/backups, изменения
  projects/HTTP/worker/render/job DTO, MCP и инструкции, обе новые UI страницы,
  интеграционные сценарии и CLI visual/live verification. Связанные исходники
  assets/sources/revisions/presets/queries/guards проверялись по цепочкам вызовов.
- IR-01–04 остаются **исправленными** по inspection-review.md. Исторический
  origin читает сохранённый plan/resources, apply IDs ограничены, неэффективная
  правка отсекается повторным compile/review, before backup атомарен с CAS.
  FR-03 относится к пагинации текущего draft и не переоткрывает исторический fix.
- Inspection не вызывает source reconciliation/commit; malformed draft не
  подменяется last-good. Ownership, scoped receipts, повторный CAS перед записью,
  общий heavy lease/fencing и hash-проверка frame manifest прослежены. Отдельной
  подтверждённой регрессии безопасности или гонки публикации здесь не найдено.
- Сравнение visual frames отделено от оценки красоты: exact RGBA и ROI,
  missing/dimensions/environment не становятся passed, engineId служит
  provenance. Fixture manifest сохраняет всю матрицу и честный sampled scope.
  Полный render/accept/check координатора ещё идёт; PNG всего набора мной не
  оценивались, и этот отчёт не утверждает их художественную приёмку.
- Глубокие measurements честно сохраняют visualAssessment=notChecked и меряют
  декодированный звук; это не доказательство плавности или субъективного ритма.
  Однако проблема адресности FR-02 остаётся.
- Самостоятельно выполнены только три небольших read-only Node/tsx probes:
  применение recipe, выбор deep-сцен и длинные generated card IDs. БД и медиа
  владельца не менялись; дорогие рендеры/полные тесты не повторялись.
- Переданные результаты: targeted77+11/query4 PASS, real stdio6 cases/106 asserts,
  контрольный агент6/6, desktop/mobile UI без pageerrors/overflow. Они приняты
  как внешние evidence, не выданы за мои прогоны. Полная обязательная тройка и
  187 fixtures/1561 frames находятся у координатора.
- Кандидаты перепроверены повторным чтением вызывающих и контрактов. Нового
  субагента-проверяющего не запускал по прямому ограничению задания; координатор
  получил находки для независимого решения.

STATUS: FAIL — FR-01–03 требуют исправления до merge; полный продукт пока не закрыт.

## Повторная адресная проверка FR-01–03 и связанных дополнений

Дата: 2026-11-06. Основание: исправления `76b7a51`, `015a737`, `70a7310`,
`fa98797`, `0af1360` и текущие рабочие правки review/MCP/UI/content/projects.
Исходный отчёт выше сохранён как история; актуальный вердикт этого повторного
прохода находится в конце. Новый широкий поиск и субагенты не запускались.

| Пункт | Статус | Проверка исходного сценария |
| --- | --- | --- |
| FR-01 | Исправлена | Новый `video/recipe-apply.ts` сохраняет authoring graph, порядок, timing и semantic settings; default preserve переносит отличающиеся от exact base overrides. `projects.ts` маршрутизирует только `recipe.*` через helper; legacy preset сохраняет прежний контракт. Try-on использует тот же helper/mode. UI явно предлагает preserve/replace. Повтор моего probe: intro/main сохранены, **510 → 510 кадров**, top13 секунд, borderRadius77. |
| FR-02 | Исправлена | `review.ts` передаёт sceneId/segmentId/frame в готовую deep-команду и фильтрует сцены перед выборкой. fromFrame/durationFrames охватывают указанный focus в пределах сцены и 15-секундного бюджета. Адресный service test повторяет пять сцен с проблемной s2 и проверяет ровно один enqueue именно s2 с её интервалом. UI добавляет кнопку проверки конкретного замечания. |
| FR-03 | Исправлена | `loadPinnedInspectionProject` проверяет owned project/job, frozen payload, origin, media/font hashes и возвращает старый engineId. sourceJobId continuation использует этот frozen plan вместо live evaluation. Новая страница копирует ресурсы в собственные inputs, поэтому удаление предыдущего job не ломает следующую. Интеграционный сценарий cover A→B при неизменной версии, смена engine, invalid current draft и продолжение comparison покрыты адресными тестами. UI продолжает закреплённый просмотр и показывает его устаревание отдельно. |

Дополнительные пункты предыдущего отчёта:

- **Готовое продолжение P04/P05 — исправлено.** `jobView.nextPageAction`
  содержит sourceJobId, страницу и сохранённый scope; ready MCP предпочитает
  его review. MCP `.partial({mode,page,pageSize})` не подставляет defaults раньше
  наследования. Последняя страница рекомендует review именно своего sourceJobId.
- **Отчёт P08 — добавлен.** `compareStoryboardDocuments` сравнивает авторские
  свойства и immutable manifest по stable ID, повторно вызывает review на обоих
  plans и возвращает resolved/new/remaining с bounded counts и notChecked.
  Сервис передаёт обе frozen стороны; UI показывает свойства и изменения issues.
  Смена содержимого обозначается отдельно от визуальной регрессии.
- **Pixel diff P08 — проверен после commit `0af1360`.** Worker сравнивает уже
  отрендеренные before/after RGBA PNG, а не несвязанные кадры; diff входит в
  owned frame ledger, SHA256 и storageBytes. Страница ограничена24 плитками
  с учётом третьей картинки. Missing/dimensions дают notComparable без ложного
  passed. identical/different — описательные статусы пользовательского контента,
  не оценка красоты. Codec ограничивает PNG, pixels, процесс и decoded output.
  Прочитаны unit-тесты alpha/hash/missing/dimensions/budgets и настоящий worker
  integration red→blue с проверкой magenta difference PNG и доступа по frameId.
- **Длинные generated IDs — исправлены.** Повтор probe с participant и round
  по200 символов успешно строит content; card и binding получают разные
  ограниченные stable digest IDs. Сохранение привычных коротких ID и обработка
  занятого binding key остаются явными.
- Небольшая обнаруженная в исправлении FR-01 ошибка расположения catch устранена:
  `RecipeApplyError` преобразуется в `StudioError` во внешнем catch операции,
  а не только при поиске base preset. Координатор сообщил meaningful
  RED7/8→GREEN8/8 с проверкой instanceof StudioError; финальное расположение
  catch проверено по коду.
- Связанный historical nextAction теперь не посылает `video_text_inspect`
  на текущий draft: эта ветка разрешена только при `revision === null` без
  sourceJobId. Исторический отчёт рекомендует storyboard с тем же revision;
  прочитана соответствующая assertion в review.test.ts.

Мои фактические прогоны в этом повторном проходе — один объединённый read-only
Node/tsx probe исходного recipe-сценария и длинных content IDs. БД/медиа не
менялись. Остальное проверено по исходникам, вызывающим и адресным тестам.
Переданные результаты: recipe-related28 PASS; pixel/continuation/history/
storyboard25 PASS в5 файлах; текущий tsc exit0; meaningful catch8/8 PASS.
Эти прогоны не выдаются за мои. Новый real MCP повтор и финальная обязательная
тройка выполняются координатором и не являются условием завершения этого
адресного ревью.

Уточнение baseline evidence: по последним данным координатора полный актуальный
stable sampling — **187 fixtures / 1675 уникальных PNG**, representative кадры
всех187 просмотрены на8 sheets; acceptance выполняется отдельно. Число1561
в исходном отчёте относилось к прежней, не принятой выборке. Я не повторял
рендер и не объявляю приёмку эталонов своим результатом.

Исходные FR-01–03 и перечисленные дополнительные пункты закрыты. Существенных
регрессий в проверенных исправлениях не найдено. Это scoped повторная проверка,
а не новый полный аудит ветки; полный QG и итоговая приёмка остаются за
координатором. Код не менялся, дополнен только этот отчёт.

STATUS: PASS — повторная проверка FR-01–03, P08, nextAction и generated IDs.

## Последняя адресная проверка: rasterizer policy и имена MCP

Дата: 2026-11-06. Область только commit `4f2ded8`, его meaningful tests,
rasterizer-policy-report.md и текущая правка init-инструкции MCP. Широкое ревью,
полный QG и рендер не повторялись.

**Политика software rasterizer пригодна для нового закреплённого golden-набора.**
Подтверждённых дефектов изменения или ослабления сравнения не найдено:

- `renderStudioFrames` передаёт `chromiumOptions.gl='swangle'` только при явной
  опции. Этот browser передаётся в каждый renderStill через puppeteerInstance;
  вариант без опции сохраняет прежние worker options. Проверены оба новых теста.
- CLI одновременно передаёт опцию рендера и записывает
  `environment.rasterizer='swangle'`. Установленный Remotion действительно
  преобразует её в `--use-gl=angle --use-angle=swiftshader`; прочитан локальный
  `@remotion/renderer/dist/open-browser.js`. Это фиксация способа растеризации,
  а не специальная обработка двух провалившихся fixtures.
- `visualEnvironmentsMatch` строго сравнивает rasterizer. Старый/default
  manifest без поля не совместим с SW, даже когда пиксели совпадают. Новый
  meaningful unit проверяет именно это, а не только наличие поля.
- Порог exact RGBA/ROI не изменён. Ни проблемные кадры, ни fixtures не исключены;
  engineId по-прежнему только provenance. Missing/dimensions/hash/mandatory
  aggregate guards и explicit `accept --confirm --reason` сохранены.
- Мой небольшой read-only probe дал `environment-mismatch` для одинаковых
  пикселей default/SW и `failed` для изменения одного канала на1 при одинаковой
  SW-среде. Это проверка guards, не доказательство повторяемости renderer.

Границы вывода существенны: исходный full default repeat имел **2/1675 failed**
и не стал зелёным задним числом. По переданной диагностике все21 кадр двух
fixtures в трёх SW batches (63 renders) совпали между повторениями, но SW и
старый default baseline визуально/пиксельно не эквивалентны. Локальные default
batches тоже были стабильны; механизм GPU/compositor как причина исходного
дрейфа **не доказан**. Это основание выбрать и явно принять воспроизводимую
тестовую среду, но не основание объявить старые расхождения несущественными.

SW golden-набор защищает результат общего renderer в закреплённой SW-среде.
Он не доказывает побитовую эквивалентность default browser/worker, параметры
которого этим коммитом не меняются. Требуемые **full SW render → ручной просмотр →
явный accept с причиной → новый full SW repeat/check** выполняет координатор;
на момент этой записи их общий PASS ещё не предъявлен. Я не принимаю baseline
и не присваиваю себе этот будущий результат.

MCP init теперь содержит полные `video_motion_list`/`video_motion_get`,
`video_font_list`/`video_font_get` и `video_typography_list`/`video_typography_get`.
Имена сверены с MCP_TOOL_NAMES; сокращённый несуществующий `/get` больше не
выдаётся за имя инструмента. Бюджет проверен собственным read-only подсчётом
UTF-8 и остаётся в3072 байтах. Переданные координатором результаты:
rasterizer2RED→18PASS/tsc0 и MCP3files20PASS; это внешние evidence, не мои прогоны.

STATUS: PASS — адресная проверка пригодности rasterizer policy и MCP names.
Этот статус не означает прохождения ещё выполняемых full SW check и финального QG.

## Финальная адресная проверка: bundled browser policy

Дата: 2026-11-06. Проверен commit `1d6f94e`, его adapter tests, локальная
реализация установленного Remotion `ensureBrowser` и вызывающие CLI/worker.
Это read-only source review; новых рендеров, автотестов и полного аудита в этом
проходе не выполнялось.

**STATUS: PASS — код политики bundled browser пригоден для полной проверки.**
Подтверждённых существенных дефектов в этом изменении не найдено:

- CLI вызывает public `ensureBrowser({ chromeMode: 'headless-shell' })` без
  системного browserExecutable. В установленном Remotion отсутствие override
  означает выбранную им tested revision, с проверкой локальной версии;
  переменная REMOTION_BROWSER_EXECUTABLE здесь не подмешивается.
- Один возвращённый executable path используется для version/binary SHA-256
  fingerprint и передаётся в `renderStudioFrames`, далее в
  `prepareStudioRender`/`selectComposition` и `openBrowser`. Фактические кадры
  используют этот browser через puppeteerInstance. Выбор браузера для metadata
  не расходится с выбором для захвата кадров.
- Override является внутренним параметром trusted renderer API. Обычные
  worker/storyboard callers его не передают и сохраняют прежний fallback на
  REMOTION_BROWSER_EXECUTABLE. Глобальная среда не изменяется. Нет private CDP
  hooks, дополнительных screenshot, прогревов, таймеров или rAF в production.
- Новые тесты проверяют приоритет override при установленном системном пути,
  передачу пути в select/open, неизменность env и default worker fallback.
  Прежний тест проверяет передачу открытого browser в renderStill. Это meaningful
  границы adapter flow; CLI resolve/fingerprint flow дополнительно прочитан по
  коду. Переданные результаты 20 targeted PASS/tsc0 не выдаются за мои прогоны.
- Exact RGBA/ROI, browser binary fingerprint, rasterizer identity, полнота
  матрицы и explicit acceptance не ослаблены. Browser149 и browser157 не
  эквивалентны по environment identity даже при одинаковых пикселях.

### Что отменяет прежнее предположение о достаточности SW

Предыдущая запись о пригодности SW policy относится к её guards, а не к
доказанной повторяемости: **полный SW/system Chrome157 repeat провалился**.
В сохранённом `storage/verification/32-storyboard/repeat-swangle-first-report.json`
фактически 22 failed results из1675. Старый набор не получил PASS задним числом.

Мои последующие диагностические опыты отдельно сохранены в storage:

- `surface-probe`: fromSurface=false не создал PNG; повторные capture errors
  не доказывают OOM, поскольку renderer переписывает исходную ошибку.
- `scale-probe`: explicit device scale1 не устранил float550px/Δ60 и board
  1–2px/Δ1 между fresh browsers.
- `raf-probe`: на одной из12 страниц top vertical изменился между первым
  screenshot и захватом после2rAF на49px/Δ60; остальные страницы сохраняли
  собственные варианты. Готовность DOM/fonts/image decode сама по себе не
  гарантировала неизменности пикселей.
- `raf-before-probe`:2rAF перед самым первым screenshot также не устранили
  top vertical49px/Δ60 между browsers. Следовательно rAF/private hooks не
  обоснованы как production fix; такие изменения не внесены.

По evidence координатора bundled headless149+SW дал111 renders
(37frames×3) без расхождений между повторениями, с одним capture и без hooks.
Это ограниченный кандидат, **не приёмка полной матрицы**. Прочитанный во время
этого ревью actual manifest действительно записывал Chrome for Testing149.0.7790.0,
SHA-256 `b469d05c698ccf9f4ae3dc43fb194fbdcf56f9da1fc46dcc19f2bf9fe2aa20b8`
и swangle; он ещё имел `complete:false`.

**Гейтом приёмки остаётся полный bundled149 render всех187 fixtures/1675 кадров →
ручной просмотр → explicit accept с причиной → новый полный bundled149 repeat
и check**, плюс финальная обязательная тройка после code freeze. На момент
этой записи общий PASS не предъявлен. Ни старый SW157 FAIL, ни111 samples,
ни DOM/SSR-ready предположения его не заменяют. Политика golden environment
не доказывает побитовую эквивалентность системному браузеру обычного worker.
