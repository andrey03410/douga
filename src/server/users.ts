import "server-only";
import path from "node:path";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { can, isAssignableRole, quotasFor } from "@/lib/domain/permissions";
import { BOOTSTRAP_ROLE, isBootstrapAdmin } from "@/server/roles";
import { activeJobStatuses } from "@/server/studio/job-types";

// Personal-cabinet usage overview + admin user management. Framework-free
// (thin routes on top), covered by integration tests against the real schema.

async function fileSize(relative: string): Promise<number> {
  try {
    return (await stat(absPath(relative))).size;
  } catch {
    return 0; // file missing on disk -> counts as zero, not an error
  }
}

/**
 * Backfill sizeBytes for rows created before phase 5 (best-effort, persisted so
 * the stat() cost is paid once per row instead of on every cabinet visit).
 */
async function backfillSizes(userId: string): Promise<void> {
  const tracks = await prisma.track.findMany({
    where: { tournament: { userId }, sizeBytes: null, filePath: { not: "" } },
    select: { id: true, filePath: true },
  });
  for (const t of tracks) {
    await prisma.track.updateMany({
      where: { id: t.id, sizeBytes: null },
      data: { sizeBytes: await fileSize(t.filePath) },
    });
  }
  const arts = await prisma.art.findMany({
    where: { userId, sizeBytes: null, filePath: { not: "" } },
    select: { id: true, filePath: true },
  });
  for (const a of arts) {
    await prisma.art.updateMany({
      where: { id: a.id, sizeBytes: null },
      data: { sizeBytes: await fileSize(a.filePath) },
    });
  }
}

interface KindTotals {
  count: number;
  bytes: number;
}

export interface UsageSummary {
  studio: {
    projects: number;
    revisions: number;
    snapshots: number;
    bytes: number;
    jobs: number;
    resultBytes: number;
  };
  role: string;
  quotas: ReturnType<typeof quotasFor>;
  /** Pool totals with a per-kind split (images/videos/audio). */
  pool: KindTotals & {
    byKind: Record<"image" | "video" | "audio", KindTotals>;
  };
  archives: KindTotals;
  /** Legacy aliases the quota lines are drawn from. */
  archiveBytes: number;
  poolBytes: number;
  tournamentCount: number;
}

/**
 * What the personal cabinet shows above the lists: quotas and totals, computed
 * with aggregates only. The lists themselves are loaded on demand (a pool of a
 * thousand posters must not be part of this response).
 */
export async function usageSummary(userId: string): Promise<UsageSummary> {
  await backfillSizes(userId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true },
  });

  const poolByKind = await prisma.art.groupBy({
    by: ["kind"],
    where: { userId },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  const empty = (): KindTotals => ({ count: 0, bytes: 0 });
  const byKind: Record<"image" | "video" | "audio", KindTotals> = {
    image: empty(),
    video: empty(),
    audio: empty(),
  };
  for (const row of poolByKind) {
    const kind = row.kind as "image" | "video" | "audio";
    if (!byKind[kind]) continue;
    byKind[kind] = { count: row._count._all, bytes: row._sum.sizeBytes ?? 0 };
  }
  const pool = {
    count: Object.values(byKind).reduce((n, k) => n + k.count, 0),
    bytes: Object.values(byKind).reduce((n, k) => n + k.bytes, 0),
    byKind,
  };

  const [tournamentCount, trackAgg] = await Promise.all([
    prisma.tournament.count({ where: { userId } }),
    prisma.track.aggregate({
      where: { tournament: { userId } },
      _sum: { sizeBytes: true },
    }),
  ]);
  const archives: KindTotals = {
    count: tournamentCount,
    bytes: trackAgg._sum.sizeBytes ?? 0,
  };

  const studioProjects = await prisma.studioProject.findMany({
    where: { userId },
    include: {
      revisions: { select: { assetsJson: true } },
      _count: { select: { snapshots: true } },
    },
  });
  const studioFiles = new Map<string, number>();
  for (const project of studioProjects)
    for (const revision of project.revisions) {
      if (!revision.assetsJson) continue;
      const assets = JSON.parse(revision.assetsJson) as {
        files: Record<
          string,
          {
            path: string;
            bytes: number;
            posterPath?: string;
            posterBytes?: number;
          }
        >;
      };
      for (const file of Object.values(assets.files)) {
        studioFiles.set(file.path, file.bytes);
        if (file.posterPath)
          studioFiles.set(file.posterPath, file.posterBytes ?? 0);
      }
    }
  const [studioJobs, exportCache] = await Promise.all([
    prisma.studioJob.aggregate({
      where: { userId },
      _count: true,
      _sum: { outputBytes: true },
    }),
    prisma.studioExportCache.aggregate({
      where: { userId },
      _sum: { bytes: true },
    }),
  ]);
  const studio = {
    jobs: studioJobs._count,
    resultBytes: studioJobs._sum.outputBytes ?? 0,
    projects: studioProjects.length,
    revisions: studioProjects.reduce((n, p) => n + p.revisions.length, 0),
    snapshots: studioProjects.reduce((n, p) => n + p._count.snapshots, 0),
    bytes:
      [...studioFiles.values()].reduce((n, b) => n + b, 0) +
      (exportCache._sum.bytes ?? 0),
  };
  return {
    studio,
    role: user.role,
    quotas: quotasFor(user.role),
    pool,
    archives,
    archiveBytes: archives.bytes,
    poolBytes: pool.bytes,
    tournamentCount,
  };
}

export interface ArchiveRow {
  id: string;
  title: string;
  status: string;
  trackCount: number;
  sizeBytes: number;
  createdAt: Date;
}

/** Archives for the cabinet list. Few by design (quotas cap them), so no paging. */
export async function listArchiveRows(userId: string): Promise<ArchiveRow[]> {
  const rows = await prisma.tournament.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { tracks: true } },
      tracks: { select: { sizeBytes: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    trackCount: t._count.tracks,
    sizeBytes: t.tracks.reduce((sum, tr) => sum + (tr.sizeBytes ?? 0), 0),
    createdAt: t.createdAt,
  }));
}

