import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { StudioError } from "./errors";
import { freezeStudioProject } from "./revisions";
import { getStudioProject } from "./projects";
import { releaseSnapshotIfFree } from "./snapshots";
import { actor, hash, owned, receipt, replay, requestHash, type Db } from "./shared";
import type { StudioFrozenRevision } from "./types";
import { publishStudioProjectSchema, type PublishStudioProjectInput } from "./types";
import { unpublishStudioProjectSchema, type UnpublishStudioProjectInput } from "./types";

/** Test seam. Runs inside the publication transaction, before the row is written. */
export const publishTestHooks: { beforeWrite: null | (() => Promise<void>) } = {
  beforeWrite: null,
};

export interface StudioPublicationView {
  projectId: string;
  userId: string;
  token: string;
  revision: number;
  snapshotId: string;
  title: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
  updated: boolean;
}

async function present(
  db: Db,
  row: {
    projectId: string;
    userId: string;
    token: string;
    revision: number;
    snapshotId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  updated: boolean,
): Promise<StudioPublicationView> {
  const snapshot = await db.studioSnapshot.findUniqueOrThrow({
    where: { id: row.snapshotId },
  });
  const payload = JSON.parse(snapshot.payloadJson) as StudioFrozenRevision;
  return {
    projectId: row.projectId,
    userId: row.userId,
    token: row.token,
    revision: row.revision,
    snapshotId: row.snapshotId,
    title: payload.document.title,
    bytes: snapshot.bytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updated,
  };
}

/**
 * The first statement of a publication transaction writes the project row and so
 * takes SQLite's write lock. A publish from another process (site, MCP) waits here
 * and then sees this one's row instead of racing it.
 */
async function lockProject(db: Db, userId: string, projectId: string) {
  const locked = await db.$executeRaw`
    UPDATE "StudioProject" SET "id" = "id" WHERE "id" = ${projectId} AND "userId" = ${userId}
  `;
  if (locked !== 1) throw new StudioError("NOT_FOUND");
}

export function publicWatchUrl(token: string): string {
  const base = (process.env.DOUGA_PUBLIC_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/watch/${encodeURIComponent(token)}`;
}

export async function findPublicationByToken(
  token: string,
): Promise<StudioPublicationView | null> {
  const row = await prisma.studioPublication.findUnique({ where: { token } });
  if (!row) return null;
  return present(prisma, row, false);
}

export async function listStudioPublications(userId: string) {
  await actor(userId);
  const rows = await prisma.studioPublication.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      snapshot: { select: { bytes: true } },
      project: { select: { title: true } },
    },
  });
  return rows.map((row) => ({
    projectId: row.projectId,
    title: row.project.title,
    revision: row.revision,
    bytes: row.snapshot.bytes,
    token: row.token,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getStudioPublication(
  userId: string,
  projectId: string,
): Promise<StudioPublicationView | null> {
  await owned(userId, projectId);
  const row = await prisma.studioPublication.findUnique({ where: { projectId } });
  if (!row) return null;
  return present(prisma, row, false);
}

/** Publish the latest saved revision, or move the existing link onto it. */
export async function publishStudioProject(
  userId: string,
  projectId: string,
  raw: PublishStudioProjectInput = {},
): Promise<StudioPublicationView> {
  const input = publishStudioProjectSchema.parse(raw);
  const request = requestHash(`publish:${projectId}`, input);
  const replayed = await replay<StudioPublicationView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (replayed) return replayed;
  const project = await getStudioProject(userId, projectId);
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== project.version
  )
    throw new StudioError("VERSION_CONFLICT");
  const existing = await prisma.studioPublication.findUnique({
    where: { projectId },
  });
  if (existing && existing.revision === project.revision) {
    const same = await present(prisma, existing, false);
    await prisma.$transaction(async (db) => {
      const again = await replay<StudioPublicationView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (!again)
        await receipt(db, userId, input.idempotencyKey, request, same);
    });
    return same;
  }
  const internalKey = input.idempotencyKey
    ? `publish-freeze:${hash(`${userId}:${input.idempotencyKey}:${project.revision}`)}`
    : undefined;
  const frozen = await freezeStudioProject(userId, projectId, {
    expectedVersion: project.version,
    revision: project.revision,
    idempotencyKey: internalKey,
  });
  try {
    return await prisma.$transaction(async (db) => {
      await lockProject(db, userId, projectId);
      const again = await replay<StudioPublicationView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (again) return again;
      await owned(userId, projectId, db);
      const current = await db.studioPublication.findUnique({
        where: { projectId },
      });
      let row;
      let updated = false;
      let previousSnapshot: string | null = null;
      if (publishTestHooks.beforeWrite) await publishTestHooks.beforeWrite();
      if (current) {
        previousSnapshot = current.snapshotId;
        row = await db.studioPublication.update({
          where: { id: current.id },
          data: { snapshotId: frozen.snapshotId, revision: frozen.revision },
        });
        updated = true;
      } else {
        row = await db.studioPublication.create({
          data: {
            projectId,
            userId,
            token: randomBytes(16).toString("base64url"),
            snapshotId: frozen.snapshotId,
            revision: frozen.revision,
          },
        });
      }
      if (previousSnapshot && previousSnapshot !== frozen.snapshotId)
        await releaseSnapshotIfFree(previousSnapshot, db);
      const result = await present(db, row, updated);
      await receipt(db, userId, input.idempotencyKey, request, result);
      return result;
    });
  } catch (error) {
    const again = await replay<StudioPublicationView>(
      prisma,
      userId,
      input.idempotencyKey,
      request,
    );
    if (again) return again;
    throw error;
  } finally {
    // The freeze receipt must die with an unclaimed snapshot, or a retry of the
    // same key replays a snapshot id that no longer exists.
    await prisma.$transaction(async (db) => {
      const released = await releaseSnapshotIfFree(frozen.snapshotId, db);
      if (released && internalKey)
        await db.studioMutation.deleteMany({
          where: { userId, key: internalKey },
        });
    });
  }
}

export async function unpublishStudioProject(
  userId: string,
  projectId: string,
  raw: UnpublishStudioProjectInput = {},
): Promise<{ removed: boolean; projectId: string }> {
  const input = unpublishStudioProjectSchema.parse(raw);
  const request = requestHash(`unpublish:${projectId}`, input);
  const replayed = await replay<{ removed: boolean; projectId: string }>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (replayed) return replayed;
  await owned(userId, projectId);
  return prisma.$transaction(async (db) => {
    await lockProject(db, userId, projectId);
    const again = await replay<{ removed: boolean; projectId: string }>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (again) return again;
    const project = await owned(userId, projectId, db);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== project.version
    )
      throw new StudioError("VERSION_CONFLICT");
    const row = await db.studioPublication.findUnique({ where: { projectId } });
    if (!row) {
      const result = { removed: false, projectId };
      await receipt(db, userId, input.idempotencyKey, request, result);
      return result;
    }
    await db.studioPublication.delete({ where: { id: row.id } });
    await releaseSnapshotIfFree(row.snapshotId, db);
    const result = { removed: true, projectId };
    await receipt(db, userId, input.idempotencyKey, request, result);
    return result;
  });
}
