# Ход выполнения

План: [plan.md](plan.md). Авторитетные требования: product.md и tech.md.
Автономный режим. Основной checkout; worktree не создаётся по прямому правилу Douga.

## Проверка связей задач до начала

| Связь | Контракт | Результат |
|---|---|---|
| 1 → 2 | optional IR motion/backdrop/widgets | Renderer начинается после фиксации типов Task 1 |
| 1 → 3 | browser-safe catalog и compiled examples | MCP/галерея используют общий экспорт |
| 2 → 3 | StudioVideo/StudioSceneFrame | Галерея не создаёт собственный движок |
| 1–3 → 4 | frozen plan и все выходы | Watch/offline asset traversal проверяется отдельно |

## Прогресс

- Бриф, продукт и техника закоммичены. Свежий builder-check: nothing important left.
- Task 1: реализация `415ac78`, свежий task review в работе.

## Контроль процесса

Артефакты SDD находятся в agents/ внутри папки задачи по правилу Douga;
стандартный .superpowers workspace не используется.

| Задача | Внутренняя согласованность |
|---|---|
| 1 | Тесты покрывают закрытый каталог, IR и компиляцию |
| 2 | Использует зафиксированный IR; старый transitionAt сохраняется |
| 3 | Использует общий каталог и renderer; не дублирует их |
| 4 | Собирает доказательства всех поверхностей после интеграции |
| 5 | Карточки сверяются с финальным кодом |

### Task 1 — в работе

- Исполнитель `/root/sdk_motion`, модель gpt-6.1-sol/high, base `c5f7b8b`.
- Целевой GREEN 115/115, 5 файлов, 46 motion tests; идёт полный npm test.
- Контракт backdrop: `scene.backdrop.layers[] = {from,to,fadeInFrames,media}`.
- Progress video: scene-local from = `-scene.from`, duration = final video length.
- Root подготовил свой аккаунт/медиа, make-showcase.mts, browser-check.mjs и
  extract.mjs в `storage/verification/30-motion-kit/`; `account.json` приватный.
- `make-showcase.mts` проходит: 23 segments, 40 scenes, 1569 frames; 40 effects.
- Task2 brief дополнен обязательным обходом backdrop media в worker/watch/offline.

- SDK commit `415ac78`; свежие целевые 160/160 (6 файлов), tsc exit0.
- Промежуточный общий npm test остановлен после 4 failures: устаревший node-union
  assertion исправлен, три failures возникли при изменении тестов в ходе Vite-run.
  Итоговый полный QG обязателен на неподвижном коде после интеграции.
- Reviewer `/root/sdk_review`, пакет agents/task-1-review.diff, отчёт task-1-review.md.

### Task 1 — fix round 1/5

Свежий review `415ac78`: Spec ❌ / Needs fixes, 5 Important, 0 Critical/Minor.
R1 preset backdrop slots теряют самостоятельный destination scene asset;
R2 source override сохраняет унаследованный old asset;
R3 board round-intro нумерует все раунды 1 и создаёт номер вне раунда;
R4 authored layer<=-100 теряет motion;
R5 container stagger не оркестрирует children и возвращает global enter родителю.
Исходный исполнитель `/root/sdk_motion` возобновлён для RED→GREEN/целевых тестов.
P02/T03 уточнены: stagger контейнера работает на дочерние анимации, own transforms
не копируются детям; implicit global enter — только leaves.
Полный suite будет после всей интеграции; сейчас без повторных широких прогонов.

Root подготовил baseline SDK из main и parity.mts: после финального кода сравнить
точный JSON compile для всех 54 built-in presets × 5 fps (270 случаев).

- Fix round1 commit `a17fc01`; R1–R5 RED15→GREEN66, R6 RED5→GREEN71;
  fresh target182/182 (6файлов), tsc0. Scoped re-review `/root/sdk_review` в работе.
- Проверочный документ пересобран; legacy exact parity снова270/270 на a17fc01.

Task 1: fix round 1/5 (5 addressed, 2 open — R6 null entrance readiness,
R7 custom VS clip outside own window; commits 415ac78..a17fc01).
Scoped report: agents/task-1-rereview-1.md. Исходный sdk_motion возобновлён
для round2, только coordination + RED→GREEN/целевые тесты; IR не меняется.

Task 1: fix round 2/5 (2 addressed, 0 open — R6/R7; commits a17fc01..eba8ec3).
Task 1: complete (commits c5f7b8b..eba8ec3, review clean; target191/191, tsc0).
Reports: agents/task-1-report.md, task-1-review.md, task-1-rereview-{1,2}.md.
Task2 начинается после фиксации этого состояния, исполнитель будет новым.

