import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { userOr401, notFound, mediaResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { makeThumbnail } from "@/lib/audio";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Small files and GIFs (which keep moving) are served as they are. */
const THUMB_MIN_BYTES = 400 * 1024;

/**
 * Cover of a track, or the picture of an image participant (task 33).
 * `?size=thumb` serves a cached 480px JPEG for the compare grid; it is made by
 * ffmpeg once per picture and falls back to the original on any failure.
 */
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
  let served = filePath;
  const ext = path.extname(filePath).toLowerCase();
  if (new URL(req.url).searchParams.get("size") === "thumb" && ext !== ".gif") {
    const size = (await stat(absPath(filePath)).catch(() => null))?.size ?? 0;
    if (size > THUMB_MIN_BYTES) {
      const thumb = path.join(
        "tournaments",
        track.tournamentId,
        "thumbs",
        `${track.id}-${track.coverArt ? track.coverArt.id : "own"}.jpg`,
      );
      const ready = ((await stat(absPath(thumb)).catch(() => null))?.size ?? 0) > 0;
      if (!ready) {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.dirname(absPath(thumb)), { recursive: true });
        await makeThumbnail(absPath(filePath), absPath(thumb)).catch(() => {});
      }
      if (((await stat(absPath(thumb)).catch(() => null))?.size ?? 0) > 0) served = thumb;
    }
  }
  const data = await readFile(absPath(served)).catch(() => null);
  if (!data) return notFound();
  const response = mediaResponse(
    req,
    data,
    MIME[path.extname(served).toLowerCase()] ?? "application/octet-stream",
  );
  // Each URL carries the picture version (?art=…), so the browser may keep it.
  response.headers.set(
    "Cache-Control",
    new URL(req.url).searchParams.has("art") ? "private, max-age=3600" : "private, no-cache, max-age=0",
  );
  return response;
}
