# Технические решения

Статус: приняты агентом в автономном режиме 2026-11-17.
Основание — подтверждённый [продукт](product.md), финальное уточнение владельца
и разведка реального кода. Воркспейс остаётся основным checkout по `feature`.

## Исходная система — проверено в коде

- `VideoDocument` v1/v2, строгий `Settings`, чистый compiler и общий Remotion renderer.
  `compileTop` всегда создаёт один card. Групповой picker дважды использует aspect
  fitting layoutCards и теряет место между панелью и карточкой.
- Recipes меняют Settings, используют прежние blocks с nodes:[], default builder
  берёт classic. Сервер принимает полный document либо presetId; сайт сам собирает
  classic JSON. История, CAS, snapshots и try-on уже существуют.
- `getBuiltinPresets` участвует в совместимости, личных шаблонах и visual fixtures.
  Удалять из него старые ID или изменять их значения нельзя.
- Content short form не выражает группы, round.music/background, subtitle/kind и
  готовое распределение по тирам. Канонический документ большую часть уже умеет.
- 100 000 authored values и 2 000 000 символов сериализации независимы. Общие пределы:
  20 000 expanded nodes, 2 000 scenes, 20 000 cues, 200 000 audio-policy windows,
  глубина 32, 7 200 с. Heavy child имеет собственную память/таймауты.
- Шрифты pinned TTF/OFL измеряются Fontkit. Есть Oswald/Manrope и Noto, нет
  Cinzel/Cormorant. `TypographyText` умеет статическую обводку, но не рисование контура.
- `compileBackdrop` current-card ожидает top card с media; новая image/text сцена
  требует адресного исправления. Motion post-pass может дублировать автоматический enter.

## T01. Тип и решение агента о стиле

Варианты: mandatory styleId; intent с рекомендацией и overrides; свободный HTML.
**Решение:** intent `{kind:top|picker|tier-list, subject?:characters|anime|music,
format?, title?, sourceId?, roundCount?, cardsPerRound?, design?, idempotencyKey?}`.
Kind первичен; subject выбирает предметную адаптацию. `design` уточняет accent,
palette, typography/motion/backdrop существующими декларативными средствами.
Нет нового движка или произвольного JS. Тип tier-list переводится в board.
Агенту выдаётся type-first руководство: как выбрать палитру/пару шрифтов/масштаб/
движение по составу, примеры сочетаний, типичные ошибки, команды storyboard/review/
clip и обязательное исправление после визуального просмотра.

## T02. Версия графики и совместимость

Варианты: заменить текущие blocks глобально; создать второй renderer; opt-in marker.
**Решение:** `settings.composition?: {version:1, variant:portrait-top|music-top|picker|tier-list,
accent?, palette?} | null`. Отсутствие/null сохраняет прежний IR. Новые сцены используют
те же media/audio/source/events, но отдельный composition-compiler геометрии/декора.
IR может иметь `rankDraw:{from,durationInFrames}` только у новых числовых text-узлов.
Renderer рисует контур/заполнение детерминированно по кадру и закреплённому шрифту.
Старые версии пресетов не меняются. Existing free-layout не перетирается новой
автоматической геометрией: конфликт обозначается диагностикой.

## T03. Каталог и raw SDK

**Решение:** закрытый новый authoring-каталог из 12 композиций (четыре предметных
адаптации × три формата). ID: `composition.top.portrait.<format>`,
`composition.top.music.<format>`, `composition.picker.<format>`,
`composition.tier-list.<format>`. Публичные подписи — тип/предметная адаптация.
`getBuiltinPresets` сохраняет legacy и добавляет новые композиции; отдельная
функция отдаёт curated authoring. Серверный create по retired presetId отклоняется
после проверки replay receipt. Copy/restore/edit прежних документов работают.

