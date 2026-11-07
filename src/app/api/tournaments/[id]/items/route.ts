import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { permissionOr403, userOr401, notFound, badRequest, tooLarge } from "@/lib/api";
import { prisma } from "@/lib/db";
import { quotasFor } from "@/lib/domain/permissions";
import { addParticipants, deleteParticipants } from "@/server/tournament-items";
import { participantsFromForm } from "@/server/tournament-upload";
import { tournamentErrorMessage } from "@/lib/tournament-errors";

const fail = (e: unknown) => {
  if (e instanceof ZodError) return badRequest("Некорректный список участников");
  const code = String((e as Error).message);
  if (code === "NOT_FOUND") return notFound();
  if (code === "ARCHIVE_QUOTA") return tooLarge(tournamentErrorMessage(code));
  return badRequest(tournamentErrorMessage(code));
};

/**
 * Task 33: add participants to an existing tournament (multipart: `file`,
 * `sources` JSON, `segmentId` or `segmentTitle`). A finished segment reopens
 * and the newcomers are inserted into its order.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await permissionOr403("tournament:create", "Изменение турниров недоступно вашей роли");
  if ("response" in auth) return auth.response;
  const max = quotasFor(auth.user.role).maxArchiveBytes;
  if (Number(req.headers.get("content-length") ?? 0) > max)
    return tooLarge(tournamentErrorMessage("ARCHIVE_QUOTA"));
  // Ownership before any download: a foreign id must not occupy the Shikimori queue.
  if (!(await prisma.tournament.count({ where: { id: params.id, userId: auth.userId } }))) return notFound();
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Ожидается форма с файлами или источниками");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.reduce((n, f) => n + f.size, 0) > max) return tooLarge(tournamentErrorMessage("ARCHIVE_QUOTA"));
  try {
    const parsed = await participantsFromForm(auth.userId, form, max);
    if (!parsed.tracks.length)
      return badRequest(parsed.skipped.length ? "Ни одного участника не удалось загрузить" : "Нечего добавлять");
    const segmentId = String(form.get("segmentId") ?? "") || undefined;
    const segmentTitle = String(form.get("segmentTitle") ?? "") || undefined;
    const result = await addParticipants(auth.userId, params.id, { segmentId, segmentTitle }, parsed.tracks);
    return NextResponse.json({ ok: true, ...result, skipped: parsed.skipped });
  } catch (e) {
    return fail(e);
  }
}

/** Delete participants: `{trackIds, confirmReset?}`; answers at stake need confirmation. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  const ids = body?.trackIds;
  if (!Array.isArray(ids) || !ids.every((x: unknown) => typeof x === "string"))
    return badRequest("Укажите участников");
  try {
    return NextResponse.json(
      await deleteParticipants(auth.userId, params.id, ids, body?.confirmReset === true),
    );
  } catch (e) {
    return fail(e);
  }
}
