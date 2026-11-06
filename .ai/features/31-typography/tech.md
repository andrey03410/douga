# Технические решения

Автономный режим: решения приняты агентом в пределах утверждённого продукта.

## Исходная система

Прочитаны карточки studio-sdk/render/mcp/dev-env, types/schema/settings/compiler,
nodes/blocks/board-compiler, assets.evaluate, revisions, engine/render,
StudioVideo/MotionText/MotionWidgets, export-html/WatchPlayer и MCP/HTTP.
Задача 30 уже в main и подключена к ветке. Компилятор синхронный и чистый;
серверная подготовка `evaluate` асинхронно разрешает медиа, затем зовёт compileVideo.
Снимки держат JSON плана, manifest и файлы; задания закрепляют engineId.

## T01. Измерение

- Варианты: Fontkit по локальным файлам; Chromium при каждом save; таблица средних ширин.
- Решение: Fontkit в серверном провайдере, OpenType shaping и реальные advance widths.
  Провайдер передаётся в чистый compileVideo третьим optional-аргументом
  `{measureText}`. Без провайдера новая типографика даёт TEXT_LAYOUT_REQUIRED,
  legacy не меняется. Сервер evaluate передаёт провайдер; браузерная галерея получает
  готовый план с сервера. План — JSON без функций/DOM/I/O.
- Контракт `measureText(text, resolvedStyle)` возвращает `{width, fonts, missing}`;
  width в px, fonts — ID реально выбранных face, missing — символы без покрытия.
  Стили фрагментов измеряются отдельно; обычные строки shaping целиком.
- Источник API: https://github.com/foliojs/fontkit (layout, hasGlyphForCodePoint,
  getVariation, unitsPerEm). Загрузка/ожидание: https://www.remotion.dev/docs/fonts.

## T02. Схема и наследование

- Отдельные browser-safe typography-types/schema/catalog/layout/compiler.
- `settings.typography?: {theme?,version?:1,defaults?,roles?}|null`;
  `node.typography?: TextTypography|null`. TextTypography включает role/preset,
  font/weight/italic/fontSize/minFontSize/lineHeight/letterSpacing/align/verticalAlign,
  padding/maxLines/wrap/fit/overflow/balance/fitGroup/language, fill/gradient,
  outlines/shadows/plate и decoration. До двух обводок/теней, только проверенные цвета.
- Семь ID: arimo/manrope/oswald/rubik/roboto-mono/noto-sans-jp/noto-serif-jp.
  Поставка реальных 400/700 normal и 400/700 italic для Arimo/Rubik/Roboto Mono;
  дополнительные веса допускаются только если фактический ресурс и каталог их поддерживают.
- String/bind сохраняются; новый вариант `{runs:[{text:TextValue,color?,weight?,italic?,decoration?}]}`
  плоский, без рекурсии. Все bindings разрешаются до измерения.
- Глубокое наследование defaults/roles; null выключает. Локальные новые свойства
  приоритетнее legacy color/fontSize того же scope; сохранённые legacy считаются overrides.
- Новая типографика включается по scope, legacy-узлы даже в смешанном плане сохраняются.

## T03. IR и раскладка

- CompiledNode: optional typography, textRuns и textLayout. Раскладка содержит
  итоговый fontSize, lineHeight, строки/runs с измеренной шириной, текстовую рамку,
  overflow/truncated и используемые faces. CompiledVideo.fonts — только выбранные ресурсы.
- Измеряем полный текст до анимации; динамические цифры резервируют максимальные
  метрики доступных значений. text-lines использует итоговые строки, letters — графемы.
- Учитываются padding, stroke/shadow bounds; бинарный поиск размера, читаемый минимум,
  Japanese kinsoku, явные newline, балансирование, ellipsis/clip только явно.
- Группы совместимых подписей пикера на раунд и явный fitGroup — общий минимальный
  подходящий размер, без перехода ниже minFontSize. Несовместимые группы — ошибка.
- Бюджеты: ≤10000 графем на надпись, ≤100 runs, ≤12 строк, bounded measured text
  и cached provider; диагностические ответы пагинируются. Точные разумные пределы
  дополнительных чисел задаёт строгая Zod-схема.

## T04. Шрифты и воспроизводимость

- Лицензированные WOFF2/TTF в public/fonts/typography-v1; browser-safe manifest
  с hash/bytes/family/weight/style. Каждый font URL закрыт каталогом, произвольных URL нет.
- Fontkit читает только локальный каталог с проверкой hash; browser FontFace ждёт
  загрузки до кадра, ошибка отменяет рендер. Синтетические начертания выключены.
- engineId включает font-ресурсы, бандл движка содержит их; frozen jobs используют
  закреплённый движок. Снимки/публикации закрепляют необходимые ресурсы и их хэши.
- Офлайн HTML встраивает только plan.fonts и лицензии, учитывает байты, сохраняет
  legacy Arimo CSS, но исключает новые `[data-typography]` узлы из принудительной гарнитуры.

## T05. Renderer

- Один TypographyText для текста/подписей групп и карточек/виджетов, готовые строки
  не перевёрстываются браузером. FontGate общий для Studio/Watch/offline/MP4.
- Обводки: отдельные декоративные слои текста с aria-hidden; основной слой с заливкой,
  градиентом, декорацией и контролируемыми тенями. Эффекты рамки независимы.
- Поддерживаются темы 6 × роли 8 и стили 12 из product.md без отдельных renderer.

## T06. MCP, сайт, диагностика

- font_list/get, typography_list/get — каталоги; text_inspect — принадлежащий актору
  проект, фильтры segment/node, limit/cursor, version и данные раскладки.
- Опциональный диагностический PNG — bounded текущий черновик, только TEXT_OVERFLOW,
  без commit и обычного job; ограничения прав preview, сериализация тяжёлого рендера.
- Применение темы/стиля через существующие CAS patches, SDK helper для preserve/replace.
  Галерея /studio/typography использует серверную compile+measure и настоящий Player.
  Раздел проекта не перезаписывает грязный буфер, применяет к draft с expectedVersion.
- Четыре готовых примера; инструкция короткая, подробности в каталоге.

## T07. Проверки и зоны знаний

TDD домена/сервисов; реальные шрифты, японский и mixed text, ошибки/границы,
legacy/смешанные документы, все 54 пресета ×3 формата; MCP stdio, живая галерея,
PNG/MP4/watch/offline с сетью off, декодированный звук. Итоговая тройка строго
npm test → npm run build → npx tsc --noEmit. Независимое ревью и устранение существенного.
Обновляются карты studio-sdk/render/mcp; DB-миграция не нужна.
