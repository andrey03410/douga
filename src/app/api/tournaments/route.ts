import { NextResponse } from "next/server";
import {
  userOr401,
  permissionOr403,
  badRequest,
  forbidden,
  tooLarge,
} from "@/lib/api";
import { formatBytes, quotasFor } from "@/lib/domain/permissions";
import { isScheme } from "@/lib/domain/types";
import { createTournament, listTournaments } from "@/server/tournaments";
import { participantsFromForm } from "@/server/tournament-upload";
import { tournamentErrorMessage } from "@/lib/tournament-errors";

export async function GET() {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const tournaments = await listTournaments(auth.userId);
  return NextResponse.json({ tournaments });
}

/**
 * Create a tournament from archives, loose files and/or a draft of Shikimori
 * and pool sources (task 33). `scheme` is optional: without it the person
 * picks the algorithm on the tournament page.
 */
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
  const schemeRaw = String(form.get("scheme") ?? "");
  const blindMode = String(form.get("blindMode") ?? "") === "on";
  const groupSize = Number(form.get("groupSize") ?? 2);
  const files = form.getAll("file").filter((f): f is File => f instanceof File);

  if (!title) return badRequest("Укажите название");
  if (schemeRaw && !isScheme(schemeRaw)) return badRequest("Неизвестная схема");
  if (!files.length && !form.get("sources"))
    return badRequest("Добавьте архив, файлы или участников из Shikimori и пула");
  if (files.reduce((n, f) => n + f.size, 0) > maxArchiveBytes) return tooLarge(limitMsg);

  let parsed;
  try {
    parsed = await participantsFromForm(auth.userId, form, maxArchiveBytes);
  } catch (e) {
    const code = String((e as Error).message);
    if (code === "ARCHIVE_QUOTA") return tooLarge(limitMsg);
    if (["IMAGE_TOO_LARGE", "BAD_EXT", "NOT_FOUND", "TOO_MANY_SHIKIMORI"].includes(code))
      return badRequest(tournamentErrorMessage(code === "NOT_FOUND" ? "BAD_EXT" : code));
    return badRequest("Не удалось прочитать архив или файлы");
  }
  if (!parsed.tracks.length)
    return badRequest(
      parsed.skipped.length
        ? "Ни одного участника не удалось загрузить из Shikimori"
        : "В архиве должны быть аудио, видео или картинки",
    );

  try {
    const tournament = await createTournament(
      auth.userId,
      {
        title,
        scheme: isScheme(schemeRaw) ? schemeRaw : undefined,
        blindMode,
        groupSize,
        segments: parsed.segments,
      },
      parsed.tracks,
      { maxTournaments: quotasFor(auth.user.role).maxTournaments },
    );
    return NextResponse.json({
      id: tournament.id,
      trackCount: parsed.tracks.length,
      skipped: parsed.skipped,
    });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "TOURNAMENT_LIMIT") {
      return forbidden(
        "Достигнут лимит архивов. Удалите существующий в личном кабинете",
      );
    }
    if (code === "ARCHIVE_QUOTA") return tooLarge(limitMsg);
    if (code.startsWith("DUPLICATE_ITEM") || code === "TOO_MANY_PARTICIPANTS")
      return badRequest(tournamentErrorMessage(code));
    throw e;
  }
}
