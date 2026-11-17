# Проверки задачи 35

## Итоговая реализация

Автономный режим разрешён владельцем 2026-11-17 до merge/push main.
Проверяется весь diff от `aeb0a2a`: единые права зарегистрированных, новый
авторинг по типу ролика, композиции/шрифты/движение, предметный контент и бюджеты.
Исходные HTML, проекты и медиа владельца не изменялись.

## TDD и совместимость

Отдельные RED→GREEN и целевые команды записаны в
[графике](implementation-graphics.md), [контенте](implementation-content.md),
[бюджетах](implementation-budgets.md). В частности:

- Новая геометрия, SVG-номер, слои групп и separate answer, длинные имена,
  motion duration override и устойчивые кадры проверены адресными регрессиями.
- Все **435** результатов legacy IR (87 пресетов × 5 fps) совпадают с oracle,
  сохранённым до реализации. Raw-документы, чтение/copy/restore остаются совместимы;
  явное создание по retired presetId отклоняется.
- Subject/kind/design, receipt replay, CAS, права/типы медиа и атомарный отказ
  некорректных ссылок проверены сервисом, HTTP и настоящим stdio MCP.
- Реальное переполнение allocation сначала вернуло HTTP 500; после исправления
  возвращает 400 с `resource=expandedNodes; used=120000; limit=100000` без вставки.
- Контракт палитры HTTP/MCP переиспользует composition schema (1–8 цветов).
  HTTP отказ для 9 цветов проверен без создания проекта.

## Обязательная тройка после последних правок

| Команда | Результат | Лог |
|---|---|---|
| `npm test` | **142 файла / 1 711 тестов, exit 0, 400,79 с** | `storage/feature-35-implementation/qg-test.log` |
| `npm run build` | **exit 0, production build compiled successfully** | `storage/feature-35-implementation/qg-build.log` |
| `npx tsc --noEmit` | **exit 0, пустой вывод** | `storage/feature-35-implementation/qg-tsc.log` |

Тесты используют настоящую dev.db без параллельных тестов/worker в этой БД.
Живые большие и графические пробы используют отдельные SQLite backup и собственных
акторов. Перед build проверяется порт; процессы владельца не останавливаются.

## Графика, эталоны и сравнение с референсами

Нативные изображения всех 12 композиций: `storage/feature-35-implementation/composition.*.png`
(1920×1080, 1080×1920, 1080×1080, размеры в `native-frames.json`).
Все 12 просмотрены исполнителем; root отдельно посмотрел wide/vertical picker,
square portrait top, wide music top и tier-list. После первого просмотра были
исправлены пустые группы, слои поверх арта, тяжёлые рамки prompt/timer, подсветка,
подписи и обрезание номера на переходе. Это художественная проверка конкретных
результатов, не автоматическая гарантия красоты произвольного документа.

| Ось референса | Что проверено в новой основе |
|---|---|
| Крупность и иерархия | Крупные равные портреты, отдельные имя/место/серия; в picker 3×2 лица занимают основную площадь |
| Шрифты | Oswald/Manrope для портретов; Cinzel только для цифр и Cormorant для кириллицы/курсива; шрифты закреплены и встроены |
| Читаемость | Имена на градиенте, тонкие общие контуры вместо тяжёлых плашек, длинные имена/JP fallback измерены |
| Движение | Целый номер на шторке → диагональный выход → каскад → спокойное окно выбора; музыкальный stroke→fill и мягкий фон |
| Цельность | Одна палитра/пара шрифтов и согласованное движение; агент получает руководство по типу, содержимому и визуальной проверке |

`npm run visual:render -- --filter preset.composition.` отрендерил **129**
полноразмерных кадров: входы, устойчивые состояния и переходы всех новых композиций.
Приняты только новые эталоны в `35-studio-design-quality/baselines`; legacy32 не
переписывался. PNG оптимизированы без потерь до 23 810 250 байт, хеши обновлены.
Повтор `visual:check -- --filter preset.composition.`: **129 exact, 0 failures,
selectionPassed=true, complete=false**. Команда возвращает exit 1, потому что
весь прежний каталог в этом прогоне не запускался; full visual suite не объявлен
зелёным. Это сравнение пикселей, не оценка красоты. Лог: `visual-check.log`.

