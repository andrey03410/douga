# Живая приёмка больших документов через stdio MCP

Дата: 2026-11-17. Исполнитель: design_architecture. Результат: сценарии сохранения,
чтения, кадров, звука и всех страниц раскадровки прошли. Source code не менялся,
коммитов и полного QG этот исполнитель не делал. Общую проверку ветки ведёт root.

## Изоляция и воспроизводимость

Из `prisma/dev.db` сделан согласованный SQLite backup через read-only connection:
`storage/feature-35-implementation/large-acceptance.db`. Исходная БД этим драйвером
не изменялась. Все процессы проверяли/получали явный абсолютный `DATABASE_URL`
этой копии; создан отдельный зарегистрированный актор. Его данные и медиа
остались только в gitignored storage. Чужие проекты/медиа не редактировались.

Основной драйвер: `storage/feature-35-implementation/large-acceptance-driver.ts`.
Пример запуска из корня:

```sh
DATABASE_URL=file:/Users/gel/my_projects/douga/storage/feature-35-implementation/large-acceptance.db TSX_TSCONFIG_PATH=/Users/gel/my_projects/douga/tsconfig.mcp.json node --import tsx storage/feature-35-implementation/large-acceptance-driver.ts
```

Драйвер использует настоящий SDK Client + StdioClientTransport и
`src/mcp/server.ts`. Все рабочие процессы запускались адресно:
`scripts/studio-worker.ts --once --job JOB_ID`. Он не запускал общий worker и
не забирал чужие задания. `state.json`, `call-*.json`, worker/job logs сохраняют
фактические ответы, время, версии и повторяемые receipt keys.

Дополнительные драйверы в той же папке implementation:
`large-native-frames.ts`, `large-audio-evidence.ts`, `large-text-inspect.ts`.
Итоговый машинный отчёт: `large-acceptance/acceptance-summary.json`.
Дополнение renderer для миллионного fixture:
`million-render-acceptance.ts` → `large-acceptance/million-render-summary.json`.

## 300 раундов и 2 100 настоящих привязок

В собственной БД и на диске созданы **1 800 PNG + 300 WAV**, каждый с отдельными
Art ID, физическим путём и SHA-256. Это 2 100 owned rows/файлов/уникальных hashes,
а не 300 назначений одного общего OST. Суммарно 32 513 040 байт.

PNG используют шесть разных синтетических визуальных паттернов в каждом раунде;
каждый файл имеет собственный корректный PNG tEXt chunk. WAV — 300 разных
шестисекундных PCM-тонов с частотами `220 + (round-1)*3` Гц. Эти материалы
проверяют вместимость и маршрутизацию, не художественный подбор портретов/OST.
`assets.json` перечисляет все IDs/пути/байты/hashes; итоговая проверка заново
прочитала и захэшировала все 2 100 физических файлов.

Настоящий MCP маршрут:

1. `video_design_guide(kind:picker,subject:characters,format:wide)` →
   `composition.picker.wide`, затем curated `video_project_create`.
2. `video_content_set(mode:replace)` — 1 800 участников, 300 раундов, в каждом
   шесть карточек, три группы и собственный `musicAssetId`. Все card/group IDs
   глобально уникальны и включают номер раунда.
3. `video_document_get(section:draft)` → полный документ; затем его отдельное
   raw `video_draft_replace(document)` → `video_draft_commit`.
4. `video_document_get(revision:2)` и все три страницы `video_timeline_get(limit:100)`.

После commit/read: **2 100 bindings, 300 сцен, 1 800 card nodes, 300 разных
round.music keys, 300 фактических music cues**, всего 12 000 IR nodes.
Таймлайн — 44 100 кадров при 30 fps, 1 470 секунд (24:30).
Документ занимает 513 084 байта. В таблице ссылок 4 200 записей из-за head/revision
scopes; это не дополнительный набор медиа.

