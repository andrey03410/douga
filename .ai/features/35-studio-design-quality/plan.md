# План реализации

Спецификация: [product.md](product.md), технический контракт: [tech.md](tech.md).
Разрешён автономный режим до PR/merge/push main. Прогресс записывается здесь.

## Общие ограничения и интерфейсы

- Тип top/picker/tier-list первичен. Агент выбирает стиль после состава; студия
  даёт качественные defaults, графическое руководство, примерку и визуальную проверку.
- Старые IDs и compiled IR без нового marker не меняются. Raw JSON SDK остаётся
  авторским/совместимым путём; retired presetId исключён из обычного create.
- `settings.composition`: `{version:1, variant:"portrait-top"|"music-top"|"picker"|"tier-list",
  accent?:string, palette?:string[]} | null`. Существующие typography/motion overrides
  сохраняются. Все media/audio/IDs/тайминги остаются каноническими.
- Новый `composition-presets.ts`: `getCompositionPresets():VideoPreset[]`,
  `getCompositionPreset(id):VideoPreset|undefined`. 12 IDs из tech T03.
  Модуль не импортирует presets/builders (нет цикла), может использовать board-presets.
- Root владеет index.ts/presets.ts и серверным authoring/MCP/UI. Графическая задача
  владеет Settings/schema и блоками/renderer/fonts. Content и budgets не меняют эти файлы.
- Параллельные исполнители работают только в назначенных файлах, без коммитов;
  DB-тесты — на отдельных копиях, полный QG запускает root без конкурентов.
- Новые зависимости не нужны. Произвольный JS/HTML в документ не добавляется.
- Доказательства в storage/feature-35-implementation, личные медиа не в git.

## Задачи

### 1. Новые качественные композиции и шрифты

- [ ] RED: marker schema/variant, старый IR неизменен; top с раздельными
  art/rank/title/subtitle; 3×2 карточки высокие/равные, окно выбора после reveal;
  sparse/dense tier-list; motion на границах, fonts/glyphs/контур ранга.
- [ ] Versioned composition settings, новые 12 presets, composition-compiler,
  opt-in branches top/picker/board; адресная плотность/geometry диагностика.
- [ ] Pinned Cinzel/Cormorant normal/italic с лицензиями; rank stroke→fill,
  номерная шторка, гармоничные подписи/фоны/каскады, без дублирования motion.
- [ ] Реальный frame/clip просмотр и исправление визуальных проблем.

Файлы: packages/video/src/{composition-*,blocks,board-compiler,types,schema,
motion-compiler,typography-types,font-manifest}.ts, packages/render/src/, public/fonts/.
Не менять index.ts/presets.ts, root подключит экспорт/каталог.
Тесты: новые composition/renderer tests + прежние motion/typography/segments.
Готово: новые варианты читаемы, корректны и воспроизводимы; старые планы не изменились.

### 2. Ёмкость и адресные бюджеты

- [ ] RED: >1 млн values принимается; превышение depth/values/scenes/nodes/cues
  указывает конкретный ресурс/used/limit; 300×6+OST не обрезается.
- [ ] 2 000 000 values, 100 000 nodes, единые 32 МиБ UTF-8 для сериализации/строки;
  сохранить остальные пределы/защиту до измерений, дать estimate/diagnostic.
- [ ] Проверить чтение/сохранение/commit больших документов на изолированной БД.

Файлы: packages/video/src/resource-limits*, src/server/studio/{shared,types,errors}*;
отдельный shared size module допустим. Не редактировать core types.ts — metadata
ошибки совместима через существующие code/path/message либо согласуется с root.
Готово: согласованные пределы на всех путях, реальные большие данные проходят,
перегрузка понятна и не теряет черновик. Не использовать 300 как новый потолок.

### 3. Предметное заполнение групп, OST и тиров

- [ ] RED: subtitle/kind/tier, groups/labels/answers, per-round OST/background/null;
  merge сохраняет IDs и чужие части, replace явный; неверные refs/media атомарны.
- [ ] Расширить content schema/build/серверный resolver.
- [ ] Семантические tiers с participantIds → board slots/cards/place actions,
  проверить row focus и отсутствие необходимости писать actions агенту.

Файлы: packages/video/src/content.ts и content.test.ts, src/server/studio/content.ts
и content.test.ts; отдельный tiers adapter module допустим. Не менять index.ts.
Готово: 3×2+OST и готовый тир-лист выразимы короткой формой, ownership/CAS сохранены.

### 4. Type-first authoring, руководство агенту, сайт и каталоги

- [ ] RED: create по kind/subject без presetId, style overrides, receipt replay,
  sourceId, retired presetId отказ, raw/copy/restore совместимы.
- [ ] Подключить новые presets в compatibility registry; выделить curated список,
  обычный create/списки/примеры больше не предлагают слабые legacy IDs.
- [ ] Новый intent factory в SDK/server, типизированный HTTP/MCP контракт,
  type-first design guidance/capabilities с workflow «состав→стиль→проверка».
- [ ] /studio/new: первый выбор типа; затем состав/формат/оформление; gallery и
  workspace следуют тем же названиям/политике. Не добавлять обязательный styleId.
- [ ] Понятные реальные демонстрации и примерка; старый проект остаётся прежним.

Файлы: packages/video/src/{presets,index}.ts и новый authoring module; src/server/studio/
{projects,presets,recipes,index}.ts; src/mcp/{studio-tools,instructions}.ts;
src/app/studio/{new,recipes,StudioWorkspace.tsx}; соответствующие tests.
Готово: единый путь работает по HTTP и настоящему MCP, UI не создаёт classic,
агент получает пригодные знания/параметры и выбирает стиль осмысленно.

### 5. Интеграция, QG, визуальная приёмка и ревью

- [ ] Все новые/затронутые целевые тесты, compatibility IR и snapshots.
- [ ] 300 раундов/2 100 refs и >1 млн authored values: сохранение, commit,
  storyboard по страницам, клипы начала/середины/конца; реальные metrics в verify.md.
- [ ] Реальные портреты/музыка в wide/vertical/square: PNG, переход/settled/таймер/
  финал; сравнение с референсами по пяти осям. Offline HTML без сети и audio decode.
- [ ] Настоящий MCP + сайт, legacy copy/restore, стиль по явному запросу.
- [ ] После последних правок npm test → npm run build → npx tsc --noEmit;
  порт проверить заранее, не останавливать процессы владельца.
- [ ] Свежий reviewer полного diff; существенное исправлено и перепроверено.

Готово: проверены художественное качество и техническая работа, не только ready/types.

### 6. Знания и поставка

- [ ] Обновить .ai/map/{studio-sdk,render,mcp,dev-env}.md, README/SDK-guide при нужде.
- [ ] verify.md: команды, числа, файлы доказательств и что посмотреть руками.
- [ ] Push ветки, PR «35: …», stage review; затем запись history, stage merged,
  merge PR --merge, main pull/push и проверка remote SHA.

Готово: фича в origin/main, карточки соответствуют коду, рабочее дерево чистое.
