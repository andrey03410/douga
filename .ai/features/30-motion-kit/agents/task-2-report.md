# Task 2 — покадровый renderer и resolved media pipeline

Статус: **DONE**, реализация и целевые проверки завершены. Общий QG, живые MP4/watch/offline и свежий task review выполняет root после интеграции.

Коммит только src-файлов: `f9a44b0a7c024532b91b9079c0bc1a10ec2b6a20` — `feat(render): render motion effects transitions and widgets`.

## Реализация и интерфейсы

### Покадровые эффекты

Новый `src/remotion/motion-frame.ts`:

- `motionProgress(motion, frame)` — scene-local вход/выход с профилями smooth/snappy/cinematic; клип длительностью 1 завершён на своём единственном кадре. Exit обращает reveal amount. Семантическое window проверяется до применения эффекта.
- `evaluateMotion(motions, frame, fps, rect)` — чистая композиция клипов. Возвращает x/y/rotate/rotateX/rotateY, scale/scaleX/scaleY, opacity, blur, brightness, glow, outline, shimmer, spotlight, strike и массив масок. Opacity clamp [0,1], scale clamp [.01,4]. Loop имеет период durationInFrames, начинается не раньше from и действует только в window; emphasis возвращается в нейтральное состояние после собственного окна.
- `timerState(elapsed, duration, fps)` и `progressAt(frame, timing)` — общая математика виджетов.
- `wipeMask(progress, direction)` — закрытая покадровая геометрия маски.

Все 40 имён имеют визуальную реализацию:

| Семейство | Реализация |
|---|---|
| fade, pop, slide-up/down/left/right, zoom-in/out | alpha, overshoot scale, направленное перемещение, разный начальный zoom |
| flip-x/y, tilt, blur-reveal, wipe-reveal, iris, elastic, spin | 3D с perspective, наклон, blur, направленная маска, круговая маска, независимый squash/stretch, вращение |
| float, breathe, sway, drift, ken-burns, shimmer, orbit | вертикальная синусоида, дыхание, поворот, двухосевой дрейф, медленный zoom/pan, движущийся световой блик, орбита |
| pulse, bounce, shake, nudge, glow, outline, stamp, spotlight, flash, strike, wiggle | пульсация масштаба, отскок, затухающий shake, направленный толчок, drop-shadow glow, outline, stamp с поворотом, spotlight overlay, brightness flash, световой strike overlay, вращательный wiggle со stretch |
| text-words/lines/letters/wipe/counter/slam | покадровые фрагменты, построчная маска, Unicode-графемы, направленная маска всего текста, числовой счётчик, текстовый slam |

`studio-frame.ts:evaluateNode` складывает motion x/y/rotate с ручными animation, перемножает scale/opacity. Ручные треки, видимость, исходы, board motion, таймлайн и аудио не переписаны. `StudioVideo` применяет 3D/filter/outline и вложенные masks; контейнерная маска включает его потомков. Без motion дополнительных transform/filter в старом пути нет.

### Текст

Новый `MotionText.tsx` экспортирует `textFragments`, `counterText`, `MotionText`.

- Unicode разбивается `Intl.Segmenter` по графемам, семейные emoji не разрываются на отдельные визуальные части.
- Word fragments сохраняют ведущие/промежуточные/конечные пробелы, присоединяя их к словам. Число фрагментов не превосходит compiler word budget; пробельные сегменты не создают дополнительные анимируемые слова.
- Lines сохраняют переводы строк; визуальные строки показываются block-областями.
- Counter понимает точку и запятую, сохраняет внешние пробелы; конечный кадр возвращает исходный текст побуквенно, включая leading zeroes, знак и формат дроби.
- Render не разворачивает IR. Дополнительная защита ограничивает fragments 500 на узел даже для некорректного внешнего IR; общий бюджет сцены остаётся ответственностью compiler.
- Без text clips компонент возвращает исходный raw text: прежний DOM текста сохраняется.

### Фоны и виджеты

Новый `MotionBackdrop.tsx`:

