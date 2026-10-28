import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { CompiledVideo } from "@/video";
import { rewritePlanMedia, type WatchMediaName } from "@/watch/model";
import { safeFile } from "./assets";
import { streamStudioFile, studioMimeType } from "./http-media";
import type { StudioFrozenRevision } from "./types";

const PUBLIC_FILE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/i;
const INDEX_LIMIT = 32;

export type PublicWatch =
  | { ok: false }
  | { ok: true; title: string; plan: CompiledVideo };

interface SnapshotIndex {
  title: string;
  plan: CompiledVideo;
  names: Record<string, WatchMediaName>;
  /** Public file name, lower case → stored path and the hash that name carries. */
  files: Map<string, { path: string; hash: string }>;
}

/** A snapshot never changes after the freeze, so its parsed index is kept by id. */
const indexes = new Map<string, SnapshotIndex>();

function indexSnapshot(frozen: StudioFrozenRevision): SnapshotIndex {
  const names: Record<string, WatchMediaName> = {};
  const files = new Map<string, { path: string; hash: string }>();
  for (const file of Object.values(frozen.files)) {
    const name: WatchMediaName = {
      file: `${file.hash}${path.extname(file.path)}`.toLowerCase(),
    };
    files.set(name.file, { path: file.path, hash: file.hash });
    if (file.posterHash && file.posterPath) {
      name.poster = `${file.posterHash}${path.extname(file.posterPath)}`.toLowerCase();
      files.set(name.poster, { path: file.posterPath, hash: file.posterHash });
    }
    names[file.hash] = name;
  }
  return { title: frozen.document.title, plan: frozen.plan, names, files };
}

async function indexByToken(token: string): Promise<SnapshotIndex | null> {
  const row = await prisma.studioPublication.findUnique({
    where: { token },
    select: { snapshotId: true },
  });
  if (!row) return null;
  const cached = indexes.get(row.snapshotId);
  if (cached) return cached;
  const snapshot = await prisma.studioSnapshot.findUnique({
    where: { id: row.snapshotId },
    select: { payloadJson: true },
  });
  if (!snapshot) return null;
  const index = indexSnapshot(JSON.parse(snapshot.payloadJson) as StudioFrozenRevision);
  if (indexes.size >= INDEX_LIMIT) indexes.delete(indexes.keys().next().value!);
  indexes.set(row.snapshotId, index);
  return index;
}

export async function loadPublicWatch(token: string): Promise<PublicWatch> {
  const index = await indexByToken(token);
  if (!index) return { ok: false };
  return {
    ok: true,
    title: index.title,
    plan: rewritePlanMedia(index.plan, index.names, token),
  };
}

export async function publicWatchMedia(
  token: string,
  fileName: string,
  req: Request,
): Promise<Response> {
  if (!PUBLIC_FILE.test(fileName)) return new Response(null, { status: 404 });
  const file = (await indexByToken(token))?.files.get(fileName.toLowerCase());
  if (!file) return new Response(null, { status: 404 });
  try {
    return await streamStudioFile(req, {
      path: await safeFile(file.path),
      mimeType: studioMimeType(fileName),
      hash: file.hash,
      immutable: true,
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
