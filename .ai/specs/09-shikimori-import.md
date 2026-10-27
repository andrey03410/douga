# Спецификация 09 — Импорт постеров из Shikimori (аниме и персонажи)

Статус: согласовано с владельцем продукта (2026-07-14), реализуется в фазе 9.

## Цель

В менеджере медиа, рядом с импортом по ссылке (yt-dlp), пользователь ищет
аниме или персонажа по названию с живым предпросмотром (мини-постер + имя +
краткие факты), выбирает результат — и постер **синхронно** зачисляется в пул
как обычная картинка (`Art`, `kind=image`), готовая к использованию как визуал
позиции с обрезкой 16:9.

Источник — публичный REST API Shikimori v1. Домен часто мигрирует
(`.one → .io → …`), поэтому базовый URL вынесен в env.

## Согласованные решения

| Вопрос            | Решение                                                             |
|-------------------|---------------------------------------------------------------------|
| Сущности (v1)     | Аниме **и** персонажи (переключатель типа в блоке)                  |
| Источник данных   | REST API v1 Shikimori: `/api/animes?search=`, `/api/characters/search?search=`, постеры `/system/...` |
| Базовый URL       | env `SHIKIMORI_BASE_URL` (дефолт `https://shikimori.io`); смена домена = одна строка в `.env` |
| User-Agent        | env `SHIKIMORI_USER_AGENT` (дефолт `douga`) — этикет API |
| Архитектура       | Все внешние запросы **через наш бэкенд** (CORS, UA, троттлинг, квота на входе); браузер ходит только в `/api/shikimori/*` |
| Превью            | Мини-постер (preview) + имя (ru, иначе en) + факты: аниме — год · тип · ★оценка; персонаж — имя ru/en. Синопсис **не** тянем (экономия запросов) |
| Импорт            | **Синхронный** (постер ~50–100 КБ): бэкенд качает картинку и создаёт `Art` за один запрос; очередь `DownloadJob` не используется |
| Подпись (label)   | Русское имя, иначе оригинал (`russian \|\| name`)                    |
| Квота             | Транзакционная проверка квоты пула через переиспользуемый `createArt` |
| Роли              | Пермишен `media:upload` (как у загрузок)                            |
| Данные            | Схема БД **не меняется** — импортированный постер это `Art(kind=image)` |

## Данные

Изменений схемы нет. Постер после импорта — строка `Art` с `kind="image"`,
`label = russian || name`, обычным `filePath`/`sizeBytes` и учётом в квоте пула.
Провенанс (source/sourceId) и дедуп в v1 не храним (YAGNI).

## Доменный слой (чистый, без сети) — `src/lib/domain/shikimori-map.ts`

- `mapAnimeResult(raw)` → `{ id, name, russian, imagePath, kind, score, year }`
  (`year` из `aired_on`; `score` строкой из API → число или null).
- `mapCharacterResult(raw)` → `{ id, name, russian, imagePath }`.
- `pickLabel(russian, name)` → `russian?.trim() || name?.trim() || null`.
- `absoluteImageUrl(base, path)` — склейка с базой.
- `isSafeImagePath(path)` — **валидатор SSRF**: пускаем только
  `^/system/(animes|characters)/(original|preview)/\d+`; режем чужой хост,
  абсолютные URL, `..`-traversal, любые не-`/system` пути.

## Клиент API (server-only) — `src/lib/shikimori.ts`

- `searchAnimes(q, limit)` → `GET {base}/api/animes?search=&limit=`.
- `searchCharacters(q, limit)` → `GET {base}/api/characters/search?search=`
  (лимит применяется на нашей стороне, если API его не поддерживает).
- `fetchPoster(path)` → `{ data: Buffer, contentType }`, только с настроенного
  хоста и только по `isSafeImagePath`-пути.
- Общее: заголовок `User-Agent`, таймаут через `AbortController`, следование
  редиректам, маппинг ошибок (сеть / таймаут / HTTP 429 / прочее HTTP).

## Сервисный слой (server-only) — `src/server/shikimori.ts`

- `search(type, q, limit=8)` → нормализованные результаты (пустой запрос →
  пустой список; тримминг; лимит).
- `importPoster(userId, { type, id, imagePath, label, maxPoolBytes })`:
  валидирует `imagePath` → `fetchPoster` → `createArt(userId, { fileName:
  "shikimori-<type>-<id>.jpg", data, label, maxPoolBytes })`. Возвращает `Art`.
  Переиспользование `createArt` даёт транзакционную квоту бесплатно.

## API-роуты

1. `GET /api/shikimori/search?type=anime|character&q=…` — пермишен
   `media:upload`; возвращает `{ results: [...] }`.
2. `POST /api/shikimori/import` — body `{ type, id, imagePath, label }`,
   пермишен `media:upload`, квота из `quotasFor(role).maxPoolBytes`; возвращает
   `{ artId }`. Невалидный `imagePath` → 400; `POOL_QUOTA` → 400 с текстом.

## UI — `ShikimoriPanel` в `ArtGalleryModal.tsx`

Отдельный блок в режиме «Менеджер медиа», рядом с `UrlImportPanel`:
- переключатель **Аниме / Персонажи**;
- поле поиска с дебаунсом ~300 мс;
- выпадающий список: мини-постер (preview) + имя + факты;
- клик по результату → синхронный `POST /import` → по успеху `onPoolChange()`
  (сетка пула перезагружается) + инлайн «готово — в пуле»;
- состояния: загрузка / пусто / ошибка (Shikimori недоступен / 429 / квота).

## Поток

1. Ввод → дебаунс → `GET /api/shikimori/search` → бэкенд → Shikimori →
   нормализация → дропдаун с постерами и фактами.
2. Клик → `POST /api/shikimori/import {type,id,imagePath,label}` → бэкенд
   валидирует путь → качает постер → `createArt` (квота) → `{artId}`.
3. UI по успеху дёргает `onPoolChange` → пул обновляется, постер появляется.

## Тесты

- **Юнит** (без сети): маппинг аниме/персонажа, `pickLabel`-фолбэк,
  `isSafeImagePath` (режет чужой хост, не-`/system`, traversal, абсолютный URL).
- **Интеграция** (реальная БД + локальный HTTP-источник, паттерн из
  `downloads.integration.test.ts`): локальный сервер отдаёт фейковый JSON и jpg,
  `SHIKIMORI_BASE_URL` направлен на него → поиск нормализуется; `importPoster`
  создаёт `Art(image)` с учётом квоты; квота-отказ; изоляция чужих данных;
  отказ импорта при невалидном `imagePath`.
- **Смоук по реальному shikimori.io** (сетезависимый, как реальный YouTube-probe
  в фазе 8): поиск «naruto» → есть результат с постером; один `fetchPoster`.
- **Вживую** (skill `verify`, puppeteer): ввод → дропдаун → клик → постер в пуле.

## Вне скоупа

- GraphQL API, синопсис/полные детали, фильтры (жанр/год/тип), пагинация выдачи,
  дедуп по источнику, провенанс, авторизация в Shikimori (OAuth), импорт кадров
  персонажа кроме основного постера, картинки студий/людей.
