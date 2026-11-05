import { readFile } from "node:fs/promises";
import path from "node:path";
import { userOr401, notFound, mediaResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const track = await prisma.track.findFirst({
    where: { id: params.id, tournament: { userId: auth.userId } },
    include: { coverArt: true },
  });
  if (!track) return notFound();
  const filePath =
    (track.coverArt?.userId === auth.userId ? track.coverArt.filePath : null) ??
    track.coverPath;
  if (!filePath) return notFound();
  const data = await readFile(absPath(filePath)).catch(() => null);
  if (!data) return notFound();
  const mime: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const response = mediaResponse(
    req,
    data,
    mime[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
  );
  response.headers.set("Cache-Control", "private, no-cache, max-age=0");
  return response;
}
