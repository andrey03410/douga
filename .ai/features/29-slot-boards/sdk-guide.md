# Доски: вход для автора SDK

## Быстрый старт

```ts
import { createVideoDocument, compileVideo } from "@/video";

const document = createVideoDocument({
  kind: "board",
  presetId: "board.budget-draft.vertical",
  title: "Собери команду за 15 очков",
});
const result = compileVideo(document);
```

Семейства: `tier`, `kmk`, `smash-pass`, `blind-rank`, `draft`, `sort-quiz`,
`alignment`, `budget-draft`. Форматы: wide/vertical/square; короткий ID без формата
означает wide. Factory выдаёт документ v2 с сегментом board и демонстрационными
кандидатами/решениями. Их нужно заменить авторскими данными перед настоящим выпуском.
`options.participants` задаёт новый набор участников, `options.board` — полностью
заданное описание первой доски; остальные board-сцены личного пресета создаются по skeleton.

Через MCP: `video_project_create({presetId:"board.kmk.vertical"})`, далее
`video_document_get`, `video_draft_replace/patch`, validate, commit и job.
Примеры восьми семейств доступны в `video_examples`, полная схема — в `video_schema_get`.

## Данные и правила

В `segment.scenes[]`: `block:"board"`, `board:{version:1, mode, slots, rounds, ...}`.
Участники по-прежнему в `source.participants`; `round.cards[]` — отдельные появления
со стабильными `id`, `participantId` и необязательной `cost`.

- `slots[]`: id, label, capacity, color (текст), background (цвет), image,
  backgroundAsset, sound, style, нормализованный rect для free-раскладки.
  Медиа — ключи bindings. Отсутствие capacity означает неограниченную вместимость.
- `mode:"accumulate"` сохраняет доску. `mode:"rounds"` очищает её на границе раунда;
  `carry:true` сохраняет состав. `round.clearSlotIds` очищает выбранные слоты.
- Действия: place(cardId,slotId), move(cardId,slotId), swap(cardId,otherCardId),
  replace(cardId,slotId,replaceCardId), remove(cardId), lock(cardId), unlock(cardId).
  У каждого действия собственный id, необязательные comment и sound.
- Карточку можно разместить только один раз; для переноса нужен move. Замена,
  обмен и проверка бюджета атомарны. Remove/replace возвращают стоимость в бюджет.
  Lock запрещает перенос/удаление/замену/обмен до явного unlock.
- `allowMoves`, `allowReplacements`, `lockOnPlace`, `budget`, `requireAllAssigned`,
  `allowRepeatParticipants` задают правила. Пустые слоты допустимы. По умолчанию
  один участник не занимает несколько мест одновременно и не повторяется в одном раунде.
- `layout:"rows"|"grid"|"free"`, columns, xLabel/yLabel задают расположение.

Чистые `createBoardState`, `applyBoardAction` и `resolveBoard` экспортированы из SDK;
в них нет часов, ввода пользователя или рендера. Невалидное действие не меняет вход.
`applyBoardAction` принимает только уже доступные карточки; `resolveBoard` сам
следит за их появлением и сбросом раундов. Случайный выбор автора не подменяется.

## Подача и звук

`presentation`: reveal together/sequential; answerReveal round/end;
hideLabelsUntilPlaced/hideVisualsUntilPlaced; воспроизводимый shuffleCandidates;
focusActive; leadSec/revealSec/thinkSec/moveSec/holdSec/finalSec/rowFocusSec.
Слепой рейтинг строится из раундов с одной карточкой и lockOnPlace.
При answerReveal:end сначала показываются все задания, потом — заданные действия.
После прохода по слотам финал снова показывает всю доску.

Активный кандидат играет `participant.media.audio` либо звук своего видео;
даже при together аудио кандидатов идёт последовательно. Явное `card.playSound:false`
выключает прослушивание. `card.loop`, volume, offsetSec и bestMomentSec учитываются.
Общая музыка использует стандартное приглушение под primary/voice.

AudioCue.anchor понимает board.reveal/place/move/replace/swap/remove/lock/unlock/summary
с фильтрами sceneId/roundId/cardId/participantId/slotId/actionId. События и состояние
есть также в CompiledScene.boardEvents/boardState. Время события — локальное сцене;
при объединении сегментов компилятор переводит звук в абсолютные кадры.

## Пресеты и правки

Личный пресет сохраняет дизайн/правила/подачу; rounds всегда пуст. Skeleton берётся
из board-раундов, `skeleton.boards` хранит числа для каждой board-сцены отдельно.
Канонические слоты уникальны во всём пресете; картинки/звуки заменены абстрактными
slot:boardimage:N / slot:boardsound:N. Авторские решения, реальные медиа и участники
в пресет не попадают. Apply сохраняет ID появлений/действий, назначения и медиа
существующего проекта при совместимой структуре, иначе PRESET_INCOMPATIBLE.

Patch target: boardSlot, boardRound, boardCard, boardAction. Например, сменить
категорию конкретного действия: target boardAction + path ["slotId"].
Добавление/перестройка коллекций — валидированная замена документа.

Это линейный SDK-ролик. Сейчас нет кликов зрителя, игровых сессий и редактора досок.
Рендер и публикация используют существующие jobs, snapshots, Player, MP4 и offline-HTML.
