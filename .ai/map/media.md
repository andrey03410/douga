# Пул медиа и импорт

Пул медиа (`Art`) — личная библиотека пользователя Douga: картинки, видео и аудио. Ими пользуются документы студии и турниры — как обложками треков и постерами сегментов. Сюда ведут все пути импорта: файл, буфер обмена, ссылка (картинка сохраняется сразу, видео и аудио скачивает yt-dlp), Shikimori и локальный диск через MCP. На сайте импорт живёт в кабинете.

## Где код

- [`src/server/arts.ts`](../../src/server/arts.ts) — сервис пула: `listArts` (поиск по `label`, `kind`, курсор), `createArt` (из буфера), `createArtFromFile` (**перемещает** файл), `renameArt`, `deleteArt`, `deleteArts` (`MAX_BULK_DELETE = 200`), `poolUsageBytes`, `preparePoolArtFromFile` (импорт Studio). `ART_INCLUDE` считает `studioReferences`, `trackCovers`, `segmentPosters`
- [`src/lib/storage.ts`](../../src/lib/storage.ts) — корень `storage/`, `artPath` → `arts/<userId>/<artId><ext>`, `absPath`/`saveFile`/`removePath`
- [`src/lib/domain/media-ext.ts`](../../src/lib/domain/media-ext.ts) — общие списки `IMG/VIDEO/AUDIO_EXT` и `isJunkName`. Их же использует ZIP турниров ([`src/lib/upload.ts`](../../src/lib/upload.ts)); архивы в пул не попадают
- API пула: [`api/arts`](../../src/app/api/arts/route.ts) — `GET` (список), `POST` (файл ≤ 512 МБ), `DELETE {ids}` (массово); [`api/arts/[id]`](../../src/app/api/arts/[id]/route.ts) — отдача (`?poster=1` — постер видео), `PATCH {label}`, `DELETE`
- Картинка по ссылке: [`api/arts/from-url`](../../src/app/api/arts/from-url/route.ts) → [`src/server/media-url.ts`](../../src/server/media-url.ts) (загрузка) + [`src/lib/domain/media-url.ts`](../../src/lib/domain/media-url.ts) (`classifyMediaUrl`, `imageExtFromContentType`, `isBlockedHostname/Address`, `urlLabel`)
- [`src/lib/domain/clipboard.ts`](../../src/lib/domain/clipboard.ts) — разбор вставки: `pickPastedImageUrl`, `pasteLabel`, `isGenericPasteName`
- yt-dlp: [`api/downloads`](../../src/app/api/downloads/), [`src/server/downloads.ts`](../../src/server/downloads.ts) (задания), [`src/lib/ytdlp.ts`](../../src/lib/ytdlp.ts) (бинарник, запуск), [`src/lib/domain/ytdlp-args.ts`](../../src/lib/domain/ytdlp-args.ts) (селекторы, аргументы, прогресс, тексты ошибок)
- Диск: [`src/server/local-media.ts`](../../src/server/local-media.ts) + [`src/lib/domain/local-media.ts`](../../src/lib/domain/local-media.ts). Доступен **только** из MCP: `list_local_media`, `import_local_media` и path-вход `tournament_create`/`tournament_items_add` ([`tournament-tools.ts`](../../src/mcp/tournament-tools.ts)); `readLocalTournamentTrack` читает проверенный файл для турнира. HTTP-формы турниров `{path}` не принимают (`webItemSourceSchema`)
- Другие входы: Shikimori — `importPoster` в [`src/server/shikimori.ts`](../../src/server/shikimori.ts) + [`api/shikimori`](../../src/app/api/shikimori/); MCP — `list_pool`/`import_*` в [`src/mcp/server.ts`](../../src/mcp/server.ts), [`src/mcp/youtube.ts`](../../src/mcp/youtube.ts) ждёт `DownloadJob` до 180 с; Studio — [`import-attempt.ts`](../../src/server/studio/import-attempt.ts)
- [`art-usage.ts`](../../src/lib/domain/art-usage.ts) — `usageBreakdown`, `describeUsage`, `describeDeletion`; [`bulk-delete.ts`](../../src/lib/domain/bulk-delete.ts) — разбор ответа массового удаления на клиенте (в т.ч. частичного 409)
- Импорт треков турнира: [`src/lib/upload.ts`](../../src/lib/upload.ts) сохраняет title/artist/album, sourceFolder, durationSec и встроенную обложку; [`src/server/track-metadata.ts`](../../src/server/track-metadata.ts) проверяет правки и ссылки на картинки; `GET /api/tracks/:id/cover` отдаёт обложку владельцу
- Участники-картинки турнира (задача 33): png/jpg/webp/gif до 32 МБ из ZIP, отдельных файлов, пула (`{assetId}` — копия файла в турнир, `sourceKey art:<id>`), Shikimori и диска (только MCP) становятся `Track kind:"image"` с `coverPath` = сам файл ([`tournament-items.ts`](../../src/server/tournament-items.ts)). `GET /api/tracks/:id/cover?size=thumb` делает JPEG 480px через `makeThumbnail` ([`audio.ts`](../../src/lib/audio.ts)) для картинок больше 400 КБ, GIF идут как есть
- Пробы: [`src/lib/audio.ts`](../../src/lib/audio.ts) — `probeMediaInfo` (длительность, `hasAudio`, `hasVideo`), `extractPoster`; [`src/lib/media-probe.ts`](../../src/lib/media-probe.ts) — у ffmpeg-пробы таймаут 30 с и до 1 МБ вывода
- [`src/lib/art-dto.ts`](../../src/lib/art-dto.ts) — единая форма `Art` в ответах API
- UI:
  - [`useMediaPool.ts`](../../src/app/components/useMediaPool.ts) — данные: страницы по 40, поиск, `Shift`-диапазон, переименование, удаление;
  - [`MediaBrowser.tsx`](../../src/app/components/MediaBrowser.tsx) — строки пула с поиском, фильтром, выбором и удалением; [`ImportSources.tsx`](../../src/app/components/ImportSources.tsx) — табы «Файлы · Ссылка · Shikimori» и `Ctrl+V`; [`RenameField.tsx`](../../src/app/components/RenameField.tsx);
  - кабинет — [`AccountManager.tsx`](../../src/app/account/AccountManager.tsx): в блоке пула всегда виден `ImportSources`, список раскрывается отдельно. После импорта обновляются пул и сводка квот.

