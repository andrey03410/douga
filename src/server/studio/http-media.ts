import "server-only";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { actor } from "./shared";
import { safeFile } from "./assets";
import { StudioError } from "./errors";
const mime: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".mov": "video/quicktime",
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export function studioMimeType(fileName: string): string {
  return (
    mime[path.extname(fileName).toLowerCase()] ?? "application/octet-stream"
  );
}
/** Exact persisted file ledger membership, never prefix authorization. */
export async function ownedStudioMedia(userId: string, relative: string) {
  await actor(userId);
  const rows = await prisma.studioRevision.findMany({
    where: { project: { userId }, assetsJson: { contains: relative } },
    select: { assetsJson: true },
  });
  const snapshots = await prisma.studioSnapshot.findMany({
    where: { project: { userId }, payloadJson: { contains: relative } },
    select: { payloadJson: true },
  });
  let allowed = false;
  for (const json of [
    ...rows.map((r) => r.assetsJson),
    ...snapshots.map((r) => r.payloadJson),
  ]) {
    if (!json) continue;
    const ledger = JSON.parse(json);
    const files = ledger.files ?? {};
    if (
      Object.values(files).some((raw) => {
        const f = raw as { path?: string; posterPath?: string };
        return f.path === relative || f.posterPath === relative;
      })
    ) {
      allowed = true;
      break;
    }
  }
  if (!allowed)
    allowed = !!(await prisma.art.findFirst({
      where: { userId, posterPath: relative },
      select: { id: true },
    }));
  if (!allowed) throw new StudioError("NOT_FOUND");
  return { path: await safeFile(relative), mimeType: studioMimeType(relative) };
}
/** Stream with backpressure; complete files can exceed the MCP inline byte limit. */
export async function streamStudioFile(
  req: Request,
  file: {
    path: string;
    mimeType: string;
    name?: string;
    hash?: string;
    /** The URL names the content, so the browser may keep it for good. */
    immutable?: boolean;
  },
) {
  const total = (await stat(file.path)).size;
  const headers = new Headers({
    "Content-Type": file.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": file.immutable
      ? "private, max-age=31536000, immutable"
      : "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (file.hash) headers.set("ETag", `"${file.hash}"`);
  if (file.name && new URL(req.url).searchParams.get("download") === "1")
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
  const range = req.headers.get("range");
  let start = 0,
    end = total - 1,
    status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () =>
      new Response(null, {
        status: 416,
        headers: {
          ...Object.fromEntries(headers),
          "Content-Range": `bytes */${total}`,
        },
      });
    if (!m || (!m[1] && !m[2]) || !total) return invalid();
    if (!m[1]) {
      const suffix = Number(m[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
      start = Math.max(0, total - suffix);
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= total ||
      start > end
    )
      return invalid();
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (req.method === "HEAD" || total === 0)
    return new Response(null, { status, headers });
  const stream = createReadStream(file.path, { start, end });
  const abort = () => stream.destroy();
  req.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => req.signal.removeEventListener("abort", abort));
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}
