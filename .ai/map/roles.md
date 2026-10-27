# Роли, права, квоты, кабинет и админка

В Douga три роли: гость, пользователь и администратор. Пользователь собирает топы и пикеры в пределах квот, финальный MP4 рендерит только админ. В личном кабинете видно занятое место и можно удалять свои файлы, в админке меняют роли и удаляют аккаунты.

## Где код
- [`src/lib/domain/permissions.ts`](../../src/lib/domain/permissions.ts) — матрица `ROLES` (права и квоты), функции `can`, `quotasFor`, `canCreateTournament`, `fitsPoolQuota`, список `ASSIGNABLE_ROLES`. Это единственное место, где сравниваются имена ролей.
- [`src/auth.ts`](../../src/auth.ts) — Auth.js v5 с Credentials (email и пароль через bcrypt). JWT хранит только `id`, а `requireUser` и `currentUser` читают `{id, email, role}` из БД.
- [`src/app/login/actions.ts`](../../src/app/login/actions.ts) — `loginAction` и `registerAction`: регистрация открытая, пароль от 6 символов, новый аккаунт получает роль `user`.
- [`src/server/roles.ts`](../../src/server/roles.ts) — `adminEmails()` и `ensureAdminRole()`, бутстрап админа из `ADMIN_EMAILS`.
- [`src/lib/api.ts`](../../src/lib/api.ts) — `userOr401`, `permissionOr403(perm, msg)` и готовые ответы 403/413/404.
- [`src/server/users.ts`](../../src/server/users.ts):
  - кабинет: `usageSummary` (агрегаты плюс бэкфилл размеров), `listArchiveRows`, `listRenderRows` (с курсором), `deleteRenderJob`;
  - админка: `listUsers`, `setUserRole`, `deleteUser`.
- [`src/app/account/`](../../src/app/account/) — страница `/account`. `AccountManager` показывает квоты и сводки, списки грузит по запросу; пул выводится через `useMediaPool` и `MediaBrowser`.
- [`src/app/api/account/`](../../src/app/api/account/) — `GET usage`, `GET archives`, `GET renders?cursor&limit`.
- [`src/app/admin/`](../../src/app/admin/) — страница `/admin`, компонент `AdminUsers`: таблица пользователей, выбор роли, удаление.
- [`src/app/api/admin/users/`](../../src/app/api/admin/users/) — `GET` списка, `PATCH` и `DELETE` для `[id]`, всё под правом `admin:users`.
- [`src/mcp/actor.ts`](../../src/mcp/actor.ts) — актор MCP. Свежую роль на каждый вызов берёт `actor()` из [`src/server/studio/shared.ts`](../../src/server/studio/shared.ts).
- [`src/lib/studio-protection.ts`](../../src/lib/studio-protection.ts) — ответ 409 с объяснением для `JOB_IN_USE` и других защит студии.

## Данные
- `User.role` — строка, по умолчанию `"user"` ([schema](../../prisma/schema.prisma)). Роли `guest` в БД нет: это виртуальная роль для запроса без сессии, ей же считается любая неизвестная строка.
- Размеры для квот берутся из `Track.sizeBytes`, `Art.sizeBytes`, `RenderJob.outputBytes` и `StudioJob.outputBytes`.

## Как устроено
- Права: `tournament:create`, `media:upload`, `render:run`, `admin:users`. Квоты по ролям:

| Роль | Права | Турниров одновременно | Архив | Пул медиа |
|---|---|---|---|---|
| guest | нет | 0 | 0 | 0 |
| user | `tournament:create`, `media:upload` | 1 | 100 МБ | 100 МБ |
| admin | все четыре | без лимита | 10 ГБ | без лимита |

- Роль читается из БД на каждом запросе (`requireUser`), поэтому смена роли в админке действует без перелогина. Если аккаунт удалили при живой сессии, его запросы получают 401.
- Бутстрап админа: при входе (`authorize`) и при регистрации `ensureAdminRole` повышает до `admin` email из `ADMIN_EMAILS`. Список задаётся через запятую, регистр не важен. Функция только повышает роль, и повышение переживает пересоздание базы.
- Как проверяются квоты:
  - число турниров считается внутри транзакции создания; превышение даёт `TOURNAMENT_LIMIT` и ответ 403;
  - размер архива проверяется дважды, по `Content-Length` и по фактическому телу; превышение — 413;
  - пул — это сумма `Art.sizeBytes` против `maxPoolBytes`. Квота проверяется во всех путях импорта: загрузка файла, ссылка, Shikimori, yt-dlp, файлы с диска, импорт студии.