Полный JSON — существующий осознанный авторский/совместимый путь SDK. Он сохраняется
для внешних потребителей и прежних документов, а его legacy stamp не означает
проверенного дизайна. Main create/instructions/examples не предлагают этот путь
как default и не рекомендуют retired IDs. Это намеренное уточнение P03/P12:
запрет старого ID относится к обычному созданию из каталога, не удаляет raw SDK.
Новый factory не меняет default низкоуровневого createVideoDocument: старые callers
и asobiba не получают неожиданного изменения геометрии/требования measureText.

## T04. Содержание

**Решение:** расширить нынешний content API, сохраняя merge/replace/null и ID:
participant subtitle/kind/tier; groups с cardIds/label и answerGroupIds;
round musicAssetId/backgroundAssetId (null выключает назначение);
семантические tiers с participantIds → существующие slots/cards/place actions.
Сервер проверяет ownership и фактический media kind до записи. Не новый тип медиа.
Тир-лист показывает готовое распределение и row focus, не создаёт новую игру.

## T05. Геометрия и motion

**Решение:** в новых top сохраняется расчёт аудио, snippet, duration, offset.
Portrait: крупный вертикальный арт, отдельно место/имя/аниме; music: полноэкранный
затемнённый фон, отдельные место/название/метаданные без общей карточки.
Picker: панели считаются от площади кадра, 3×2 в wide — три панели и по две высокие
карточки. Vertical/square имеют собственные строки/колонки; избыточная плотность
даёт адресную проблему вместо микрошрифта. Имена измеряются и не обрезаются молча.
Читаемость и safe area проверяются существующим review.

Новая хореография не дублирует старый global enter: локальные reveal/fade/slide,
небольшая контролируемая пружина, диагональная номерная шторка и отдельное окно выбора.
Ответ — только если задан в сценарии. В musical rank — контур → заполнение, потом
название; эффекты ограничены временем сцены. Все состояния используют frame/fps,
seed, общие renderer и pinned fonts, без wall-clock/Math.random.

## T06. Шрифты

**Решение:** сохранить Oswald/Manrope; добавить Cinzel normal и Cormorant Garamond
normal/italic из официального google/fonts на закреплённом commit с OFL, SHA-256
и реальной проверкой глифов. Cinzel — числа/латинские акценты; RU serif — Cormorant,
JP — существующий Noto fallback. Новые fonts проходят общий ledger snapshots,
HTTP/media, offline HTML и measureText; не загружаются с сети во время просмотра.
Агент вправе выбрать другую поддержанную пару, проверив результат.

## T07. Вместимость и диагностика

Варианты: убрать все пределы; поднять только число JSON values; согласовать бюджеты.
**Решение:** authored values 2 000 000 (20×), сериализация до 32 МиБ UTF-8 с одинаковой
проверкой строки/объекта; expanded nodes 100 000. Остальные технические пределы
сохраняются до доказательства необходимости изменения. Ошибка указывает
resource/used/limit и точный path, а не одну фразу о всех ресурсах.
Проверяются 300×6+OST и валидные явные keyframes с >1 млн values через сохранение,
commit, чтение, storyboard/клипы, не только compile. Потолок HTML 400 МиБ и память
worker остаются; количество refs не заменяет оценку байтов. Отдельный estimate
расходов доступен агенту до тяжёлой операции.

## T08. Проверка и поставка

**Решение:** TDD по задачам; isolated DB copies для независимых целевых интеграций.
Финальная тройка строго npm test → build → tsc на основном checkout после последних
правок; проверка порта до build/dev. Живой production сайт, настоящий stdio/HTTP MCP,
реальные PNG/MP4/декодированный звук, offline HTML без сети, legacy copy/restore.
Локальные реальные референсы не коммитятся. Новые synthetic fixtures защищают
состав/рендер, принятые новые baseline добавляются только после просмотра.
Свежее ревью всей ветки, исправление существенного, PR и merge в main автономно.

## Затронутые зоны

SDK/типографика/рендер/MCP/студия; карточки `studio-sdk`, `render`, `mcp`, `dev-env`
актуализируются вместе с реализацией. Роли уже реализованы и входят в общий QG.
