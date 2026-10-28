# История фаз и фич

Одна строка на фазу. Спеки и планы фаз 1–21 — замороженный архив: они описывают
решение на момент фазы, текущее устройство — в карточках [`map/`](map/). С 22-й
задачи всё лежит в [`features/`](features/) по стадиям.

| № | Дата | Что появилось | Спека | План / приёмка |
|---|------|---------------|-------|----------------|
| 1 | 2026-07-10 | Турнир: загрузка OST, схемы, попарные сравнения, топ, ЛК | [01](specs/01-phase-tournament.md) | [задачи](phases/phase-1-tasks.md) |
| 2 | 2026-07-10 | Рендер видео-топа в Remotion | [02](specs/02-phase-render.md) | [задачи](phases/phase-2-tasks.md) |
| 3 | 2026-07-10 | Менеджер артов, пикер, недеструктивная обрезка 16:9 | [03](specs/03-render-arts-manager.md) | [задачи](phases/phase-3-tasks.md) |
| 4 | 2026-07-10 | Видео-треки, смешанные турниры, видео в пуле, подмена звука | [04](specs/04-video-support.md) | [задачи](phases/phase-4-tasks.md) |
| 5 | 2026-07-10 | Роли и пермишены, кабинет `/account`, админка `/admin` | [05](specs/05-roles-cabinet.md) | [задачи](phases/phase-5-tasks.md) |
| 6 | 2026-07-11 | «Мои видео»: пикер и ручной топ поверх `RenderConfig` | [06](specs/06-video-projects.md) | [задачи](phases/phase-6-tasks.md) |
| 7 | 2026-07-13 | Плейлист пикера, «Старт отсюда», фиксы звука и чёрных кадров | [07](specs/07-polish.md) | [задачи](phases/phase-7-tasks.md) |
| 8 | 2026-07-13 | Импорт по ссылке через yt-dlp, фоновые `DownloadJob` | [08](specs/08-url-import.md) | [задачи](phases/phase-8-tasks.md) |
| 9 | 2026-07-14 | Импорт постеров из Shikimori | [09](specs/09-shikimori-import.md) | [задачи](phases/phase-9-tasks.md) |
| 10 | 2026-07-14 | MCP-сервер: внешний ИИ собирает пикер | [10](specs/10-mcp-server.md) | [задачи](phases/phase-10-tasks.md) |
| 11 | 2026-07-16 | Вертикальные плашки, сетка «Ростер», режимы вписывания | [11](specs/11-vertical-tiles.md) | [задачи](phases/phase-11-tasks.md) |
| 12 | 2026-07-30 | Интро и аутро пикера (`TitleCard`) | [12](specs/12-picker-bookends.md) | [задачи](phases/phase-12-tasks.md) |
| 13 | 2026-07-30 | Списки и избранное пользователя Shikimori в MCP | [13](specs/13-shikimori-user-lists.md) | [задачи](phases/phase-13-tasks.md) |
| 14 | 2026-07-30 | Лимиты Shikimori 5/сек и 90/мин, полноразмерные постеры | [14](specs/14-shikimori-robustness.md) | [задачи](phases/phase-14-tasks.md) |
| 15 | 2026-07-31 | Оформление проекта из MCP, импорт медиа с диска | [15](specs/15-mcp-local-media.md) | [задачи](phases/phase-15-tasks.md) |
| 16 | 2026-07-31 | Групповое сравнение в пикере (блок против блока) | [16](specs/16-group-comparison.md) | [задачи](phases/phase-16-tasks.md) |
| 17 | 2026-07-31 | Библиотека медиа: ссылки, буфер обмена, массовое удаление | [17](specs/17-media-library.md) | [задачи](phases/phase-17-tasks.md) |
| 18 | 2026-08-01 | Множественные сравнения в турнире (группы 2–7) | [18](specs/18-group-ranking.md) | [задачи](phases/phase-18-tasks.md) |
| 19 | 2026-09-04 | Ручные топы через MCP, расширенные профили Shikimori | [19](specs/19-mcp-manual-top.md) | — |
| 20 | 2026-10-26 | AI Video SDK: JSON-документ, студия, очередь, MCP `video_*` | [продукт](specs/20-ai-video-product.md) · [техника](specs/21-ai-video-technical-discussion.md) · контракты [22](specs/22-ai-video-sdk-contract.md) [23](specs/23-ai-video-service-contract.md) [24](specs/24-ai-video-job-contract.md) [25](specs/25-ai-video-http-contract.md) | [план](phases/phase-20-ai-video-sdk-plan.md) · [решения](phases/phase-20-implementation-decisions.md) · [приёмка](phases/phase-20-verification.md) |
| 21 | 2026-10-27 | Три демо SDK, `CardStyle.gradient`/`shadow` | [26](specs/26-sdk-visual-demos.md) | [план](phases/phase-21-sdk-demos-plan.md) · [приёмка](phases/phase-21-verification.md) |
| 22 | 2026-10-27 | Переименование в Douga, карта знаний, стадии задач, скиллы | [фича 22](features/22-douga/README.md) | там же |
| 23 | 2026-10-27 | Хвосты: SSRF в yt-dlp, восстановление рендеров, роли и email, чистка; автономный режим стадий | [фича 23](features/23-followups/README.md) | там же |
| 24 | 2026-10-28 | HTML-плеер студии: ссылка `/watch` и один офлайн-файл, MP4 остаётся | [фича 24](features/24-html-player/README.md) | там же |
