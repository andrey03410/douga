import "server-only";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { quotasFor } from "@/lib/domain/permissions";
import { extractTrackFromBuffer, type ExtractedTrack } from "@/lib/upload";
import { readLocalTournamentTrack } from "./local-media";
import { shikimoriParticipants, type SkippedItem } from "./shikimori";
import {
  MAX_PARTICIPANTS,
  assertNoDuplicates,
  participantBytes,
  participantRow,
  reopenForNewcomers,
  storeParticipantFiles,
} from "./tournaments";
import { aggregateTournamentStatus, completeSingleton, ensureTournamentSegments } from "./tournament-segments";
import { parseOverlay } from "@/lib/domain/segment-run";

/**
 * Task 33: where tournament participants come from and how the composition
 * changes after creation — sources (disk, pool, Shikimori), adding to a running
 * or finished segment, deleting, excluding and returning.
 */

const caption = {
  title: z.string().trim().min(1).max(500).optional(),
  subtitle: z.string().trim().max(500).optional(),
  note: z.string().trim().max(2000).optional(),
};

export const itemSourceSchema = z.union([
  z.object({ path: z.string().min(1), ...caption }).strict(),
  z.object({ assetId: z.string().min(1), ...caption }).strict(),
  z
    .object({
      shikimori: z
        .object({ type: z.enum(["character", "anime"]), id: z.number().int().positive() })
        .strict(),
      ...caption,
    })
    .strict(),
]);
export type ItemSource = z.infer<typeof itemSourceSchema>;
/**
 * What the site may send: the person's pool and Shikimori. Disk paths are an
 * MCP-only source (MCP_LOCAL_MEDIA_DIRS of the machine owner), never HTTP.
 */
export const webItemSourceSchema = z.union([itemSourceSchema.options[1], itemSourceSchema.options[2]]);

/** Shikimori participants one call may fetch (~75 s of pictures at 250 ms each). */
export const MAX_SHIKIMORI_PER_CALL = 300;

export interface ResolvedSources {
  tracks: (ExtractedTrack | null)[];
  skipped: SkippedItem[];
}

function applyCaption(t: ExtractedTrack, s: ItemSource): ExtractedTrack {
  return {
    ...t,
    title: s.title ?? t.title,
    subtitle: s.subtitle ?? t.subtitle ?? null,
    note: s.note ?? t.note ?? null,
  };
}

/**
 * Read every source into participant files. Structural problems (someone
 * else's pool item, a path outside the allowlist, quota) throw and fail the
 * whole call; a Shikimori participant that cannot be fetched is skipped (P11).
 */
export async function resolveItemSources(
  userId: string,
  sources: ItemSource[],
  maxBytes: number,
): Promise<ResolvedSources> {
  const shikimori = sources
    .map((s, index) => ({ s, index }))
    .filter((x): x is { s: Extract<ItemSource, { shikimori: unknown }>; index: number } => "shikimori" in x.s);
  if (shikimori.length > MAX_SHIKIMORI_PER_CALL) throw new Error("TOO_MANY_SHIKIMORI");
  const tracks: (ExtractedTrack | null)[] = sources.map(() => null);
  let bytes = 0;
  const spend = (t: ExtractedTrack) => {
    bytes += participantBytes(t);
    if (bytes > maxBytes) throw new Error("ARCHIVE_QUOTA");
  };
  for (const [index, s] of sources.entries()) {
    if ("path" in s) {
      const t = await readLocalTournamentTrack(s.path, maxBytes - bytes);
      spend(t);
      tracks[index] = applyCaption(t, s);
    } else if ("assetId" in s) {
      const art = await prisma.art.findFirst({ where: { id: s.assetId, userId } });
      if (!art) throw new Error("NOT_FOUND");
      const full = absPath(art.filePath);
      if ((await stat(full)).size > maxBytes - bytes) throw new Error("ARCHIVE_QUOTA");
      const t = await extractTrackFromBuffer(path.basename(art.filePath), await readFile(full));
      t.title = art.label ?? t.title;
      if (t.kind !== "image") t.durationSec = art.durationSec ?? t.durationSec;
      t.sourceKey = `art:${art.id}`;
      spend(t);
      tracks[index] = applyCaption(t, s);
    }
  }
  const fetched = await shikimoriParticipants(
    shikimori.map(({ s }) => ({
      type: s.shikimori.type,
      id: s.shikimori.id,
      title: s.title,
      subtitle: s.subtitle,
      note: s.note,
    })),
  );
  fetched.tracks.forEach((t, i) => {
    if (!t) return;
    spend(t);
    tracks[shikimori[i].index] = t;
  });
  return {
    tracks,
    skipped: fetched.skipped.map((s) => ({ ...s, index: shikimori[s.index].index })),
  };
}

