# Task 2 — свежий scoped review

Основание: `b65e8af..f9a44b0`, пакет `task-2-review.diff` (15 src-файлов),
`task-2-brief.md` с дополнением про media traversal и `task-2-report.md`.
Проверены продуктовые P01–P06/P08 и технические T02–T05 в пределах Task 2.

**Spec: ❌. Quality: Needs fixes.** Две подтверждённые Important-находки.
Critical нет. Minor в отчёт не включены.

## R2-01 — Important: blur-переход пропускает подложку в середине

`src/remotion/motion-transition.ts:68–72`, внесено этим diff.

На среднем кадре перехода длительностью 21 кадр (`frame=10`) incoming и
outgoing оба получают `opacity: 0.5`. В `StudioVideo.tsx:556–565` это два
последовательных слоя над `scene.background`, поэтому итоговое покрытие
равно `0.5 + 0.5 * (1 - 0.5) = 0.75`: 25% цвета подложки просвечивает сквозь
переход. Например, две соседние сцены с белой полноэкранной графикой и чёрным
scene.background темнеют посередине перехода, даже вдали от размытой границы.
Это не ожидаемое размытие, а дополнительный провал яркости. Требование brief:
outgoing/incoming закрывают кадр; продукт запрещает чёрный стык.

Подтверждено адресным вызовом `transitionLayers({type:'blur',durationInFrames:21},
10,100,640,360)`: оба opacity=.5, оба blur=12px. Проверка интеграции показывает,
что отдельной компенсации alpha нет. В crossfade/zoom эта проблема уже решена
непрозрачным outgoing, но ветка blur осталась прежней.

Исправление: сохранять полное покрытие исходящим слоем под входящим, сохранив
характер blur; проверить центральные decoded pixels на двух одинаковых светлых
сценах над тёмной подложкой, включая границы перехода.

## R2-02 — Important: допустимые цвета полностью отключают vignette

`src/remotion/MotionBackdrop.tsx:125`, внесено этим diff.

Валидный документ с `backdrop:{preset:'vignette',colors:['red','blue']}`
или с `#123`, `rgb(1, 2, 3)`, 8-значным hex проходит публичную схему.
Renderer дописывает `cc` к первому цвету и получает `redcc`, `#123cc`,
`rgb(1, 2, 3)cc` либо 10-значный hex. Браузер отвергает весь radial-gradient;
эффект vignette отсутствует, остаётся только общий dim. Таким образом один
из пяти фонов не работает с поддерживаемыми форматами цвета.

Подтверждено настоящим Chromium через Puppeteer и React-rendered MotionBackdrop:

| Переданный цвет | computed backgroundImage |
|---|---|
| `#123456` | валидный radial-gradient, контроль |
| `#123` | `none` |
| `red` | `none` |
| `rgb(1, 2, 3)` | `none` |

Неизменённый `src/video/motion-schema.ts:13–16` прочитан именно для проверки
достижимости: эти форматы разрешены. Исправление: применять прозрачность без
строкового предположения о шестизначном hex либо нормализовать цвет; проверить
короткий/полный/alpha hex, named и функциональные цвета на реальном CSS.

## Покрытие и перепроверка

- Проверены 40 веток эффектов, отдельная текстовая отрисовка, композиция
  x/y/rotate и scale/opacity поверх keyframes, маски, 3D, ограничение частиц.
  Случайность, wall-clock и CSS-анимации в новом renderer не обнаружены.
- Проверены реальные outgoing-слои: предыдущая смежная сцена, последний локальный
  кадр, Freeze, принудительный media hold, отключение poster и собственного
  transition. none/fade/slide сохраняют старый путь; timeline/audio не меняются.
- Проверены widget geometry/frame-time, Unicode/whitespace и counters.
  Гипотеза о дополнительных пустых строках text-lines опровергнута Chromium:
  `Первая\nВторая\nТретья` при font 40px/1.15 занимает 138px как без motion,
  так и после окончания text-lines; textContent совпадает.
- Проверен единый compiledMediaUsages → worker/public rewrite → preload →
  slices/posters/applySlices/unresolved. Фоновое окно берётся как `to-from`,
  включая crossfade extension. Asset копируется при независимом slice retarget.
- Дополнительная гипотеза координатора «bouncy полностью совпадает со smooth»
  опровергнута: `motion-frame.ts:217–223` добавляет scale для non-loop/non-text.
  Адресный probe fade в середине клипа даёт smooth=1, bouncy=.96. Для loop/text
  оба профиля совпадают, но обещание отдельного результата для каждого сочетания
  профиля и семейства в brief отсутствует; самостоятельной Important-находки нет.

Неизменённые файлы прочитаны адресно: motion-types/schema/catalog — допустимые
поля/каналы/цвета; части motion-compiler — достижимость text-эффектов, timer и
создание backdrop media/extension. Обхода всего проекта не было.

Найденные кандидаты перепроверены отдельным собственным проходом против схемы
и места композиции. Дополнительный независимый агент не запускался согласно
прямому ограничению поручения; это самостоятельное свежее ревью реализации.

## Evidence и границы

Suite не повторялся по поручению. Переданные результаты: 216 tests / 7 files,
tsc exit 0. Прочитанные `studio-player.test.ts` используют настоящий Player
через SSR `renderToString(initialFrame)`, **не mounted browser seek**.

Фактически выполнены адресные probes через `node --import tsx`:
React MotionText/MotionBackdrop → headless Chromium → DOM/computed CSS;
transitionLayers для среднего blur-кадра; evaluateMotion smooth/bouncy.
Все завершились exit 0; приведённые выше результаты получены этими probes,
а не заявлены по авторскому отчёту.

Координатор сообщил legacy decoded RGBA parity 5/5. Настоящий MCP MP4,
mounted watch/offline, gallery и звук проверяются root/Task 3; самостоятельно
здесь их результат **не проверен** и общая live/QG-готовность не объявляется.
