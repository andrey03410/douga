# Проверка задачи 30

Автономный режим до вливания разрешён владельцем 2026-11-06. Проверяется полный
расширенный объём. Все данные принадлежат отдельному проверочному аккаунту;
чужие проекты/медиа не менялись. Evidence: `storage/verification/30-motion-kit/`
(в git не попадают). Последний source commit: `5a92ab0`. Финальный QG2 выполнен на этом source;
промежуточные и повторные живые проверки ниже разделены по evidence.

## Обязательная тройка

Финальный прогон на неподвижном source `5a92ab0`, строго в этом порядке:

1. `npm test` — **1142/1142, 91/91 файлов**, 359.83s; `qg2-test.log`.
2. `npm run build` — **exit0**, production route `/studio/motion` собран;
   `qg2-build.log`.
3. `npx tsc --noEmit` — **exit0**, `qg2-tsc.log` пуст, выполнено после build.

Session97407 завершён exit0; source оставался неподвижным. Собственный dev
остановлен перед QG;3000 свободен, общего worker нет. QG1 на1e2abe0 также
прошёл1129/91files, build0,tsc0; его логи qg-*.log сохранены отдельно.

До общего QG: SDK191/6файлов, renderer229/7файлов, discovery176/4файла;
после последнего текстового live-fix —216/6файлов, tsc0. Все новые дефекты
воспроизводились RED перед исправлением; подробности в отчётах agents/.
Промежуточный ранний общий запуск не считается зелёным: старый assertion списка
node types исправлен; три failures вызваны редактированием regression tests
во время Vite-run. Финальный прогон повторён на неподвижном коде.

## Настоящий MCP и SDK

`mcp-probe.mjs` / `mcp-probe.json`: повторено на final source5a92ab0,
лог mcp-verified.log (67entries/12recipes passed).

- Все67 entries: effect40, choreography10, transition8, backdrop5, widget4;
  list/filter/get и полная пагинация по7 элементов без пропусков/повторов.
- Flash разделён category; alias flip → flip-y; unknown/ambiguous/invalid cursor
  и limit дают ожидаемые ошибки. Capabilities/schema отражают новый SDK.
- Все12 whole motion recipes: own bindings → create → stable-ID patch motion →
  validate → commit → timeline → personal preset save/get → apply → validate.
  Каждый прошёл; owner assets/права/CAS не обходились.
- Внутри targeted discovery:67×4profiles×3intensities=804 compile-ready preview
  сочетания и8widget variants. Все12 complete examples проходят схему и compiler;
  default response сохраняет15прежних examples, optional id читает один.
- Legacy compiler:54presets×5fps +15mixed v2 = **285/285** ready results с
  полностью одинаковым JSON (plan, diagnostics, ready) относительно SDK main.
  `parity-result.json`; старые top/picker, v2 board, смешанные сегменты,
  separate answer, disabled segment, повторный summary и старые fade/slide.

## Настоящие очередь и MP4

`scripts/verify-studio.mjs` через явного actor и scoped worker, без общего daemon.
Все указанные сценарии завершились с первой попытки; скачанные bytes/SHA-256
сверены. Основной ролик повторно собран после final fixes на5a92ab0.

| Сценарий | Файл | Размер/время |
|---|---|---|
| Полный набор40эффектов/10хореографий/8переходов/5фонов/виджетов | `mcp-verified/artifact.mp4` | 1920×1080,30fps,1569frames,52.3s,11971842bytes |
| Только видеофон + кольцо/VS | `mcp-vertical/artifact.mp4` | 396×704,24fps,77frames,317775bytes |
| Только видеофон + кольцо/VS | `mcp-square/artifact.mp4` | 704×704,60fps,192frames,489356bytes |
| Обычный playing video → push | `mcp-transition-video/artifact.mp4` | 704×396,30fps,102frames,454613bytes |

Финальный основной MP4 SHA-256:
`b315782e272f7b91012be78ff9cb908d0c4ebc02844d4ea7ba97447eeaef963d`.
H.264/AAC. Status passed/downloadVerified=true; project
`cb9bd100-7f3d-44dd-a94e-198b78d681ae`, evidence mcp-verified/summary.json.
Промежуточные mcp-showcase/mcp-final сохранены отдельно. Документ23сегмента/40сцен; IR содержит все40имен эффектов.
Включены separate answer, board place/swap и произвольные композиции.

## Кадры и звук

- Просмотрены30 реальных кадров: `verified-contact-sheet.png`, `verified-frames/`,
  `verified-frame-index.json`. Проверены дуэль/таймер, ответ, тир-лист и swap,
  новые переходы, типографика, фоны и все группы эффектов.
- Просмотрены отдельно VS (`verified-frames/frame-013.png`) и multiline text
  (`frame-004.png`): VS крупный и читаемый; words/letters/lines сохраняют перенос.
- Legacy renderer: **5/5** полностью одинаковых decoded RGBA PNG для picker
  separate-answer и настоящего board move: `render-parity.json`, `legacy-frames/`.
- Декодировано **2512896** mono PCM samples, RMS **−38.65dB**:
  `verified-audio-result.json`. PCM SHA-256
  `ab4b55de18583e82774e90d9747ee5f6ddc836df73c7a3ae547fd72e6450737b`
  совпал с первым рендером до визуальных исправлений: аудио осталось идентичным.
- Видео-фон не играет свой640Hz звук: RMS около−48.77dB, отношение640Hz/330Hz
  фоновой музыки **−60.38/−60.45dB** в vertical/square; `probe-results.json`.
- На реальном MP4 граница удержанного видео frame65→66: средняя абсолютная
  разница RGB **0.00476** (шкала0..255), `held-video-push.png`.
