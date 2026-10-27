# Классические видеопроекты (ручной топ и пикер)

Прежние «Мои видео» Douga, появившиеся до студии SDK. `VideoProject` бывает двух видов: `kind: "top"` (ручной топ без турнира поверх общего `RenderConfig`) и `kind: "picker"` (раунды «выбери персонажа/OST»). Топ из турнира использует тот же `RenderConfig`/`TopVideo`, но принадлежит `Tournament`. В студию ничего не мигрирует, новые эффекты делаются в SDK ([studio-sdk.md](studio-sdk.md)).

## Где код
- [`src/server/projects.ts`](../../src/server/projects.ts) — сервис: CRUD проекта, раунды, режим `single`/`groups`, блоки, плитки, плейлист, позиции ручного топа. Здесь же все лимиты (`LIMITS`, импорт `MAX_*`)
- [`src/server/manual-top.ts`](../../src/server/manual-top.ts) — `setTopItems`: атомарная замена всего ручного топа. Вызывает только MCP `set_top_items`
- [`src/server/render-items.ts`](../../src/server/render-items.ts) — `patchRenderItem`: арт позиции, кроп, `audioSource`, `mediaStartSec`, сброс RMS-кэша. Общий для турнира и ручного топа
- [`src/server/render-config-dto.ts`](../../src/server/render-config-dto.ts) — DTO конфига для `RenderConstructor` (одна форма для обоих топов)
- [`src/server/picker-render.ts`](../../src/server/picker-render.ts) — `buildPickerPreviewPlan`, `bookends`, `invalidRounds`, рендер пикера
- [`src/lib/domain/video-plan.ts`](../../src/lib/domain/video-plan.ts), [`picker-plan.ts`](../../src/lib/domain/picker-plan.ts) — чистые таймлайны топа и пикера; одни и те же для Player и рендера. В `picker-plan.ts` живёт `roundIsRenderable` — единое правило пригодности раунда
- [`src/lib/domain/picker-layout.ts`](../../src/lib/domain/picker-layout.ts) — `pickerLayout` (2–9 плиток, «Ростер» 2:3), `groupLayout`, `effectiveOrientation`
- [`src/lib/domain/position-media.ts`](../../src/lib/domain/position-media.ts) — что показывает и чем звучит позиция, `resolveFootage` (луп короткого видео); [`art-crop.ts`](../../src/lib/domain/art-crop.ts) — кроп и `fitMode`
- Композиции: [`TopVideo.tsx`](../../src/remotion/TopVideo.tsx), [`PickerVideo.tsx`](../../src/remotion/PickerVideo.tsx) (таймер-кольцо, VS, подсветка ответа, плейлист), [`TitleCard.tsx`](../../src/remotion/TitleCard.tsx) (интро/аутро обоих)
- UI: [`src/app/projects/page.tsx`](../../src/app/projects/page.tsx) («Мои видео»: сверху SDK-проекты, ниже «Ранее созданные проекты»), [`[id]/page.tsx`](../../src/app/projects/[id]/page.tsx), [`PickerConstructor.tsx`](../../src/app/projects/[id]/PickerConstructor.tsx). Ручной топ рисует [`RenderConstructor.tsx`](../../src/app/tournaments/[id]/render/RenderConstructor.tsx) с `baseUrl=/api/projects/<id>`
- API: [`api/projects/`](../../src/app/api/projects/) (`[id]` GET отдаёт и `previewPlan`; `items`, `playlist`, `rounds`, `render`, `render/config`), [`api/rounds/[id]/`](../../src/app/api/rounds/[id]/) (`PATCH {mode}`, `tiles`, `groups`), [`api/groups/[id]/`](../../src/app/api/groups/[id]/), [`api/tiles/[id]/`](../../src/app/api/tiles/[id]/) (`group` — перенос в блок), [`api/render-items/[id]`](../../src/app/api/render-items/[id]/route.ts)
- MCP поверх тех же сервисов: [`src/mcp/server.ts`](../../src/mcp/server.ts), сводки `get_project` — [`project-summary.ts`](../../src/mcp/project-summary.ts) (пикер, плановый `durationSec`) и [`top-summary.ts`](../../src/mcp/top-summary.ts) (топ). Подробно — [mcp.md](mcp.md)

## Данные
- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `VideoProject` — `kind`, дефолты пикера `revealSec`=4 / `timerSec`=5 / `hideAfterReveal` / `tickSound`, `bgArtId`, legacy `bgMusicArtId`, `tileOrientation`, `introEnabled/introText/outroEnabled/outroText`
  - `PickerRound` (`mode`, `labelsMode` always/finale/never, null-оверрайды проекта), `PickerGroup` (`label`, `isAnswer`), `PickerTile` (`groupId?`, `fitMode`, `startSec`, `crop*`, `playSound`, `isAnswer`), `PickerPlaylistItem`
  - `RenderConfig` (владелец — `tournamentId` ИЛИ `projectId`), `RenderItem` (звук — `trackId` ИЛИ `audioArtId`), `RenderJob`
- Медиа — `Art` пула (`image`/`video`/`audio`), см. [media.md](media.md)

