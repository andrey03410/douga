import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { CompiledVideo } from "@/video";
import { rewritePlanMedia, type WatchMediaName } from "@/watch/model";
import { safeFile } from "./assets";
import { streamStudioFile, studioMimeType } from "./http-media";
import type { StudioFrozenRevision } from "./types";

const PUBLIC_FILE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/i;

export type PublicWatch =
  | { ok: false }
  | { ok: true; title: string; plan: CompiledVideo };

function mediaNames(
  frozen: StudioFrozenRevision,
): Record<string, WatchMediaName> {
  const names: Record<string, WatchMediaName> = {};
  for (const file of Object.values(frozen.files)) {
    const name: WatchMediaName = {
      file: `${file.hash}${path.extname(file.path).toLowerCase()}`,
    };
    if (file.posterHash && file.posterPath)
      name.poster = `${file.posterHash}${path.extname(file.posterPath).toLowerCase()}`;
    names[file.hash] = name;
  }
  return names;
}

function locate(frozen: StudioFrozenRevision, fileName: string): string | null {
  const wanted = fileName.toLowerCase();
  for (const file of Object.values(frozen.files)) {
    const main = `${file.hash}${path.extname(file.path).toLowerCase()}`;
    if (main === wanted) return file.path;
    if (file.posterHash && file.posterPath) {
      const poster = `${file.posterHash}${path.extname(file.posterPath).toLowerCase()}`;
      if (poster === wanted) return file.posterPath;
    }
  }
  return null;
}

async function frozenByToken(token: string): Promise<StudioFrozenRevision | null> {
  const row = await prisma.studioPublication.findUnique({
    where: { token },
    include: { snapshot: true },
  });
  if (!row) return null;
  return JSON.parse(row.snapshot.payloadJson) as StudioFrozenRevision;
}

export async function loadPublicWatch(token: string): Promise<PublicWatch> {
  const frozen = await frozenByToken(token);
  if (!frozen) return { ok: false };
  return {
    ok: true,
    title: frozen.document.title,
    plan: rewritePlanMedia(frozen.plan, mediaNames(frozen), token),
  };
}

export async function publicWatchMedia(
  token: string,
  fileName: string,
  req: Request,
): Promise<Response> {
  if (!PUBLIC_FILE.test(fileName)) return new Response(null, { status: 404 });
  const frozen = await frozenByToken(token);
  const relative = frozen ? locate(frozen, fileName) : null;
  if (!relative) return new Response(null, { status: 404 });
  try {
    return await streamStudioFile(req, {
      path: await safeFile(relative),
      mimeType: studioMimeType(fileName),
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
