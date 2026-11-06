# Renderer: задача 3

Реализовано в `src/remotion` без правок сервера, SDK и UI.

- `TypographyText` использует только `textLayout`: абсолютные рамки строк и runs,
  итоговые размер/межстрочный интервал, согласованные padding/align/verticalAlign.
  Браузер не переносит текст и не выполняет повторную подгонку.
- Общий путь покрывает text, подпись card/group, timer, badge, VS и процент progress.
  Кольца/полосы/сегменты таймера, графика VS, рамка badge и полоса progress сохранены.
- Заливка, градиент, до двух обводок и теней, плашка и декорация поддерживаются
  вместе с плоскими rich runs. Декоративные копии обводки имеют `aria-hidden`.
- Новые узлы отмечены `data-typography`. В смешанном плане legacy-узлы проходят
  прежнюю ветку с исходным fitter/style; профильные прежние тесты сохранены.
- `TypographyFontGate` в `StudioVideo` распространяется на Preview/Watch/offline/MP4.
  Все выбранные faces загружаются через FontFace до показа контента; синтетика
  выключена. Штатные и замороженные relative static paths проходят через staticFile,
  data/blob/HTTP/API URL сохраняются. Кэш привязан к FontFaceSet и хэшу face.
  Player получает buffer/loading; render получает delay/continueRender. Ошибка
  отменяет render или передаётся error boundary Player. У запроса таймаут 15 секунд,
  размонтирование освобождает handles.
- Анимация text-lines использует реальные visual lines; letters — графемы Unicode;
  нейтральные позы возвращают обычный текст для native shaping. Одновременные
  inset-маски пересекаются. Таймер/счётчик/процент используют резервную ширину;
  после окна счётчика показывается целевое значение, а не число-резерв.
- CSS family начинается с выбранного primary font, затем идут реально выбранные
  fallback families: японский текст в начале mixed run не меняет латинские метрики.

## Проверки

TDD: первоначально 9 новых проверок renderer упали на отсутствии нового пути;
затем красные проверки FontFace readiness/failure/timeout/static rewrite, mixed
JP-first family, пересечения масок, окончания counter и текущего progress были
доведены до зелёного состояния.

Последняя команда: `npx vitest run src/remotion` — **5 файлов, 144 теста, все проходят**.
`git diff --check -- src/remotion` — без ошибок.

Общий typesmoke во время параллельной реализации обнаружил неподдерживаемый
fixture profile `linear` в моём тесте — заменён на поддерживаемый `smooth`.
Остальные на тот момент ошибки были вне renderer: MCP args implicit-any,
`video/presets.ts` rich bind и `video/schema.ts` rich groupId; основной агент уведомлён.

Полная тройка и живые PNG/MP4/watch/offline относятся к общей приёмке основной
задачи и здесь не объявляются пройденными. Особое внимание при QG: реальные
ширины JP-first mixed текста, края с двумя обводками/тенями и offline FontFace
при отключённой сети.
