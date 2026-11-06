# Финальный scoped re-review FR-01–FR-03

**Base:** `9bbc328`. **Head:** `5a92ab059fe2b63ad609d478e5d6465adc428193`.

**FR-01: ADDRESSED. FR-02: ADDRESSED. FR-03: ADDRESSED.**
**Spec: ✅. Quality: Approved. Ready to merge: Yes — со стороны review;
окончательное слияние после зелёного QG на последнем source.**

Открытых Critical / Important / Minor находок в проверенной области нет.
Это один scoped re-review исходных замечаний из [review.md](../review.md)
и регрессий fix diff, без нового whole-branch поиска. Прочитаны
[final-fix-brief.md](final-fix-brief.md),
[final-fix-report.md](final-fix-report.md), весь `final-fix-review.diff`,
обновления документации в рабочем diff и адресные evidence. HEAD подтверждён.

## Закрытие исходных findings

### FR-01 — ADDRESSED

`src/remotion/MotionBackdrop.tsx:20,50–52`: исходный индекс сохраняется
в `backdropLayersAt` до фильтрации, React key теперь `layer.index`.
У продолжающегося B ключ остаётся тем же при уходе A и при обратном seek.
Два слоя с одинаковыми from/media также имеют разные ключи. Окна, источники,
opacity и правило отсутствия будущего слоя не менялись; исправлена причина
remount, а не скрыт его результат.

Постоянная регрессия проверяет совпадающие from/media и смену membership.
Прочитанный `final-fix-backdrop-probe.json` показывает forward/backward:
`sameB=true`, `oldConnected=true` на реальном mounted MotionBackdrop/native
video. Это ровно исходная проверка identity; отчёт не выдаёт её за измерение
buffering или потерянных кадров.

### FR-02 — ADDRESSED

`src/remotion/studio-frame.ts:198–208,217–226`:
`legacyExitReplaced` требует непосредственно смежную следующую сцену,
положительные scene duration и transition duration, а также новый тип перехода.
Optional `suppressExit` заменяет только exit на1; прежняя enter-математика
сохраняется. `StudioVideo.tsx` передаёт этот контекст через
`suppressTransitionExit` из плоского плана, включая segment boundary.

Предыдущая fade/slide теперь уже до границы находится в том визуальном
состоянии, которое удерживается outgoing. Freeze, source frame, muted media
и отдельная аудиодорожка не переписаны. При duration0, gap, legacy→legacy
или отсутствии следующей сцены helper возвращает false, то есть применяется
прежний путь. Duration1 нового перехода корректно является opt-in.

Прочитаны скрипты actual renderStill и mounted Player, их assertions и JSON:

- Fade→push10, slide→crossfade10 и fade→crossfade1 имеют белые RGB samples
  на58/59/60/61 и повторном59. Для исходного frame59 вместо `[33,36,44]`
  теперь `[255,255,255]`. Segment boundary включён.
- Negative controls duration0/gap сохраняют fade exit `[33,36,44]`;
  slide→slide сохраняет прежнее смещение. Frame5 проверяет сохранение enter.
- Mounted Player повторяет шесть случаев и обратный seek. Видео outgoing
  на60/65/69 и повторном60 сохраняет `currentTime=1.133333`, readyState4,
  muted=true, paused=true; на70 отсутствует. JS errors пусты.

SSR premount не использован как пиксельное доказательство. Документация
product P04, tech T04, SDK-гид и render map согласованы с принятой opt-in
политикой; в ней нет обещания изменить старые документы.

### FR-03 — ADDRESSED

`src/video/motion-compiler.ts:66–80`: при explicit cardId target ищется
среди card nodes текущей сцены; берётся его scene-local active/visible start.
Неизвестная цель возвращает undefined и проходит существующую diagnostic
ветку `MOTION_EVENT_UNAVAILABLE`, без fallback. Без selector прежняя
current-node/scene семантика сохраняется. Offset/delay по-прежнему применяет
caller, поэтому дополнительного node.from или повторного offset нет.

`src/video/motion-schema.ts:28–61` разделяет строгие phase/card/board ветви:
phase events не принимают selectors, card.reveal принимает только cardId,
board.* сохраняет все три прежних selectors. Новых авторских полей нет.

Прочитанный SDK evidence подтверждает исходный случай target30/label30,
offset2+delay3 при node.from5 даёт35, unselected остаётся12. Missing target
даёт ready=false/MOTION_EVENT_UNAVAILABLE; phase/card несовместимые selectors
дают SCHEMA_INVALID. Постоянные тесты дополнительно проверяют прежние board
selectors вместе и по одному несовпадению каждого. Это устраняет молчаливое
изменение смысла, а не только меняет сообщение об ошибке.

## Регрессии fix diff и Global Constraints

- Исправления не записывают новые поля в serialized IR, не меняют semantic
  windows, timeline length, board actions, ranking, ответы, keyframes или audio.
- Frame/fps/seed остаются источником состояния; новый контекст перехода
  вычисляется из неизменного плана, а ключ — из исходного массива слоёв.
- Schema остаётся закрытой; произвольный JS/CSS не добавлен. Уточнение selector
  validation намеренно отвергает только раньше молча игнорируемые комбинации.
- Количество элементов, лимиты particles/text fragments, выбор backdrop source
  и защита от раннего показа победителя не изменились.
- Прочитаны результаты exact legacy parity:285/285 JSON и5/5 decoded RGBA.
  Они согласуются с тем, что новый exit helper срабатывает только при opt-in.

Новых подтверждённых поломок в этих связях нет. Предыдущие закрытые task findings
не переоткрыты; fix не меняет их реализации.

## Проверки и границы

Переданный targeted GREEN подтверждён чтением лога: **263/263,9/9 files**;
переданы tsc0 и diff-check0. Прочитаны actual render/mounted/anchor/parity
evidence и методы измерения, без повторного запуска suite или probes.
Сам reviewer выполнял только чтение/сводку сохранённых данных.

Полная неизменная тройка `npm test → build → tsc` на5a92ab0 выполняется root.
Этот отчёт не заявляет её завершение и не подменяет её старым QG на1e2abe0.
Новые src/data/process/index/Git изменения не делались; создан только этот
файл. Субагенты не запускались.

**Declined to judge:** пусто. **STATUS: PASS** в указанном scope.
