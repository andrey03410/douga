# Проверка

## QG

Итоговый код — `54fc0d4` (после исправления `bf96e59`). Node 22.23.2 (`/opt/homebrew/opt/node@22/bin` в PATH).
Полный прогон после последних исправлений выполнен отдельным свежим процессом;
свой dev-сервер на 3000 был остановлен. Порядок tests → build → tsc соблюдён.

| Проверка | Команда | Результат |
|---|---|---|
| Тесты | `npm test` | **1252/1252**, 99 файлов, 338.41 s; `storage/typography-qg-final-pass.log` |
| Сборка | `npm run build` | **exit 0**, `storage/typography-qg-final-build.log` |
| Типы | `npx tsc --noEmit` | **exit 0**, без ошибок; `storage/typography-qg-final-tsc.log` |

Ранний полный прогон был запущен до окончания параллельных правок: 1214/1219,
пять ошибок (устаревшие transformed modules домена/галереи и отсутствующий React
import для SSR). Свежие целевые прогоны подтвердили исправления. Следующий полный
прогон прерван SIGINT после уточнений ревью, результат не засчитан. Готовность
опирается только на финальную тройку после заморозки исходников.

Полный прогон на d930ddb: 1248/1249, единственная регрессия — заводская тир-доска
с clean. Фиксированные 10 px съедали подпись миниатюрной карточки при читаемом
минимуме. bf96e59 заменил внутренний inset на min(10,w×0.03,h×0.03): для 80×100
рамка 75.2×47.6, реальные две строки по 23.8 помещаются при fontSize21.25≥min20.
Большие карточки сохраняют 10 px; media/node geometry и legacy не меняются.
Добавлена реальная матрица всех 54 populated factories ×3 формата (162), зелёная;
фикс независимо перепроверен перед новым полным QG.

## Живые проверки

Все материалы — `storage/verification/31-typography/`, не в git. Создан отдельный
проверочный admin и свои проекты/медиа; существующие проекты и медиа владельца
не менялись. Пароль хранится только в `credentials.json` этой папки, не выводился.

| Поверхность | Проверка и результат | Доказательство |
|---|---|---|
| Настоящие шрифты | 10 TTF / 25 635 784 bytes, 7 OFL; реальные веса 400/700, italic в трёх семействах, JP fallback и проверка хэшей | font-manifest.ts, provider/integration tests, fonts-report.md |
| Каталоги | 7 семейств, 12 стилей, 6 тем ×8 ролей; все темы/стили/семейства подготовлены во wide/vertical/square, 75 случаев | typography-authoring.integration.test.ts, typography-gallery-matrix.log |
| Legacy/пресеты | 54 пресета проверены по трём форматам без включения новых полей; отдельный реальный Fontkit smoke всех 54 с clean | domain tests; storage/check-typography.log |
| Заводские проекты | 54 populated factory presets ×3 формата (162), clean готов с настоящим Fontkit после readable minima | typography-authoring.integration.test.ts, typography-factory-matrix.log |
| SDK примеры | Все четыре документа готовы с настоящим измерителем | storage/check-typography.log |
| PNG/клип/MP4 | Через durable worker созданы still 18 165 B, clip 374 933 B и финальный MP4 459 194 B; реальные строки ru/JP, rich accents, контуры, градиент/тень, timer/counter | still.png, clip.mp4, render.mp4, effects.png; state.json |
| Исправленная плотная доска | Последний кадр заводского board.tier: подписи сохраняют minFontSize, overflow=false; реальный still на итоговом коде | tier-readable-final.png; mcp-final.json |
| Топ/пикер/доска | 9 реальных PNG, каждый пример wide/vertical/square; все просмотрены глазами | matrix.json, ost-top-*.png, character-picker-*.png, manga-board-*.png |
| Замороженное задание | Правка оформления проекта не меняет snapshotHash существующего render job | state.json; verify-typography.mts |
| Звук | MP4 реально декодирован; mean -43.8 dB, max -40.7 dB, тестовый sine слышен, не тишина | audio.log |
| MCP stdio | 57 tools; font/theme/style discovery, inspect с пагинацией; diagnostic PNG, чужой id → NOT_FOUND | mcp.json, mcp-final.json; typography-final-mcp.log |
| Черновик | Diagnostic PNG при TEXT_OVERFLOW без изменения version/revision, временные файлы убраны, не обычное задание | overflow.png; typography-final-live.log |
| Галерея | Headless Chrome 1920×1080 и 320×900; собственный mixed text, смена темы; 0 JS errors, 0 horizontal overflow | gallery-wide.png, gallery-neon.png, gallery-320.png, browser.json |
| Редактор | Грязный локальный буфер отключает применение темы; серверные CAS/replay/ownership и malformed draft проверены интеграцией | dirty-editor.png, browser.json; typography-authoring.integration.test.ts |
| Метрики | Реальная DOM Range width соответствует подготовленной ширине: максимальная разница <0.1 px в масштабированном Player | browser.json |
| Watch/offline | Те же строки/font family/left/top/width на кадрах 45 и 165 | parity.json, watch-frame-*.png, offline-frame-*.png |
| HTML без сети | 15 673 991 B, оценка равна размеру скачанного файла; 5 шрифтов loaded, 0 HTTP-запросов в Chrome offline | offline.html, offline.png, browser.json |