### Task 2 — в работе

Исполнитель `/root/motion_renderer`, base `b65e8af`, новый контекст gpt-6.1-sol/high.
Текущий targeted GREEN213/213,7файлов; финализируется actual Player outgoing
regression. Общий media traversal worker/watch/offline реализован в этом scope.
Root: baseline Remotion bundle готов, render-parity.mts сравнит декодированные
RGBA legacy PNG после commit. Отдельные video-backdrop-only документы готовы:
vertical24 и square60, только свои данные. Legacy compiler parity расширена
15 смешанными v2 сценариями:285/285 ready results с полным совпадением JSON.

### Task 2 — review/fix round1

Commit f9a44b0: targeted216/216,7files,tsc0. Fresh reviewer /root/render_review
нашёл 2Important: blur alpha coverage .75 и недопустимое alpha suffix у
CSS-цветов vignette. Root добавил тот же suffix в winner badge и R3
geometry-based default fontsize generated VS/badge по настоящему кадру.
Исполнитель motion_renderer возобновлён для RED→GREEN; контракт IR не меняется.

Live на f9a44b0: mcp-showcase artifact.mp4,1920×1080,1569frames,52.3s,
11826503bytes, SHA verified, first attempt done. 30 extracted frames viewed
в contact-sheet.png, full VS/widgets frames; decoded2512896 mono samples,
RMS−38.65dB. Legacy renderer RGBA parity5/5 (picker answer/board motion).
Эти evidence промежуточные: финальный код после исправлений перерендерить.
SSR Player regression доказывает frame context/markup, mounted seek
дополнительно проверяется root в живом watch/offline.

Task 2: fix round 1/5 (4 addressed,0 open; f9a44b0..bc4a675).
Task 2: complete (b65e8af..bc4a675, review clean; target229/229,tsc0,
Chromium color/coverage/font probe passed, legacy decodedRGBA5/5 on latestcode).
Final MP4 must be regenerated after Task3; intermediate showcase remains f9a44b0.

### Task 3 — в работе

Исполнитель /root/motion_catalog_ui, base3cda802, стандартный свежий контекст.
RED5 observed. Каталог list default20/max100/category/cursor; get name/category.
Решение root: default video_examples около12 полных motion docs (10recipes+2samplers),
67 preview cases локально, get короткие fragments; optional id для одного full doc.

### Живая находка для Task4 (проверяется)

Root увидел на actual MP4 text sampler (frame-004.png), что text-words/text-letters
могут визуально терять явный newline внутри отдельных inline-block fragments.
Raw text / text-wipe / lines выглядят с переносом. Render reviewer возобновлён
read-only для одного Chromium y-rect probe, без suite/изменений кода.
Если подтвердится, исправить после завершения Task3 (не параллелить implementers).

Task 3: complete (3cda802..d3aae86, fresh review clean; targeted176/4files,tsc0).
Actual MCP probe passed:67entries/category/get,67paging,12recipes create/patch/
commit/preset save/get/apply/validate; evidence mcp-probe.json.
LT-01 sourcefix1e2abe0: Chromium252cases/0fail, targeted216/6files,tsc0;
scoped reviewer render_review проверяет live-text-fix.diff.
Own dev запущен на проверенном свободном3000, session10642, лог dev.log;
остановить перед общим QG/build. Gallery browser driver session14562.

### Task4 — live checks complete, QG running

Все live checks passed на1e2abe0: main finalMP411968066bytes/SHA verified,
30frames viewed, decodedPCM identical to initial;3format/video probes passed.
Gallery auth/play/profile/copy/mobile0errors; Studio explicit preview, watch
/offline seek1568/1568; backdrop-only video loop/seek/mute offline; native
outgoing video held65/30 across75/80/70 and removed84 inwatch/offline.
Legacy compiler285/285 latest; rendererRGBA5/5 latest. Evidence в verify.md.
Own dev PID38162 terminated,3000 free; no global worker. Combined final QG
process session82472: npm test→build→tsc, logs qg-*.log in storage.
Не менять src/tests до окончания этого прогона.

QG1 complete на1e2abe0:1129/1129,91files,374.13s;build0;tsc0 emptylog.
Все local links main docs/maps132 проверены, missing0. origin/main послеfetch
не изменился; repo допускает merge commit. Итоговый broad review следующий.
Два конкретных риска для оценки reviewer: React key фонового B меняется при
выходе A из filtered active layers (standalone React DOM probe sameB=false);
стык legacy fade/slide → new adjacent transition (SSR-only white probe
не воспроизвёл, actual renderStill probe запущен отдельно). Не менять src до
заключения review; при подтверждении все findings одним fix wave.
