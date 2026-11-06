# Домен типографики

Задача 1 реализована в `src/video/`, без правок серверов, renderer и ресурсов шрифтов.
Интерфейсы согласованы с ресурсным и renderer агентами.

## Решения

- `compileVideo(document, manifest?, {measureText}?)` остаётся чистым и синхронным;
  включённый scope без провайдера получает `TEXT_LAYOUT_REQUIRED`. Legacy-планы не
  получают новых полей, implicit `DEFAULT_SETTINGS` не считаются overrides.
- 7 font IDs, 12 стилей, 6 тем, 8 ролей, 4 полных примера. Метаданные faces
  подключены из `font-manifest.ts` ресурсного агента; `plan.fonts` — отдельные копии.
- Строгая схема: закрытые ID, конечные числа, проверенные цвета, плоские rich runs,
  не более 100 runs и 10000 графем, не более 12 заданных строк. Bindings разрешаются
  до измерения; rich captions карточек включают отдельный префикс ранга.
- Глубокое наследование, null scopes/roles/effects, локальные legacy overrides и
  явные новые поля. SDK helpers `applyTypographyTheme` / `applyTypographyStyle`
  поддерживают immutable preserve/replace и document/segment/scene/node scopes.
- IR содержит typography/textRuns/textLayout. Геометрия layout.rect относительно
  node, line.x/y относительно rect, run.x относительно line. lineHeight в IR — px,
  в typography — коэффициент. Реальные метрики измеряются до компиляции анимаций.
- Графемы, kinsoku, word/char/none, явные newlines, balance, padding и bounds двух
  обводок/теней/плашки, shrink/fixed, читаемые minima по формату/роли, error/ellipsis/clip.
  Последние две политики дают предупреждение. Explicit fitGroup действует внутри
  сегмента через scenes; автоматические compatible picker groups — внутри раунда.
- Timer/progress/counter резервируют ширину допустимых значений заранее. До 10000
  значений проверяются реальные строки, большие диапазоны используют консервативный
  максимум цифры на разряд. Исходный target counter остаётся в node.text.
- Выгрузка личного preset очищает приватные rich literals/group IDs, сохраняя
  типографику и оформление фрагментов.

## Проверки

Все новые поведения прошли RED → GREEN. Первые 20 тестов зафиксировали отсутствие
schema/compile/layout; последующие RED покрыли helpers/examples/counter/minima,
rich card bindings, rich preset extraction, aggregate budget, segment fit groups
и предупреждения explicit overflow.

После последних правок выполнены:

- `npx vitest run src/video`: 16 файлов, 354 теста, все зелёные.
- `npx tsc --noEmit --project /tmp/douga31-domain.tsconfig.json`: зелёный;
  конфигурация расширяет проектную и включает `src/video/**/*.ts`.
- Все 54 legacy presets × 3 формата проверены без provider: новых IR-полей нет.
- 4 примера, все темы и стили проверены pixel provider в доменном suite.
- Root сообщил о зелёной проверке Fontkit: 4 примера; 54 presets с clean;
  6 themes / 12 styles / 7 fonts × 3 формата.

Общий QG и живая проверка выполняются root после интеграции. Полный suite/build
этим агентом не запускались согласно делегированным границам.
