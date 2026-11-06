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
