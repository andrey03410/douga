# Проверка задачи 27

Дата: 2026-11-05. Автономный режим до merge разрешён владельцем.
Все доказательства и одноразовые драйверы лежат в `storage/verification/27-segments/`
(не коммитятся). Использован отдельный проверочный аккаунт `segments27-manual@test.local`,
проекты и медиа владельца не изменялись. Перед аддитивным db push сделана SQLite backup
`storage/backups/before-27-segments.db`.

## Итоговый QG

**PASS после всех production-исправлений, Node22.23.2.**

| Команда (по порядку) | Итог | Лог |
|---|---|---|
| `npm test` | **913/913 тестов, 80/80 файлов**, exit0, 481.83с | qg-test.log |
| `npm run build` | production build успешен, exit0, Next14.2.35 | qg-build.log |
| `npx tsc --noEmit` | exit0, вывод пустой | qg-types.log |

Порт3000 был свободен при сборке; собственный dev остановлен до тройки, общих worker нет.
`git diff --check` чистый. Проверены246 локальных Markdown-ссылок, отсутствующих0.
Ручной сайт, MCP, MP4/PNG/PCM — ниже; исключение живого offline playback указано явно.

## TDD и целевые проверки

- Backend: 85 тестов/9 файлов; отдельный regression старого singleton — 8/8.
  `backend-report.md`, `backend-green.log`, `backend-singleton-{red,green}.log`.
- SDK: 253 теста/15 файлов; `sdk-report.md`, `sdk-*-red.log`, `sdk-green.log`.
- Source bridge: 142 теста/7 файлов после первой suppression-правки;
  `bridge-report.md`, `bridge-tombstone-tests.log`.
- UI/пул: 18 тестов/5 файлов до итогового mute regression, `ui-green.log`.
  Красные проверки переноса без потери треков, перестановки рангов и segmentId:
  `ui-red.log`, `navigation-red.log`; player SSR/длительности: `player-red.log`;
  volume0→unmute: `player-mute-red.log`.
- Discovery MCP: `capabilities-red.log` → `capabilities-green.log`.
  `video_capabilities` сообщает latest schemaVersion2 и supportedSchemaVersions1/2;
  runtime schemaVersion1 относится к compiled IR.
- Кэш изменяемых обложек: `cover-cache-red.log`, `cover-manifest-red.log` →
  `cover-cache-green.log`. HTTP cover private/no-cache, UI меняет адрес по выбранной
  Art, манифест включает hash содержимого в URL.

## Ручной сайт

Драйв выполнен во встроенном браузере через CUA с реальными кликами, файлами,
нативным drag, клавиатурными range и осмотром скриншотов.

1. **Несколько архивов:** два ZIP с тремя треками каждый; имена сегментов изменены
   в форме до отправки. Создан турнир
   `/tournaments/cmw3d89za0002hysvxc42ajdz`.
2. **Независимые сравнения:** сначала пройден Эпизод2, сохранён top-2; у Эпизода1
   осталось 0 ответов. Прослушивание реально декодировало 8-секундный MP3,
   `readyState=4`, currentTime рос. Лучший момент отмечен на 5.7с.
3. **Результаты:** native drag поменял места Трека4 и Трека6, порядок сохранился.
   Название исправлено на Golden Witch, исполнитель Dai, комментарий
   «Любимый мотив эпизода», лучший момент1.5с. Через диалог импортирован файл
   cover1.jpg и выбран как обложка. Метаданные приехали в SDK (см. ниже).
4. **Перенос после ответов:** в редакторе создан Бонус, трек5 перенесён мультивыбором.
   Сайт показал подтверждение снятия 1 ответа. После применения Эпизод2 стал
   in_progress с 2 треками/0 ответов, Бонус из одного трека сразу получил место1.
   Эпизод1 не изменился. Эпизод2 завершён заново, затем пройден Эпизод1.
5. **Папки архива:** `/tournaments/cmw3dhvhz003dhysvqzrzme1i` создан из folders.zip.
   Форма предложила две папки, общий корень OST отброшен, обе стали сегментами.
6. **Плоский архив:** `/tournaments/cmw3dk021003yhysv1mpz32rl` создан одним блоком.
   В редакторе «Разбить по альбомам» создало 2×3 трека. Native drag трека1 дал
   состав2+4. Удаление текущего сегмента перенесло треки в оставшийся и сменило URL;
   404 не появилось, все6 треков сохранены.
