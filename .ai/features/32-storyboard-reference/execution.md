# Исполнение задачи 32

План: plan.md; продукт принят, автономный режим до merge.

## Решения исполнения

- Ruling: файлы журнала/заданий/ревью сохраняются в .ai/features/32-storyboard-reference,
  не в .superpowers: это прямое правило AGENTS.md о размещении ИИ-материалов.
- Ruling: основной checkout на feat/32-storyboard-reference сохраняется; отдельный
  worktree не создаётся по feature, чтобы не терять env/storage/DB и не конфликтовать с dev.
- Preflight: чистые recipes/content и selection/review имеют разные файлы;
  regression runner использует оговорённый renderStudioFrames. Общие exports,
  adapters и presets.ts интегрирует основной агент после готовности модулей.

## Прогресс

- Продукт: f0a2b40. Техника/план приняты агентом в автономном режиме.

- Задача1: e837b3d, рецепты/content формы, 24 targeted PASS; 021936a preview/try-on, 6 PASS.
- Задача2: 0e7ca4a, выбор смысловых кадров и review, 35 targeted PASS.
- Задача3: 5648297, pixel regression/fixtures/runner, 14 targeted PASS, реальный repeat PSNR∞.
- Задача4/5 core: durable inspection, pinned inputs/fonts, shared renderer, 4 MCP tools,
  HTTP и recipe discovery. Последний targeted прогон: 6 файлов /25 тестов PASS;
  ранее интегрированные SDK tests: 47 PASS; промежуточный tsc EXIT0.
- Исправление интеграции RED→GREEN: recipe fonts при inspection должны копироваться
  вместе с лицензиями; проверка verifyTypographyFonts сначала воспроизвела ошибку,
  затем прошла с frozen inputs. Простой evaluate без directory их не закрепляет.
- Ruling: baseline sampling ограничен до11 representative frames/fixture (187 fixtures,
  1561 кадров), available/selected events сохранены. Это снижает размер/стоимость
  эталонов; полная раскадровка пользовательских сцен остаётся пагинируемой.

## Интеграция и проверки

- Core commit0926302; guided UI018db03; live verifier d6e0bb8.
- Раннее ревью inspection-review.md: IR01 исторические assets (21dc3c2),
  IR02 короткие IDs/доменный no-op (f90e4f6), IR03 реальные effective fixes
  (566830c), IR04 atomic before backup/recovery (60d606e +566830c).
  Повторный verdict PASS.
- Live stdio: 6/6,103 calls,106 assertions; PNG grids/tiles,26scene pagination,
  compare/review/apply, actual decoded MP4/PCM. Evidence live-4ca970ae… .
- Слабая модель gpt-6-luna medium:6/6 без ручных nodes/bindings и подсказок;
  ошибки аргументов/ID и concurrent create исправлены в≤2 попытки.
  Evidence storage/verification/32-storyboard/weak-agent/.
- UI desktop/mobile login/gallery/player/storyboard/review: errors0/overflowfalse.
  Restore UI отдельным полным проходом: beforev5→applyv6→restorev7,revision1,
  before/restored hash равны,95 остальных проектов не менялись (aca2edc).
- До финального FR: targeted77 +diagnostic11 +query4 PASS, промежуточный tsc0.
- Полная предварительная matrix187/1561 отрендерена в actual-manifest.json,
  baseline ещё НЕ accepted. Контактные листы выявили тёмные top thumbnails:
  нужна обязательная representative stable frame выборка перед nativepreview.

## Финальное ревью: активные исправления

- final-review.md verdictFAIL, реальные FR01–03 требуют закрытия до QG/merge.
- FR01(P1): recipe preserving apply/try-on + explicit appearance replace.
  Агент recipes_content владеет recipe-apply.ts/tests, projects.ts/types.ts,
  recipe-preview.ts/tests. Root интегрирует mode в UI/MCP после его commit.
- FR02(P2): root добавил sceneId/segmentId/frame для deep review и ready action,
  targeted RED→GREEN: review-focused 2files/10PASS. UI кнопка адресного клипа добавлена.
- FR03(P2): агент visual_regression делает frozen sourceJobId continuation,
  scope/nextPageAction, ownership/hash/engine tests. Root интегрирует UI/MCP после commit.
- P08 gap: агент storyboard_domain пишет чистый storyboard-diff.ts/tests:
  changed properties +resolved/new/remaining issues. Root интегрирует DTO/UI.
- Minor generatedIDs: root boundedContentId для длинных допустимых participant/
  round IDs; тест воспроизвёл Zod too_big, затем targeted GREEN ожидается/лог рядом.
- После FR03 visual_regression добавляет selected representative кадры в fixtures;
  root затем меняет prefer nativepreview, rerender→просмотр→accept→fresh check.
- Full mandatory npm test→build→tsc ещё не запускалась. Не объявлять готовность
  по промежуточным targeted/tsc. Root dev session97872 владеет портом3000,
  перед build остановить, после build поднять снова при необходимости.

## Исправления финального ревью

- FR01: 76b7a51 — apply/try-on теперь preserve по умолчанию; replace только
  оформления. Авторское intro+main остаётся510 кадров; свои13sec/override77 сохранены.
- FR02: ready deep action содержит scene/segment/frame; окно включает риск.
  Pinned review/deep использует тот же frozen media/fonts/engine, что PNG.
