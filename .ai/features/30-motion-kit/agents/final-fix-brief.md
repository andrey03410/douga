# Финальный fix wave — FR-01 / FR-02 / FR-03

База:9bbc328 (последний source1e2abe0). Прочитать ../review.md целиком.
Исправляем все подтверждённые Important одним исполнителем, без новых subagents.
Продукт/техника ../product.md и ../tech.md. Автономность до merge разрешена.

## FR-01 — стабильная идентичность активного backdrop layer

`MotionBackdrop` использует индекс filtered active array как часть React key.
При исчезновении A текущий B remounts. Сохранить исходную стабильную идентичность
слоя (например исходный индекс в backdrop.layers) независимо от filtered membership.
Не менять IR/окна/source timing/opacity. Поддержать одинаковые from/assetId у разных
слоёв без key collision. RED→GREEN на сохранение B и его native video DOM через
crossfade boundary; root probe backdrop-identity-probe.mjs сейчас sameB=false.

## FR-02 — opt-in стык legacy fade/slide → adjacent new transition

Решение root: если следующая сцена непосредственно смежна и имеет новый
adjacent transition с duration>0, её переход заменяет исходящую часть legacy
fade/slide предыдущей сцены. Входящая часть предыдущего fade/slide сохраняется.
Последняя сцена, временной разрыв, legacy→legacy и документы без новых полей
полностью сохраняют прежнюю математику/картинку. Новый переход duration1 тоже
считается opt-in. Duration0 не отключает legacy exit.

Окна/число кадров/аудио/IR не менять. Можно добавить optional параметр pure
transitionAt/StudioSceneFrame для подавления только exit и вычислить контекст
смежности в Scene. Outgoing по-прежнему удерживает последний реальный кадр,
без повторного перехода и звука. Учесть segment boundary.

RED→GREEN: белая fade/slide сцена → белый push/crossfade без затемнения/сдвига
на последних кадрах предыдущей и первом incoming. При старой legacy→legacy
исходящие fade/slide сохраняются. Root actual renderStill probe
mixed-render-probe.json:frames58/59/60=57→33→255, скачок подтверждён.
SSR-only mixed-transition-probe.json дал ложный255 из-за premount — не использовать
его как pixel evidence. Нужен настоящий headless render или mounted browser.

## FR-03 — card.reveal selectors не игнорируются

Решение root внутри существующего Anchor API:
- `at:{event:"card.reveal",cardId}` поддержать: искать source cardId среди card
  nodes данной сцены и привязывать к её active/reveal/visible start (scene-local).
- Unknown/missing target — диагностическая ошибка, документ not ready, без
  fallback на первую карточку/scene.revealStart.
- Без cardId сохранить существующую семантику current node/scene.
- board.* selectors cardId/actionId/slotId полностью сохранить.
- Неприменимые selectors у phase events явно отвергать схемой либо runtime
  diagnostic. cardId разрешён у card.reveal и board.*, actionId/slotId только board.*.
  У scene.start/timer.start/answer.reveal нельзя молча принять любой selector.
- Offset/delay и node.from не учитывать повторно: target frame уже scene-local.

Root probe anchor-selector-probe.json: card-1-2 target30,label12,readytrue;
с исправлением label30. Добавить positive/nonexistent/unsupported/offset tests.
Схемы/типы можно минимально уточнить для этой валидации, без новых авторских полей.

## Проверка и дисциплина

1. Наблюдаемые RED перед source fixes. Permanent tests проверяют поведение,
   а live probes должны подтвердить фактический DOM/pixel эффект.
2. Targeted: video/motion, remotion/motion-frame, studio-frame, studio-player,
   watch/backdrop-media/model/offline, mcp/motion-discovery/instructions.
3. tsc, diffcheck. Полную тройку выполняет root после scoped re-review;
   НЕ повторять полный npm test в implementer.
4. No arbitraryJS/CSS из JSON, frame/fps/seed deterministic; старый IR без новых
   полей неизменен. Не трогать права/чужие медиа/проектные данные.
5. Commit conventional только своих src; full report с RED/GREEN, commands/counts,
   live evidence и контракты в agents/final-fix-report.md. Другие .ai файлы не stage.
6. При неоднозначности спросить root, пользователь не нужен для рутинных решений.