7. **Кнопка видео:** из готового сегмента открыт `/studio/new?sourceId=…`.
   Видимый JSON v2, после «Создать SDK-проект» проект
   `5f0a49af-bad9-4cca-904f-5852a6cc8872` получил все3 сегмента/6 участников,
   проверка «Готово». Состав просмотрен в открытом SDK, не через скрытое состояние.
8. **Новый плеер:** единая тёмная панель в результатах, парном сравнении и редакторе.
   Проверены play/pause, seek клавишей до старта, смена трека с остановкой предыдущего,
   volume0→unmute, отметка лучшего момента из нового media element (0.4с).
   Нет нативной белой панели, длительность8с показана до загрузки.
9. **Узкий экран:** при layout390px scrollWidth=390px; шапка и действия переносятся.
   Результаты и плеер помещаются. Временные viewport/CDP overrides сброшены.

Доказательства: `ui-folders.jpg`, `ui-editor.jpg`, `ui-completed.jpg`,
`ui-studio-source.jpg`, `ui-themed-compare.jpg`, `ui-player-mobile.jpg`,
`ui-final-player.jpg`, `ui-final-results.txt`. В процессе разработки HMR сбрасывал
черновик редактора; конечный сценарий повторён на стабильном коде и сохранение подтверждено.

## Настоящий MCP и синхронизация

Backend stdio: создание из path разрешённой директории и assetId пула,
подписи/постеры и отказы чужому пулу/вне allowlist. `backend-report.md`.

Source stdio: проект `b851228e-f90b-44e9-9cc9-1e527352ce6c`.

- `live-source-project.json`: один готовый Эпизод2, v2, version1/revision1.
  rank1, Dai, comment, bestMoment1.5, cover binding присутствуют.
- `live-source-after-move.json`: Эпизод2 dormant, его ID/сцены/оформление сохранены;
  singleton Бонус появился. version2/revision2, ready без diagnostics.
- `live-source-after-complete.json`: тот же Эпизод2 включён, Бонус остался,
  новый Эпизод1 добавлен. version3/revision3, ready. Author document order удержан,
  source.segments идёт в порядке турнира.

## Реальный ролик и главы

