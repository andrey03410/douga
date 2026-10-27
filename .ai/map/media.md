# Пул медиа и импорт

Пул медиа (`Art`) — личная библиотека пользователя Douga: картинки, видео и аудио. Из пула собираются позиции топов, карточки пикеров, фоны, плейлисты и ассеты Studio. Сюда ведут все пути импорта: файл, буфер обмена, ссылка (картинка сохраняется сразу, видео и аудио скачивает yt-dlp), Shikimori и локальный диск через MCP.

## Где код
- [`src/server/arts.ts`](../../src/server/arts.ts) — сервис пула: `listArts` (поиск по `label`, `kind`, курсор), `listRecentArts`, `createArt` (из буфера), `createArtFromFile` (**перемещает** файл), `renameArt`, `deleteArt`, `deleteArts` (`MAX_BULK_DELETE = 200`), `poolUsageBytes`, `preparePoolArtFromFile` (импорт Studio)
- [`src/lib/storage.ts`](../../src/lib/storage.ts) — корень `storage/`, `artPath` → `arts/<userId>/<artId><ext>`, `absPath`/`saveFile`/`removePath`
- [`src/lib/domain/media-ext.ts`](../../src/lib/domain/media-ext.ts) — общие списки `IMG/VIDEO/AUDIO_EXT` и `isJunkName`. Их же использует ZIP турниров ([`src/lib/upload.ts`](../../src/lib/upload.ts)); архивы в пул не попадают
- API пула: [`api/arts`](../../src/app/api/arts/route.ts) — `GET` (список, `?recent=1`), `POST` (файл ≤ 512 МБ), `DELETE {ids}` (массово); [`api/arts/[id]`](../../src/app/api/arts/[id]/route.ts) — отдача (`?poster=1` — постер видео), `PATCH {label}`, `DELETE`
- Картинка по ссылке: [`api/arts/from-url`](../../src/app/api/arts/from-url/route.ts) → [`src/server/media-url.ts`](../../src/server/media-url.ts) (загрузка) + [`src/lib/domain/media-url.ts`](../../src/lib/domain/media-url.ts) (`classifyMediaUrl`, `imageExtFromContentType`, `isBlockedHostname/Address`, `urlLabel`)
- [`src/lib/domain/clipboard.ts`](../../src/lib/domain/clipboard.ts) — разбор вставки: `pickPastedImageUrl`, `pasteLabel`, `isGenericPasteName`
- yt-dlp: [`api/downloads`](../../src/app/api/downloads/), [`src/server/downloads.ts`](../../src/server/downloads.ts) (задания), [`src/lib/ytdlp.ts`](../../src/lib/ytdlp.ts) (бинарник, запуск), [`src/lib/domain/ytdlp-args.ts`](../../src/lib/domain/ytdlp-args.ts) (селекторы, аргументы, прогресс, тексты ошибок)
- Диск: [`src/server/local-media.ts`](../../src/server/local-media.ts) + [`src/lib/domain/local-media.ts`](../../src/lib/domain/local-media.ts). Доступен только из MCP (`list_local_media`, `import_local_media`)
- Другие входы: Shikimori — `importPoster` в [`src/server/shikimori.ts`](../../src/server/shikimori.ts) + [`api/shikimori`](../../src/app/api/shikimori/); MCP — `list_pool`/`import_*` в [`src/mcp/server.ts`](../../src/mcp/server.ts), [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) ждёт `DownloadJob` до 180 с; Studio — [`import-attempt.ts`](../../src/server/studio/import-attempt.ts)
- [`art-usage.ts`](../../src/lib/domain/art-usage.ts) — `usageBreakdown`, `describeUsage`, `describeDeletion`; [`bulk-delete.ts`](../../src/lib/domain/bulk-delete.ts) — разбор ответа массового удаления на клиенте (в т.ч. частичного 409)
- [`src/lib/domain/art-crop.ts`](../../src/lib/domain/art-crop.ts) — `parseArtCrop`, `cropFromColumns`, `artCropStyle` (`cover`/`fill`/`contain`)
- Пробы: [`src/lib/audio.ts`](../../src/lib/audio.ts) — `probeMediaInfo` (длительность, `hasAudio`, `hasVideo`), `extractPoster`; [`src/lib/media-probe.ts`](../../src/lib/media-probe.ts) — у ffmpeg-пробы таймаут 30 с и до 1 МБ вывода
- [`src/lib/art-dto.ts`](../../src/lib/art-dto.ts) — единая форма `Art` в ответах API
- UI:
  - [`useMediaPool.ts`](../../src/app/components/useMediaPool.ts) — данные: страницы по 40, поиск, `Shift`-диапазон, переименование, удаление;
  - [`MediaBrowser.tsx`](../../src/app/components/MediaBrowser.tsx) — сетка или строки; [`ImportSources.tsx`](../../src/app/components/ImportSources.tsx) — табы «Файлы · Ссылка · Shikimori» и `Ctrl+V`; [`RenameField.tsx`](../../src/app/components/RenameField.tsx);
  - модалка [`ArtGalleryModal.tsx`](../../src/app/tournaments/[id]/render/ArtGalleryModal.tsx) (`manage`/`pick`/`crop`, react-easy-crop); её импортирует и [`PickerConstructor.tsx`](../../src/app/projects/[id]/PickerConstructor.tsx);
  - кабинет — [`AccountManager.tsx`](../../src/app/account/AccountManager.tsx).

