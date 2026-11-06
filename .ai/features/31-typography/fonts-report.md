# Ресурсы и серверное измерение: отчёт задачи 2

Реализована ресурсная часть, интеграция со всеми выходами и серверный провайдер
реального измерения. Общий QG/живые поверхности остаются у основного агента.

## Контракты

- `src/video/font-manifest.ts` — browser-safe `TypographyFontAsset`, массивы
  `typographyFonts` / `typographyFontAssets`, `getFontFace`, `supportsFontFace`.
  Лицо имеет ID `<font>-<400|700>-<normal|italic>`, стабильную CSS family,
  локальный src, hash/bytes, OFL license/hash/bytes и pinned upstream URL.
- `getTypographyMeasureText(): Promise<MeasureText>` загружает локальные TTF,
  проверяет SHA-256 и читает variable `wght` через Fontkit 2.0.4 (точная версия;
  `@types/fontkit` 2.0.9). Измеряет OpenType shaping/advance widths в px,
  сохраняет kerning в последовательных участках одного лица, считает интервалы
  между графемами, выбирает JP fallback и сообщает отсутствующие символы.
  Измерительный cache ограничен 2048 строками длиной не более 2048 UTF-16 units.
- `evaluate` передаёт измеритель только для документа с новой типографикой.
  `freezeTypographyFonts` закрепляет выбранные файлы и OFL licenses и возвращает
  `fontFiles`, keyed by hash. Два веса variable файла используют один ресурс.
- Ревизии/снимки сохраняют `fontFiles`; снимок учитывает их bytes. Проверка
  сохранённого ресурса читает frozen bytes, независимо от текущего каталога.
- `engineId` включает все public font resources. Bundle копирует fonts в свой
  public; MP4/still читает и проверяет frozen selected fonts и использует static URLs.
  Child также поддерживает diagnostic render под существующей heavy lease.
- Закреплённые ресурсы доступны через точное членство в ledger на owner endpoint;
  публикация переписывает URLs на собственный публичный allowlist. MIME TTF/WOFF2/OFL.
- HTML встраивает каждый выбранный TTF и полный OFL один раз как blob-ресурсы;
  никаких запросов к CDN. Учитывает реальный base64 размер. Legacy Arimo WOFF2 CSS
  остаётся для legacy текста и исключает новые `[data-typography]` поддеревья.

## Поставка

Официальный `google/fonts@38411257417e616c5d4daa1b9e91a3dbcebe1c2e`.
Десять полных variable TTF: **25 635 784 байта**; семь файлов SIL OFL 1.1.
Arimo/Manrope/Oswald/Rubik/Roboto Mono/Noto Sans JP/Noto Serif JP normal 400/700;
Arimo/Rubik/Roboto Mono также настоящие italic 400/700. Синтетические начертания
провайдер отвергает. Noto — полные японские файлы, без дробления по CDN subsets.
Источник, SHA-256 и bytes каждого файла: `public/fonts/typography-v1/sources.json`.

## TDD и целевая проверка

Красные состояния наблюдались до реализации: отсутствующий модуль измерителя,
отсутствующий freeze helper, `plan.fonts` отсутствует в сквозном project test;
отдельно пойман JP base + Arimo combining mark (`東\u0302`) с неверным лицом.

Команда на Node 22:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  src/server/studio/typography-fonts.test.ts \
  src/integration/typography-resources.integration.test.ts \
  src/integration/studio-publication.integration.test.ts \
  src/integration/studio-export.integration.test.ts
```

**19/19, 4 файла зелёные.** Проверены proportional/mono/kerning/size/spacing,
RU+JP fallback, combining grapheme, отсутствующий символ, реальный italic,
unsupported face и повреждение pinned/frozen hash. Сквозной тест проходит
compile → revision → freeze → owned/public font bytes → standalone HTML;
оба Arimo веса делят один TTF, estimate равен фактическому download byte count.
Существующие export/publication сценарии также зелёные.

`git diff --check` чистый. Полную тройку и проверку одинаковых живых кадров/HTML
выполняет основной агент после интеграции всех частей. Node по умолчанию в shell
оказался 26 с несовместимым ABI SQLite; целевые интеграции запускались на Node 22.