Независимый повтор того же render до ревью дал **128 exact / 1 FAIL**: на кадре
`preset.composition.top.portrait.wide@180` один пиксель фона `(1015,256)` изменил
R с 35 до 36 при остальных RGBA `(42,50,255)`. Глифы/геометрия не изменились;
PSNR всего кадра 117,32 dB. Это укладывается в прежний global budget 4×1 LSB,
но нарушает точный static ROI rank, поэтому `visual:check` остаётся **FAIL**,
а не переименовывается в PASS. Отчёт и обе PNG сохранены в `visual-repeat-report.json`,
`visual-pixel-noise.json`, `noise-actual.png`, `noise-baseline.png`. Свежий reviewer
классифицировал как MINOR ограничение квантизации браузера; автономно принято как
неблокирующее при обязательном QG и просмотре реальных кадров. Пороги, ROI и
эталоны ради этого случая не менялись. Финальный независимый повтор после исправлений ревью: **129 exact / 0 failures,
selectionPassed=true** (`visual-final-render.log`, `visual-final-check.log`).
`complete=false`, общий passed=false/exit1 сохраняются только из-за частичной
выборки нового cohort, полный legacy visual suite не запускался.

## Настоящий MCP, рендер и offline

Драйвер: `storage/feature-35-implementation/live-acceptance.mjs`; БД
`live/acceptance.db`, новый аккаунт с сохранённой ролью `user`. Цепочка для каждого
типа: design guide → create(kind/subject/design) → import owned media → semantic
content → draft commit → document/timeline/text inspect → storyboard → review → clip.

- Пикер: **3 раунда × 3 группы × 2 портрета**, собственная музыка раундов,
  441 кадр. Storyboard показывает 3/3 сцен; MP4 final **1920×1080, 30 fps,
  2 279 780 байт**, получен через MCP resource и проверен по hash/bytes.
- Топ персонажей: 2 участника, 360 кадров; музыка и подписи, клип 300 кадров.
- Музыкальный топ: 2 позиции, 1800 кадров; Cinzel/Cormorant, клип 300 кадров.
- Тир-лист: 5 рядов/6 участников, 7 сцен/483 кадра, полная раскадровка и клип.
- Каждый worker запускался только как `--once --job <свой ID>`, без общего daemon.
  Полный рендер под legacy user подтверждает права зарегистрированного аккаунта.
- Реальные MP4 полностью декодированы ffmpeg; извлечены и просмотрены PNG.
  Музыка: picker clip mean **−28,9 dB**, final **−28,8 dB**; portrait top **−19,6 dB**,
  music top **−19,5 dB**. Тир-лист намеренно без музыки (−91 dB).
- HTML всех четырёх проектов экспортирован общим сервисом, открыт в Chrome с
  offline mode: **0 сетевых запросов, 0 page errors**, все шрифты/изображения
  загружены; перемотка на кадр 120 работает. Проверены Oswald/Manrope и
  Cinzel/Cormorant, графика совпадает по структуре с рендером.

Доказательства: `live/summary.json`, `*-storyboard.png`, `*-clip.mp4`,
`picker-final.mp4`, `*-clip-frame.png`, `decoded-audio.json`, `*-offline.html`,
`*-offline.png`, `offline-browser.json`. Личные иллюстрации/OST остаются только в storage.

Статический review: 0 errors у всех четырёх примеров; у топов 0 warnings.
В picker остаются предупреждения о малых декоративных ordinal badges и коротком
номере перехода; в tier-list — о коротком начальном overview перед крупными рядами.
Они просмотрены в PNG/клипах: имена читаемы, номера — служебные акценты,
содержимое тиров затем показано крупно и в финале. Проверки не отключались,
`notChecked` движения/звука не выдавались за успешные статические проверки.

## Исправления свежего ревью

[review.md](review.md): R35-01 (полосы вместо одиночных вариантов), R35-02
(перекрытый scene.background, включая separate answer), R35-03 (use client)
исправлены и адресно перепроверены. Добавлены RED→GREEN для сеток, фоновых медиа,
клона ответа и выравнивания badge. Целевой итог: **4 файла / 38 tests passed**,
`review-final-targeted.log`. Реальные исправленные PNG просмотрены в
`review-frames/`: ungrouped vertical/square, одна группа, две группы по три,
portrait background и отдельный ответ на назначенном фоне.

