import { studioProtectionMessage } from "@/lib/studio-protection";
import { NextResponse } from "next/server";
import { userOr401, permissionOr403, badRequest, tooLarge, serverError } from "@/lib/api";
import { formatBytes, quotasFor } from "@/lib/domain/permissions";
import { artDto as serialize } from "@/lib/art-dto";
import { listArts, listRecentArts, createArt, deleteArts, MAX_BULK_DELETE } from "@/server/arts";

// Pool uploads are single media files; keep a sane ceiling well under the
// tournament-archive limit. Roles with a pool quota get the tighter of the two.
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB

export async function GET(req: Request) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const params = new URL(req.url).searchParams;
  if (params.get("recent")) {
    const arts = await listRecentArts(auth.userId);
    return NextResponse.json({ arts: arts.map(serialize), nextCursor: null });
  }

  const limitRaw = Number(params.get("limit"));
  const kindRaw = params.get("kind");
  const { arts, nextCursor } = await listArts(auth.userId, {
    q: params.get("q") ?? undefined,
    kind:
      kindRaw === "image" || kindRaw === "video" || kindRaw === "audio"
        ? kindRaw
        : undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  });
  return NextResponse.json({ arts: arts.map(serialize), nextCursor });
}

export async function POST(req: Request) {
  const auth = await permissionOr403(
    "media:upload",
    "Загрузка медиа недоступна вашей роли",
  );
  if ("response" in auth) return auth.response;

  const maxPoolBytes = quotasFor(auth.user.role).maxPoolBytes;
  const quotaMsg =
    maxPoolBytes === null
      ? ""
      : `Превышена квота пула медиа (${formatBytes(maxPoolBytes)}). Удалите лишнее в личном кабинете`;

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return tooLarge("Файл слишком большой (лимит 512 МБ)");
  }

  const form = await req.formData();
  const file = form.get("file");
  const label = String(form.get("label") ?? "").trim() || null;
  if (!(file instanceof File)) return badRequest("Прикрепите изображение или видео");

  try {
    const art = await createArt(auth.userId, {
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      label,
      maxPoolBytes,
    });
    return NextResponse.json(serialize({ ...art, usageCount: 0 }));
  } catch (e) {
    if ((e as Error).message === "BAD_EXT")
      return badRequest(
        "Неподдерживаемый формат: картинки jpg/png/webp/gif, видео mp4/webm/mov, аудио mp3/m4a/flac/wav/ogg",
      );
    if ((e as Error).message === "POOL_QUOTA") return tooLarge(quotaMsg);
    throw e;
  }
}

/** Bulk cleanup: delete every media in `ids` the user owns, reporting the rest. */
export async function DELETE(req: Request) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];

  try {
    const result = await deleteArts(auth.userId, ids);
    const failed=result.failed.map(entry=>({...entry,...(studioProtectionMessage(entry.reason)?{message:studioProtectionMessage(entry.reason)}:{})}));
    return NextResponse.json({...result,failed},{status:failed.some(entry=>studioProtectionMessage(entry.reason))?409:200});
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NO_IDS") return badRequest("Не выбрано ни одного файла");
    if (msg === "TOO_MANY")
      return badRequest(`За один раз можно удалить не больше ${MAX_BULK_DELETE} файлов`);
    return serverError(e);
  }
}
