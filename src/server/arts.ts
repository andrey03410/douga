import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import { saveFile, removePath, artPath, absPath } from "@/lib/storage";
import { probeMediaInfo, extractPoster } from "@/lib/audio";
import { AUDIO_EXT, VIDEO_EXT, IMG_EXT } from "@/lib/domain/media-ext";
import { usageBreakdown, type UsageBreakdown } from "@/lib/domain/art-usage";
import type { MediaKind } from "@/lib/domain/position-media";

/** Pool media kinds: visuals (image/video) + phase-6 audio tracks. */
export type PoolKind = MediaKind | "audio";

// Service layer for the user's media pool (images + videos): listing/search/
// pagination, upload, rename, delete. Kept framework-free (thin routes on top)
// so the full behavior is covered by integration tests against the real schema.

export { IMG_EXT, VIDEO_EXT, AUDIO_EXT };

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const RECENT_LIMIT = 8;

export interface ArtRow {
  id: string;
  label: string | null;
  filePath: string;
  kind: PoolKind;
  durationSec: number | null;
  hasAudio: boolean;
  posterPath: string | null;
  sizeBytes: number | null;
  /** Everything that points at this media, grouped (phase 17). */
  usage: UsageBreakdown;
  /** Total of `usage` — kept as a field because the UI shows it on cards. */
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

// Every relation that points at an Art: a poster standing as a card in a picker
// round is just as "used" as one assigned to a top position.
const ART_INCLUDE = {
  _count: {
    select: {
      studioReferences: true,
      renderItems: true,
      audioRenderItems: true,
      pickerTiles: true,
      playlistItems: true,
      projectBgs: true,
      projectMusics: true,
      roundBgs: true,
      roundMusics: true,
    },
  },
} as const;

type ArtWithCount = Awaited<
  ReturnType<typeof prisma.art.findMany<{ include: typeof ART_INCLUDE }>>
>[number];

function toRow(a: ArtWithCount): ArtRow {
  const usage = usageBreakdown(a._count);
  return {
    id: a.id,
    label: a.label,
    filePath: a.filePath,
    kind: a.kind as PoolKind,
    durationSec: a.durationSec,
    hasAudio: a.hasAudio,
    posterPath: a.posterPath,
    sizeBytes: a.sizeBytes,
    usage,
    usageCount: usage.total,
    lastUsedAt: a.lastUsedAt,
    createdAt: a.createdAt,
  };
}

export interface ListArtsOptions {
  q?: string;
  kind?: PoolKind;
  cursor?: string;
  limit?: number;
}

/** Newest-first listing with optional label search, kind filter and cursor pagination. */
export async function listArts(
  userId: string,
  opts: ListArtsOptions = {},
): Promise<{ arts: ArtRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const q = opts.q?.trim();

  const rows = await prisma.art.findMany({
    where: {
      userId,
      ...(q ? { label: { contains: q } } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
    },
    include: ART_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, // one extra row tells us whether a next page exists
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, limit);
  return {
    arts: page.map(toRow),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

/** Media recently assigned to render items, most recent first. */
export async function listRecentArts(
  userId: string,
  limit = RECENT_LIMIT,
): Promise<ArtRow[]> {
  const rows = await prisma.art.findMany({
    where: { userId, lastUsedAt: { not: null } },
    include: ART_INCLUDE,
    orderBy: { lastUsedAt: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}

export interface CreateArtInput {
  fileName: string;
  data: Buffer;
  label?: string | null;
  /** Total pool size ceiling for this user in bytes; null = unlimited. */
  maxPoolBytes?: number | null;
}

/** Total bytes the user's pool occupies (sum of stored file sizes). */
export async function poolUsageBytes(userId: string): Promise<number> {
  const agg = await prisma.art.aggregate({
    where: { userId },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

/**
 * Store an uploaded image or video; the label defaults to the file name sans
 * extension. Videos get their duration/audio-stream flag probed via ffmpeg and
 * a poster frame extracted (best-effort — a video without one still works).
 */
export async function createArt(userId: string, input: CreateArtInput) {
  const ext = (path.extname(input.fileName) || ".jpg").toLowerCase();
  const kind: PoolKind | null = IMG_EXT.includes(ext)
    ? "image"
    : VIDEO_EXT.includes(ext)
      ? "video"
      : AUDIO_EXT.includes(ext)
        ? "audio"
        : null;
  if (!kind) throw new Error("BAD_EXT");

  const label =
    input.label?.trim() ||
    path.basename(input.fileName, path.extname(input.fileName)).trim() ||
    null;

  // Quota claim happens in one transaction with the row insert (sizeBytes is
  // set immediately), so two concurrent uploads can't both fit into the last
  // free megabytes.
  const art = await prisma.$transaction(async (tx) => {
    const max = input.maxPoolBytes ?? null;
    if (max !== null) {
      const agg = await tx.art.aggregate({ where: { userId }, _sum: { sizeBytes: true } });
      const used = agg._sum.sizeBytes ?? 0;
      if (used + input.data.length > max) throw new Error("POOL_QUOTA");
    }
    return tx.art.create({
      data: { userId, filePath: "", label, kind, sizeBytes: input.data.length },
    });
  });
  const rel = await saveFile(artPath(userId, art.id, ext), input.data);

  let durationSec: number | null = null;
  let hasAudio = false;
  let posterPath: string | null = null;
  if (kind === "video" || kind === "audio") {
    const info = await probeMediaInfo(absPath(rel));
    durationSec = info.durationSec;
    hasAudio = info.hasAudio;
  }
  if (kind === "video") {
    const posterRel = artPath(userId, `${art.id}.poster`, ".jpg");
    try {
      await extractPoster(absPath(rel), absPath(posterRel));
      posterPath = posterRel;
    } catch {
      // no extractable frame -> cards fall back to a generic tile
    }
  }

  return prisma.art.update({
    where: { id: art.id },
    data: { filePath: rel, durationSec, hasAudio, posterPath },
  });
}

export interface CreateArtFromFileInput {
  /** Absolute path of an existing file to absorb into the pool (moved/copied). */
  sourcePath: string;
  fileName: string;
  label?: string | null;
  maxPoolBytes?: number | null;
}

/**
 * Absorb an on-disk file into the pool without buffering it in memory
 * (URL imports can be hundreds of MB). Same transactional quota claim and
 * probing/poster flow as createArt.
 */
export async function createArtFromFile(userId: string, input: CreateArtFromFileInput) {
  const ext = (path.extname(input.fileName) || path.extname(input.sourcePath) || "").toLowerCase();
  const kind: PoolKind | null = IMG_EXT.includes(ext)
    ? "image"
    : VIDEO_EXT.includes(ext)
      ? "video"
      : AUDIO_EXT.includes(ext)
        ? "audio"
        : null;
  if (!kind) throw new Error("BAD_EXT");

  const { stat, copyFile, rename, unlink } = await import("node:fs/promises");
  const sizeBytes = (await stat(input.sourcePath)).size;

  const label =
    input.label?.trim() ||
    path.basename(input.fileName, path.extname(input.fileName)).trim() ||
    null;

  const art = await prisma.$transaction(async (tx) => {
    const max = input.maxPoolBytes ?? null;
    if (max !== null) {
      const agg = await tx.art.aggregate({ where: { userId }, _sum: { sizeBytes: true } });
      const used = agg._sum.sizeBytes ?? 0;
      if (used + sizeBytes > max) throw new Error("POOL_QUOTA");
    }
    return tx.art.create({ data: { userId, filePath: "", label, kind, sizeBytes } });
  });

  const rel = artPath(userId, art.id, ext);
  const dest = absPath(rel);
  await (await import("node:fs/promises")).mkdir(path.dirname(dest), { recursive: true });
  try {
    await rename(input.sourcePath, dest); // same volume: cheap move
  } catch {
    await copyFile(input.sourcePath, dest);
    await unlink(input.sourcePath).catch(() => {});
  }

  let durationSec: number | null = null;
  let hasAudio = false;
  let posterPath: string | null = null;
  if (kind === "video" || kind === "audio") {
    const info = await probeMediaInfo(dest);
    durationSec = info.durationSec;
    hasAudio = info.hasAudio;
  }
  if (kind === "video") {
    const posterRel = artPath(userId, `${art.id}.poster`, ".jpg");
    try {
      await extractPoster(dest, absPath(posterRel));
      posterPath = posterRel;
    } catch {
      // no extractable frame -> cards fall back to a generic tile
    }
  }

  return prisma.art.update({
    where: { id: art.id },
    data: { filePath: rel, durationSec, hasAudio, posterPath },
  });
}

async function ownedArt(userId: string, artId: string) {
  const art = await prisma.art.findFirst({ where: { id: artId, userId } });
  if (!art) throw new Error("NOT_FOUND");
  return art;
}

export async function renameArt(userId: string, artId: string, label: string | null) {
  const art = await ownedArt(userId, artId);
  return prisma.art.update({
    where: { id: art.id },
    data: { label: label?.trim() || null },
  });
}

/**
 * Delete a pool media: positions referencing it are freed (artId -> null via
 * the FK) and their per-position settings (crop, audio source, footage offset)
 * reset to defaults in the same transaction; files are removed afterwards
 * (best-effort).
 */
export async function deleteArt(userId: string, artId: string) {
  const art = await ownedArt(userId, artId);
  await prisma.$transaction(async tx => {
    if (await tx.studioAssetReference.count({where:{artId:art.id}})) throw new Error("STUDIO_ASSET_IN_USE");
    await tx.renderItem.updateMany({
      where: { artId: art.id },
      data: {
        artCropX: null,
        artCropY: null,
        artCropW: null,
        artCropH: null,
        audioSource: "track",
        mediaStartSec: null,
        // positions that were listening to this media need a fresh RMS pass
        resolvedStartSec: null,
      },
    });
    await tx.art.delete({ where: { id: art.id } });
  });
  await removePath(art.filePath);
  if (art.posterPath) await removePath(art.posterPath);
}

/** One cleanup pass must not be able to wipe the whole pool by accident. */
export const MAX_BULK_DELETE = 200;

export interface BulkDeleteResult {
  deleted: string[];
  failed: { id: string; reason: string }[];
}

/**
 * Delete several pool media in one pass (phase 17). Each id goes through
 * `deleteArt`, so the cascade and the freeing of top positions are identical to
 * a single delete; an id that cannot be deleted is reported, not fatal.
 */
export async function deleteArts(userId: string, ids: string[]): Promise<BulkDeleteResult> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id))];
  if (!unique.length) throw new Error("NO_IDS");
  if (unique.length > MAX_BULK_DELETE) throw new Error("TOO_MANY");

  const deleted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of unique) {
    try {
      await deleteArt(userId, id);
      deleted.push(id);
    } catch (e) {
      failed.push({ id, reason: (e as Error).message || "FAILED" });
    }
  }
  return { deleted, failed };
}

/** Prepared pool bytes, with no visible database row. Caller owns the directory
 * and must publish with its authorization/quota/attempt transaction or clean it. */
export interface PreparedPoolArt {
  id: string;
  filePath: string;
  label: string | null;
  kind: PoolKind;
  sizeBytes: number;
  durationSec: number | null;
  hasAudio: boolean;
  posterPath: string | null;
}
export async function preparePoolArtFromFile(input: {
  id: string;
  sourcePath: string;
  directory: string;
  kind: "audio" | "video";
  label: string | null;
}): Promise<PreparedPoolArt> {
  const { mkdir, copyFile, stat } = await import("node:fs/promises");
  const ext = path.extname(input.sourcePath).toLowerCase();
  if (!(input.kind === "audio" ? AUDIO_EXT : VIDEO_EXT).includes(ext))
    throw new Error("BAD_EXT");
  const filePath = `${input.directory}/media${ext}`;
  await mkdir(absPath(input.directory), { recursive: true });
  await copyFile(input.sourcePath, absPath(filePath));
  const info = await probeMediaInfo(absPath(filePath));
  if (
    !info.durationSec ||
    (input.kind === "video" ? !info.hasVideo : !info.hasAudio)
  )
    throw new Error("IMPORT_MEDIA_INVALID");
  let posterPath: string | null = null;
  if (input.kind === "video") {
    const poster = `${input.directory}/poster.jpg`;
    try {
      await extractPoster(absPath(filePath), absPath(poster));
      posterPath = poster;
    } catch {
      await removePath(poster);
    }
  }
  return {
    id: input.id,
    filePath,
    label: input.label,
    kind: input.kind,
    sizeBytes: (await stat(absPath(filePath))).size,
    durationSec: info.durationSec,
    hasAudio: info.hasAudio,
    posterPath,
  };
}