Первый общий тестовый прогон нашёл устаревшее ожидание семи шрифтов вместо девяти:
141 passed / 1 failed file, 1704 passed / 1 failed test. Проверка обновлена на
девять и явно требует оба новых serif font IDs. Это диагностический прогон,
**не** финальный зелёный QG; лог `qg-initial-test.log`.

Локальный производственный picker skill также обновлён и проверен, детали в
[implementation-picker-guide.md](implementation-picker-guide.md).

## Большие документы

[Настоящий MCP прогон](implementation-large-acceptance.md) завершён:
**1800 PNG + 300 WAV**, 2100 разных owned rows/physical paths/hashes. Semantic
content → raw save → commit → historical read сохранили 2100 bindings, 300 сцен,
1800 cards, 300 разных music keys и 300 фактических cues. Документ 513 084 байта;
44 100 кадров / 24:30. Полный MP4 24:30 не рендерился.

- Content/save/commit заняли 34,98 / 30,61 / 36,82 с; read+3 timeline pages 0,59 с.
- **13/13 PNG storyboard страниц скачаны, проверены по hash и просмотрены**:
  300/300 уникальных сцен, partial:false у всех jobs.
- Native кадры 1/150/300 — 1920×1080. Три полных раундовых клипа 4,9 с прошли AV
  decode; PCM дал 220/667/1117 Гц соответственно ожидаемым разным OST, около −29,86 dB.
- Million fixture: **1 040 834 wire values / 8 221 874 bytes**, 100 nodes × 2600 keys.
  Через stdio save/commit/read без потерь, receipt replay не создаёт новую ревизию.
  На той же revision выполнены настоящие storyboard и 30-frame clip, bytes/SHA
  проверены; ffmpeg decode exit0. Два соседних кадра меняют 278 679 пикселей, то есть
  keyframes действительно исполняются. Это технический overlap fixture, не дизайн.
- Own active jobs = 0. Все эти пробы — на отдельной БД, исходники не менялись.

Pure estimate `audioCues:0` относится к явным authored cues; сгенерированные 300 cues
подтверждены actual IR. `complete` не равен полной проверке рендера. MCP дополнительно
оценивает сериализованные UTF-8 bytes после bounded traversal. Scope описан в карте MCP.
Доказательства: `large-acceptance/acceptance-summary.json`, `large-storyboard-*.png`,
`native-bundled/`, `large-clip-*.mp4`, `audio-evidence.json`, `million-render-summary.json`.

Один промежуточный полный QG имел **1710 passed / 1 failed**: существующий download
cleanup тест получил системный `kill EPERM` при `process.kill(-pid,0)`. В первом
прогоне он проходил; отдельный неизменённый повтор — 1 passed/10 skipped, затем
весь неизменённый suite — **1711/1711** без retries. Ошибка не скрывалась и тесты не
ослаблялись; логи `qg-native-process-failure.log`, `download-cleanup-recheck.log`.
Финальная обязательная тройка использует только последний полный зелёный прогон.

## Сайт и HTTP

На production `next start`, только собственный сервер и изолированная live БД:

- Вход реальным браузером под legacy user; доступны новые типы Топ/Пикер/Тир-лист.
  Начальный JSON-editor отсутствует. Через форму создан вертикальный picker:
  HTTP 201, preset `composition.picker.vertical`, marker/palette сохранены.
- Gallery picker показывает нативный 1920×1080 preview, список всех recipes — 12.
- Motion gallery: **15** эффектов по умолчанию (spin отсутствует), **40** при
  явном compatibility переключателе. Переключение проверено браузером.
- Живые HTTP: tier-list create **201**; retired preset **422**;
  allocation overflow **400** с concrete resource/used/limit; HTML export **200**,
  2 748 200 байт со встроенным планом.
- Временный личный токен → настоящий HTTP MCP: capabilities/design guide/resource
  estimate **200**. permissions author/render=true под legacy user;
  guide рекомендует composition.picker.vertical; estimate возвращает 32 МиБ и bytes.
  Токен отозван. **0 page errors**.
- Живой пример gallery проигран и остановлен на ~4 с: видны все группы,
  таймер и RU/JP текст; 0 failed requests/page errors, audio/video readyState=4.
  Снимок `web-gallery-playing.png`, метрики `gallery-live.json`.
- Собственный production сервер остановлен. Созданный live актор и только его
  проекты/медиа удалены из отдельной БД; remaining=0, активных токенов перед
  удалением=0, файл пароля удалён. Доказательство `live/cleanup.json`.

