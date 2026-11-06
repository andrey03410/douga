# Задача 1: рецепты и предметное заполнение

Сделано в общем checkout, в согласованных файлах. Дополнительно основной агент
разрешил адаптеры `applyStudioContentDraft`/`transformStudioDraft` и options
штатного `writeDraft` в `projects.ts`.

## Контракты

- `getVideoRecipes()`, `getVideoRecipe(id)`, `getRecipePresets()` — browser-safe,
  без импорта presets/builders и без import cycle. 33 рецепта:
  clean/cinematic/anime-impact/manga/neon × top/picker × wide/vertical/square;
  board-clear × board × три формата. IDs `recipe.<style>.<kind>.<format>`.
- `VideoRecipe` содержит обычный `VideoPreset`, metadata совместимости,
  плотность/языки/движение/медиа/длительность, канонический `example`,
  `contentForm.required/optional/constraints/example`, а у доски — slotIds.
  Чтение возвращает независимые значения, пресеты не вычисляют примеры лишний раз.
- `videoContentInputSchema`, `VideoContentInput`,
  `buildVideoContent(document,input): VideoDocument`,
  `getVideoContentMissingInputs(document): string[]`.
  Форма всегда содержит `kind` и явный `mode: merge|replace`.
- Участник: `{id,label?,caption?,comment?,album?,rank?,visualAssetId?,audioAssetId?,bestMomentSec?}`.
  Новый участник требует label, новый участник топа — авторский rank.
  null очищает media/caption/comment/album. Merge сохраняет остальные значения;
  replace очищает отсутствующие semantic fields, сохраняя локальные settings.
- Пикер: `rounds:[{id,prompt?,cards?:[{id?,participantId,label?}],answerParticipantIds?:string[]|null}]`.
  Старые card IDs и их настройки сохраняются при совпадении; новые IDs стабильны.
  Ответ не выбирается автоматически. Невалидные/неоднозначные ответы отвергаются.
- Доска: `boards:[{sceneId,rounds:BoardRound[]}]` использует существующие slot IDs
  и штатные place/move/replace/swap/remove/lock/unlock. Все восемь семейств
  валидируются resolveBoard; назначения/стоимость/действия не выдумываются.
- Удаление по `deleteParticipantIds`, у пикера ещё `deleteRoundIds`.
  Неизвестные IDs, конфликт удаления с обновлением и сломанные ссылки отвергаются.
  Custom/mixed v2 или неподдержанное сопоставление дают явную ошибку.
  Tournament source разрешает только изменение title, source защищён.
- `setStudioContent(userId,projectId,{expectedVersion,idempotencyKey?,content})`
  возвращает обычный project view плюс missingInputs. Доменные ошибки становятся
  StudioError с diagnostic path. CAS/idempotency/evaluate/references — штатные.
- `selectStudioRecipes(userId,{kind?,format?,style?,query?,limit?})` возвращает
  `{items,recommended,reason,alternatives}`. Не более трёх metadata карточек,
  default формат wide; безопасный fallback Clean/Board clear.
- Внутренний `transformStudioDraft(userId,id,{expectedVersion,idempotencyKey?,identity},transform)`
  хэширует полную trusted identity, проверяет каноническую схему и использует
  штатный draft CAS. Допускает оставшиеся исходные ошибки подобно patch;
  review caller предварительно проверяет отсутствие новых ошибок.
  `applyStudioContentDraft` требует готовую validation (invalid material не пишется).
- Оба адаптера читают `view(await owned(...))` вместо source-reconciling read,
  пропускают preparation reconcileSource. Внутритранзакционные
  assertProjectSourcesUnchanged/assertSourceUnchanged, references и CAS сохранены.

## Пример

```json
{
  "expectedVersion": 1,
  "idempotencyKey": "my-content-1",
  "content": {
    "kind": "picker",
    "mode": "replace",
    "participants": [
      {"id":"frieren","label":"Фрирен","visualAssetId":"owned-image-id"},
      {"id":"violet","label":"Вайолет","visualAssetId":"another-owned-id"}
    ],
    "rounds": [{
      "id":"round-1",
      "cards":[{"participantId":"frieren"},{"participantId":"violet"}],
      "answerParticipantIds":["frieren"]
    }]
  }
}
```

## RED → GREEN и проверки

1. `npx vitest run src/video/content.test.ts src/video/recipes.test.ts`:
   RED 15 failures на отсутствующей реализации; после реализации GREEN15.
   Проверка каталога использует настоящие font metrics
   `getTypographyMeasureText`, а не приблизительную заглушку.
2. `npx vitest run src/server/studio/content.test.ts`:
   RED отсутствующие atomic adapters; GREEN после подключения writeDraft.
   Дополнительно RED→GREEN для нормального StudioError доменных ошибок.
3. `npx vitest run src/video/content.test.ts`:
   отдельные RED→GREEN для неизвестных/конфликтующих удалений и для полной
   замены с очищением старых semantic fields при сохранении overrides.
4. Последний итоговый targeted запуск:
   `npx vitest run src/video/content.test.ts src/video/recipes.test.ts src/server/studio/content.test.ts`
   — **3 файла, 24 PASS**.
   Реальный SQLite: отдельные временные пользователи/проект, cleanup своих строк;
   CAS/replay/identity conflict/concurrent edit/stale no-reconcile/foreign ownership.
   Настоящий WAV создан только под storage своего тестового аккаунта:
   owned audio→visual отвергается по ASSET_KIND_MISMATCH без изменения draft.
5. `node_modules/.bin/tsc --noEmit --project storage/storyboard-task32/recipes-tsconfig.json --pretty false`
   — **EXIT0**; temporary tsconfig включает только файлы задачи и их зависимости,
   extends корневой strict tsconfig, incremental=false.

Общую тройку, реальный MCP/HTTP/UI, красивые populated previews и финальное
ревью выполняет основной агент после интеграции. Каталог примеров не подставляет
несуществующие pool assetId/demo-media: участники/ответы/действия заданы явно,
материалы заполняются автором; для отсутствующих visual возвращается missingInputs.
Визуальные fixtures/превью должны использовать настоящие fixture media общего
pipeline. Готовность всего продукта по этим targeted тестам не объявляется.