// ---- Admin: user management ----

export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  tournamentCount: number;
  diskBytes: number;
  /** Listed in ADMIN_EMAILS: elevated on every login, so it cannot be demoted here. */
  bootstrapAdmin: boolean;
}

export async function listUsers(): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  const rows: AdminUserRow[] = [];
  for (const u of users) {
    await backfillSizes(u.id);
    const [trackAgg, artAgg, tournamentCount] = await Promise.all([
      prisma.track.aggregate({
        where: { tournament: { userId: u.id } },
        _sum: { sizeBytes: true },
      }),
      prisma.art.aggregate({
        where: { userId: u.id },
        _sum: { sizeBytes: true },
      }),
      prisma.tournament.count({ where: { userId: u.id } }),
    ]);
    rows.push({
      ...u,
      tournamentCount,
      diskBytes: (trackAgg._sum.sizeBytes ?? 0) + (artAgg._sum.sizeBytes ?? 0),
      bootstrapAdmin: isBootstrapAdmin(u.email),
    });
  }
  return rows;
}

/**
 * Change a user's role. Actors cannot change their own role (last-admin guard).
 * An email listed in ADMIN_EMAILS is elevated back on its next login, so a
 * demotion would silently undo itself: refused with ADMIN_BOOTSTRAP.
 */
export async function setUserRole(
  actorId: string,
  targetId: string,
  role: string,
) {
  if (!isAssignableRole(role)) throw new Error("BAD_ROLE");
  if (actorId === targetId) throw new Error("SELF_CHANGE");
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("NOT_FOUND");
  if (role !== BOOTSTRAP_ROLE && isBootstrapAdmin(target.email)) {
    throw new Error("ADMIN_BOOTSTRAP");
  }
  return prisma.user.update({ where: { id: targetId }, data: { role } });
}

/**
 * Delete a user with everything they own on disk: tournament media, the media
 * pool directory, Studio revision media and job results. DB rows go via
 * cascade, except the Restrict-guarded Studio rows, which are deleted
 * explicitly. Refused with JOB_IN_USE while a Studio job is active (same rule
 * as deleteStudioJob); finished jobs go with the account.
 */
export async function deleteUser(actorId: string, targetId: string) {
  if (actorId === targetId) throw new Error("SELF_CHANGE");
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!can(actor?.role, "admin:users")) throw new Error("FORBIDDEN");
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    include: { tournaments: true },
  });
  if (!target) throw new Error("NOT_FOUND");

  // Delete references and rows atomically before releasing any user bytes.
  await prisma.$transaction(async (tx) => {
    const activeJobs = await tx.studioJob.count({
      where: {
        userId: targetId,
        OR: [
          { status: { in: activeJobStatuses } },
          { leaseUntil: { gt: new Date() } },
        ],
      },
    });
    if (activeJobs) throw new Error("JOB_IN_USE");
    // Jobs reference snapshots and projects with onDelete: Restrict.
    await tx.studioJob.deleteMany({ where: { userId: targetId } });
    await tx.studioPublication.deleteMany({ where: { userId: targetId } });
    await tx.studioSnapshot.deleteMany({
      where: { project: { userId: targetId } },
    });
    await tx.studioProject.deleteMany({ where: { userId: targetId } });
    // Covers/posters restrict Art deletion. Remove their owning tournaments
    // before the User cascade reaches the media pool.
    await tx.tournament.deleteMany({ where: { userId: targetId } });
    await tx.user.delete({ where: { id: targetId } });
  });
  await removePath(path.join("studio", targetId));
  await removePath(path.join("studio-jobs", targetId));
  await removePath(path.join("studio-exports", targetId));
  for (const t of target.tournaments) {
    await removePath(path.join("tournaments", t.id));
  }
  await removePath(path.join("arts", targetId));
}