Доказательства: `live/web.json`, `web-new.png`, `web-created.png`,
`web-recipes.png`, `web-motion.png`, драйвер `live-web.mjs`. Снимки новой формы, галереи и живого примера просмотрены root.
Пароль/токен не печатались; всё частное в storage.

Финальная проверка документации: **22 файла / 288 локальных путей, 0 отсутствующих**,
`final-links.json`; `git diff --check` и staged diff check — exit 0.

## Независимое ревью

Свежий reviewer проверил весь diff от `aeb0a2a`, включая working tree.
[review.md](review.md): три IMPORTANT исправлены и перепроверены; открытых
Critical/Important нет. Ревью PASS относится к коду, не подменяет QG/живую проверку.

## Что посмотреть руками

1. `/studio/new`: сначала Топ/Пикер/Тир-лист, затем содержимое/формат/оформление.
2. `/studio/recipes`: новые композиции и нативные preview; `/studio/motion`:
   курированный список по умолчанию, прежние эффекты по отдельному переключателю.
3. Локальный `storage/feature-35-implementation/live/picker-final.mp4` и
   `top-music-offline.html`: номер/каскад/таймер, шрифты/подписи и звук.
4. [Продукт](product.md), [исследование лимита](research.md) и фактические бюджеты
   в `video_capabilities` / `video_resource_estimate`.

<details>
<summary>История: досрочное изменение прав и согласование продукта</summary>


## Объём этого шага

Продуктовая спецификация визуальной фичи и исследование референсов/бюджетов.
Графика, схемы и бюджеты SDK пока не менялись. По отдельному прямому поручению
владельца реализован только P11 — единые права зарегистрированных.
Весь QG ниже относится к этому изменению прав, не доказывает реализацию P01–P14.

## Исследование и документы

- Оба HTML открыты в Chrome 158.0.8127.18, просмотрены реальные кадры входа,
  устойчивого состояния, перехода и финала. Пути, размеры, хэши и результаты
  синтетических SDK-проб записаны в [research.md](research.md).
- Воспроизведён отказ по 100 000 посещаемых значений JSON; общий потолок 100 медиа
  или анимаций не подтверждён. Проверены компиляционные пробы до 2 100 bindings.
- Свежий builder-check `product_builder_check`: **nothing important left**.
- Финальная проверка **229 относительных ссылок в 12 изменённых документах**:
  0 отсутствующих путей. `git diff --check` — без ошибок.

## TDD изменения прав

Исполнитель `registered_admin` сначала обновил meaningful expectations:
8 ожидаемых RED по legacy user/admin-правам, квотам, назначению роли, регистрации
и MCP-токенам. После реализации — GREEN. Отдельно 3 RED по неизвестным
prototype-именам ролей → корректный закрытый отказ, 14 unit-тестов GREEN.

Целевая команда `npx vitest run` охватывала:

- `src/lib/domain/permissions.test.ts`;
- `src/integration/{roles,api-tokens,account,user-backfill,mcp-actor}.integration.test.ts`;
- `src/integration/studio-{projects,mcp,jobs,imports,http,export,publication,publish-mcp}.integration.test.ts`.

Результат исполнителя: **14 файлов, 148 тестов, exit 0, 208,30 с**.
Проверен настоящий финальный MP4 в отдельном worker под сохранённым `user`.
Проверки явных ограничений сервисов, очереди и владения сохранены.

## Итоговая тройка после правок

Выполнена основным агентом после последних правок кода, строго по порядку:

| Команда | Результат | Лог |
|---|---|---|
| `npm test` | **137 файлов, 1 619 тестов, exit 0**, 442,87 с | `storage/feature-35-research/npm-test.log` |
| `npm run build` | **exit 0**, production build compiled successfully | `storage/feature-35-research/build.log` |
| `npx tsc --noEmit` | **exit 0**, пустой вывод | `storage/feature-35-research/tsc.log` |

До build проверен порт 3000: слушателя нет. После тройки запущен только собственный
`npm run start` для живых проверок; после них остановлен. Сервер владельца не останавливался.

## Живые проверки

После тройки, на production-сборке и отдельном случайном аккаунте:

- Регистрация через настоящий `/login?mode=register` сохранила **admin**, переход
  на `/projects`.
