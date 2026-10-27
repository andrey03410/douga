import { NextResponse } from "next/server";
import { userOr401, permissionOr403, badRequest, forbidden, tooLarge } from "@/lib/api";
import { formatBytes, quotasFor } from "@/lib/domain/permissions";
import { isScheme } from "@/lib/domain/types";
import { extractTracksFromZip } from "@/lib/upload";
import { createTournament, listTournaments } from "@/server/tournaments";

export async function GET() {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const tournaments = await listTournaments(auth.userId);
  return NextResponse.json({ tournaments });
}

export async function POST(req: Request) {
  const auth = await permissionOr403(
    "tournament:create",
    "Создание турниров недоступно вашей роли",
  );
  if ("response" in auth) return auth.response;

  // Archive ceiling depends on the role: ROLES[role].quotas.maxArchiveBytes in
  // lib/domain/permissions.ts (no numbers here, so this can't drift).
  // Checked twice: Content-Length up front (cheap), then the actual body size
  // below — a understated header must not bypass the quota.
  const maxArchiveBytes = quotasFor(auth.user.role).maxArchiveBytes;
  const limitMsg = `Архив слишком большой (лимит ${formatBytes(maxArchiveBytes)})`;
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxArchiveBytes) return tooLarge(limitMsg);

  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const scheme = String(form.get("scheme") ?? "");
  const blindMode = String(form.get("blindMode") ?? "") === "on";
  const groupSize = Number(form.get("groupSize") ?? 2);
  const file = form.get("file");

  if (!title) return badRequest("Укажите название");
  if (!isScheme(scheme)) return badRequest("Неизвестная схема");
  if (!(file instanceof File)) return badRequest("Прикрепите ZIP-архив с треками");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > maxArchiveBytes) return tooLarge(limitMsg);
  let tracks;
  try {
    tracks = await extractTracksFromZip(buffer);
  } catch {
    return badRequest("Не удалось прочитать архив");
  }
  if (tracks.length < 2) {
    return badRequest("В архиве должно быть минимум 2 аудио- или видеофайла");
  }

  try {
    const tournament = await createTournament(
      auth.userId,
      { title, scheme, blindMode, groupSize },
      tracks,
      { maxTournaments: quotasFor(auth.user.role).maxTournaments },
    );
    return NextResponse.json({ id: tournament.id, trackCount: tracks.length });
  } catch (e) {
    if ((e as Error).message === "TOURNAMENT_LIMIT") {
      return forbidden(
        "Достигнут лимит архивов. Удалите существующий в личном кабинете",
      );
    }
    throw e;
  }
}