- `backdropLayersAt(backdrop, frame)` не возвращает будущие layers; новый слой появляется только с from.
- Предыдущий слой удерживается под fade-in нового до продлённого compiler `to`. При разрыве до следующего слоя/конце последний слой плавно гаснет к нейтральному scene background.
- Пять отдельных визуальных решений: art-blur с resolved image/video, движущийся многоцветный gradient-flow, radial light-orbs, ограниченные 32 particles, radial vignette.
- Детерминированные координаты процедурных элементов зависят от seed/index, время — только frame/fps; motion:false замораживает процедурное движение.

Новый `MotionWidgets.tsx`: `MotionTimer`, `MotionVersus`, `MotionBadge`, `MotionProgress`.

- Timer: прежние digits, настоящий SVG ring, 12 SVG segments, bar; frame/fps countdown, showValue, warning color, track/color/stroke.
- SVG использует квадратный viewBox по меньшей стороне rect и preserveAspectRatio=xMidYMid meet: круг не растягивается в прямоугольнике.
- VS: clean/neon/slash/impact имеют разные формы/свет/наклон/ударную подложку.
- Badge: rank/round/winner/label, resolved текст из IR, цвет/обводка, winner star.
- Progress: clamp((sceneFrame-from)/durationInFrames), включая отрицательный from у video scope.

### Настоящие переходы

Новый `motion-transition.ts` экспортирует `isAdjacentTransition`, `transitionLayers`; они также экспортированы через motion-frame.

- wipe/zoom/push/flash/iris/split/blur/crossfade занимают только начало входящей сцены, не сдвигая timeline/audio.
- Направления и размеры canvas используются при масках и перемещении.
- Outgoing — ровно последний scene-local кадр смежной предыдущей сцены; поиск допускает границу сегментов, но не перескакивает через временной разрыв.
- Outgoing получает Freeze time context, отключённый собственный transition, фиксированное media source frame и принудительное отключение poster fallback. Это удерживает реальный кадр обычного playing video без activeWindow, в Player и покадровом пути.
- Crossfade/zoom держат непрозрачную outgoing подложку до завершения входящего, избегая провала общей alpha в середине.
- Первая сцена использует нейтральный scene background под incoming. Duration 1 даёт завершённый переход на frame 0.
- `transitionAt` сохраняет старую математику none/fade/slide; новые типы не попадают в прежнюю slide-ветку.

### Один media traversal

Новый browser-safe `src/video/compiled-media.ts`, публичный export из index:

```ts
compiledMediaUsages(plan): Generator<{
  asset: ResolvedAsset;
  from: number;                 // composition-absolute
  durationInFrames: number;
  media?: CompiledMedia;
  cue?: CompiledAudio;
  scene?: CompiledScene;
}>
```

Генератор выдаёт mutable references для audio cues, scene nodes и backdrop.layers. Фон имеет duration=`to-from`, включая crossfade extension; source media offset/loop/freeze остаются исходными.

Потребители общего обхода:

- `src/server/studio/render.ts` — static publicDir rewrite источников и poster. WeakSet защищает shared ResolvedAsset от повторного переписывания уже переписанного пути.
- `src/watch/model.ts` — rewritePlanMedia по hash/file/poster, upcomingMedia по абсолютным usage windows.
- `src/watch/offline.ts` — usages/mediaSlices, posterHashes, applySlices и offlineMediaUnresolved. Каждый usage получает отдельную копию asset перед retarget: общий manifest asset у разных trims больше не затирает пути/длительность соседнего usage.

Те же image/video источники работают для backdrop-only сцены без scene.nodes.media. Offline BOOT уже рекурсивно разрешает src/posterSrc и поддерживает backdrop без отдельной ветки.

## Изменённые src-файлы

Новые: `src/remotion/{motion-frame.ts,motion-transition.ts,MotionText.tsx,MotionWidgets.tsx,MotionBackdrop.tsx,motion-frame.test.ts}`, `src/video/compiled-media.ts`, `src/watch/backdrop-media.test.ts`.

Изменены: `src/remotion/{StudioVideo.tsx,studio-frame.ts,studio-player.test.ts}`, `src/video/index.ts`, `src/server/studio/render.ts`, `src/watch/{model.ts,offline.ts}`.