- FR03: 015a737/70a7310 — sourceJobId continuation, scope и ready nextPageAction;
  MCP не подставляет дефолты поверх наследуемого scope; UI сохраняет снимок.
- fa98797 и интеграция: compare показывает changed properties/resolved/new/remaining.
  Generated content IDs ограничены стабильным digest; длинные допустимые входы
  воспроизвели старый отказ, после исправления16 content testsPASS.
- PixelDiff P08: optional третья RGBA плитка/PSNR, только compare; max24 общий.
  Missing/размеры — notComparable. Адресный worker и codec tests:5files/25PASS.
- Небольшое замечание повторного ревью: RecipeApplyError переносится во внешний
  catch, MCP получает PRESET_KIND_MISMATCH. Instance assertion RED7/8→GREEN8/8.
- После осмотра8 contact sheets всех187 samples baseline accepted:1675 unique PNG,
  max12/fixture. Прежняя matrix1561 была предварительной и не принималась.
  Fresh full render запущен отдельно для доказательства повторяемости.

## Финальный QG и воспроизводимость

- Первый full npmtest:120files/1409testsPASS,1FAIL из-за сокращения имени
  video_motion_list/get в MCP initialize. Возвращены явные имена get/list;
  адресный RED→GREEN3files/20tests. Исходный qg-test-initial.log сохранён.
- Первый полный fresh default-raster repeat:1673/1675exact,2FAIL. KMK square725:
  455px/maxDelta3; manga topwide186:100px/maxDelta177 на маленькой части русской подписи (JP fallback не подтверждён).
  Ни tolerance,ни повторный accept для получения green не применялись.
- Исследовательские isolated/batch повторы сохранены в drift/ и drift-probe/.
  Оба полных проблемных batch (11+10кадров)×3 программнымswangle совпадают
  между собой exact. Default baseline им не эквивалентен — это смена backend.
- Ruling: эталонный CLI закрепляет swangle,metadata rasterizer входит в environment
  guard; shared renderStudioFrames получает необязательную настройку. Штатные
  пользовательские previews/render сохраняют прежний default. После изменения
  нужен новый full render→просмотр→explicitaccept→freshfullrender/check.
  Это воспроизводимый режим,не послабление pixel/ROI критерия.

- 4f2ded8: программная policy pin,18targetedPASS/tsc0. Scoped reviewPASS:
  exact/ROI не ослаблены,workerdefault сохранён,envrasterizer несмешиваем.
  GPU-механизм исходного дрейфа не доказан. FullSWmatrix выполняется отдельно.
- Промежуточный fulltest совпал по времени с добавлением RED envidentity-test
  (1410PASS/1FAIL); не считается финальнымQG. Финальная тройка запущена после
  commit4f2ded8 и freeze всех исходников; меняются только документы.

- Финальная тройка после4f2ded8/rootfreeze:122files/1413testsPASS(382.93sec),
  productionbuildPASS,tsc0послеbuild. Rootcorecommitc10f1fd.

- FullSWrepeat: 1653/1675exact,22FAIL. Не green; merge остановлен.
  Bbox показывает прежде всегоSVG/rounded-border AA,неfontfallback.
  Probe2: control/prewarmfail,37frames×3doublechosenexact(111PNG).
  FromSurfacefalse9errors,forceDSF1driftсохраняется. Новыеheadless/settleprobes
  read-only; baselineиsourcesнадиагностикене меняются.

- Последующаядиагностика:2rAF/privatecaptureне исправилиdrift. Dedicated
  bundledheadless-shell149+SW:37frames×3=111PNGexactбезprewarm/double/hooks.
  Новыйsupportedcandidate:CLIensureBrowser(headless-shell),одинpathдля
  fingerprint/selectComposition/openBrowser; workerENVfallbackне меняется.
  Нуженновыйполныйrender/view/accept/freshrepeat/check. Не выдаёмлокальную
  выборкузагарантиювсейматрицы.

- Full149repeat завершён:1675PNG,1674побайтноравныfirst149baseline;
  единственнаяразницаtier.wide@123:1pixelΔ1,PSNR117.31865. Пиксельвреальной
  анимированнойкарточке,внезаписанныхstaticROI;необъявляетсяфоном.
- RulingT07calibration:CLI-onlyfixedglobal≤4changedpixelsANDmaxDelta≤1;
  записанныеROIexact0,ноtracksMotionfalse. SDK/projectexactdefaultunchanged.
  5новыхboundaryRED→GREENcases. Никакогоновогоacceptпослеrepeat,first149
  referencePNGнепереписаны. Caption/transitionnegativecasesобнаружены/restored.
- c645283policycode+rootHTMLRU,sourcefreeze. IndependentscopedreviewPASS
  сограничениями;finalfullcheckиmandatorytrioвыполняютсяпослеправок.

## Финальная приёмка координатора

- Bundled149 + SW full render/view/explicit accept/fresh full repeat завершены.
  Full check: 1675 PASS, 1674 exact, 1 bounded-noise (один pixel Δ1), ROI failures0.
  First149 PNG reference после независимого повтора не переписывался.
- Оба отрицательных контроля обнаружены после калибровки, actual восстановлены.
- Последняя тройка после c645283 и HTML RU:122 files /1420 tests PASS,
  build PASS, tsc0. Отчёты и предыдущие отказы сохранены.
- Независимое scoped review политики PASS с указанными ограничениями.
  Автономная приёмка выполнена в рамках дословного разрешения владельца.
  Далее PR и merge по feature, без нового ожидания гейта.