| Операция | Фактическое время |
|---|---:|
| Создание 2 100 rows/файлов | 0,72 с |
| content_set с разрешением медиа | 34,98 с |
| Отдельный raw save | 30,61 с |
| commit с frozen ledger | 36,82 с |
| read + три страницы timeline | 0,59 с |
| text inspect последнего prompt | 44,49 с |

Чтение текста `main/r300/prompt` вернуло полный русский текст, размер 58,
`overflow:false`, `truncated:false`, `missing:[]`; сохранено в
`video_text_inspect.json`.

## Больше миллиона явных значений

Использован `largeKeyframeDocument()` из `resource-limits.test-fixtures.ts`:
100 text nodes × 2 600 явных opacity keyframes. Через настоящий stdio выполнены
curated create → raw text save → commit → историческое чтение.

- JSON-файл: **8 221 874 байта**.
- Wire JSON estimate: **1 040 834 authored values**, depth 10, diagnostics пусты.
  Исходный JS fixture имеет ещё одно undefined-поле: JSON-транспорт его не передаёт.
- MCP save request с экранированием строки: **9 784 113 байт**.
- Сохранена revision 2; прочитанный JSON структурно равен отправленному JSON,
  все 2 600 ключей последнего узла сохранены. Actual plan содержит 100 nodes.
- Первый save — 2,40 с, commit — 3,60 с, historical read — 0,78 с.
- Повторные запросы также проверили idempotent receipt replay без новой ревизии.

Доказательства: `million-document.json`, `call-005/006/007-*` и последующие
idempotent чтения в `large-acceptance/`. Первичный assert драйвера сравнивал
порядок ключей/undefined JS-object с wire JSON; он исправлен на структурное
равенство сериализованного JSON. Ответы сервисов успешны и данные не терялись.
Дополнительно на **том же project/revision 2**, без пересоздания сценария с
2 100 bindings, через настоящий MCP и bundled browser выполнены:

- `video_storyboard(page:0,pageSize:12)` → одна реальная PNG страница с одной
  custom-сценой, 63 553 байта, worker 4,70 с, попытка 1. Выбран кадр 2 599;
  metadata честно содержит `custom-semantics-not-inferred`. PNG просмотрен.
- `video_job_start(kind:clip,fromFrame:1280,durationFrames:30)` → односекундный
  MP4, 54 978 байт, worker 4,73 с, попытка 1. Bytes/размер/SHA сверены через
  `video://job/ID`; полный ffmpeg decode завершился с exit 0.
- Декодированы и просмотрены два соседних кадра: первый с opacity 0, следующий
  с opacity 1 и текстом. Между ними 278 679 из 278 784 pixels отличаются больше
  чем на 12 уровней gray, то есть явные keyframes исполняются рендерером.

Это технический stress fixture со 100 перекрывающимися узлами и чередованием
opacity, не образец дизайна. Звукового содержимого у него нет; звук здесь не
требовался. Просмотрены статические extracted PNG, не автопроигрывание мерцания.
Исторический документ, version и revision после inspection не изменились.
Доказательства: `million-storyboard.png`, `million-keyframe-clip.mp4`,
`million-keyframe-frame-{1,2}.png`, job/call JSON и `million-render-summary.json`.

## Кадры, клипы и декодированный звук

Через MCP jobs сделаны still и полные 4,9-секундные клипы раундов **1, 150, 300**.
Их бинарные bytes скачаны через `video://job/ID`, SHA-256 и размер сверены с
результатом задания. Все шесть jobs завершились за одну попытку.

MCP preview штатно имеет 704×396. Он не объявляется native. Дополнительно общий
`renderStudioFrames(scale:1)` нарисовал **1920×1080** из того же замороженного
MCP snapshot и engine; три PNG заняли 7,45 с на bundled Chromium:

- `native-bundled/frame-127.png` — раунд 1;
- `native-bundled/frame-22030.png` — раунд 150;
- `native-bundled/frame-44080.png` — раунд 300.