## Как устроено
- `createProject`: топ получает `RenderConfig` (интро = название, аутро = «Спасибо за просмотр»). Пикер получает один пустой раунд и включённые интро/аутро; дефолт БД — выключены, чтобы старые пикеры не сдвинулись. Формы создания на `/projects` больше нет (`CreateProjectForm.tsx` нигде не подключён): классику создают `POST /api/projects` и MCP.
- Ручной топ: позиция = аудиоисточник из пула (аудио или видео со звуком) + необязательный арт. Дальше как у турнирного топа: `clipMode` `active_snippet`/`manual`/`full`, подпись «N - Title» или `customLabel`, порядок `desc` (N→1) или `asc`.
- Визуал позиции: медиа пула → собственный видеоряд источника → заглушка «#N». Звук — источник или звук прикреплённого видео (`audioSource: "media"`). Немое видео короче сегмента лупится от `mediaStartSec`.
- Раунд пикера: подводка 1.5 с с вопросом (0.5 с без) → по `revealSec` на плитку (в `groups` — на блок, карточки каскадом до 0.15 с) → таймер-кольцо `timerSec` с тиком → подсветка ответа 2.5 с, если ответ отмечен → пауза 0.7 с. Интро/аутро по 3 с, только если есть хоть один показываемый раунд.
- `groups`: 2–3 блока по 1–5 карточек, один размер карточки на раунд. `groupLayout` перебирает разбиения (4 → [4]/[2,2], 5 → [5]/[3,2]); одинаковые блоки разбиваются одинаково. Ответ ставится на блок и необязателен. В блоке звучит только первая карточка с видео и звуком. `setRoundMode` карточки не теряет: режет плитки по 5, обратно сплющивает.
- Звук пикера: плейлист проекта идёт сквозь всё видео, включая титры, с кроссфейдом 1 с и лупом. На раундах со своей `bgMusicArtId` он молчит (`muteWindows`), под звуком плиток приглушается до 0.15 (`duckWindows`). Пустой плейлист = legacy `bgMusicArtId` как один трек.
- Ориентация: дефолт проекта + оверрайд раунда. landscape 16:9 (2|3|2+2|3+2|3+3|4+3|4+4|3+3+3), portrait 2:3 (в ряд до 6, затем 4+3/4+4/5+4). Кадр видео всегда 1920×1080@30. `fitMode`: `cover` учитывает кроп, `fill`/`contain` его игнорируют.

## Грабли
- Лимиты есть только у классики: плиток 2–9, блоков 2–3, карточек в блоке 1–5 (≤ 15), раундов ≤ 50, треков плейлиста ≤ 50, `revealSec`/`timerSec` 1–60, текст титров ≤ 120, позиций `set_top_items` 1–200. В SDK (`src/video`) их не переносить.
- Смена эффективной ориентации (у проекта или раунда) сбрасывает кропы плиток затронутых раундов.
- Пригодность раунда задаёт одно правило `roundIsRenderable` из `picker-plan.ts`: раунду `single` нужно не меньше двух плиток, групповому — не меньше двух блоков, и ни один не пустой. По нему работают превью, проверка `ROUND_TOO_SMALL` при старте рендера, цикл рендера и подсказки конструктора. Превью пропускает ровно те раунды, на которых рендер откажет.
- `invalidRounds` (доменная `unrenderableRounds`) перечисляет раунды с карточками, которые блокируют рендер. Пустые раунды в него не входят: они выпадают молча. Конструктор показывает предупреждение в панели превью и под кнопкой «🎬 Рендерить видео». MCP `get_project` считает `durationSec` по тому же правилу.
- `round.tiles` включает и карточки блоков (`roundId` есть у всех). «Плоские» плитки — `!groupId`.
- `RenderConstructor` лежит в зоне турнира, но обслуживает и ручной топ: правка задевает оба.
- `GET …/render/config` и `get_project` топа запускают RMS-анализ позиций без кэша; первый вызов может идти минуты.
- `RenderConfig.orientation` и `template` в план и рендер не попадают.
- «Группы» пикера (`PickerGroup`, спека 16) — не групповые сравнения турнира (`groupSize`, `group-answer.ts`, спека 18).
- Финальный рендер доступен только при `render:run` (админ). Конвейер и его грабли — [render.md](render.md).

## Как проверить
- Юниты: `npx vitest run src/lib/domain/picker-plan.test.ts src/lib/domain/picker-layout.test.ts src/lib/domain/group-layout.test.ts src/lib/domain/video-plan.test.ts src/lib/domain/position-media.test.ts src/lib/domain/art-crop.test.ts src/lib/render-assemble.test.ts src/mcp/project-summary.test.ts`
- Интеграция (пишет в `prisma/dev.db`, ту же базу, что у dev-сайта): `npx vitest run src/integration/projects.integration.test.ts src/integration/video.integration.test.ts src/integration/mcp-top.integration.test.ts src/integration/mcp-compose.integration.test.ts`
- Живая проверка: `/projects/<id>` — Player конструктора играет тот же план, что уйдёт в рендер. MCP `get_project` отдаёт плановый `durationSec` пикера. Рендер, кадры и звук — по [render.md](render.md).

## История
- [спека 02](../specs/02-phase-render.md) — конструктор топа, `RenderConfig`/`RenderItem`, подпись, интро/аутро
- [спека 04](../specs/04-video-support.md) — видео в позициях: подмена звука, оверлей, луп
- [спека 06](../specs/06-video-projects.md) — `VideoProject`, пикер и ручной топ
- [спека 07](../specs/07-polish.md) — плейлист с кроссфейдом, «Старт отсюда» на позициях и видео-плитках
- [спека 11](../specs/11-vertical-tiles.md) — portrait 2:3, «Ростер», `fitMode`
- [спека 12](../specs/12-picker-bookends.md) — интро и аутро пикера
- [спека 16](../specs/16-group-comparison.md) — раунды `groups`, VS, ответ на блоке
- [спека 19](../specs/19-mcp-manual-top.md) — MCP `create_top_project` и `set_top_items`
