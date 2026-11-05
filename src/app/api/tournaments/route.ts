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
import { extractTracksFromZip, groupArchiveTracks } from "@/lib/upload";
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
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const splitFolders = String(form.get("splitFolders") ?? "") === "true";
  let segmentTitles: string[] = [];
  try {
    const value = JSON.parse(String(form.get("segmentTitles") ?? "[]"));
    if (!Array.isArray(value) || value.some((t) => typeof t !== "string"))
      throw new Error();
    segmentTitles = value;
  } catch {
    return badRequest("Некорректные названия сегментов");
  }

  if (!title) return badRequest("Укажите название");
  if (!isScheme(scheme)) return badRequest("Неизвестная схема");
  if (!files.length) return badRequest("Прикрепите ZIP-архив с треками");

  if (files.reduce((n, f) => n + f.size, 0) > maxArchiveBytes)
    return tooLarge(limitMsg);
  const tracks: Awaited<ReturnType<typeof extractTracksFromZip>> = [];
  const segments: { title: string; trackIndexes: number[] }[] = [];
  try {
    for (const [i, file] of files.entries()) {
      const extracted = await extractTracksFromZip(
        Buffer.from(await file.arrayBuffer()),
      );
      const title =
        segmentTitles[i]?.trim() ||
        (files.length > 1 ? file.name.replace(/\.zip$/i, "") : "Все треки");
      const offset = tracks.length;
      segments.push(
        ...groupArchiveTracks(
          extracted,
          files.length === 1 && splitFolders,
          title,
        ).map((s) => ({
          ...s,
          trackIndexes: s.trackIndexes.map((i) => i + offset),
        })),
      );
      tracks.push(...extracted);
    }
  } catch {
    return badRequest("Не удалось прочитать архив");
  }
  if (!tracks.length)
    return badRequest("В архиве должны быть аудио- или видеофайлы");

  try {
    const tournament = await createTournament(
      auth.userId,
      { title, scheme, blindMode, groupSize, segments },
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
    if ((e as Error).message === "ARCHIVE_QUOTA") return tooLarge(limitMsg);
    throw e;
  }
}