Проверочные драйверы сохранены в `storage/verify-typography*.mts|mjs`; они работают
только с собственным проверочным аккаунтом. Снимки паритета сравнивают текстовую
геометрию и строки; побитовое совпадение H.264 или сглаживания разных ОС не заявляется.

## Ревью

[Независимое ревью](review.md): на `54fc0d4` закрыто **5/5**, новых Critical/Important нет. Отдельно перепроверены responsive card inset и матрица populated factories.

- F31-01: rich-only текст включает Fontkit provider (2205b55).
- F31-02: inspect читает owned+view, не вызывает source reconciliation (dca9410).
- F31-03: числа только одной строкой, учитываются плюс/нули/десятичные/экспонента,
  несовместимые ellipsis/clip диагностируются (4a4f616).
- F31-04: ограничены строки/runs/тексты/missing/reservedText/diagnostics;
  есть counts и offsets (dca9410, b9f1ab8).
- F31-05: rich card preset сохраняет стили, выводит displayLabel ровно один раз,
  соблюдает caption??label и повторяемый контекст (4a4f616, d930ddb).
- Живая проверка дополнительно выявила text-shadow поверх градиента: исправлено
  отдельными aria-hidden слоями, новый effects.png просмотрен также ревьюером (c41f2a3).

Профильные проверки перед финальным QG: домен и board integration 381/381, renderer 145/145,
provider+ресурсы 10/10, сервис инспекции 8/8; эти прогоны не заменяют тройку.

## Что посмотреть руками

- [ ] `/studio/typography`: ввести длинный русский/японский текст, выбрать тему,
  стиль или шрифт, уменьшить рамку, сравнить варианты, переключить формат и фон.
- [ ] Применить тему к своему черновику с preserve/replace; открыть проект,
  посмотреть превью и проверку текста. При грязном редакторе применение заблокировано.
- [ ] Через MCP font/typography list/get → patch → text_inspect → validate → still.
  Попробовать TEXT_OVERFLOW с diagnostic PNG, неподдерживаемый italic и отсутствующий glyph.
- [ ] Открыть `offline.html` с отключённой сетью; сравнить с render.mp4 на 1.5/5.5 s.
  На втором фрагменте цветной градиент, двойная обводка и динамические цифры.
- [ ] Проверить свой старый проект без новых полей: новая типографика включается
  только явно, новые заводские проекты получают clean.

## Ограничения выпуска

- API предоставляет реальные 400/700; italic Arimo/Rubik/Roboto Mono. Цветные emoji,
  furigana, вертикальное письмо и пользовательские font URLs/загрузки не входят.
- Полный японский variable TTF встраивается целиком: даже короткий JP-текст
  увеличивает HTML. Выбранные физические ресурсы дедуплицируются по hash и входят в оценку.
- Новые инструменты уже запущенного внешнего MCP-клиента требуют перезапуска
  соединения stdio; сайт подхватывает код после обычного перезапуска сервера.

## Замечания владельца

Автономный режим до вливания разрешён владельцем 2026-11-06. Дополнительных
замечаний владельца после принятия продукта не поступало.