export interface AddTarget {
  segmentId?: string;
  /** Create a new segment with this title instead. */
  segmentTitle?: string;
}

/**
 * Add participants to a tournament. A running segment simply has more to
 * compare; a finished one reopens and the newcomers are inserted into its
 * persisted order (P14).
 */
export async function addParticipants(
  userId: string,
  tournamentId: string,
  target: AddTarget,
  tracks: ExtractedTrack[],
) {
  if (!tracks.length) throw new Error("NOTHING_TO_ADD");
  const written: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.tournament.updateMany({
          where: { id: tournamentId, userId },
          data: { updatedAt: new Date() },
        });
        if (!claimed.count) throw new Error("NOT_FOUND");
        await ensureTournamentSegments(tx, tournamentId);
        const tournament = await tx.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
          include: { user: true, segments: { orderBy: { order: "asc" } } },
        });
        const quota = quotasFor(tournament.user.role);
        const existing = await tx.track.findMany({ where: { tournamentId } });
        if (existing.length + tracks.length > MAX_PARTICIPANTS) throw new Error("TOO_MANY_PARTICIPANTS");
        const used = existing.reduce((n, t) => n + (t.sizeBytes ?? 0), 0);
        if (used + tracks.reduce((n, t) => n + participantBytes(t), 0) > quota.maxArchiveBytes)
          throw new Error("ARCHIVE_QUOTA");
        let segment = target.segmentId
          ? tournament.segments.find((s) => s.id === target.segmentId)
          : target.segmentTitle
            ? undefined
            : tournament.segments[0];
        if (target.segmentId && !segment) throw new Error("NOT_FOUND");
        if (!segment)
          segment = await tx.tournamentSegment.create({
            data: {
              tournamentId,
              title: target.segmentTitle?.trim() || "Новые участники",
              order: tournament.segments.length,
            },
          });
        const inSegment = existing.filter((t) => t.segmentId === segment!.id);
        assertNoDuplicates([...inSegment, ...tracks]);
        let order = inSegment.reduce((m, t) => Math.max(m, t.order), -1) + 1;
        const ids: string[] = [];
        for (const t of tracks) {
          const created = await tx.track.create({
            data: {
              tournamentId,
              segmentId: segment.id,
              ...participantRow(t),
              filePath: "",
              order: order++,
            },
          });
          const files = await storeParticipantFiles(tournamentId, created.id, t);
          written.push(files.filePath, ...(files.coverPath ? [files.coverPath] : []));
          await tx.track.update({ where: { id: created.id }, data: files });
          ids.push(created.id);
        }
        await reopenForNewcomers(tx, tournament, segment, ids);
        await completeSingleton(tx, segment.id);
        await aggregateTournamentStatus(tx, tournamentId);
        return { segmentId: segment.id, added: ids };
      },
      { timeout: 300000 },
    );
  } catch (e) {
    for (const f of new Set(written)) await removePath(f).catch(() => {});
    throw e;
  }
}

/**
 * Delete participants for good. Screens that showed them are removed whole
 * (as when moving between segments, task 27); with answers at stake the call
 * first returns how many screens it would take.
 */
