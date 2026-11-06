# Task 2 — scoped re-review, fix round 1

Основание: `f9a44b0..bc4a675`, `task-2-fix-1.diff` (7 src-файлов).
Прочитаны исходный `task-2-review.md` и дополнение Fix round 1 в
`task-2-report.md`. Проверка ограничена закрытием R1–R4 и новыми регрессиями
исправлений; неизменённый проект повторно не обходился.

**Spec: ✅ в пределах fix round 1. Quality: Approved.**
Все четыре замечания **ADDRESSED**. Новых подтверждённых Critical/Important
регрессий в fix-diff не обнаружено.

| Замечание | Статус | Проверка исходного сценария |
|---|---|---|
| R1 / прежнее R2-01: провал покрытия blur | **ADDRESSED** | `src/remotion/motion-transition.ts:68–72`: outgoing остаётся непрозрачным, пока incoming не достигнет opacity=1. Центральное покрытие теперь `p + 1×(1−p)=1`; в конце incoming=1, outgoing=0. Blur-фильтры, длительность и held frame не изменены. |
| R2 / прежнее R2-02: цвета vignette; расширение root на winner badge | **ADDRESSED** | `src/remotion/studio-paint.ts:23–24` применяет alpha через color-mix без hex-суффиксов. `MotionBackdrop.tsx:126` и `MotionWidgets.tsx:188–189` используют helper. Короткий/полный/alpha hex, named и rgb/rgba остаются валидными CSS-цветами; исходная alpha умножается. |
| R3: слишком мелкие generated VS/badge | **ADDRESSED** | `src/remotion/StudioVideo.tsx:229–235` вводит fallback по геометрии только для новых versus/badge; существующие типы сохраняют прежнюю формулу. `:247–269` считает размер по реальному VS и ограничивает ширину одного знака. Explicit fontSize остаётся исходным приоритетным значением с прежней необходимой подгонкой под геометрию. |
| R4: light-orbs игнорирует particles | **ADDRESSED** | `src/remotion/MotionBackdrop.tsx:74–75`: число элементов теперь `min(32,b.particles)`, то есть 0/3/32 дают 0/3/32, внешний 40 ограничивается 32. Формулы позиций и детерминизм не менялись. |

## Проверка новых рисков

Изменение alpha изолировано двумя новыми визуальными элементами; старые
gradient/shadow helpers не менялись. `color-mix` сохраняет цвет и умножает
его alpha на заданную долю; числовые значения .8 и 40/255 соответствуют прежним
cc и 28 для непрозрачного hex. Blur исправляет именно composition alpha, не
маскируя проблему изменением тайминга. Для существующих text/timer/card
обёртка `Math.min(oldFit,Infinity)` математически сохраняет прежний результат.

Отдельно проверен потенциальный побочный эффект увеличенного badge-шрифта:
звезда могла вытеснить текст Winner за границы. Адресный probe
`node --import tsx` → React StudioSceneFrame → настоящий headless Chromium
для rect240×100/style{} дал font48px; диапазон текста расположен на одной
строке внутри badge (x74.875–237.109 при правой границе badge240.813),
scrollHeight=clientHeight=82. Гипотеза об обрезании этого исходного сценария
опровергнута. Probe завершился exit 0; файлов исходников не создавал.

## Evidence и границы

Переданные результаты автора, не собственный повторный запуск: 229/229 tests
в 7 файлах, tsc exit 0, diff-check exit 0; Chromium computed CSS для семи
форматов цвета, blur RGB RED [191,191,191] → GREEN [255,255,255] на среднем
кадре, итоговые font116.4px у VS и 48px у badge. Регрессионные тесты в diff
прочитаны и соответствуют исходным сценариям. Suite по поручению не повторялся.

Собственный адресный browser probe описан выше. SSR-тест Player не выдаётся
за mounted browser seek. Общий MCP MP4, mounted watch/offline, legacy parity
и финальный QG остаются evidence/workflow координатора; этот отчёт утверждает
закрытие Task 2 fix round 1, а не завершение всей задачи.

Дополнительные агенты не запускались по ограничению поручения. Checkout,
индекс, Git и src не изменены; создан только этот отчёт.