## Данные
- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `Art`: `kind` (`image`|`video`|`audio`), `filePath`, `posterPath` у видео, `durationSec`, `hasAudio`, `sizeBytes` (по нему считается квота), `lastUsedAt` (блок «недавние»);
  - `DownloadJob`: `mode` (`video`|`audio`), `quality` (480/720/1080), `status` (`queued`|`running`|`done`|`failed`|`canceled`), `progress`, `artId`.
- Файлы: медиа — `storage/arts/<userId>/<artId><ext>`, постер — `<artId>.poster.jpg`; временные — `storage/tmp/` и `storage/downloads/tmp/<jobId>/`; бинарник — `storage/bin/yt-dlp`
- Обрезка не меняет файл. Прямоугольник лежит в `RenderItem.artCrop{X,Y,W,H}` (кадр 16:9) или в `PickerTile.crop{X,Y,W,H}` с `fitMode`; соотношение сторон плитки задаёт ориентация раунда

## Как устроено
- Все записи идут через `createArt`/`createArtFromFile`. Тип определяется по расширению. Квота `maxPoolBytes` проверяется в одной транзакции со вставкой строки, `sizeBytes` пишется сразу. Затем записывается файл, потом по возможности ffmpeg-проба и постер.
- По ссылке:
  - клиент вызывает `classifyMediaUrl`: расширение картинки → `/api/arts/from-url`, иначе → yt-dlp;
  - сервер решает по `Content-Type`; если это не картинка, отвечает `code: NOT_IMAGE`, и UI предлагает скачать ссылку как видео или аудио;
  - лимиты: 32 МБ (по заголовку и по счётчику потока), 15 с, 3 редиректа; редиректы обрабатываются вручную, каждый проходит DNS-проверку адресов. `MEDIA_URL_ALLOW_PRIVATE=1` снимает запрет приватных адресов.
- Вставка `Ctrl+V` в модалке работает, если курсор не в поле ввода. Файлы загружаются, безымянные получают метку «Вставка ДД.ММ ЧЧ:ММ». Иначе берётся `<img src>` из HTML, затем текстовая ссылка на картинку; обе идут в `from-url`. Ссылку на видео вставка игнорирует.
- yt-dlp:
  - задание — фоновый `DownloadJob` внутри процесса Next, не больше 2 активных на пользователя;
  - сначала `-J`: если оценка размера не влезает в остаток квоты — отказ; загрузка идёт с `--max-filesize` = остаток. Видео — avc1+mp4a в mp4, звук — m4a;
  - если сломался экстрактор: `yt-dlp -U` и один повтор. Отмена убивает процесс через `SIGKILL`;
  - бинарник: `YTDLP_PATH`, иначе `storage/bin/yt-dlp`, иначе последний релиз с GitHub. `YTDLP_PROXY` — прокси.
