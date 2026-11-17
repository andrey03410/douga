# Реализация графики — задача 1

Дата: 2026-11-17. Исполнитель: design_architecture. Изменения переданы root без
коммита. Общий QG, сайт/MCP, offline HTML, звук и принятие baseline выполняет root.

## Контракты

- `composition-settings.ts`: `CompositionSettings`, `compositionVariants`,
  `compositionSettingsSchema`. Строгий marker `{version:1,
  variant:"portrait-top"|"music-top"|"picker"|"tier-list",accent?,palette?}`.
  Палитра содержит 1–8 безопасных цветов; неизвестные поля/версии отвергаются.
- `Settings.composition?: CompositionSettings | null`. Нет marker — нет новой ветки.
- `CompiledNode.rankDraw?: {from:number,durationInFrames:number}` — локальные кадры
  контура/заполнения. Старым узлам поле не добавляется.
- `composition-presets.ts`: `getCompositionPresets():VideoPreset[]`,
  `getCompositionPreset(id:string):VideoPreset|undefined`; новые независимые значения
  при каждом вызове, без импорта builders/presets и без цикла каталога.
- Ровно 12 ID: `composition.top.portrait.<format>`,
  `composition.top.music.<format>`, `composition.picker.<format>`,
  `composition.tier-list.<format>`; форматы wide/vertical/square. Тир-лист использует
  технический `kind:"board"`. У пикера skeleton 6 карточек / 3 группы.
- index.ts/presets.ts, сервер, MCP, сайт и fixtures менял root, не этот исполнитель.

## Что изменено

`composition-compiler.ts` вызывается только при marker из существующих blocks.
Расчёт source/snippet/offset/audio/duration топа сохранён. Portrait top получает
крупный вертикальный арт, отдельные место/имя/вторую подпись, защищённые поля и
согласованную последовательность входов. Musical top показывает арт через общий
backdrop, отдельный SVG-контур места, затем название и метаданные, мягкий световой
акцент/виньетку. Служебная card сохраняет current-card resolution, opacity=0,
без label и без второго видимого изображения.

Пикер считает геометрию непосредственно от площади кадра: wide — три группы и
две высокие карточки рядом, square — три колонки с карточками друг над другом,
vertical — три строки с парой в строке. Крупность внутри сцены одинакова.
Полупрозрачные панели обнимают реальные карточки; есть ambient gradient,
мягкий цветной свет, тонкий контур, заголовки групп, маленькие ordinal badges и
счётчик раунда. Имена лежат на затемнении внутри карточек. Prompt без рамки,
таймер — спокойное кольцо с тонким stroke. Каскад и маска заканчиваются до выбора.
Номерная шторка держит целый номер, затем уходит с диагональной кромкой.

Для separate answer сохранены все защитные слои/подписи, переназначены parentId,
выключен повторный вход и исключена стартовая шторка. Ответ не придумывается.

Тир-лист показывает уже вычисленное `resolveBoard(...).final`:
обзор → непустые тиры крупно → итог. Нет candidate/think таймеров и новой игры.
В строках портрет и полное имя расположены рядом. Используются тёмные строки,
тонкие цветные полосы, крупные вертикально центрированные названия тиров.
Фокус/обзор меняются мягким crossfade. Плотный ряд вызывает адресную диагностику.

Free layout даёт `COMPOSITION_GEOMETRY_CONFLICT`; чрезмерная плотность —
`COMPOSITION_DENSITY_EXCEEDED`; несоответствие block/variant —
`COMPOSITION_KIND_MISMATCH`. Старый документ автоматически не мигрирует.

Шрифтовая пара задаётся через обычные typography roles. Font overrides для title,
prompt/rank и scoped captions сохраняются; motion profile/intensity/duration
работают через существующий post-pass. Отдельные channels локально согласованы
композицией, чтобы не складывать второй global enter с каскадом.

## Шрифты

Официальный google/fonts, закреплённый commit
`38411257417e616c5d4daa1b9e91a3dbcebe1c2e`, SIL OFL 1.1. Runtime не ходит в сеть.
Добавлено три TTF (суммарно 2 036 672 байта) и две OFL:

| Файл | SHA-256 |
|---|---|
| Cinzel normal | `f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34` |
| Cormorant Garamond normal | `b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0` |
| Cormorant Garamond italic | `0f48ea6abb2084537854f7174c470991a463b13036309e3b50a81511611c530d` |
| Cinzel OFL | `f2b3029aba64c378bf0963b62945eee15e564fe4330b934c8f2eb058282b5e83` |
| Cormorant OFL | `60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956` |

