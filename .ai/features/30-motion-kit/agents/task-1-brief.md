# Task 1: SDK, каталог и компилятор

**Файлы:** новые `src/video/motion-types.ts`, `motion-schema.ts`,
`motion-catalog.ts`, `motion-compiler.ts`, `motion.test.ts`; изменения
`types.ts`, `schema.ts`, `compiler.ts`, `nodes.ts`, `settings.ts`, `index.ts`,
при необходимости `resource-limits.ts`, `blocks.ts`, `assets.ts`, `presets.ts`.

**Interfaces:** consumes VideoDocument/CompileContext/CompiledScene;
produces exported MotionName/MotionSpec/MotionSettings/CompiledMotion,
motionCatalog/getMotionCatalogEntry, applySceneMotion, typed widgets/backdrop,
закрытые Zod-схемы. Поля и семантика — T02, точные типы авторитетны после этой задачи.

- [ ] RED: schema отвергает неизвестное имя/CSS, принимает 40 имён и alias flip;
  каталог содержит 10 хореографий, новые переходы, 5 фонов и виджеты.
- [ ] RED: compile без motion идентичен старому; enter/exit ограничены окном,
  cascade forward/reverse/center/rows, null отключает наследование, node overrides.
- [ ] RED: event timer/answer/board разрешается в scene-local frame;
  missing/incompatible event — diagnostic; ручные keyframes не меняются.
- [ ] RED: фон не раскрывает ответ до answer; явный missing asset — error;
  ресурсы/длинный текст/много эффектов ограничены; все fps/форматы конечны.
- [ ] Реализовать типы/схемы/каталог и post-pass компилятора; нормализованные
  optional IR-поля; виджеты и хореографии работают с generated и custom узлами.
- [ ] GREEN: `npx vitest run src/video/motion.test.ts src/video/sdk.test.ts
  src/video/segments.test.ts src/video/board-compiler.test.ts src/video/resource-limits.test.ts`.
- [ ] Коммит `feat(video): add declarative motion kit and choreography compiler`.
- [ ] Свежий task review; исправить существенное, записать точные контракты в execution.md.


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