- Диск: allowlist `MCP_LOCAL_MEDIA_DIRS` (список через `:`, `~` раскрывается, относительные пути отбрасываются). Путь проверяется до и после `realpath`. Файл копируется в `storage/tmp`, оригинал не трогается. Не больше 50 файлов за вызов, ошибки по файлам — в `failed`.
- Удаление:
  - есть `StudioAssetReference` → 409 `STUDIO_ASSET_IN_USE`;
  - `PickerTile` и `PickerPlaylistItem` удаляются каскадом;
  - `RenderItem.artId` и фоны/музыка проектов и раундов получают `SetNull`; кроп и настройки звука позиции сбрасываются в той же транзакции;
  - массовое удаление — до 200 id, каждый через `deleteArt`, частичный успех разрешён.
- Счётчик использований — `_count` по 9 связям `Art` (8 из фазы 17 плюс `studioReferences`), сгруппированный в позиции, карточки, плейлист, фоны и Studio.

## Грабли
- У `RenderItem.audioArtId` стоит `onDelete: Cascade`: позиция ручного топа, которая звучит этим медиа, удаляется целиком. `usageBreakdown` поэтому разделяет счётчики. `positions` — картинка позиции (`artId` → `SetNull`), подтверждение пишет «N позиция топа освободится». `audioPositions` — звук позиции, текст «N позиция ручного топа будет удалена». Позицию, где одно медиа служит и звуком, и картинкой, считаем один раз, в `audioPositions`: `_count.renderItems` в `src/server/arts.ts` фильтруется по `audioArtId ≠ artId` (field reference). Короткая строка `describeUsage` показывает сумму как «N позиций топа».
- `createArtFromFile` удаляет источник (`rename`, иначе copy+unlink). Чужой файл сначала копируй в `storage/tmp`, как делает `local-media.ts`.
- Строка `Art` создаётся с `filePath: ""` до записи файла. Если запись или проба упадут, строку никто не откатывает.
- `/api/downloads` проверяет только схему `http(s)`; защита от приватных адресов из `media-url.ts` для yt-dlp не работает.
- Процессы yt-dlp хранятся в памяти. После перезапуска задание висит, пока `listDownloads` не пометит его `failed` — через 10 минут без обновлений. `DownloadJob.userId`/`artId` — строки без внешнего ключа, каскадов нет.
- `mediaResponse` читает весь файл в память на каждый Range-запрос.
- Тестам импорта по ссылке с фикстурой на `127.0.0.1` нужен `MEDIA_URL_ALLOW_PRIVATE=1`. В карточке пула два `input`: чекбокс и `.rename-input`. После правки `schema.prisma` перезапусти dev: старый Prisma-клиент в живом процессе ломает роуты.

## Как проверить
- Юниты: `npx vitest run src/lib/domain/media-url.test.ts src/lib/domain/clipboard.test.ts src/lib/domain/ytdlp-args.test.ts src/lib/domain/local-media.test.ts src/lib/domain/art-usage.test.ts src/lib/domain/art-crop.test.ts src/lib/domain/bulk-delete.test.ts src/lib/domain/media-ext.test.ts src/lib/audio-probe.test.ts`
- Интеграция (пишет в `prisma/dev.db` и `storage/`): `npx vitest run src/integration/arts.integration.test.ts src/integration/media-url.integration.test.ts src/integration/local-media.integration.test.ts src/integration/downloads.integration.test.ts`. Тест загрузок берёт `storage/bin/yt-dlp` и сам его не скачивает
- Живая проверка — менеджер медиа в `/tournaments/<id>/render` или в конструкторе пикера `/projects/<id>`: табы, `Ctrl+V`, ссылка на картинку и на HTML-страницу (`NOT_IMAGE` → предложение yt-dlp), выбор с `Shift` и удаление со списком последствий; кабинет `/account`.

## История
- [спека 03](../specs/03-render-arts-manager.md) — менеджер артов, пикер, обрезка 16:9 без изменения файла
- [спека 04](../specs/04-video-support.md) — видео в пуле: проба, постер, подмена звука
- [спека 05](../specs/05-roles-cabinet.md) — квота пула (у пользователя 100 МБ)
- [спека 06](../specs/06-video-projects.md) — `Art.kind = audio`
- [спека 08](../specs/08-url-import.md) — yt-dlp и `DownloadJob`
- [спека 09](../specs/09-shikimori-import.md) — постеры Shikimori в пуле
- [спека 15](../specs/15-mcp-local-media.md) — `list_pool` и импорт с диска через MCP
- [спека 17](../specs/17-media-library.md) — картинки по ссылке, буфер обмена, табы, честный счётчик, массовое удаление
