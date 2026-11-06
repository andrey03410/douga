# FR-03: frozen продолжение раскадровки

Исправлена пагинация: `storyboardSchema` принимает `sourceJobId`. Такой запрос
читает owned same-project storyboard input, проверяет canonical frozen hash,
origin document/content hashes, сохранённые media/poster bytes и frozen fonts.
Он использует исходные plan, media, fonts, origin и **engineId**. Live draft и
новая история не разрешаются повторно. Clip/audio job не может быть корнем листа.

Новые страницы копируют полный frozen root и fonts/licenses в собственный job
inputs; это полный исходный план со всеми сценами. Продолжение от страницы 1
работает даже после удаления страницы 0 и её каталога. `compare` сохраняет обе
старые стороны и compareOrigin. Pinned enqueue пропускает CAS сравнение с текущей
версией проекта; project/actor/source-job ownership проверяются заново.
Невалидный/изменённый live draft не мешает чтению закреплённых страниц.
Если переданы expectedVersion/revision, они должны совпадать с **pinned origin**.

## Контракт для MCP/UI

```ts
// Новый live просмотр, прежний контракт:
{ projectId, expectedVersion, page: 0, pageSize: 12 }

// Продолжение того же frozen просмотра, даже после изменения проекта/медиа:
{ projectId, sourceJobId: previousPageJobId, page: 1, pageSize: 12,
  mode: "overview" } // sceneId/segmentId сохраняются при наличии

// Продолжение compare без новых compare selectors:
{ projectId, sourceJobId: comparePageJobId, page: 1, pageSize: 12,
  mode: "compare" }
```

`sourceJobId` нельзя смешивать с compareRevision/compareJobId: обе стороны уже
закреплены исходным job. Если mode/sceneId/segmentId/pageSize не переданы,
используется сохранённый `inspection.scope`. `sourceJobId` доступен и до рендера,
поскольку frozen input закрепляется при enqueue.

`InspectionSummary.scope?: {mode,sceneId?,segmentId?,pageSize}` сохраняет отбор.
`jobView` у **done storyboard** с оставшимися страницами возвращает:

```ts
nextPageAction: {
  tool: "video_storyboard",
  arguments: {
    projectId, sourceJobId: row.id, page: selection.page + 1,
    pageSize: scope.pageSize, mode: scope.mode, sceneId?, segmentId?
  }
}
```

Последняя страница не содержит nextPageAction. Готовая команда не передаёт
текущий expectedVersion, который мог измениться. MCP/HTTP адаптеры передают
projectId отдельным аргументом сервису, как и раньше.

Отказы: NOT_FOUND для отсутствующего/чужого job/project;
INSPECTION_SOURCE_NOT_FOUND для wrong-project/non-storyboard/non-inspection;
VERSION_CONFLICT для mismatched pinned expectedVersion/revision;
SNAPSHOT_HASH_MISMATCH для повреждённого frozen payload/media/font.

## RED → GREEN и ограничения

Новый `storyboard-continuation.integration.test.ts`: исходный **RED 5/5**
(sourceJobId отсутствует в схеме, ready page action отсутствует), затем **GREEN 5/5**.
Настоящие DB/media операции проверяют:

- track cover A→B при неизменном project.version; page1 сохраняет A, origin,
  полный план и исходный engine, хотя preparation engine уже изменился;
- копии inputs/fonts принадлежат новому job; page2 работает после удаления
  исходного job0/files, наследует pageSize и не предлагает следующую страницу;
- после invalid draft и увеличения версии continuation продолжает старый origin,
  старый expectedVersion разрешён, новый expectedVersion/revision отклоняются;
- scene+segment filters/pageSize присутствуют в готовом nextPageAction;
- compare pages сохраняют обе media hash/origin после порчи live JSON;
- foreign/deleted/wrong-project/plain job, canonical corruption, media и frozen
  font byte corruption дают явные отказы.

Полные project/revision строки и snapshot count до/после pinned чтения совпадают.
Renderer engine замокан; done status для DTO задан fixture, новые изображения
этим тестом не рендерились и такой успех не заявляется.

Последний targeted прогон:

```sh
npx vitest run src/integration/storyboard-continuation.integration.test.ts src/integration/storyboard-history.integration.test.ts src/integration/storyboard.integration.test.ts
```

**16/16 PASS, 3 файла, 2.81 с.** Логи:
`storage/verification/32-storyboard/continuation-{red,green}.log`.
Типы новых файлов чисты; общий tsc пока видит параллельные unfinished
review.test.ts mode literal и storyboard-diff.test.ts implicit-any. Это передано
координатору; global tests/build/baselines этим заданием не запускались.
