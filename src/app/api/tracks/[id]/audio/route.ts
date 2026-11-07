import { readFile } from "node:fs/promises";
import path from "node:path";
import { userOr401, notFound, mediaResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  // video tracks are served from the same route (players pick the track by kind)
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  // task 33: picture participants (SDK bindings without media:"cover")
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const track = await prisma.track.findFirst({
    where: { id: params.id, tournament: { userId: auth.userId } },
  });
  if (!track) return notFound();

  const data = await readFile(absPath(track.filePath));
  const ext = path.extname(track.filePath).toLowerCase();
  return mediaResponse(req, data, MIME[ext] ?? "application/octet-stream");
}
