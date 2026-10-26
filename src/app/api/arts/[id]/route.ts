import { studioProtectionResponse } from "@/lib/studio-protection";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { userOr401, badRequest, notFound, mediaResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { renameArt, deleteArt } from "@/server/arts";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
};

/** Serves the media file; `?poster=1` serves a video's extracted poster frame. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const art = await prisma.art.findFirst({
    where: { id: params.id, userId: auth.userId },
  });
  if (!art) return notFound();

  const wantPoster = new URL(req.url).searchParams.get("poster") === "1";
  if (wantPoster) {
    if (!art.posterPath) return notFound();
    const poster = await readFile(absPath(art.posterPath));
    return mediaResponse(req, poster, "image/jpeg");
  }

  const data = await readFile(absPath(art.filePath));
  const ext = path.extname(art.filePath).toLowerCase();
  return mediaResponse(req, data, MIME[ext] ?? "application/octet-stream");
}

const patchSchema = z.object({ label: z.string().max(200).nullable() });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Некорректное название");

  try {
    const art = await renameArt(auth.userId, params.id, parsed.data.label);
    return NextResponse.json({ id: art.id, label: art.label });
  } catch (e) {
    const protectedResponse=studioProtectionResponse(e); if(protectedResponse)return protectedResponse;
    if ((e as Error).message === "NOT_FOUND") return notFound();
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  try {
    await deleteArt(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const protectedResponse=studioProtectionResponse(e); if(protectedResponse)return protectedResponse;
    if ((e as Error).message === "NOT_FOUND") return notFound();
    throw e;
  }
}