Compiler/types/schema семантика не менялась. Всего в коммите 15 src-файлов. Чужие .ai-изменения не включены; state/plan не менялись. Обновление карточки `.ai/map/render.md` передано root для общего docs-коммита этой же ветки.

## TDD RED → GREEN

Наблюдаемые RED до реализации соответствующего поведения:

1. Базовые renderer/traversal контракты: **2 failed suites**, отсутствуют motion-frame и compiled-media. Команда `npx vitest run src/remotion/motion-frame.test.ts src/watch/backdrop-media.test.ts`, лог `/tmp/douga-render-red.txt`.
2. Edge regression после первого GREEN: **2 failed / 66 passed** — crossfade/zoom opacity подложки=.5 вместо 1; shared asset у двух разных source windows после slicing получил один и тот же slice src. Лог `/tmp/douga-render-red-edges.txt`. Исправлены непрозрачная подложка и независимый asset на usage.
3. Text budget regression: **1 failed / 66 passed** — три слова с пробелами создавали семь fragments вместо трёх. Лог `/tmp/douga-render-red-text.txt`. Исправлены группировка whitespace со словом и numeric comma handling.

Промежуточные GREEN: 208, 213, 215 tests. После последних функциональных изменений выполнен неподвижный финальный набор:

```sh
npx vitest run src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/video/motion.test.ts src/watch/backdrop-media.test.ts src/watch/model.test.ts src/watch/offline.test.ts
```

**7 файлов / 216 tests passed**, duration 2.24 s, лог `/tmp/douga-render-final.txt`:

- motion-frame: 67;
- studio-frame: 32;
- studio-player: 3;
- video/motion: 80;
- backdrop-media: 3;
- watch/model: 17;
- watch/offline: 14.

Покрытие: все 40 имён, конечные bounded states, повторный seek, начальные/завершённые позы entrance, duration 1, окна и композиция keyframes; все 8 переходов и направления; 3 canvas × 5 fps; timer circle/progress; exact text/Unicode/whitespace/counter; backdrop gap/future source; backdrop-only image/video rewriting/posters/slicing/unresolved; shared source trim independence.

Actual Player regression (`studio-player.test.ts`) исполняет настоящий React/Player/StudioVideo в отдельном NODE_ENV=production процессе. Для каждого из 8 новых переходов использован предыдущий playing video **без activeWindow**, с poster и ручным движением x=0→59. На кадрах композиции **60/65/70/71/65** проверены:

- в течение перехода source start остаётся **149/30** секунды (offset90 + last59), независимо от текущего входящего clock;
- ручная позиция удержана x=59;
- poster не монтируется;
- frame71 уже не содержит outgoing video;
- первый scene transition не создаёт NaN/Infinity.

После функциональных правок:

```sh
npx tsc --noEmit
```

**exit 0**, лог `/tmp/douga-render-tsc-final.txt`.

`git diff --check` — **exit 0**.

Полный `npm test → npm run build → npx tsc --noEmit` здесь не запускался по явному разделению задания: его выполняет root после Task3. Реальные worker MP4, watch/offline browser playback, визуальное различие всей галереи и decoded RGBA parity со старым renderer проверяет root; данный отчёт не утверждает завершение этих живых проверок или fresh review.

## Fix round 1/5 — R1/R2/R3/R4

Прочитан свежий `task-2-review.md`. Коммит `bc4a6750ed649d9acc46d260c2ddd152bd3d924f` — `fix(render): preserve transition coverage and widget readability`; только 7 src-файлов.

### Изменения

