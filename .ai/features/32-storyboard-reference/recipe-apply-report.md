# FR-01: безопасное применение оформления рецепта

Исправлены только согласованные recipe helper/tests, applyStudioPreset/schema и
recipe try-on/tests. Legacy `applyVideoPreset`, builders и fixture factories не
менялись. UI/MCP подключает основной агент.

## Контракт

`applyVideoRecipe(document,preset,{mode?:'preserve'|'replace',basePreset?})`
возвращает тот же канонический VideoDocument с новым оформлением.

- Default **preserve**: новые global design defaults плюс явные author overrides.
  Inherited значения распознаются сравнением с исходным preset только при точном
  совпадении ID/version/kind. Unknown/deleted/чужой/version-mismatched base
  трактуется консервативно: текущие настройки считаются явными overrides.
- Explicit **replace**: сбрасываются appearance overrides в settings, node style,
  typography/motion и соответствующих вложенных слоях; текст, nodes, сцены и
  исходный сценарий не заменяются.
- В обоих режимах сохраняются scenes/order/IDs, node graph, containers/rects,
  selection/layout, scene/node durations/timing, source participants/ranks/rounds/
  answers/groups, board slots/actions/rules, bindings/audio, media offsets/crop/
  fit/volume/loop. Settings top/picker/labels сохраняют смысл и длительности;
  top snippet active не превращается в manual. Output format берётся из явно
  выбранного варианта рецепта, FPS сохраняется для авторских frame timings.
- Matching scenes получают design settings/transition, если в preserve нет
  явного отличия от исходного template. Длительность имеющегося transition
  сохраняется. Custom intro не удаляется. Несовместимая новая block choreography
  не навязывается intro/другому блоку или намеренно пустой доске.
- `RecipeApplyError` даёт PRESET_KIND_MISMATCH / PRESET_MODE_UNSUPPORTED /
  RECIPE_REQUIRED. Сервер преобразует её в штатный StudioError.

`applyStudioPreset` для `recipe.*` загружает exact owned/builtin base через
getStudioPreset и вызывает новый helper. `mode` optional в applyStudioPresetSchema.
Non-recipe preset без mode продолжает прежнюю полную замену; explicit mode для
него отклоняется PRESET_MODE_UNSUPPORTED. Штатные source guards/CAS/idempotency/
evaluate/references не менялись.

`tryStudioRecipe` принимает тот же optional mode, использует тот же helper и
exact owned base lookup. Read-only/CAS guards сохранены. Assigned custom media
теперь сохраняются в существующем custom intro/main, вместо прежнего отказа или
сброса структуры.

## TDD и проверки

1. `npx vitest run src/video/recipe-apply.test.ts`: RED 6 missing implementation
   → GREEN6. Реальный FR-01: intro4s + top13s = **510frames**, scene borderRadius77,
   авторский текст и media/source сохранены; inherited clean→cinematic изменён.
   Preserve сохраняет explicit global/local typography, unknown base; replace
   меняет appearance с сохранением структуры/geometry/510frames. Покрыты top,
   picker (включая фазы/answerMode) и segmented board (слоты/действия/тайминги).
2. `npx vitest run src/server/studio/recipe-preview.test.ts`: корректный RED на
   unsupported mode и **240 вместо510frames** → GREEN после общего helper.
   Real SQLite + own PNG + typography metrics: try-on и atomic write дают
   deep-equal plans в preserve и replace. Проверен legacy без mode (старые
   240frames/полная замена) и отказ explicit mode у legacy без записи.
3. Дополнительный RED→GREEN намеренно пустой доски: новый board-place не вызывает
   MOTION_CHOREOGRAPHY_INCOMPATIBLE и не добавляет выдуманные действия.
4. Последний targeted regression run:
   `npx vitest run src/video/recipe-apply.test.ts src/server/studio/recipe-preview.test.ts src/server/studio/content.test.ts src/server/studio/review-backups.test.ts`
   — **4 файла, 28 PASS**.
5. `node_modules/.bin/tsc --noEmit --project storage/storyboard-task32/recipe-apply-tsconfig.json --pretty false`
   — **EXIT0**, strict root config + затронутые файлы/зависимости.

В первом server test запуске была ошибка нового fixture cleanup (`extraProjects`
не объявлен из-за прежнего многострочного объявления). Исправлено до корректного
RED; два оставшихся собственных test-account и три их проекта точечно удалены
ignored cleanup-драйвером по prefix+точному интервалу создания. Прочие данные не
затрагивались; последующие test cleanup успешны.

Полная тройка, живые HTTP/MCP/UI preserve/replace и fresh baselines — у основного
агента. Добавленный helper меняет engine provenance; неизменённый legacy factory
путь визуальных fixtures даёт прежний документ, но full fresh render/check
должен выполнить основной агент.