## Данные

- Модели Prisma ([schema](../../prisma/schema.prisma)):
  - `Art`: `kind` (`image`|`video`|`audio`), `filePath`, `posterPath` у видео, `durationSec`, `hasAudio`, `sizeBytes` (по нему считается квота);
  - `DownloadJob`: `mode` (`video`|`audio`), `quality` (480/720/1080), `status` (`queued`|`running`|`done`|`failed`|`canceled`), `progress`, `artId`.
- Файлы: медиа — `storage/arts/<userId>/<artId><ext>`, постер — `<artId>.poster.jpg`; временные — `storage/tmp/` и `storage/downloads/tmp/<jobId>/`; бинарник — `storage/bin/yt-dlp`
- Использование: `StudioAssetReference`, `Track.coverArtId` и `TournamentSegment.posterArtId`. Последние две связи — FK `onDelete: Restrict`, сервис принимает только собственные `Art.kind=image`. Кроп задаётся в документе SDK (`CardStyle.crop`), файл пула не режется.
- Встроенная обложка трека хранится в `storage/tournaments/<id>/tracks/<trackId>-cover.<ext>`, `Track.coverPath` относителен storage, размер входит в `Track.sizeBytes`. Выбранный `coverArtId` приоритетнее встроенной обложки; `null` возвращает fallback. `album` и `sourceFolder` сохраняются при импорте, `comment` и `bestMomentSec` редактируются на сайте.

## Как устроено

- Все записи идут через `createArt`/`createArtFromFile`. Тип определяется по расширению. Квота `maxPoolBytes` проверяется в одной транзакции со вставкой строки, `sizeBytes` пишется сразу. Затем записывается файл, потом по возможности ffmpeg-проба и постер.
- По ссылке:
  - клиент вызывает `classifyMediaUrl`: расширение картинки → `/api/arts/from-url`, иначе → yt-dlp;
  - сервер решает по `Content-Type`; если это не картинка, отвечает `code: NOT_IMAGE`, и UI предлагает скачать ссылку как видео или аудио;
  - лимиты: 32 МБ (по заголовку и по счётчику потока), 15 с, 3 редиректа; редиректы обрабатываются вручную, каждый проходит DNS-проверку адресов.