Каталог закрепляет веса 400/700, Cormorant имеет normal/italic. Cinzel применяется
к цифрам; русский serif — Cormorant. Реальные кириллические/JP строки измерены
Fontkit, missing glyphs пуст. JP использует существующий Noto fallback.

## TDD и проверки

До реализации сохранены 435 hash результатов компиляции: все 87 старых preset ID
на 24/25/30/50/60 fps, включая diagnostics. Файл `legacy-ir.json` — исходный oracle,
не пересоздавался после реализации. Полное равенство проверяет новый unit.

RED записан в `storage/feature-35-implementation/red.log`: 14 failed / 1 passed,
нет marker/каталога/новой геометрии/шрифтов. Далее выявлены отдельные реальные
регрессии с собственным RED→GREEN:

- двойная transition-маска обрезала номер при hold;
- separate answer терял shade и родителей подписей;
- длинные имена в tier overview не помещались;
- group panel рисовалась поверх арта и затемняла его;
- названия тиров стояли внизу строки;
- duration override игнорировался;
- бесконечный decorative loop мешал устойчивой раскадровке.

Логи этих прогонов: red-polish.log, red-layering.log, red-duration.log,
stable-green.log. Свет декора оставлен статическим, медленное движение музыкального
арта остаётся в backdrop; критерий stable storyboard не ослаблялся.

- `node node_modules/vitest/vitest.mjs run packages/video/src packages/render/src packages/node/src`
  → **37 files / 712 tests passed**, `target-suite.log`.
- После последней косметики таймера:
  `node node_modules/vitest/vitest.mjs run packages/video/src/compositions.test.ts packages/render/src/rank-draw.test.ts packages/video/src/visual-fixtures.test.ts`
  → **3 files / 21 tests passed**, `final-target.log`.
- `git diff --check` по изменённым tracked graphics-файлам → exit 0.
- Полный QG намеренно не запускался; DB не использовалась.

## Реальные кадры и движение

Скрипт: `storage/feature-35-implementation/preview.ts`.
Запуск: `node --import tsx storage/feature-35-implementation/preview.ts`.
Для выборочного повтора допустим аргумент `picker`, `wide` и т. п.
Используются настоящий Remotion bundle, bundled Chromium, общий renderer,
закреплённые шрифты и реальные картинки из локального референса.

Сначала неверные тестовые подписи были заменены точным сопоставлением
`DATA.rounds[0].groups[].cards` и `ASSETS.images[card.id]` из «Архетипов».
В финальных доказательствах изображены Лиза Мисима, Нагиса Фурукава, Сапфир
Кавашима, Даркнесс, Фрирен и Нано Эйай; имена/серии соответствуют источнику.
Исходный HTML и медиа владельца не менялись. Эти бинарные материалы не в git.

Все 12 representative PNG находятся непосредственно в
`storage/feature-35-implementation/composition.*.png`, без суффикса `-frame-*`.
`native-frames.json` доказывает 1920×1080 / 1080×1920 / 1080×1080.
Все 12 кадров просмотрены; дополнительно повторно просмотрены финальные picker,
тиры и переход. Полный экран номера — frame 6, диагональный выход — frame 18,
маска/каскад — frames 33/60, спокойный выбор — frame 102.

Для музыкального топа просмотрены frame 18/33: контур без заполнения и без раннего
названия; frame 120: заполненное число и читаемые подписи. Есть короткие MP4
`composition.picker.wide.mp4` и `composition.top.music.wide.mp4`; оба полностью
декодированы ffmpeg с exit 0. Это графические клипы без OST, не доказательство
звукового QG. Native PNG/MP4 не включены в публичный репозиторий.

## Решения и ограничения

- Ruling: контур числового ранга рисуется SVG text с закреплённой гарнитурой,
  детерминированными dash/fill по кадру и измеренным box. Не нужен общий JS/SVG
  path-конвертер произвольного текста. Цена — точная скорость движения по контурам
  разных цифр различается; начальное/конечное состояние и fill проверены.
- Ruling: номерная шторка — обычные shape/text/keyframes плюс короткий adjacent
  crossfade, без нового transition runtime и без изменения старого IR.
- Ruling: overview тиров использует portrait+имя справа; только уменьшение
  портретной карточки с надписью внутри не выдерживало длинных имён.
- Ruling: бесконечный световой loop декора убран, чтобы оставалось измеримое
  устойчивое окно. Музыкальный фон продолжает мягко двигаться штатным backdrop.
- «Красота» не объявлена автоматически доказанной unit/ready. Финальная приёмка
  библиотеки, 12 curated preview baseline, UI/MCP/offline и звук остаются в QG root.
