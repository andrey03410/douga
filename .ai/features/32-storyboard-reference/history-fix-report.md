# IR-01: immutable historical inspection

Исправлена историческая ветка `loadInspectionProject` в `storyboard.ts`.
Текущий draft по-прежнему проходит прежний `evaluate` путь. Для явной revision
берутся только сохранённые `documentJson`, `assetsJson`, `planJson`,
`validationJson`: resolvedDocument, manifest, files, fontFiles и runtime остаются
от выбранной ревизии. Повторного разрешения track cover / pool bytes нет.

Проверяются project ownership и pinned `revision:N` references, включая прежний
cover Art, а не нынешний `track.coverArtId`. Сохранённый manifest сопоставляется
с file ledger, проверяются SHA256 медиа/постеров и frozen fonts/licenses штатным
`verifyTypographyFonts`. Отсутствующий plan/assets или error validation дают
VALIDATION_FAILED; повреждённые байты — SNAPSHOT_HASH_MISMATCH. Origin использует
сохранённые media/font hashes, version=null и номер исторической revision.
Исторический путь не вызывает freezeStudioProject, reconcile, commit и не пишет
в проект/source/revisions/snapshots.

## RED → GREEN

Новый `src/integration/storyboard-history.integration.test.ts` создаёт только
свои аккаунты, PNG A (red), PNG B (blue), WAV, завершённый tournament с ranking,
source-backed top project и настоящую сохранённую ревизию с frozen files/fonts.
Затем штатный `updateTrackMetadata({coverArtId:B})` меняет обложку того же трека.
Renderer engine замокан только для enqueue compare; media evaluation, БД,
font measurement, freeze ledger, смена cover и hashing настоящие.

Первый targeted RED: **5/5 failed**. История и compareRevision читали SHA256 B
вместо A; отсутствие plan, ошибочная saved validation, повреждение frozen bytes
и смена ownership старой A не приводили к требуемому отказу.

После исправления **5/5 PASS**:

1. revision остаётся на A, текущий draft разрешается в B; saved plan,
   resolvedDocument, files и fontFiles совпадают с ledger; contentHash различен.
2. compareRevision действительно содержит frozen A на стороне «до» и B на
   текущей стороне. Проверяется сохранённый queue input, а не mock-return.
3. Отсутствующий historical plan и сохранённая error validation явно отклоняются.
4. Повреждение именно frozen media и frozen font проверяется независимо от
   доступности актуальных замен.
5. Чужой project actor и утрата ownership прежнего pinned Art отклоняются.

В первых двух случаях полные строки project/revisions и source
(tournament/tracks/rankings/segments), а также count snapshots до/после совпадают.
Проверочные данные удалены только в пределах уникальных аккаунтов этого теста.

Последняя совместная проверка:

```sh
npx vitest run src/integration/storyboard-history.integration.test.ts src/integration/storyboard.integration.test.ts
```

**10/10 PASS, 2 файла, 2.32 с.** Существующие проверки current invalid draft,
ownership/version, отсутствие side effects и frozen fonts тоже проходят.
`tsc` не обнаружил ошибок в изменённых файлах; параллельный unfinished
`review-backups.test.ts` ещё ожидал тип draftBackupId (передано основному агенту).
Полные tests/build и render baselines не запускались по поручению координатора.
