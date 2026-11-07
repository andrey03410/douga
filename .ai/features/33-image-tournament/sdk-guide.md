# Маршрут агента: база турнира картинок → топ → ролик

Всё выполняется от имени `MCP_ACTOR_EMAIL`. Места определяет только человек на сайте.
Агент собирает базу и потом ролик, но не отвечает на экраны, не выбирает алгоритм
без прямой просьбы и не трогает готовый топ без согласия человека.

## 1. Собрать базу по профилю Shikimori

Пример запроса: «главные женские персонажи Madhouse, которых я смотрел».

1. `shikimori_find_user({user})`, затем `shikimori_user_anime_list({user, status:"all", limit:500})`.
   «Смотрел» — это `completed`, `watching`, `rewatching`. `on_hold` и `dropped` берутся,
   только если человек попросил, `planned` не берётся никогда. Записи `kind` `music`/`pv`/`cm`
   отбрасываются.
2. Студия: id даёт `shikimori_find_studio({query:"Madhouse"})`, затем у каждого тайтла
   смотрим `shikimori_anime({id}).studios`. `shikimori_studio_animes` отдаёт не больше
   50 тайтлов и для крупной студии неполон: у Madhouse их сотни. Обход идёт с лимитом
   80 запросов в минуту: 319 тайтлов заняли около 4 минут, это не зависание.
3. `shikimori_anime_characters({animeId, role:"Main"})` по каждому тайтлу. Персонажей склеиваем
   по id. `subtitle` — самый ранний просмотренный тайтл с этим персонажем.
4. Пола в Shikimori нет. Его агент определяет сам, основание пишет в `note`, сомнительных
   называет в отчёте.
5. Создание турнира:

```json
{
  "title": "Главные героини Madhouse",
  "segments": [{
    "title": "Главные героини Madhouse",
    "items": [
      {"shikimori": {"type": "character", "id": 702}, "subtitle": "Нана", "note": "главная роль; женский персонаж — оценка агента"},
      {"assetId": "картинка из своего пула"},
      {"path": "/разрешённая/папка/Рика.png", "subtitle": "Higurashi"}
    ]
  }]
}
```

`scheme` не передавайте. Ответ: `{id, url, itemCount, skipped[], schemeRequired:true, estimates}`.
`estimates` — число экранов по восьми алгоритмам для отчёта человеку. Картинки по умолчанию
идут по 4 на экран. Если персонажа не удалось скачать, он попадает в `skipped[]`
(`NO_IMAGE` и подобное), остальные создаются.

Отчёт человеку: сколько участников и из скольких тайтлов, кто пропущен и почему,
сомнительные, ссылка `url`.

## 2. Поправить состав

- `tournament_items_add({id, segmentId?|segmentTitle?, items})` — добавить. Тот же персонаж
  в сегменте отклоняется (`DUPLICATE_ITEM:<имя>`).
- `tournament_items_update({id, items:[{trackId, title?, subtitle?, note?, coverArtId?, excluded?}]})` —
  подписи, картинка из пула, исключение. Сначала проверяется вся пачка: чужая картинка
  отклоняет вызов целиком.
- `tournament_items_remove({id, trackIds, confirmReset})` — удалить насовсем.
- **Готовый сегмент** (топ сохранён). Добавление, исключение и возврат участника отвечают
  `{requiresConfirmation:true, segmentsToReopen}` и ничего не меняют. Покажите это человеку и
  повторите вызов с `confirmReset:true` только после его явного согласия. Подписи меняются
  без вопросов.

## 3. Человек выбирает алгоритм и сравнивает

Агент здесь ничего не делает. На странице турнира человек выбирает алгоритм (для одного
сегмента или для всех), видит оценку экранов и проходит экраны с картинками. Итог фиксирует
кнопка «Сохранить итог».

## 4. Ролик через SDK

1. `video_source_list({})` — турнир виден с `kinds:["image"]` и `needsMusic:true`.
2. `video_project_create({presetId:"top.classic.wide", sourceId, title})`. Участники — картинки
   с `media.visual = source:<id>:cover`, без звука. Подписи берутся из `subtitle` турнира,
   ссылки — из `link`.
3. Музыка обязательна, иначе ролик немой. Положите трек в пул, затем через `video_draft_patch`:

```json
{"operations": [
  {"op": "set", "target": {"type": "document"}, "path": ["bindings", "music"], "value": {"kind": "pool", "assetId": "<artId>"}},
  {"op": "set", "target": {"type": "document"}, "path": ["audio", "playlist"], "value": {"tracks": ["music"], "loop": true, "crossfadeSec": 2}}
]}
```

   Громкость плейлиста по умолчанию 0,35: это примерно −9 дБ к исходнику.
4. Картинки персонажей обычно портретные. `top.classic.wide` по умолчанию режет их под 16:9
   во весь кадр, и лицо может пропасть. Задайте карточке
   `settings.card = {orientation:"portrait", fit:"contain"}` и проверьте кадры через
   `video_storyboard`. Подпись этого пресета лежит поверх картинки, и на светлом постере
   её не видно. Если так вышло, возьмите рецепт с подписью под карточкой или раскладку
   примера `video_examples` `top-images`.
5. `video_project_validate` → `video_draft_commit` → `video_job_start kind:"clip"`. Финальный
   `render` доступен только админу.
