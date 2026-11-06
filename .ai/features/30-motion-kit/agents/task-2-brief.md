# Task 2: Покадровый рендерер

**Файлы:** новые `src/remotion/motion-frame.ts`, `MotionBackdrop.tsx`,
`MotionWidgets.tsx`, `MotionText.tsx`, `motion-frame.test.ts`; изменения
`studio-frame.ts`, `StudioVideo.tsx`, при необходимости watch/offline helpers.

**Interfaces:** consumes IR из Task 1; produces evaluateMotion/transition helpers
и тот же StudioVideo/StudioSceneFrame для всех поверхностей. Старый transitionAt
сохраняется для none/fade/slide. Никакой логики разрешения событий в React.

- [ ] RED: каждый эффект имеет ожидаемые начало/середину/конец; повторный seek
  даёт то же состояние; opacity/scale ограничены, нет NaN/Infinity.
- [ ] RED: новые transition outgoing/incoming закрывают кадр; первая сцена,
  короткие окна, направления, сегментная граница; старые переходы неизменны.
- [ ] RED: ring/segments/bar используют frame/fps, круг остаётся круглым;
  текстовые эффекты сохраняют текст/пробелы, число заканчивается заданным значением.
- [ ] Реализовать все 40 эффектов, композицию с keyframes, маски/3D/blur/glow,
  текст, пять фонов, все виджеты и настоящие переходы соседних сцен.
- [ ] GREEN: `npx vitest run src/remotion/motion-frame.test.ts
  src/remotion/studio-frame.test.ts src/remotion/studio-player.test.ts src/video/motion.test.ts`.
- [ ] Коммит `feat(render): render motion effects transitions and widgets`.
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

## Уточнение интеграции resolved media

Task1 хранит фоновые media в scene.backdrop.layers[].media. Обеспечь их
участие в public/worker/offline pipeline, иначе настоящие MP4 и HTML сломаются.
Нужны изменения src/server/studio/render.ts rewrite, src/watch/model.ts
rewritePlanMedia/upcomingMedia, src/watch/offline.ts mediaSlices/posterHashes/
applySlices/offlineMediaUnresolved. Можно вынести общий browser-safe обход
в src/video/compiled-media.ts и экспортировать из index.ts. Не дублируй один
и тот же обход в пяти местах. Тесты RED→GREEN на backdrop-only image/video
без scene.nodes.media, переписывание hash/poster, slice offsets и unresolved
проверку. Длительность usage фонового слоя = to-from, включая уже продлённое
компилятором окно предыдущего слоя на crossfade; offline slices должны покрыть
все реально показываемые кадры. Не путать crossfade фона с удержанием outgoing
кадра настоящего межсценового перехода.

Progress from scene-local: scope video = -scene.from, durationInFrames =
финальная длина всего видео, renderer считает (frame-from)/duration.

Нужны все 40 эффектов с различимым визуальным характером, а не алиасы
одного transform; читабельные маленькие файлы. Галерея Task3 будет использовать
тот же renderer. Никаких wall-clock, CSS animations, Math.random.
