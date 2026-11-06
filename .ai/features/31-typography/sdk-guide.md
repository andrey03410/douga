# Типографика: короткий рецепт SDK и MCP

## Начать с готового оформления

1. `video_typography_list {category:"theme"}` → выбрать тему.
2. `video_typography_get {category:"theme",id:"anime-impact"}` → прочитать роли и фрагмент.
3. Прочитать текущую версию проекта, затем `video_draft_patch`:

```json
{
  "projectId": "PROJECT_ID",
  "expectedVersion": 7,
  "operations": [{
    "op": "set",
    "target": {"type": "document"},
    "path": ["settings", "typography"],
    "value": {"version": 1, "theme": "anime-impact"}
  }]
}
```

4. `video_text_inspect {projectId:"PROJECT_ID",limit:20}` → реальные размеры/строки.
5. `video_project_validate` → `video_draft_commit` → штатный still/clip/render.
   Финальный render по-прежнему только для admin.

Полные примеры в `video_examples`: `typography-ost`, `typography-picker-jp`,
`typography-board-labels`, `typography-rich-title`. Пример — уже валидный документ;
не нужно собирать JSON из справочных фрагментов каталога.

## Настроить одну надпись

```json
{
  "id": "title",
  "type": "text",
  "text": {"runs": [
    {"text": "Место №1 — "},
    {"text": {"bind": "participant.label"}, "color": "#ffd166", "weight": 700}
  ]},
  "rect": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.2},
  "typography": {
    "role": "title",
    "preset": "anime-outline",
    "font": "rubik",
    "weight": 700,
    "fontSize": 64,
    "minFontSize": 28,
    "maxLines": 2,
    "wrap": "word",
    "fit": "shrink",
    "overflow": "error",
    "align": "center",
    "verticalAlign": "middle",
    "balance": true
  }
}
```

Надпись с participant binding требует соответствующего контекста участника;
для самостоятельной custom-сцены подставьте буквальный текст или document.title.
Обычные строки и прежние bind-объекты по-прежнему допустимы.
Новый bind `participant.displayLabel` возвращает `caption ?? label`; он сохраняет
штатную подпись карточки в личных пресетах и повторяющихся контейнерах. Runs плоские,
≤100 фрагментов; текст ≤10000 графем. У каждого фрагмента свой цвет, жирность,
курсив, decoration; размер/семейство/рамка общие. `wrap:"char"` — перенос по графемам,
`none` — без переноса. Японские переносы и запрещённые крайние знаки учитываются автоматически.

Роли: title/subtitle/label/prompt/rank/timer/badge/caption. Настройка
`settings.typography.roles.label` оформляет все наследующие подписи; локальный
`node.typography` точнее. `null` отключает новую типографику в выбранном scope.
Тени/обводки/плашка текста независимы от теней/градиента/рамки карточки.

## Шрифты и готовые стили

- `video_font_list {language:"ja"}` или `{italic:true}` — фильтр реальных возможностей.
- `video_font_get {id:"noto-sans-jp"}` — точные faces, hashes, источник, лицензия.
- Семь семейств: arimo, manrope, oswald, rubik, roboto-mono, noto-sans-jp, noto-serif-jp.
- Поставлены реальные 400/700. Italic есть у Arimo/Rubik/Roboto Mono;
  недоступный курсив даёт FONT_FACE_UNSUPPORTED, синтетическое начертание не создаётся.
- `video_typography_list {category:"style"}` → 12 стилей; get возвращает готовый
  `typography.preset`, включая двойной контур, неон, плашки, титры и цифры.
- JP-подстановка встроена. FONT_GLYPH_MISSING означает реальный пробел покрытия,
  а не запрос скачать шрифт из сети. Цветные emoji и редкие письменности не гарантируются.

## SDK и применение темы

```ts
import {applyTypographyTheme, applyTypographyStyle, compileVideo} from "@/video";

const next = applyTypographyTheme(document, "cinematic", {
  scope: {type: "segment", id: "episode-1"},
  mode: "preserve",
});
const styled = applyTypographyStyle(next, "jp-title", {
  scope: {type: "node", id: "title"},
});
// compileVideo остаётся чистым: измеритель передаётся вызывающей стороной.
const result = compileVideo(styled, manifest, {measureText});
```

На сервере `evaluate` подключает Fontkit автоматически. В браузере готовый IR
приходит с сервера: не импортируйте серверный загрузчик файлов в клиент.
Без measureText новый SDK-путь возвращает TEXT_LAYOUT_REQUIRED. Старые документы
не требуют провайдера и сохраняют прежний IR. Legacy/new могут жить в одном плане.

Preserve сохраняет явно записанные старые color/fontSize и новые overrides.
Replace очищает только текстовое оформление внутри выбранного scope. Медиа,
рейтинг, источник и таймлайн не меняются. Личные пресеты сохраняют типографику
и оформление runs, не копируя частные названия участников.

## Ошибки, инспекция и черновик

Текст не уменьшается ниже читаемого минимума. Если не помещается — TEXT_OVERFLOW;
расширьте рамку, увеличьте число строк, сократите текст или явно выберите
`ellipsis`/`clip` (получите предупреждение). Имя не переводится и не переписывается.
Числа таймеров/счётчиков подгоняются как одна строка по самому широкому состоянию.
Для них явные ellipsis/clip дают TEXT_DYNAMIC_OVERFLOW_POLICY: усечённое число
может поменять смысл, поэтому нужно расширить рамку или уменьшить размер.

`video_text_inspect` читает сохранённый документ/текущий черновик без синхронизации
источника, фиксации или новой ревизии. Ответ содержит его version и формат.
`expectedVersion` позволяет отвергнуть устаревший запрос. Параметры nodeId/segmentId
ограничивают область, limit/cursor — узлы. lineLimit≤12, lineOffset/runOffset/missingOffset —
подробности; totalLines/nextLineOffset/nextRunOffset/totalMissing/nextMissingOffset
и textLength показывают усечение
отчёта. По умолчанию вывод компактный; это не усечение самого видео.

`preview:true,frame:0` возвращает настоящий PNG диагностического черновика без commit.
Разрешён только готовый документ либо TEXT_OVERFLOW, не ошибки схемы/ресурсов/прав.
Если тяжёлый слот занят — JOB_ACTIVE; PNG ≤12 MiB, результат временный и удаляется
на сервере после выдачи. Не выдавайте его за финальную готовую ревизию.

Галерея `/studio/typography`: свой текст, шрифт/стиль/тема, рамка, формат и фон;
закрепление варианта для сравнения, копирование и применение темы к своему черновику.
В проекте грязный локальный редактор блокирует применение; CAS защищает серверные изменения.

## Переносимость

FontGate ждёт выбранные локальные fonts до первого кадра. План хранит готовые
строки и версии/хэши faces; снимок копирует бинарники и OFL. Штатные задания
закрепляют engineId. Watch и offline получают тот же layout; offline включает
использованные ресурсы один раз по hash, включая разные веса одного variable TTF.
Цена шрифтов входит в оценку HTML. Runtime-нарезки до отдельных глифов нет:
японский variable TTF встраивается целиком, поэтому даже короткий JP-титр увеличивает файл.