- SSRF-гард один на все входы по ссылке — `assertPublicUrl` в [`src/server/media-url.ts`](../../src/server/media-url.ts): правило имён хоста, затем DNS `lookup(all)` и `isBlockedAddress` для каждого адреса. IPv6 разбирается в 16 байт. Формы со встроенным IPv4 судятся по этому IPv4: `::ffff:0:0/96` (WHATWG пишет `[::ffff:127.0.0.1]` как `[::ffff:7f00:1]`), `::/96`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`. Плюс блокируются ULA, link-local, site-local, multicast, `2001:db8::/32` и `100::/64`. Ошибки `BLOCKED_HOST` и `HOST_UNRESOLVED`. `MEDIA_URL_ALLOW_PRIVATE=1` снимает запрет. Его вызывают импорт картинки (на каждом редиректе; `HOST_UNRESOLVED` там превращается в `FETCH_FAILED`), `startDownload` и студийный импорт ([studio-sdk.md](studio-sdk.md)).
- yt-dlp получает нормализованный `URL.href` той ссылки, которую проверил гард: `startDownload` хранит `url.toString()`, студийная схема делает `.transform(new URL(v).href)`. Иначе парсеры расходятся: Python `urlparse` читает `http://a.com\@127.0.0.1/` с хостом 127.0.0.1, а WHATWG — с хостом a.com.
- `startDownload` проверяет адрес до создания `DownloadJob`. `/api/downloads` (400) и MCP `import_youtube_audio` отдают текст из `describeStartRefusal`: «По этому адресу ходить нельзя: локальные и внутренние адреса запрещены» или «Сайт по ссылке не найден — проверьте адрес».
- Вставка `Ctrl+V` работает на странице с блоком импорта (кабинет), если курсор не в поле ввода. Файлы загружаются, безымянные получают метку «Вставка ДД.ММ ЧЧ:ММ». Иначе берётся `<img src>` из HTML, затем текстовая ссылка на картинку; обе идут в `from-url`. Ссылку на видео вставка игнорирует.
- yt-dlp:
  - задание — фоновый `DownloadJob` внутри процесса Next, не больше 2 активных на пользователя;
  - сначала `-J`: если оценка размера не влезает в остаток квоты — отказ; загрузка идёт с `--max-filesize` = остаток. Видео — avc1+mp4a в mp4, звук — m4a;
  - если сломался экстрактор: `yt-dlp -U` и один повтор. Отмена убивает процесс через `SIGKILL`;
  - бинарник: `YTDLP_PATH`, иначе `storage/bin/yt-dlp`, иначе последний релиз с GitHub. `YTDLP_PROXY` — прокси.
- Диск: allowlist `MCP_LOCAL_MEDIA_DIRS` (список через `:`, `~` раскрывается, относительные пути отбрасываются). Путь проверяется до и после `realpath`. `import_local_media` копирует файл в `storage/tmp`, не трогая оригинал; не больше 50 файлов за вызов, ошибки по файлам — в `failed`. `list_local_media` добавляет title/artist/album/durationSec/sourceFolder, когда metadata доступна; за пределами allowlist теги не читаются даже через symlink. `tournament_create` читает path напрямую после той же проверки и копирует байты в каталог турнира; собственный audio/video пула копируется по assetId.
- ZIP турнира не попадает в пул. Несколько multipart `file` образуют сегменты; `splitFolders=true` делит один архив без общего корня. `POST /api/tournaments/inspect` отдаёт folders/trackCount без создания. HTTP сверяет сумму размеров архивов, сервис — суммарные распакованные треки с обложками по квоте `maxArchiveBytes`, отдельно от `maxPoolBytes`.
- Удаление:
  - есть `StudioAssetReference` → 409 `STUDIO_ASSET_IN_USE`;
  - есть обложка трека или постер сегмента → 409 `TOURNAMENT_ASSET_IN_USE` с подсказкой сначала заменить картинку в турнире;
  - иначе строка и файлы удаляются;
  - массовое удаление — до 200 id, каждый через `deleteArt`, частичный успех разрешён.