- `VideoProject` создаётся с правом `tournament:create`, лимита на число проектов нет, ограничивает только пул.
- Рендер:
  - `POST /api/tournaments/[id]/render` и `/api/projects/[id]/render` требуют `render:run`, иначе 403 «Рендер доступен только администратору»;
  - в студии `jobActor` требует `render:run` для `kind: "render"` при постановке задания и ещё раз, когда воркер его берёт;
  - превью still/clip/audio доступны любому автору: не больше 4 активных заданий, а у ролей без `render:run` все результаты вместе не больше 512 MiB.
- Страницы:
  - гость на `/` видит приветственный экран, пользователя с сессией `/` перенаправляет на `/tournaments`;
  - остальные страницы без сессии перенаправляют на `/` (студия — на `/login`), API отвечает 401;
  - `/admin` без права отдаёт 404, а не 403.
- Кабинет:
  - `usageSummary` считает всё агрегатами (`groupBy`, `aggregate`), а списки загружаются только по «Показать все»;
  - при каждом заходе `backfillSizes` дописывает `sizeBytes` и `outputBytes` в старые строки;
  - API отдаёт ещё и сводку `studio`, но интерфейс её не показывает.
- Админка:
  - менять роль или удалять самого себя нельзя: `SELF_CHANGE` даёт 403;
  - `deleteUser` сначала в транзакции удаляет строки БД, потом файлы: `tournaments/<id>`, рендеры, `arts/<userId>`, `studio/<userId>`, `studio-jobs/<userId>`.
- MCP: при старте `resolveActor()` ищет `User` по `MCP_ACTOR_EMAIL` с точным совпадением. Пароль не нужен, email должен совпадать с веб-аккаунтом. Каждый вызов заново читает роль по id и требует `media:upload`, подробнее в [mcp.md](mcp.md).

## Грабли
- Новые проверки пиши только через `can()`, `quotasFor()` и `permissionOr403()`, имя роли напрямую не сравнивай. Новая роль добавляется одной записью в `ROLES`.
- `ADMIN_EMAILS` срабатывает только при входе и регистрации. Добавленный email при живой сессии станет админом только после перелогина. Если такого админа понизить в админке, при следующем входе он снова станет админом.
- Регистрация не приводит email к нижнему регистру, а вход и `resolveActor` ищут точное совпадение. `User@x` и `user@x` — это разные аккаунты.
- `deleteUser` отказывает с `JOB_IN_USE` (409), если у аккаунта есть хоть одно SDK-задание в любом статусе.
- Спека 05 и комментарий в `src/app/api/tournaments/route.ts` называют лимит архива админа 2 ГБ, а в матрице 10 ГБ. Верь коду.
- `RenderJob` общий для турниров и проектов, поэтому фильтр владения прежних рендеров пишется как `OR: [{tournament:{userId}}, {project:{userId}}]`.
- Смена роли не трогает уже загруженные файлы. Новые загрузки блокируются, пока занятое место не станет меньше лимита или равно ему.

## Как проверить
- Тесты: `npx vitest run src/lib/domain/permissions.test.ts src/integration/roles.integration.test.ts src/integration/account.integration.test.ts src/integration/user-backfill.integration.test.ts src/integration/mcp-actor.integration.test.ts`.
- Свежую роль в студии проверяют интеграционные тесты `studio-http`, `studio-jobs`, `studio-imports` и `studio-projects`.
- Вживую:
  - гость видит приветствие на `/`, а API отвечает ему 401;
  - у пользователя нет кнопки рендера, а квоты видны на `/account`;
  - админ открывает `/admin`, и смена роли действует без перелогина. Подробнее в [verify-скилле](../../.claude/skills/verify/SKILL.md).

## История
- [спека 05](../specs/05-roles-cabinet.md) — роли, матрица прав, лимиты, кабинет и админка.
- [спека 10](../specs/10-mcp-server.md) — актор MCP через `MCP_ACTOR_EMAIL`.
- [спека 17](../specs/17-media-library.md) — кабинет на агрегатах, `RenderJob.outputBytes`, ленивые списки.
- [спека 24](../specs/24-ai-video-job-contract.md) — `render:run` для финального рендера студии и повторная проверка в воркере.
