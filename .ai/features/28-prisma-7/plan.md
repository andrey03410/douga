# План

## Задачи

- [x] **1. Пакеты, генератор, конфиг.** Файлы: `package.json` (точные 7.10.1, адаптер, `postinstall`,
  `db:push`, без `@auth/prisma-adapter`), `prisma/schema.prisma` (`prisma-client`, `output`,
  `importFileExtension`, без `url`), `prisma.config.ts`, `src/lib/database-url.ts`, `.gitignore`.
  Тест: `database-url.test.ts` — относительный путь от `prisma/`, абсолютный без изменений, умолчание.
  Готово, когда: `npm install` генерирует клиент в `src/generated/prisma`, `prisma db push` на копии
  говорит «already in sync».
- [x] **2. Клиент и импорты.** Файлы: `src/lib/db.ts` (`createPrismaClient`), `src/lib/sqlite-adapter.ts`,
  шесть серверных файлов, интеграционные тесты, `prisma-client.test.ts`. Тесты: `db.integration.test.ts` —
  даты целыми миллисекундами, внешняя запись переживает откат чужой транзакции (сначала красный).
- [x] **3. Аудит транзакций.** Найти запросы через общий `prisma` внутри `$transaction` и длинную
  файловую работу в транзакциях; исправить найденное.
- [x] **4. Скрипты.** `scripts/e2e-setup.mjs`, `scripts/clean-test-data.mjs` (вместо `.cjs`).
  Готово, когда: `node scripts/e2e-setup.mjs` создаёт пользователя в копии базы.
- [x] **5. Знания.** `dev-env.md` (клиент, адрес базы, генерация, грабли), строка стека в `AGENTS.md`,
  первый запуск в `README.md`, скилл `verify`.

## Живые проверки

- Тройка `npm test` → `npm run build` → `npx tsc --noEmit` в ворктри (копия базы).
- `npm audit --omit=dev`.
- Сайт ветки на свободном порту: вход, список турниров и кабинет читают копию базы.
- Настоящий MCP через stdio-драйвер: список турниров, проект студии, задание в воркере
  (`studio:worker --once --job`), состояние аренды воркера.
- Даты новых строк в копии базы — целые числа.