- В той же веб-сессии тестовой строке назначен legacy `user`: `/admin` **200**,
  подпись «Администратор», **0** селекторов роли; в студии доступна «Финальный MP4».
- `/api/account/usage` **200**: role=user, maxPoolBytes=null, maxTournaments=null,
  maxArchiveBytes=10 737 418 240. Релогин после замены роли не выполнялся.
- Выпуск временного токена → настоящий HTTP MCP `video_capabilities` **200**:
  author=true, render=true. Токен отозван.
- Гость: `/api/admin/users` и `/api/account/usage` — **401**.
- Настоящий stdio MCP через `scripts/verify-studio.mjs --actor <проверочный аккаунт>
  --document storage/feature-35-research/render-document.json --kind render
  --seconds 1 --output storage/feature-35-research/mcp-render --timeout 600`:
  **exit 0, downloadVerified=true**, отдельный worker, H264/AAC, 30 кадров.
- MP4 декодирован ffmpeg: извлечён и просмотрен кадр 0,5 с; **100 352 аудиосэмпла**,
  mean **−36,6 dB**, peak **−21,0 dB** (короткий builtin tick, не проверка музыки).

Доказательства: `storage/feature-35-research/live-web.json`, `live-web.log`,
`legacy-admin.png`, `legacy-account.png`, `legacy-studio.png`,
`mcp-render/summary.json`, `mcp-render/artifact.mp4`, `mcp-frame.png`,
`audio-volumedetect.log`, `cleanup.json`. Скрипт — `live-roles.mjs` в той же локальной
папке; пароль/токен не печатался и не коммитился, временный файл аккаунта удалён.
Оба созданных в процессе проб аккаунта и только их данные удалены; итоговая
проверка второго: removedAccounts=1, remaining=0. Первый удалён перед повтором.

Первая UI-проба ошибочно искала видимый innerText кнопки внутри закрытого details.
Снимок показал закрытый «Создать задание», после раскрытия блока повтор прошёл.
Исправлен только локальный проверочный скрипт, код приложения не менялся.
Проверка роли не является оценкой новой графики: новые композиции ещё не реализованы.

## Свежее ревью кода

`admin_code_review` прочитал полный дифф от `aeb0a2a` и цепочки веб/MCP/worker/
ownership. **Critical: 0, Important: 0, Minor: 0**, исправлений не потребовалось.
Ревью read-only, тесты параллельно с QG не запускались.

Дополнительные связанные находки закрыты в том же изменении: неизвестные
prototype-имена ролей безопасно считаются гостем; выдача/разрешение MCP-токенов
используют общую `can()`, а не отдельную проверку строкового guest.

## Что посмотреть руками

1. [Продуктовые решения](product.md), особенно P02–P05 (оформление), P10 (ёмкость),
   P11 (уже разрешённое изменение прав).
2. [Разбор ограничения «100»](research.md) и локальные кадры из
   `storage/feature-35-research/`.
3. После запуска приложения зарегистрироваться: доступны `/admin`, неограниченные
   пул/турниры в `/account`, кнопка «Финальный MP4» в студии. В `/admin` нет селектора user.
4. Старый аккаунт с сохранённой ролью `user` имеет те же возможности без перелогина.

## Замечания владельца

- 2026-11-17: убрать обычного user и выдать всем зарегистрированным admin —
  принято в P11, реализовано досрочно в рамках прямого поручения.


## Уточнение структуры авторинга 2026-11-17

По фидбеку владельца пересмотрены продуктовые P02/P08 и связанные требования:
три входа «Топ», «Пикер», дополнительный «Тир-лист»; содержимое/структура/формат
кадра задаются отдельно, композицию по умолчанию подбирает студия. Прежние
«Арена/Кино/Чистый» исключены из предлагаемой публичной классификации.
Тир-лист представляет готовое распределение на существующей модели доски,
без нового движка сортировки. Добавлены A15/A16 и сохранены требования референсов.

Свежий builder-check `taxonomy_builder_check`: **nothing important left**.
Изменены только четыре Markdown-документа задачи; код и бюджеты SDK не менялись.
Проверены относительные ссылки и `git diff --check`. Тройка не повторялась:
по `verify` для чистых документов достаточно проверки ссылок/путей. Предыдущий
QG изменения прав остаётся отдельным результатом и не доказывает новую графику.

</details>