- Счётчик использований складывает `_count.studioReferences`, `_count.trackCovers`, `_count.segmentPosters`. `usage` разделяет Studio и турниры, `usageCount` — сумма. Карточка и массовое удаление показывают ссылки на Studio и/или турниры; при нуле — «не используется».

## Грабли

- `createArtFromFile` удаляет источник (`rename`, иначе copy+unlink). Чужой файл сначала копируй в `storage/tmp`, как делает `local-media.ts`.
- Строка `Art` создаётся с `filePath: ""` до записи файла. Если запись или проба упадут, строку никто не откатывает.
- Остаточный риск SSRF у yt-dlp: проверяется только первый адрес нормализованной ссылки. Редиректы yt-dlp проходит сам, а DNS после нашей проверки резолвит заново. Поэтому публичный хост с редиректом в LAN или DNS-rebinding в этом зазоре даст слепой GET изнутри. Для личного проекта с входом по аккаунту риск принят в задаче 23.
- Процессы yt-dlp хранятся в памяти. После перезапуска задание висит, пока `listDownloads` не пометит его `failed` — через 10 минут без обновлений. `DownloadJob.userId`/`artId` — строки без внешнего ключа, каскадов нет.
- `mediaResponse` читает весь файл в память на каждый Range-запрос.
- Тестам импорта по ссылке с фикстурой на `127.0.0.1` нужен `MEDIA_URL_ALLOW_PRIVATE=1`: ставь его и восстанавливай после файла. Детерминированные имена «резолвится в LAN» и «не резолвится» даёт мок DNS [`src/test/private-dns.ts`](../../src/test/private-dns.ts). В строке пула два `input`: чекбокс `.row-pick` и `.rename-input`. После правки `schema.prisma` перезапусти dev: старый Prisma-клиент в живом процессе ломает роуты.

## Как проверить

- Юниты: `npx vitest run src/lib/domain/media-url.test.ts src/lib/domain/clipboard.test.ts src/lib/domain/ytdlp-args.test.ts src/lib/domain/local-media.test.ts src/lib/domain/art-usage.test.ts src/lib/domain/bulk-delete.test.ts src/lib/domain/media-ext.test.ts src/lib/audio-probe.test.ts`
- Интеграция (пишет в `prisma/dev.db` и `storage/`): `npx vitest run src/integration/arts.integration.test.ts src/integration/media-url.integration.test.ts src/integration/local-media.integration.test.ts src/integration/downloads.integration.test.ts src/integration/tournament-segments.integration.test.ts src/integration/tournament-segments-http.integration.test.ts src/integration/studio-segments.integration.test.ts`. Тест загрузок берёт `storage/bin/yt-dlp` и сам его не скачивает
- Живая проверка — кабинет `/account`, блок пула: табы «Файлы · Ссылка · Shikimori», `Ctrl+V`, ссылка на картинку и на HTML-страницу (`NOT_IMAGE` → предложение yt-dlp), выбор с `Shift`. Удаление медиа, на которое ссылается студия, даёт 409 `STUDIO_ASSET_IN_USE`; обложки/постера турнира — 409 `TOURNAMENT_ASSET_IN_USE`. Проверь сумму использований и возврат встроенной обложки после снятия coverArtId.

## История

- [спека 03](../specs/03-render-arts-manager.md) — менеджер артов, пикер, обрезка 16:9 без изменения файла
- [спека 04](../specs/04-video-support.md) — видео в пуле: проба, постер, подмена звука
- [спека 05](../specs/05-roles-cabinet.md) — квота пула (у пользователя 100 МБ)
- [спека 06](../specs/06-video-projects.md) — `Art.kind = audio`
- [спека 08](../specs/08-url-import.md) — yt-dlp и `DownloadJob`
- [спека 09](../specs/09-shikimori-import.md) — постеры Shikimori в пуле
- [спека 15](../specs/15-mcp-local-media.md) — `list_pool` и импорт с диска через MCP
- [спека 17](../specs/17-media-library.md) — картинки по ссылке, буфер обмена, табы, честный счётчик, массовое удаление
- [задача 27](../features/27-segments/README.md) — metadata и обложки треков, постеры сегментов, суммарные использования и защита удаления картинок турнира
