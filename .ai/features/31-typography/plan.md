# План реализации типографики

> Исполнение: feature/autotask в автономном режиме, TDD и независимое итоговое
> ревью. Независимые зоны с зафиксированными интерфейсами делегируются по
> superpowers:dispatching-parallel-agents; состояние — execution.md.

**Цель:** весь расширенный объём [product.md](product.md).
**Архитектура:** чистый compileVideo получает синхронный провайдер реального
измерения; сервер загружает локальные шрифты Fontkit. IR сохраняет раскладку,
selected font manifest; renderer не измеряет и не меняет строки.
**Стек:** TypeScript/Zod/React/Remotion, Fontkit, локальные OFL fonts.
**Технический контракт:** [tech.md](tech.md).

## Общие ограничения

- Новая типографика включается по scope, legacy без новых полей сохраняет IR/вид.
- Только встроенные проверенные ресурсы и цвета; ни JS/HTML/CSS, ни font URL из документа.
- 7 семейств, 12 стилей, 6 тем, 8 ролей, 4 валидных примера; локальная JP-подстановка.
- Сохранённые legacy color/fontSize — overrides; defaults из компилятора — нет.
- Нижняя граница размера обязательна; error/ellipsis/clip, группы не проваливают минимум.
- До анимации фиксируются строки; динамические значения резервируют место.
- Только собственные проверочные данные в storage, секреты не печатать и не коммитить.
- После последних правок npm test → npm run build → npx tsc --noEmit + живые выходы.

## Фокус ревью

- Смешанная кириллица/JP, редкий отсутствующий символ, unsupported italic.
- Смешанный legacy/new документ после локального изменения и сохранения overrides.
- Подпись у края с двумя обводками/тенями и предельно длинное имя в fitGroup.
- PNG черновика с overflow без побочного коммита, чужой проект и конфликт версии.
- Offline без сети/шрифтов ОС и старое frozen задание после изменения каталога.

## Задача 1. Домен: контракт, каталоги, компиляция и раскладка

Файлы: новые typography-types/schema/catalog/layout/compiler/examples в src/video;
types.ts/schema.ts/settings.ts/nodes.ts/blocks.ts/board-compiler.ts/compiler.ts/index.ts.
Интерфейс: compileVideo(doc, manifest?, {measureText}?) и типы из tech T01–T03.

- [ ] Красный тест: неизвестный font/произвольный CSS/runs>100 отвергнуты;
  локальный enable оставляет другие узлы legacy; null/reset/overrides соблюдаются.
- [ ] Каталоги/схема/наследование и semantic roles, rich bindings.
- [ ] Красный→зелёный layout: JP punctuation, графемы/newlines, balance, effect bounds,
  minSize/ellipsis/clip, fitGroup и диапазон timer/counter; fake measurer для алгоритма.
- [ ] Все 54 legacy пресета ×3 формата без измерителя дают прежний IR.
- [ ] Коммит feat(video): add typography contracts and measured text layout.

## Задача 2. Ресурсы, реальное измерение и все выходы

Файлы: public/fonts/typography-v1, font manifest, src/server/studio/typography-fonts.ts,
assets.ts/engine.ts/render.ts/revisions.ts/export-html.ts, scripts/studio-render-child.ts,
package.json/lock. Интерфейс провайдера совпадает с задачей 1.

- [ ] Красный тест реальных font widths/JP fallback/missing/unsupported face и hash.
- [ ] Поставка OFL fonts, pinned hashes/bytes/licenses; Fontkit provider с bounded cache.
- [ ] evaluate передаёт measureText; план содержит только нужные font assets.
- [ ] engine/snapshot pin ресурсов; offline встраивает только selected faces и лицензии,
  честно считает bytes, legacy CSS не перебивает data-typography.
- [ ] Реальные тесты ресурсов, повторной компиляции, frozen/export без CDN.
- [ ] Коммит feat(studio): package and measure pinned typography fonts.

## Задача 3. Renderer

Файлы: src/remotion/TypographyText.tsx, typography-fonts.tsx, StudioVideo.tsx,
MotionText.tsx/MotionWidgets.tsx и профильные тесты.

- [ ] Красный→зелёный тест стилей/строк/включения/динамических чисел.
- [ ] FontGate ждёт реальные face; TypographyText рисует готовые линии и rich runs,
  тени/обводки/градиенты/плашки, выравнивание и анимации без перевёрстки.
- [ ] Охват text/card/group/timer/badge/versus/progress, legacy путь неизменен.
- [ ] Коммит feat(render): render measured typography and text effects.

## Задача 4. Сервисы, MCP и галерея

Файлы: src/server/studio/typography.ts и index/http; src/mcp/studio-tools.ts/instructions;
src/app/studio/typography/*, StudioWorkspace.tsx, навигация projects/new.

- [ ] Красный→зелёный тест ownership/version/pagination/diagnostic restrictions.
- [ ] font_list/get, typography_list/get, text_inspect с optional diagnostic PNG;
  краткие ответы/примеры; HTTP и MCP используют те же сервисы.
- [ ] Галерея: свой текст/формат/рамка/фон, все темы/стили/шрифты, настоящий Player,
  строки/размер/ошибки, копирование и применение к своему проекту.
- [ ] SDK apply helper preserve/replace и CAS apply в проекте, грязный буфер сохраняется.
- [ ] Четыре примера и рецепт агента; новые factory-проекты явно включают clean.
- [ ] Коммит feat(studio): expose typography tools and gallery.

## Задача 5. QG и приёмка

- [ ] npm test → npm run build → npx tsc --noEmit после последних правок.
- [ ] Настоящий MCP: discover/apply/inspect/validate/PNG; overflow/чужой проект/CAS.
- [ ] Живой сайт wide и 320px, применение и сравнение на своих ru/JP названиях.
- [ ] PNG/MP4/watch/offline без сети; кадры на одинаковом времени, декодированный звук.
- [ ] Независимое ревью до отсутствия существенных находок; исправления перепроверены.
- [ ] verify.md с числами, файлами свидетельств и ручными маршрутами.

## Задача 6. Знания

- [ ] Обновить .ai/map/studio-sdk.md, render.md, mcp.md и SDK-гид задачи.
- [ ] PR, stage review; затем history/merged, merge PR и проверить main.
- [ ] Убрать свой диагностический сервер/worktree, сохранив доказательства в storage.
