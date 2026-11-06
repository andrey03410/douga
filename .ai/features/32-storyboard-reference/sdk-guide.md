# Короткий маршрут для агента

Все операции выполняются от имени MCP_ACTOR_EMAIL. Нужен studio:worker.
Обычный автор может смотреть PNG/клипы; финальный MP4 требует admin.

## Выбрать и заполнить

1. `video_preset_list({recipes:true,kind:"picker",format:"vertical"})` — до трёх
   совместимых рецептов, recommended и образцы; `previewOrder` соответствует
   порядку настоящих image blocks, `previews` честно сообщает недоступные.
2. `video_preset_get({presetId:"recipe.anime-impact.picker.vertical"})` — канонический
   preset, recipe.contentForm и валидный пример. Полный SDK читать не требуется.
3. `video_project_create({presetId:...,title:"Мой пикер"})` — запомнить id/version.
4. `video_content_set` с expectedVersion и явным content.mode:

```json
{
  "projectId": "ID из create",
  "expectedVersion": 1,
  "idempotencyKey": "мой-уникальный-ключ-заполнения",
  "content": {
    "kind": "picker",
    "mode": "replace",
    "participants": [
      {"id":"a","label":"Фрирен / フリーレン","visualAssetId":"собственный assetId"},
      {"id":"b","label":"Вайолет / ヴァイオレット","visualAssetId":"другой собственный assetId"}
    ],
    "rounds": [{"id":"round-1","prompt":"Кого выберешь?","cards":[{"participantId":"a"},{"participantId":"b"}],"answerParticipantIds":["a"]}]
  }
}
```

`assetId` получается из пула. Имена в примере выше — места для своих значений,
не существующие IDs. `missingInputs` должен опустеть перед выдачей ролика.
`merge` обновляет именованные части, `replace` явно заменяет содержимое.
Настройки оформления и поля вне выбранного scope сохраняются.

Для своего топа: `content.kind:"top"`, participants с заданными rank,
visualAssetId/audioAssetId; раунды не нужны. Для турнира используйте create с
presetId топа и sourceId: места берутся из турнира и через content не назначаются.
Для доски копируйте форму recipe.contentForm.example: её sceneId/slotIds и
board round actions — авторские решения, система их не выдумывает.
В `video_examples`: guided-top, guided-picker, guided-board.

## Увидеть и исправить

`video_storyboard({projectId,expectedVersion})` даёт одну сетку страницы.
Queued/running — выполните nextAction video_job_get, после done — job_inspect.
Каждая сетка содержит origin и coverage. Чтобы открыть один кадр:
`video_job_inspect({jobId,frameId:"0"})`. Сцена подробно — mode:"scene"+sceneId;
все сцены длинного ролика — page:0,1,…; pageSize≤24 (default12).
Для продолжения используйте готовое `nextPageAction`: sourceJobId закрепляет
полный план, media/fonts и engine первой страницы. Изменение черновика или
обложки не меняет этот снимок. `video_review({projectId,sourceJobId})` и deep
проверяют те же материалы; sceneId/segmentId/frame адресуют конкретный риск.

`video_review({projectId,expectedVersion})` возвращает реальные layout checks,
измерения и проверенные предложения. Используйте готовый nextAction;
не пытайтесь патчить compiled node ID самостоятельно. Выбранное исправление:
`video_review_apply({projectId,expectedVersion,reportId,suggestionIds,idempotencyKey})`.
Неэффективная/пустая/устаревшая правка отвергается. Снова review и сравнение
`video_storyboard({projectId,mode:"compare",compareJobId:старыйJobId})`.
В compare есть сводка изменённых свойств, устранённых/новых/оставшихся замечаний.
Опциональный pixelDiff:true добавляет третью плитку RGBA-разницы и PSNR для
каждой сопоставимой пары. Это измерение изменений, а не оценка красоты;
отсутствующие стороны и разные размеры помечаются notComparable.
Применение рецепта через video_preset_apply по умолчанию preserve: сцены,
порядок, длительности и свои overrides сохраняются. mode replace заменяет только
оформление. Для SDK используйте applyVideoRecipe; low-level applyVideoPreset
сохраняет прежнюю семантику полной замены шаблона.

После apply ответ содержит draftBackupId. `video_document_get` с reviewBackupId
возвращает точный документ до правки и готовое restore действие через draft_replace.
На сайте есть «Вернуть состояние до исправлений». Backup защищён аккаунтом
и ограничен 128 записями/16MiB на проект; без молчаливого вытеснения.

`video_review({projectId,mode:"deep"})` готовит до трёх коротких clip окон
начала/середины/конца ролика, с декодированными audio measurements. Просмотрите
их и прослушайте звук: successful decode не является оценкой красоты/плавности.
Статический notChecked не превращается в passed. Максимум два цикла исправлений
одного случая; затем честно сообщите оставшееся ограничение.

Все inspect/try-on читают точную версию без commit/reconcileSource.
Историческая revision использует сохранённые media/fonts, а не сегодняшние
обложки/файлы. CAS-conflict требует заново прочитать текущую версию.
После приёмки: validate → commit → preview/final render штатными tools.

## Владельцу

- `/studio/recipes` — образцы и до трёх read-only примерок на своём проекте;
  применение — отдельная кнопка.
- `/studio/<id>/storyboard` — сетка, кадры, замечания, сравнение, восстановление.
- Локальный dirty JSON в другой вкладке не заменяется этими страницами.

## Эталоны для разработки

`npm run test:visual` рендерит актуальную полную матрицу и сравнивает её с baseline.
`npm run visual:render -- --filter ... --limit ...` — диагностика подмножества,
не полный green. `npm run visual:check` пишет HTML/JSON reference/actual/diff.
После просмотра намеренного изменения: `npm run visual:accept -- --confirm --reason "причина"`.
Никогда не обновляйте baseline автоматически после провала.
Среда закреплена в manifest; incompatible environment — отдельная ошибка.
Доказательства и секреты проверочных аккаунтов — только storage/verification/32-storyboard/.

Эталонный CLI явно использует штатный headless-shell закреплённой версии
Remotion и программный Chromium rasterizer `swangle` через
общий `renderStudioFrames`. Режим входит в environment identity: другой режим
даёт environment-mismatch даже при совпадающих пикселях. Штатный worker
сохраняет прежний default; это настройка воспроизводимых эталонов. Критерий
RGBA/ROI остаётся точным, без послабления допуска.