export async function deleteParticipants(
  userId: string,
  tournamentId: string,
  trackIds: string[],
  confirmReset = false,
) {
  const ids = [...new Set(trackIds)];
  if (!ids.length) throw new Error("NOTHING_TO_DELETE");
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({
      where: { id: tournamentId, userId },
      data: { updatedAt: new Date() },
    });
    if (!claimed.count) throw new Error("NOT_FOUND");
    const tracks = await tx.track.findMany({ where: { tournamentId, id: { in: ids } } });
    if (tracks.length !== ids.length) throw new Error("NOT_FOUND");
    if (await tx.studioAssetReference.count({ where: { trackId: { in: ids } } }))
      throw new Error("STUDIO_ASSET_IN_USE");
    const gone = new Set(ids);
    const batches = (await tx.comparisonBatch.findMany({ where: { tournamentId } })).filter((b) =>
      (JSON.parse(b.itemIds) as string[]).some((id) => gone.has(id)),
    );
    const legacy = (
      await tx.comparison.findMany({ where: { tournamentId, batchId: null } })
    ).filter((c) => gone.has(c.trackAId) || gone.has(c.trackBId));
    const answersToReset = batches.filter((b) => b.kind !== "tier").length + legacy.length;
    if (answersToReset && !confirmReset)
      return { requiresConfirmation: true as const, answersToReset, files: [] as string[] };
    if (batches.length)
      await tx.comparisonBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
    await tx.comparison.deleteMany({
      where: { tournamentId, OR: [{ trackAId: { in: ids } }, { trackBId: { in: ids } }] },
    });
    const segments = [...new Set(tracks.map((t) => t.segmentId).filter((s): s is string => Boolean(s)))];
    await tx.ranking.deleteMany({ where: { tournamentId, trackId: { in: ids } } });
    await tx.track.deleteMany({ where: { id: { in: ids } } });
    for (const segmentId of segments) {
      await renumber(tx, tournamentId, segmentId);
      await pruneOverlay(tx, segmentId, gone);
      await completeSingleton(tx, segmentId);
    }
    await aggregateTournamentStatus(tx, tournamentId);
    const files = tracks.flatMap((t) => [t.filePath, t.coverPath]).filter((f): f is string => Boolean(f));
    return { requiresConfirmation: false as const, answersToReset, files };
  });
  for (const f of new Set(result.files)) await removePath(f).catch(() => {});
  return { requiresConfirmation: result.requiresConfirmation, answersToReset: result.answersToReset };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Close the gaps in a segment's persisted places, keeping their order. */
async function renumber(tx: Tx, tournamentId: string, segmentId: string) {
  const rows = await tx.ranking.findMany({ where: { tournamentId, segmentId }, orderBy: { rank: "asc" } });
  for (const [i, r] of rows.entries())
    if (r.rank !== i + 1) await tx.ranking.update({ where: { id: r.id }, data: { rank: i + 1 } });
}

async function pruneOverlay(tx: Tx, segmentId: string, gone: Set<string>) {
  const segment = await tx.tournamentSegment.findUnique({ where: { id: segmentId } });
  const overlay = parseOverlay(segment?.insertBase);
  if (!segment || !overlay) return;
  await tx.tournamentSegment.update({
    where: { id: segmentId },
    data: {
      insertBase: JSON.stringify({
        ...overlay,
        base: overlay.base.filter((id) => !gone.has(id)),
        pending: overlay.pending.filter((id) => !gone.has(id)),
      }),
    },
  });
}

/**
 * Exclude a participant or bring it back (P13). Answers stay in the log. In a
 * finished segment an excluded participant leaves the places (the rest close
 * up, manual order kept); a returning one is inserted back (P14).
 */
export async function setExcluded(userId: string, trackId: string, excluded: boolean) {
  return prisma.$transaction(async (tx) => {
    const track = await tx.track.findFirst({
      where: { id: trackId, tournament: { userId } },
      include: { tournament: true, segment: true },
    });
    if (!track) throw new Error("NOT_FOUND");
    if (track.excluded === excluded) return { excluded };
    await tx.tournament.update({ where: { id: track.tournamentId }, data: { updatedAt: new Date() } });
    await tx.track.update({ where: { id: trackId }, data: { excluded } });
    const segment = track.segment;
    if (segment) {
      if (excluded) {
        await tx.ranking.deleteMany({ where: { tournamentId: track.tournamentId, trackId } });
        await renumber(tx, track.tournamentId, segment.id);
      } else {
        await reopenForNewcomers(tx, track.tournament, segment, [trackId]);
      }
      await completeSingleton(tx, segment.id);
    }
    await aggregateTournamentStatus(tx, track.tournamentId);
    return { excluded };
  });
}
