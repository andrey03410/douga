# Живая UI-проверка восстановления до исправлений

2026-11-06, PASS. Использован работающий root dev-сервер :3000; новый сервер,
сборка, полная тройка и production edits не запускались. Применён verify workflow
для живой поверхности. Учётные данные прочитаны только из указанного файла
storage, пароли в отчёты/логи не выводились.

Создан один собственный изолированный проект проверочного аккаунта:
`cef7ca49-2ca5-43ed-a21b-55ecf878e688`. Чужие проекты и медиа не изменялись.
Проект оставлен доступным для просмотра доказательств.

## Выполненный маршрут

1. Штатным service созданы custom text label с clean theme и не committed draft
   с явным Rubik52, weight700 и жёлтым fill `#f2c94c`.
2. Создан before storyboard; выполнен только его адресный worker.
3. Puppeteer вошёл через /login, восстановил before job через sessionStorage,
   открыл /studio/:id/storyboard, нажал «Замечания» → «Проверить эту версию».
4. Выбрана реальная `return-label-theme` через checkbox, нажата
   «Применить выбранные (1)». Ответ содержит draftBackupId.
5. Адресно выполнен только созданный этим UI compare job, дождались «Готово» и
   доступной кнопки «Вернуть состояние до исправлений».
6. Нажата кнопка восстановления; UI показал успешное сообщение, убрал кнопку и
   обновил текущий draft. Старый compare честно помечен как относящийся к v6,
   пока текущий документ уже v7.

Чистый итоговый прогон: **v5 → apply v6 → restore v7**, **revision r1 → r1 → r1**.
Exact canonical hashes исходного и восстановленного документа совпадают:
`de2e8bd3e6126b9fbfc6e4f4f33da750498e356ae3d9e635705145194a9f026d`.

В actual DB draft и в HTTP inspection-plan v7 восстановлены:
`Вернуть мой черновик`, font `rubik`, measured fontSize `52`, fill `#f2c94c`.
Fingerprint всех **95 остальных проектов** до/после совпал, включая version,
revision, hashes head/draft и updatedAt. Browser pageErrors: **0**, HTTP≥400: **0**.

## Доказательства

Всё под `storage/verification/32-storyboard/ui-restore/` (ignored):

- `verify.mts` — воспроизводимый service+addressed worker+Puppeteer driver;
- `setup.json`, `after-apply.json`, `result.json`, `journal.json`;
- `restored-plan-http.json` — actual compiled plan восстановленного v7;
- `other-projects-before.json`, `other-projects-after.json`;
- `01-before.png`, `02-selected-fix.png`, `03-after-comparison.png`, `04-restored.png`;
- `worker-049d1ee1-34fa-4a10-a8fb-ba5985005648.json` — before done;
- `worker-c74fe68c-3774-4653-a99b-440452d8dbc6.json` — compare done.

Скриншоты selected-fix, comparison и restored просмотрены глазами: слева
жёлтый Rubik до применения, справа белая theme label после, затем notice об
успешном возврате и правильная маркировка прежнего сравнения.

Первая попытка восстановила документ v2→v3→v4 правильно, но её драйвер ошибся
в ожидании UI: Node-переменная `document` была переименована tsx в `document2`
и попала в сериализованный browser callback. Это ошибка проверочного скрипта;
`failure.json/png` и `observed-restored.png/json` сохранены для честности.
После переименования переменной повторён весь чистый маршрут на том же проекте,
без production changes и без создания дополнительных проектов.
