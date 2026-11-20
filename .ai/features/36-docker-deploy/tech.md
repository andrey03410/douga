# Технические решения

Next.js, Prisma SQLite и HTML-экспорт с esbuild при первом запросе. Регистрация открытая.

- **T01. Упаковка.** Docker-образ на Debian с Node нужной версии. Сборка в GitHub, данные в постоянном каталоге VPS. Поставляет Next.js, источники HTML-плеера и FFmpeg. Caddy ограничивает публичный доступ к студии.
- **T02. Адрес.** Один технический хост и HTTPS-порт `8444` для сервиса. Caddy проксирует во внутреннюю сеть Compose.
- **T03. Выпуск.** Actions публикует образ с тегом SHA. Ручной запуск проверяет конфигурацию и вызывает скрипт VPS по ограниченному SSH-ключу. Автоматический запуск после merge включается переменной репозитория.
- **T04. Состояние.** Схемы SQLite обновляются с резервной копией базы. Записываем активный SHA и результат HTTP-проверки. Файлы среды и ключи остаются вне Git и слоёв образа.

[Docker Compose в продакшене](https://docs.docker.com/compose/how-tos/production/) · [Caddy и порты](https://caddyserver.com/docs/caddyfile/concepts) · [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
