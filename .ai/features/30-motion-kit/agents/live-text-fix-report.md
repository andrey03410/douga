# LT-01 — реальные переносы строк в MotionText

Статус: **DONE**, source commit `1e2abe0409bbe52b7642f9d34a329f4b7cfcdf8f` — `fix(render): preserve text motion line flow and shaping`.

Основание: прочитан `live-text-review.md`, работа по systematic-debugging/TDD. Изменены только `src/remotion/MotionText.tsx` и `src/remotion/motion-frame.test.ts`. SDK, compiler, budgets, schema, MCP, UI/gallery examples не менялись.

## Причина и узкое исправление

`textFragments` сохранял исходные символы, однако words помещал завершающие пробелы/переводы строк внутрь word inline-block, а letters помещал newline в отдельный inline-block. Такой перевод строки действовал только внутри атомарной области и не переносил её sibling. Поэтому корректный textContent сопровождался неправильной геометрией.

Для words/letters leading/trailing whitespace теперь выводится исходными текстовыми узлами в общем `pre-wrap` потоке. Только непробельное слово/графема остаётся внутри анимируемой области. Чисто пробельные фрагменты выводятся текстом без анимируемой коробки. Исходные `\n`, `\r\n`, последовательные пустые строки, ведущие/конечные пробелы и Unicode не заменяются и не удаляются. Индексы/число IR-фрагментов и stagger timing не менялись, дополнительных анимируемых фрагментов нет.

Дополнительная живая проверка нейтрального конечного состояния выявила межбуквенный кернинг: letters с раздельными inline-block давал `AV М` x(М)=64.5px вместо raw61.5px. Когда все text clips находятся в нейтральной позе, words/letters возвращает исходный текст без разделяющих boxes; когда все полностью скрыты — исходный текст внутри одного opacity0 span. Поэтому завершённый вход, начальная поза выхода и полностью скрытые позы используют native font shaping. В активной анимации слова/буквы сохраняют свои трансформации.

Путь text-lines/counter/wipe/slam и обычного текста не переписан. Text-lines продолжает собственную корректную построчную отрисовку; counter по-прежнему заканчивается исходной строкой.

## Наблюдаемый RED

### Живой Chromium до product-правки

Создан `storage/verification/30-motion-kit/live-text-probe.mts` (gitignored evidence, не source). Настоящий установленный headless Google Chrome через Puppeteer, React renderToStaticMarkup(MotionText), width1800/font40px/1.15 Arial/pre-wrap, viewport2000px. DOM Range измеряет положения М/Ж относительно контейнера, отдельно проверяются высота и textContent.

```sh
node --import tsx storage/verification/30-motion-kit/live-text-probe.mts
```

Исходный прогон **exit1, 175 cases / 60 failures**, все failures — words/letters. Лог `/tmp/douga-live-text-red.json`. У `МОУШЕН\nЖИВОЙ ТЕКСТ`: raw height92/yМ1/yЖ47, words height46/yМ19/yЖ19 на входном кадре0, на завершённом входе также отсутствовал перенос. TextContent совпадал. Lines/wipe/slam не дали failures.

### Постоянная регрессия до product-правки

```sh
npx vitest run src/remotion/motion-frame.test.ts
```

**2 failed / 79 passed**, `/tmp/douga-live-text-unit-red.txt`: оба режима помещали явный line separator внутрь atomic inline-block. Регрессия разбирает реальную семантическую структуру SSR: для LF/CRLF separator не должен иметь inline-block предка, иначе он не разрывает общий поток. Проверены enter/exit, frames0/10/20/30/100, consecutive CRLF, пробелы и семейный emoji/世界. Это проверка поведения строки, а не только join/textContent.

### Отдельная нейтральная геометрия/кернинг

После минимального whitespace-исправления первый Chromium набор175/175 прошёл. Добавлен `AV М\nЖ VA`: **210 cases / 3 failures** у neutral letters, xМ64.5 вместо raw61.5; `/tmp/douga-live-text-layout-red.json`.

До исправления neutral shaping добавлены постоянные проверки native text structure: **2 failed / 81 passed**, `/tmp/douga-live-text-layout-unit-red.txt`. После neutral/hidden raw text path обе стали зелёными.

## Итоговый GREEN

Неподвижный целевой интеграционный набор после последних functional edits:

```sh
npx vitest run src/remotion/motion-frame.test.ts src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/video/motion.test.ts src/mcp/motion-discovery.test.ts src/mcp/instructions.test.ts
```

**6 файлов / 216 tests passed**, duration3.23s, `/tmp/douga-live-text-targeted-green.txt`:

- motion-frame83;
- studio-frame33;
- studio-player3;
- video/motion80;
- mcp/motion-discovery8 (включая schema-valid compile-ready examples и всю галерею под профилями/intensity/widget variants);
- mcp/instructions9.

```sh
npx tsc --noEmit
```

**exit0**, `/tmp/douga-live-text-tsc.txt`.

`git diff --check` — **exit0**.

### Финальная живая геометрия

Тот же Chromium probe — **exit0, 252 cases / 0 failures**, `/tmp/douga-live-text-green.json`.

Матрица: 6 форм текста × 6 режимов (words/letters/lines/wipe/slam/counter) × 7 сочетаний channel/frame: enter0/20/30, exit0/10/20/100. Формы: обычный LF; последовательные пустые строки; CRLF; ведущие/конечные пробелы; семейный emoji и 世界; начальный/конечный LF; AV/VA кернинг. Counter в этой line-layout матрице получает нечисловой текст как неизменяемый контроль внутреннего layout (такие авторские counter strings SDK не разрешает); валидные числовые counters дополнительно остаются в GREEN unit/SDK suite.

Для всех 252 случаев высота и textContent совпали с raw. Для нейтральных/завершённых видимых поз также совпали x/y М/Ж с допуском0.1px. Для базовой фразы все6режимов дают height92, yМ1, yЖ47 — перенос46px. Исходные CRLF в HTML нормализуются браузерным HTML parser одинаково у raw и motion; renderer передаёт исходную строку без замены. Native client rendering исходных текстовых узлов сохраняет авторские символы.

При активной анимации трансформированные координаты букв намеренно отличаются, но высота и явная структура строк остаются правильными. В финальном probe controls сохранены измерения базовой фразы для каждого режима.

Полный QG, MP4/watch/offline и общий fresh review остаются root после всех исправлений. Этот отчёт не утверждает их повторное прохождение данным fix-прогоном.
