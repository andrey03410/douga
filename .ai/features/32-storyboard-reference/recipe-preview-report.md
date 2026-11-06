# Recipe preview / try-on

Независимый серверный модуль `src/server/studio/recipe-preview.ts`.
HTTP/MCP/UI и другие файлы не менялись.

## API

- `getStudioRecipePlan(userId,recipeId)` → `{recipeId,document,plan,ready,diagnostics}`.
  Берёт именно `preset.${recipeId}` из `buildVisualFixtures()`, компилирует
  настоящим `getTypographyMeasureText`. Все 33 recipe plan проходят проверку.
  Оригинальный fixture клонируется; общий каталог не меняется.
- `getStudioRecipeMedia(userId,filename)` → `{path:absolute,mimeType,hash}`.
  Только пять известных synthetic media из `visualFixtureMedia()`;
  имена `<sha256>.svg|wav`, каталог `storage/studio-recipe-media/v1`.
  Запись через временный файл и atomic rename. Проверяются storage containment,
  ownership/actor, allowlist имени и SHA256 фактических байтов. Manifest src
  переписаны на `/api/studio/recipes/media/<filename>`.
- `tryStudioRecipe(userId,recipeId,{projectId,expectedVersion})` →
  `{recipeId,origin,plan,ready,diagnostics}`.
  `loadInspectionProject` читает exact current draft; применяется штатный
  `applyVideoPreset`, затем `compileVideo` с настоящими font metrics и собственным
  manifest. После compile повторно проверяется version. Нет project/source/draft/
  revision writes и source reconciliation. Kind mismatch — PRESET_KIND_MISMATCH;
  потеря assigned custom content — PRESET_INCOMPATIBLE с diagnostic path.
- `getStudioRecipePreview(userId,recipeId)` →
  `{recipeId,path:absolute,mimeType:'image/png',hash,frame,width,height,bytes,src}`.
  `src=/api/studio/recipes/<recipeId>/preview` для HTTP; MCP может прочитать path
  и отдать native image block. При отсутствии baseline — PREVIEW_NOT_READY,
  UI использует live player plan. Читается только accepted manifest v1 и кадр
  соответствующего fixture; предпочтён frame≥30. Проверяются exact
  `frames/<fixtureId>/<frame>.png`, basename, realpath containment, SHA256,
  PNG magic/dimensions и ≤12MiB. Renderer синхронно не вызывается.

## RED → GREEN

`npx vitest run src/server/studio/recipe-preview.test.ts`:
RED **6 failures** на отсутствующей реализации → GREEN **6 PASS**.

Проверены все 33 populated recipe plans с реальными font metrics; authenticated
media hashes/allowlist; реальный owned PNG через evaluate и read-only try-on;
stale/foreign/kind/custom incompatibility; invalid current draft без last-good;
missing baseline/path traversal/hash mismatch и валидный native PNG descriptor.
Тест baseline использует изолированный mock только baseline I/O и не переписывает
настоящие эталоны, которые параллельно готовит основной агент. SQLite, файлы
собственных тестовых пользователей и настоящий ffmpeg PNG остаются реальными;
свои пользователи/проекты/медиа удаляются cleanup.

`node_modules/.bin/tsc --noEmit --project storage/storyboard-task32/recipe-preview-tsconfig.json --pretty false`
— **EXIT0**, strict config extends root, включает только новые файлы и зависимости.

Полная тройка и живая проверка HTTP/MCP/UI — после подключения основным агентом.
