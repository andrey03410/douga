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

## Уточнения интеграции и проверки

- Catalog key — category + name: flash существует как effect и transition.
  Gallery options должны различать их; MCP get с category возвращает нужную запись.
  Если get без category неоднозначен, верни понятную ошибку выбора категории,
  а не молча другой эффект. Для уникальных имён короткого name достаточно.
- Галерея должна держать один настоящий Player для выбранного примера, а не
  одновременно 67 проигрывателей. Нужны профили и сила, категории/выбор имени,
  описание, список параметров и копирование соответствующего JSON.
- Дай wrapper `data-motion-gallery` и область Player `data-motion-preview` для
  воспроизводимой разовой живой проверки; controls должны иметь обычные label.
- Полные примеры `video_examples` должны быть canonical schema-valid и compile
  ready с явно описанным stand-in manifest; не выдавать фрагмент за целый документ.
  UI-копирование может отдавать подписанный фрагмент settings/node/transition.
- Данные превью локальные синтетические, никаких owner assets или сети;
  один и тот же compiler/renderer. Новые route/CSS файлы допустимы по надобности.
- Не запускать полный npm test до каждой промежуточной задачи: root выполняет
  итоговую тройку после интеграции. Нужен свежий targeted набор + tsc.

В preview виджетов покажи доступные варианты: timer ring/segments/bar,
VS clean/neon/slash/impact. Можно одним short demo или selector, без многих
одновременных Players. Каталог/схема должны позволять агенту узнать их имена.