- **R1 (review R2-01):** blur держит outgoing opacity=1 под incoming до последнего кадра, затем opacity=0. Blur фильтры сохранены; совокупное центральное покрытие incoming + outgoing × (1−incoming) равно 1 на протяжении перехода. Длительность, outgoing frame, остальные transition types не менялись.
- **R2 (review R2-02 и root badge finding):** единый `studio-paint.ts:colorWithAlpha(color, alpha)` строит `color-mix(in srgb, color alpha%, transparent)`, умножая имеющуюся alpha валидного CSS-цвета. Vignette использует .8; winner badge — 40/255 (прежняя hex alpha 28). Поддержаны #RGB/#RRGGBB/#RGBA/#RRGGBBAA/named/rgb()/rgba() без дописывания недопустимого hex-суффикса. Схемы и типы не менялись.
- **R3 (root visual):** новые versus/badge без `style.fontSize` получают geometry-based fallback. Versus: min(width × .38, height × .6), badge: min(width × .2, height × .55), минимум 18. Versus fitting использует фактический текст `VS`; дополнительный single-line cap не позволяет generic fitter переносить V/S на две строки. Explicit fontSize остаётся приоритетным; проверены 34px на обоих виджетах. Прежние text/timer digits/card defaults не менялись.
- **R4 (root light-orbs):** light-orbs использует `Math.min(32, b.particles)` вместо постоянных пяти элементов. 0 выключает orbs, 3 даёт три, 32/внешние 40 ограничиваются 32. Прочая семантика пресетов не расширялась.

### RED → GREEN

1. `npx vitest run src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts`: **9 failed / 99 passed** до product-правок. Failures: blur coverage, семь форматов цвета, VS fallback=21.49px вместо крупного читаемого. Лог `/tmp/douga-render-fix1-red.txt`.
2. Дополнительный R4: `npx vitest run src/remotion/motion-frame.test.ts`: **4 failed / 75 passed** — прежние постоянные пять orbs вместо 0/3/32/32. Лог `/tmp/douga-render-fix1-r4-red.txt`.
3. Первый общий GREEN attempt выявил ещё один край VS fitting: generic text fitter переносил двухбуквенный VS, допуская font82.2px в области шириной80px. Добавлен single-line cap; существующий regression стал зелёным.

Неподвижный итоговый набор после всех функциональных правок:

```sh
npx vitest run src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/video/motion.test.ts src/watch/backdrop-media.test.ts src/watch/model.test.ts src/watch/offline.test.ts
```

**7 файлов / 229 tests passed**, duration 2.24s. Файлы: motion-frame79, studio-frame33, studio-player3, video/motion80, watch/backdrop-media3, watch/model17, watch/offline14. Лог `/tmp/douga-render-fix1-green.txt`.

`npx tsc --noEmit` — **exit 0**, лог `/tmp/douga-render-fix1-tsc.txt`. `git diff --check` — **exit 0**.

### Живая адресная проверка Chromium

Скрипт вне git: `storage/verification/30-motion-kit/render-fix1-probe.mts`.

```sh
node --import tsx storage/verification/30-motion-kit/render-fix1-probe.mts
```

Настоящий установленный headless Google Chrome; React-rendered MotionBackdrop/MotionBadge/StudioSceneFrame, computed styles, screenshot PNG → ffmpeg raw RGB. Без сетевых медиа.

- RED до product-правок: центральный pixel двух белых сцен над чёрным scene.background на blur frame10 — **[191,191,191]**, frame0/20 — [255,255,255]. Vignette/badge не принимали цвета с добавленными cc/28. Лог `/tmp/douga-render-fix1-browser-red.txt`.
- GREEN — **exit 0**: frame0/10/20 дают **[255,255,255]**. Для #123/#123456/#1234/#12345678/red/rgb(1,2,3)/rgba(1,2,3,.5) computed vignette backgroundImage — валидный radial-gradient; computed badge backgroundColor — валидный color(srgb ... / alpha), исходная alpha умножается. Лог `/tmp/douga-render-fix1-browser-green.txt`.
- На том же реальном DOM rect307×194 с пустым style: VS **116.4px**; badge rect240×100, Winner — **48px**. Explicit 34px сохранён unit regression. Прежняя typography проверена unit regression; root legacy parity/QG после Task3 остаются в общем workflow.

Сообщённые root исходные live evidence (MCP MP41569 frames/52.3s/11826503bytes, RMS−38.65dB, legacy RGBA parity5/5) здесь не перезапускались и не выдаются за результат этого fix-прогона. Scoped re-review R1/R2/R3/R4 назначает root.