Все три native кадра просмотрены: правильные номера/шесть подписей, все изображения
на месте, читаемый prompt, устойчивое окно выбора и таймер. Это синтетическая
проверка геометрии/сохранности, не художественная оценка реальных портретов.

`large-clip-{1,150,300}.mp4` полностью декодированы ffmpeg с exit 0.
Из каждого дополнительно декодированы две секунды mono PCM 8 kHz:

| Раунд | Измеренная / ожидаемая частота | RMS mean dB |
|---|---:|---:|
| 1 | 220 / 220 Гц | −29,863 |
| 150 | 667 / 667 Гц | −29,863 |
| 300 | 1117 / 1117 Гц | −29,864 |

Это доказывает реальный звук и выбор собственного OST в середине/конце после
сотой позиции. `audio-evidence.json` и `audio-{round}.log` содержат числа и
volumedetect. Аппаратное прослушивание не выполнялось.

## Все страницы storyboard действительно отрендерены

**13 из 13 PNG страниц скачаны, SHA проверены и лично просмотрены**: первые
12 страниц по 24 сцены и последняя 12 сцен. Это **300 реально отрисованных
уникальных scene IDs main/r1…main/r300**, без пропусков и дублей; у всех jobs
`partial:false`. Страницы продолжались через pinned `sourceJobId` первой страницы.

Файлы: `large-storyboard-1.png` … `large-storyboard-13.png`, соответствующие
`job-large-storyboard-N.json`. Итоговый aggregate проверяет ровно 300 сцен,
физические PNG, hashes и факт просмотра каждой страницы. На всех страницах
просмотрены заполненные кадры выбора, корректные диапазоны/подписи и одинаковая
геометрия; чёрных/пропавших карточек не обнаружено.

Сумма времени 13 страниц — **560,29 с**, медиана 42,71 с; страницы с 24 кадрами
занимали 38,51–55,92 с, последняя с 12 кадрами — 25,03 с.
В 300-раундовом сценарии завершены 3 still + 3 clip + 13 storyboard, все за одну
попытку. После отдельного миллионного дополнения итог — 3 still + 4 clip +
14 storyboard done, **собственных active jobs 0**. Одна отдельная ранняя страница
отменена самим драйвером при смене браузера, см. ниже.

## Границы измерений и обнаруженные грабли

- На system Chrome первый native CLI запуск получил 30-секундный browser startup
  timeout; preview jobs шли 54–81 с. Первая медленная storyboard-попытка была
  **намеренно отменена только для своего QA job через MCP**. Lease освободился;
  idempotent драйвер продолжил с новым page key и явным bundled headless-shell.
  `.env`/source/чужие задания не менялись. Отмена записана в
  `canceled-system-chrome-page.json`; готовые 13 страниц выполнены новым маршрутом.
- `video_resource_estimate` — pure authored preflight, а не счётчик фактического
  render IR. Здесь он вернул 29 829 authored values, conservative 600 scenes /
  31 800 nodes и **audioCues:0**: явных authored `audio.cues` действительно нет.
  `complete:true` относится к завершению его области обхода. Actual compiler plan
  содержит **300 scenes / 12 000 nodes / 300 generated music cues**. Ноль в pure
  estimate не выдаётся за отсутствие музыки. Scope подтверждён root по отчёту
  budgets; уточнение руководства/документации выполняет root.
- Эти времена наблюдались во время параллельной работы на машине, не являются
  гарантией latency. Полные проходы разрешения 2 100 файлов занимают десятки секунд;
  постраничный render также заметно расходует время.
- Размер изолированной БД после 300-раундовой приёмки — **641 470 464 байта**,
  после миллионного render-дополнения — **696 168 448 байт**
  (backup до прогона 139 149 312). Длинный исходный JSON и физические медиа — только
  часть стоимости: сохранённые IR/ledgers/job inputs также занимают место.
- Полный 24:30 MP4 не экспортировался. Покрыты все сцены representative storyboard,
  три native кадра и три клипа со звуком. Художественную приёмку на реальных медиа,
  web/offline и общий QG выполняет root отдельно.