- Адресные Chromium probes: blur white→white midpoint255 (прежде191), валидные
  computed CSS для7форм цветов, VS116.4px вместо21px, корректный count orbs.
- Live LT-01: сначала words/letters давали y delta0 вместо46. После фикса
  **252/252** Chromium cases (LF/CRLF/blank lines/spaces/Unicode/kerning,
  enter/exit/neutral) проходят. `live-text-probe.mts`, reports в agents/.

## Живой сайт, watch и offline

- `gallery-check.mjs`: повторено на5a92ab0 (gallery-verified.log); authenticated gallery, unauth redirect на login,
 5категорий, playback, profile/intensity,4timer variants, реальный clipboard
  и подписанный JSON; mobile390px без горизонтального overflow. Page errors0.
  Просмотрены `gallery.png`, `gallery-mobile.png`, gallery category screenshots.
  Clipboard denial корректно показал fallback; для положительной headless-проверки
  выданы необходимые clipboard-sanitized-write permissions в тестовом browser context.
- `browser-verified.mjs`: повторено на5a92ab0; в Studio явно нажата «Показать превью», Player воспроизводится.
  Публикация текущей сохранённой ревизии; watch и один offline HTML **8201921bytes**
  воспроизводятся и перематываются до **1568/1568**, затем назад на150. Offline
  проверен с отключённой сетью. Page errors0; `verified-browser-result.json`, `verified-studio.png`,
  `verified-watch-player.png`, `verified-offline-player.png`, `verified-motion-offline.html`.
- Промежуточный `background-browser.mjs` на1e2abe0: backdrop-only video отсутствует среди nodes.media,
  но watch и offline HTML **1138546bytes** показывают его после loop/seek до76/76;
  native video readyState≥2, muted=true. Сеть offline выключена; errors0.
  `background-browser-result.json`, `background-watch.png`, `background-offline.png`.
- Промежуточный `transition-browser.mjs` на1e2abe0: mounted watch/offline на кадрах75/80/70 удерживает
  outgoing video на **65/30s** (включая обратный seek); на84 video удалён.
  errors0; `transition-browser-result.json`, `transition-offline.html`.
- SSR Player regression проверяет context/markup на8переходах. Он не выдаётся
  за mounted playback: последнее подтверждено отдельными browser probes выше.

## Независимое ревью

- Product builder-check: существенных вопросов нет.
- Task1: R1–R5 первоначального review, R6 root sequencing, R7 scoped window edge
  исправлены двумя RED→GREEN раундами; последний verdict Spec✅/Approved.
- Task2: blur coverage, alpha colors, widget fonts, orbs count исправлены;
  scoped re-review Spec✅/Approved.
- Task3: fresh review Spec✅/Approved, Critical/Important/Minor0.
- Отдельный LT-01 live-fix: scoped re-review ADDRESSED/Approved.
- Полное итоговое ревью ветки на9bbc328: With fixes,3Important FR01–FR03,
  Critical/Minor0, Declined to judge пусто; [review.md](review.md).
  Одна fix wave5a92ab0 исправила стабильность backdrop video DOM, opt-in legacy→new
  seam и event cardId validation/resolution. Scoped re-review: все3 ADDRESSED,
  Spec✅/QualityApproved, новых findings0; [final-rereview.md](agents/final-rereview.md).
  Полная тройка повторена после fixes на неподвижном source5a92ab0:1142/91,build0,tsc0.

Отчёты: [SDK review](agents/task-1-review.md),
[SDK re-review](agents/task-1-rereview-2.md),
[renderer review](agents/task-2-review.md),
[renderer re-review](agents/task-2-rereview-1.md),
[MCP/UI review](agents/task-3-review.md),
[live text](agents/live-text-review.md), [live text fix review](agents/live-text-rereview.md).
Все task-scoped и итоговые findings закрыты; финальный QG зелёный.

### Живые регрессии финального review

[Отчёт исправлений](agents/final-fix-report.md): RED11 → GREEN263/9files,tsc0.
FR01 nativeDOM сохраняет B на forward/backward seek: sameB/connected=true.
FR02 настоящие renderStill6cases36captures и mountedPlayer6cases подтверждают
плавный fade/slide→new seam, duration1, segment boundary и reverse seek;
negative controls0/gap/legacy сохраняют прежний exit. Видео удержано на34/30s,
readyState4,muted=true;JSerrors0. FR03 target30/label30, offset+delay→35,
unknown/unsupported selectors→errors; board selectors прежние. Legacy повторно
285/285JSON и5/5RGBA exact. Evidence final-fix-*.json/.log в storage.

## Что посмотреть руками

1. Открыть `/studio/motion`, выбрать приём/профиль/силу и нажать Play;
   переключить timer/VS variants, скопировать fragment.
2. Через `video_motion_list` / `video_motion_get` найти pop, flash в двух категориях,
   picker-cascade; `video_examples({id})` даст полный рецепт.
3. Открыть основной MP4 и `verified-contact-sheet.png` по путям выше; посмотреть
   каскад, VS, кольцо, reveal победителя и настоящий swap.
4. [SDK-гид](sdk-guide.md) содержит короткие JSON фрагменты, наследование и события.

## Замечания владельца

Автономный режим до вливания, дополнительных замечаний нет.

## Итог перед PR

Все задачи плана реализованы. Финальные source5a92ab0/QG2/liveMCP/MP4/
Studio/watch/offline/gallery зелёные; whole-branch review и scoped re-review
закрыты, открытых Critical/Important/Minor нет. Ссылки/пути проверены.
Собственные dev/probe/worker процессы завершены;3000/3001 свободны.
GitHub Actions workflows в репозитории нет; указанный QG выполнен локально.
