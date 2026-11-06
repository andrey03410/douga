# Task 3: MCP и живая галерея

**Файлы:** `src/mcp/studio-tools.ts`, `instructions.ts`, tests;
новые `src/video/motion-examples.ts`, `src/app/studio/motion/page.tsx`,
`MotionGallery.tsx`; `src/server/studio/timeline.ts`; ссылки в UI студии.

**Interfaces:** consumes Task 1 catalog и Task 2 renderer; produces
`video_motion_list`, `video_motion_get`, capabilities metadata, validated examples;
authenticated `/studio/motion` с настоящим Remotion Player и копированием JSON.

- [ ] RED: tools доступны и возвращают bounded summaries/filter/get/error;
  все выдаваемые примеры schema-valid и compile ready; инструкции короткие.
- [ ] RED: timeline включает начала/концы motion anchors и стыки переходов.
- [ ] Реализовать каталог, маршруты, примеры всех категорий и выбор профиля;
  превью использует тот же compiler/renderer, без CSS animation и внешних медиа.
- [ ] GREEN: targeted MCP/timeline/example tests; browser-safe bundle.
- [ ] Коммит `feat(studio): expose motion catalog and live preview gallery`.
- [ ] Свежий task review; исправить существенное.


## Global Constraints

- Без новых полей существующие v1/v2 документы сохраняют прежний IR и поведение.
- Произвольный JS/CSS из JSON запрещён; кадр — чистая функция frame/fps/seed/IR.
- Хореографии не меняют рейтинг, ответ, действия доски, число кадров и аудиоокна.
- Ручные keyframes и перемещение доски сохраняются; motion — отдельный слой.
- Частицы ≤32, визуальные текстовые фрагменты ≤500; развёртка ограничена бюджетами.
- Новые переходы занимают начало входящей сцены и удерживают последний кадр предыдущей.
- В decision-фазе current-card не выбирает будущего победителя.
- Основной checkout; чужие проекты/медиа не меняем; секреты не печатаем.
- Доки и UI по-русски, идентификаторы и conventional commits по-английски.


Продукт: ../product.md; техника: ../tech.md.