[Проверочный ролик](http://localhost:3000/watch/44V8KPji7lV1ol60n3QQeA), проект
`1d42fea0-0ced-4dd4-acef-0cc319fbf90f`, revision2/version4.
Собран и committed настоящим stdio MCP. Смешанный v2:
intro → Эпизод1 → Эпизод2 → Бонус → picker → outro.

- **12.8с, 384 кадра, 30FPS, 1920×1080**, 12 сцен.
- MP4 `live-render/mixed-final.mp4`, 837363байт; скачанный MCP ресурс сверён SHA/размером.
- Просмотрены 13PNG из MP4. Title/subtitle/number/count, локальные ранги,
  album/score/comment, обложки, наборы segment/revealed, dynamic media и blur присутствуют.
- 6 top аудио: mean_volume −26.5…−26.6dB; picker активные cue −26.6dB,
  полный picker −29.4dB. Тишина интро/аутро/итогов ожидаемая (−91dB).
- bestMoment1.5с даёт offset45 кадров в top и picker.
- Target segment patch поменял background одного сегмента; canonical SHA другого
  сегмента до/после совпал. `live-render/segment-patch-proof.json`.
- В `/watch` вручную переключены главы и seek к кадру180: «Эпизод2»,
  Golden Witch/Dai, комментарий и изменённая обложка видны. `ui-watch-*.jpg`.

Полный протокол/драйверы/кадры/звук: `live-render-report.md`, `live-render/`.

### Ограничение ручной проверки offline

Получен штатным HTTP export `live-render/mixed-offline.html`, 945013байт:
8 embedded media, 0 unresolved, 0 external scripts; план и интервалы совпали с revision2.
Названия глав проверены общими model/offline тестами и live watch.
**Живое воспроизведение локального HTML без сети не проверено:** встроенный браузер
отклонил file:// по политике допустимых протоколов (только HTTP/HTTPS). Обходов
через другой браузер, протокол или сырой CDP не предпринимали. Структурная проверка
не выдаётся за полное offline playback.

## Совместимость v1

До реализации зафиксирован baseline кода bbfe236, общий `legacy-input.json`.
Реальный рендер старым и новым bundle:

- сериализованный план одинаков;
- lossless PNG кадров0/15/45 побитово одинаковы;
- decoded PCM полностью одинаков;
- яркость всех60 decoded MP4 кадров одинаковая. H.264 chroma отличается на
  2608/26179200samples, максимум2/255, PSNR88.058287dB. Побитовое равенство MP4
  не заявляется; различие локализовано после lossy encoding.

Числа/команды/хеши: `legacy-parity-report.md`, `legacy-{before,after}*`.

## Свежее ревью

Независимый ревьюер всей ветки: `final-review.md`, воспроизводящий драйвер
`final-review-repro.ts`, фактический вывод `final-review-evidence.json`.
Первый снимок получил FAIL с шестью P2; они приняты к исправлению до QG:

- R1: sound bindings при v2 apply preset;
- R2: authored disabled после ready→unready→ready;
- R3: удаление dormant сегмента;
- R4: bestMoment dynamic video узла;
- R5: playSound:false и звук рецептов;
- R6: суммарный policy-window бюджет.

Все шесть замечаний закрыты. Первый раунд source исправлений: 15/15, `review-source-fixes.md`.
SDK R1/R4/R5/R6: RED→GREEN, затем scoped review выявил ещё два стыка R1/R5.
Во втором раунде slots получили независимые namespaces, mute v2 отделён от прежнего v1;
последние целевые SDK/watch/renderer/MCP проверки — **269/269**.
`review-sdk-fixes.md`, `review-sdk-fixes-round2.md`, `review-round2-evidence.json`.
Повтор независимого ревьюера: **PASS**, `final-review-round2.md`.

Дополнительная v1 регрессия с явным playSound:false сравнивалась с bbfe236:
по одному audio cue, весь план одинаков (SHA1ad6823c…). Это отдельно доказывает,
что исправление mute новых рецептов не меняет прежний звук.

Финальный код компилирует уже отрендеренный live-документ в полностью идентичный план
(SHA1c1f2604…, `review-sdk-live-plan.json`, повтор round2 report). Renderer после живого
прогона не менялся. Поэтому повторный MP4 не делали: содержимое не затронуто исправлениями.

При первом полном прогоне на Node26 один MCP timeline-test упёрся в default5с;
прогон прерван для второго раунда production-исправлений. Диагностика trace показала,
что сценарий включает prepareStudioEngine через job_start, где допустима сборка до120с.
Отдельный измеренный запуск на штатном Node22.23.2: job_start1551мс, тест1676мс,
`cold-engine-diagnostic.log`. Таймаут только этого интеграционного сценария приведён
к150с; production-таймауты и очередь не менялись. Финальная тройка идёт на Node22.

## Что посмотреть руками

- Турнир `/tournaments/cmw3d89za0002hysvxc42ajdz`: сегменты, результаты, новый плеер,
  настройки Golden Witch, редактор разбивки (проверочные данные, не материал владельца).
- Ролик `/watch/44V8KPji7lV1ol60n3QQeA`: переключение глав, кадр180 с комментарием,
  picker с276 кадра, итоговые таблицы.
- `storage/verification/27-segments/ui-final-player.jpg` — вид плеера;
  `ui-player-mobile.jpg` — узкая раскладка.
- MP4 и offline HTML лежат в `storage/verification/27-segments/live-render/`.

## Замечания владельца

Добавлен запрос на красивый плеер в теме сайта; реализован в этой же задаче,
дословные слова записаны в brief.md, решение — T09.

Дополнительно проверена совместимость удаления аккаунта с новыми Restrict-ссылками.
Первый запуск `tournament-assets.integration.test.ts` воспроизвёл FK-отказ в deleteUser.
Исправлен порядок: Studio-ссылки/проекты → турниры → User/pool cascade, затем файлы.
Регрессия + старые roles: 22/22, `account-assets.log` (RED), `account-assets-green.log` (GREEN).

## Интеграция

[PR8](https://github.com/andrey03410/douga/pull/8), автономная приёмка разрешена в brief.md.
После зелёной тройки и независимого PASS задача интегрируется merge-коммитом в main.
Base main оставался756cf4a; production-исправлений после итогового QG нет.
Dev перезапущен на Node22 после build, порт3000 снова доступен.
