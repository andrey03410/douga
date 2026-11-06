# IR-04: восстановимое состояние до review_apply

Исправлены только согласованные `projects.ts` (transform/write helper и разрешённая
cleanup-строка delete), optional field `StudioProjectView.draftBackupId`, новый
`review-backups.ts` и его интеграционные тесты. HTTP/MCP/review/UI не менялись.

## Поведение

`transformStudioDraft` включает `preserveBefore:true`. После успешного CAS,
но внутри той же транзакции, сохраняются исходный current draft (или head,
если draft отсутствует), origin и ссылки на материалы. Отказ создания backup,
reference publication, quota или следующий transaction error откатывает draft,
backup и receipt вместе. Отдельная commit/revision не создаётся.

Backup есть и без клиентского idempotencyKey. ID — sha256 от user/project/request;
запись в StudioMutation имеет exact key `review-backup:<id>` и собственный
requestHash, привязанный к полному содержимому. Scope asset refs — тот же ключ.
Сохранённые материалы остаются защищёнными после последующей замены draft.
При replay с ключом возвращаются тот же version и draftBackupId из штатного
mutation receipt. CAS race не публикует второй backup.

`getStudioReviewBackup(userId,projectId,backupId)` возвращает:

```ts
{
  backupId, projectId, version, document, createdAt,
  origin: { projectId, version, revision: number | null, documentHash }
}
```

Reader проверяет owned project, sha64 ID, exact mutation key, project membership,
каноническую схему, hash документа и hash полного payload. Неизвестный, чужой,
неподходящий проекту или повреждённый backup даёт NOT_FOUND.

Optional `StudioProjectView.draftBackupId` — ID before snapshot именно этой
успешной transform mutation, включённый в её ответ и replay receipt. Root
подключает reader к HTTP/MCP и ID к кнопке восстановления; restore может
сохранить backup.document обычным save с текущим expectedVersion.

Ограничение на проект: 128 записей и 16MiB сериализованных backup payloads.
Превышение даёт REVIEW_BACKUP_QUOTA_EXCEEDED с rollback; старые restore points
не вытесняются молча. От пустых повторных исправлений защищает review caller
(IR-03). StudioMutation связан FK только с user, поэтому deleteStudioProject
явно чистит записи по prefix + распарсенному точному projectId; asset refs
удаляются project cascade. Backup других проектов не затрагивается.

## TDD и проверки

- `npx vitest run src/server/studio/review-backups.test.ts` — исходный RED:
  не было draftBackupId, durable before, reference publication и cleanup.
  После реализации GREEN 5. Перед корректным RED fixture исправлен на настоящий
  PNG: несуществующий файл ошибочно останавливал review раньше проверяемого места.
- Отдельный RED→GREEN byte-quota: существующий ledger больше 16MiB при count<128
  должен отказать, сохранив project и restore points.
- `npx vitest run src/server/studio/review-backups.test.ts -t 'permits the last count slot'`
  — RED→GREEN отдельной count ветки: 128-я запись допустима, 129-я отклоняется.
- Последняя проверка:
  `npx vitest run src/server/studio/review-backups.test.ts src/server/studio/content.test.ts`
  — **2 файла, 14 PASS** (7 backup integration + 7 regression content).
- `node_modules/.bin/tsc --noEmit --project storage/storyboard-task32/review-backups-tsconfig.json --pretty false`
  — **EXIT0**, strict root tsconfig + только затронутые файлы/зависимости.

Интеграционные сценарии используют настоящий SQLite, font metrics, PNG и
production reviewStudioVideo/applyStudioReview: uncommitted override → apply
без ключа → исходный document восстановим; чужой actor/проект запрещены; replay;
asset protection; parallel CAS; deletion isolation. Единственный fault mock —
инъекция сбоя setReferences после backup insert внутри настоящей транзакции,
чтобы доказать совместный rollback. Quota fixtures — только ledger строк
своего временного проекта. Весь тестовый аккаунт/проекты/материалы очищаются.

Полная тройка и живая поверхность после интеграции остаются у основного агента.
