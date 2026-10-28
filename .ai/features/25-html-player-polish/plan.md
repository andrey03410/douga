# План

Каждая задача: сначала красный тест, потом код и коммит. Решения — в [tech.md](tech.md).

- [x] **1. Модель плеера** (T03, T05, T06, T02).
  - Файлы: `src/watch/model.ts`, `src/watch/offline.ts`, тесты рядом.
  - Тесты:
    - `keyAction` по `code`, модификаторы, повтор, стрелки на полосе;
    - `sharedAudioTagCount` = `max(5, 2 × пик)`;
    - `coverFrame`;
    - `upcomingMedia`;
    - `formatClock` вниз;
    - роли нарезки: звук из видео — `audio` и `.m4a`, видеоузел — `visual`.
  - Готово: юниты зелёные, `offline.ts` не тянет клиентский код.
- [x] **2. Звук в Player** (T01).
  - Файлы: `src/remotion/studio-frame.ts`, `StudioVideo.tsx`, тест `studio-frame.test.ts`.
  - Готово: у `<Audio>` допуск 0,15 с, у видео прежние 2 кадра.
- [x] **3. Плеер** (T03–T06).
  - Файлы: `src/watch/WatchPlayer.tsx`, `standalone.tsx`, `src/app/watch/[token]/page.tsx`,
    `globals.css`.
  - Готово:
    - живой прогон `ui-check.mjs` без дефектов из «Исходной системы»;
    - `probe.mjs` даёт 0 перемоток звука на сайте.
- [x] **4. Нарезка и файл** (T07–T09, T12).
  - Файлы: `export-slice.ts`, `export-html.ts`, `prisma/schema.prisma`, шрифты,
    `studio-export.integration.test.ts`.
  - Тесты:
    - видео со звуком как реплика даёт звук в файле;
    - повторная оценка после нового сохранения не режет заново;
    - чужие строки проекта подчищаются;
    - пропавший файл кэша режется заново;
    - `$` в названии;
    - ссылка в тексте.
  - Готово: файл играет с диска, звук декодируется.
- [x] **5. Публикация и HTTP** (T10).
  - Файлы: `middleware.ts`, `chrome.ts`, `publication.ts`, `watch-public.ts`, `http.ts`,
    `http-media.ts`, `/api/account/publications`.
  - Тесты:
    - две одновременные публикации;
    - `expectedVersion` при снятии;
    - кривой JSON;
    - `ETag` и `immutable`;
    - matcher.
- [x] **6. Студия и кабинет** (T11).
  - Файлы: `StudioWorkspace.tsx`, `AccountManager.tsx`.
  - Готово: живая проверка в браузере.
- [x] **7. Общий демо-ролик** (T13). Проект, MP4 после правки звука, публикация,
  `.html`. Приёмка:
  - ссылка на сайте;
  - файл с диска без сети;
  - кадры против MP4;
  - звук.
- [ ] **8. QG и ревью.** Тройка, свежий ревьюер на дифф ветки, повторная тройка.
- [ ] **9. Знания.** Карточки `studio-sdk`, `render`, `roles`, `dev-env`; строка в `.ai/history.md`.
