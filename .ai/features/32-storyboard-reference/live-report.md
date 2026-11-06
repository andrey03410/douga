# Живая проверка storyboard через настоящий stdio MCP

**Результат:** PASS, 2026-11-06 16:20:11–16:21:31 UTC. Основной прогон
`live-4ca970ae-3737-48cf-84d1-8424bd5361cf`: **6/6 сценариев, 106 утверждений,
103 вызова MCP, 14 основных артефактов** (12 PNG-сеток и 2 MP4), дополнительно
12 отдельных tile PNG,2 декодированных PNG и PCM двух клипов.

Команда из корня:

```sh
npx tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json scripts/verify-storyboard.ts
```

Каждый запуск создаёт собственные уникальные admin/user аккаунты, четыре PNG,
четыре SVG и двухсекундный sine WAV 440 Hz. Только эти owned IDs используются
при заполнении. Аккаунты и материалы оставлены для проверки UI; пароли находятся
только в приватном `storage/verification/32-storyboard/live-<run>/credentials.json`
(mode 0600). Скрипт не печатает пароль или токен, не удаляет чужие данные,
не запускает глобальную очередь, baseline, tests или build. Каждый queued job
обрабатывает только `runStudioWorkerOnce({jobId})` с известным ID этого прогона.

## Основной авторский маршрут

Настоящий `Client`/`StdioClientTransport` подключается к `src/mcp/server.ts`.
`tools/list` подтвердил **61 имя**, включая четыре новых инструмента.
На каждый сценарий выполнен один и тот же короткий маршрут:

`video_preset_list(recipes:true,kind,format)` → `video_preset_get` →
`video_project_create(presetId)` → `video_content_set` по полученной
`contentForm.example` с owned media IDs → `video_storyboard`.
Канонические render nodes и координаты в этих шести сценариях не строились.

| Сценарий | Recipe | Сцены / покрытие | Проект |
|---|---|---|---|
| top wide | recipe.clean.top.wide | 2/2 | aee01327-6ed4-41c9-974b-f54bcd3759e8 |
| top vertical | recipe.clean.top.vertical | 2/2 | f870969f-d921-411e-80b8-c77d985e8179 |
| picker wide | recipe.clean.picker.wide | 1/1 | 5a0b9893-d1d9-4ee4-9c27-7a3d960efb69 |
| picker vertical | recipe.clean.picker.vertical | 1/1 | 91f200cf-5e8e-428a-8910-9a3f5bb4278d |
| board wide | recipe.board-clear.board.wide | 12/12 | 17c03b0c-06c1-458c-a911-2d0f32ee3955 |
| board vertical | recipe.board-clear.board.vertical | 12/12 | f5549652-882a-41bd-a943-4de877860098 |

Во всех шести случаях missingInputs пуст, job завершён штатным worker,
`video_job_inspect` вернул native PNG image block. `resources/read` подтвердил
размер/SHA256 сетки; `video_job_inspect(frameId:"0")` подтвердил native PNG,
размер/SHA256 отдельной плитки. Повтор исходного storyboard запроса вернул
тот же done job и image block. Снимки всей строки StudioProject, количества
revisions и snapshots до/после чтения и рендера совпали.

Это воспроизводимая проверка форм и инструментов скриптом. Она не является
контролируемым испытанием слабой модели из продуктового критерия и не подменяет
художественную приёмку рецептов владельцем.

## Дополнительные проверки

- Чужой `user` получает NOT_FOUND на storyboard, content_set, job_get и job_inspect
  admin-проекта. Wrong expectedVersion даёт VERSION_CONFLICT.
- Для picker wide получена scene детализация по ID настоящей выбранной сцены.
  После semantic content merge имени участника compareJobId сравнил текущую
  и прежнюю версии: версии и documentHash различаются, происхождение закреплено.
- Длинный picker создан той же semantic формой из 26 раундов. Две страницы
  pageSize=24 содержат 24+2 разные сцены. Итоговое покрытие 26/26, повторов нет,
  лимит 24 соблюдён. Версия/ревизия/строка проекта не изменились.
- В top vertical с существующим last-good preview сохранён raw draft `{"`.
  Текущий storyboard вернул VALIDATION_FAILED, новое задание не появилось,
  старая картинка не выдана как результат текущего JSON. Этот проект намеренно
  оставлен с невалидным черновиком для проверки UI.
- Отдельный deterministic custom text case воспроизвёл TEXT_OVERFLOW.
  `video_review` предложил supported compact-label patch реального authoring node.
  Wrong CAS отклонён. `video_review_apply` устранил TEXT_OVERFLOW;
  повторный review это подтвердил, текст/source/bindings сохранены.
  PNG до/после просмотрен: полная подпись появляется в исходной небольшой области.
- Deep review top wide создал два bounded clip job. MP4 получены через настоящий
  MCP resource, проверены SHA256, независимо декодированы ffmpeg. Их decoded
  кадры просмотрены, оба содержат artwork и RU/JP подпись.
  Сама статическая проверка по-прежнему честно обозначает visualAssessment=notChecked.

## Декодированный звук

Оба MP4 дали одинаковые измерения независимого mono PCM16/48 kHz decode:

| Показатель | Значение |
|---|---:|
| Сэмплы | 290816 |
| Длительность decoded AAC/PCM | 6.058667 с |
| RMS | 0.04342365 |
| Peak | 0.10824585 |
| Mean | −27.2455 dBFS |
| Peak | −19.3118 dBFS |
| silent | false |

Серверные volumedetect значения согласуются (−27.2/−19.3 dBFS). После deep request,
адресного рендера, inspect и decode полная строка проекта и counts revisions/
snapshots совпали с исходными. Повтор deep вернул те же два done job.
Это доказательство декодирования и непустого звука выбранных окон; субъективное
прослушивание и оценка плавности не заявляются автоматически.

## Доказательства и RED → GREEN

Все пути ниже относительно `storage/verification/32-storyboard/`:

- `live-4ca970ae-3737-48cf-84d1-8424bd5361cf/summary.json`: 106 assertions, 103 steps,
  шесть сценариев, происхождение, timings и SHA256 артефактов.
- Та же папка: `tools.json`, `calls/`, `jobs/`, `workers/`, `states/`;
  `audio-measurements.json`, `artifacts/{top,picker,board}-{wide,vertical}.png`,
  `artifacts/long-page-{0,1}.png`, `artifacts/content-comparison.png`,
  `artifacts/review-comparison.png`, `artifacts/deep-{0,1}.{mp4,pcm}`,
  `artifacts/deep-{0,1}-frame.png`.
- Первый прогон `live-817d729c-4a26-488d-8b23-2e4402b2ed28/summary.json` — живой RED:
  grid был корректен, отдельный frameId вернул image block без mimeType, настоящий
  MCP клиент отказал с protocol −32602. Основной агент исправил MIME ветку;
  повтор всего сценария дал PASS, включая все 12 tile image blocks.
- Helper TDD: исходный RED отсутствующего helper → GREEN 3/3 тестов
  `npx vitest run src/video/storyboard-live-verifier.test.ts`.
  Проверяются все 33 реальные content forms с owned IDs без render nodes,
  PCM sine/silence и отказ malformed PCM/error MCP response.

Общая обязательная тройка относится к итоговому QG основного агента.
