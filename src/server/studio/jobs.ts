import "server-only";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { StudioJob } from "@prisma/client";
import { can } from "@/lib/domain/permissions";
import {
  actor,
  owned,
  receipt,
  replay,
  requestHash,
  hash,
  type Db,
} from "./shared";
import { freezeStudioProject } from "./revisions";
import { StudioError } from "./errors";
import { cleanupDirectory, fileHash, safeFile } from "./assets";
import { prepareStudioEngine } from "./engine";
import type { StudioFrozenRevision } from "./types";
import {
  startStudioJobSchema,
  studioJobLimits,
  type StartStudioJobInput,
  type StudioJobView,
  type StudioJobResult,
} from "./job-types";
export const activeJobStatuses = ["queued", "running"];
export const jobDirectory = (userId: string, id: string) =>
  `studio-jobs/${userId}/${id}`;
export async function jobActor(userId: string, kind: string, db: Db = prisma) {
  const user = await actor(userId, db);
  if (kind === "render" && !can(user.role, "render:run"))
    throw new StudioError("FORBIDDEN");
  return user;
}
export async function ownedJob(userId: string, id: string, db: Db = prisma) {
  await actor(userId, db);
  const row = await db.studioJob.findFirst({ where: { id, userId } });
  if (!row) throw new StudioError("NOT_FOUND");
  return row;
}
export async function jobView(
  row: StudioJob,
  db: Db = prisma,
): Promise<StudioJobView> {
  const snapshot = row.snapshotId
    ? await db.studioSnapshot.findUnique({ where: { id: row.snapshotId } })
    : null;
  const frozen = snapshot
    ? (JSON.parse(snapshot.payloadJson) as StudioFrozenRevision)
    : null;
  return {
    id: row.id,
    projectId: row.projectId,
    snapshotId: row.snapshotId,
    kind: row.kind as StudioJobView["kind"],
    status: row.status as StudioJobView["status"],
    progress: row.progress,
    attempts: row.attempts,
    error: row.error,
    revision: frozen?.revision ?? null,
    revisionId: frozen?.revisionId ?? null,
    snapshotHash: frozen?.hash ?? null,
    engineId: row.engineId,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function assertStudioJobQuota(
  userId: string,
  role: string,
  db: Db = prisma,
  additionalBytes = 0,
) {
  const result = await db.studioJob.aggregate({
    where: { userId },
    _sum: { outputBytes: true },
  });
  if (
    !can(role, "render:run") &&
    (result._sum.outputBytes ?? 0) + additionalBytes >=
      studioJobLimits.maxResultBytesPerAccount
  )
    throw new StudioError("JOB_QUOTA_EXCEEDED");
}
function validateRequest(
  input: StartStudioJobInput,
  frozen: StudioFrozenRevision,
) {
  const { plan } = frozen;
  if (
    Object.values(frozen.files).reduce(
      (n, f) => n + f.bytes + (f.posterBytes ?? 0),
      0,
    ) > studioJobLimits.maxInputBytes
  )
    throw new StudioError("INPUT_BUDGET_EXCEEDED");
  if (input.kind !== "render") {
    if (
      input.kind !== "still" &&
      input.durationFrames > studioJobLimits.previewSeconds * plan.fps
    )
      throw new StudioError("PREVIEW_BUDGET_EXCEEDED");
    const from = input.kind === "still" ? input.frame : input.fromFrame;
    const length = input.kind === "still" ? 1 : input.durationFrames;
    if (from + length > plan.durationInFrames)
      throw new StudioError("FRAME_RANGE_INVALID");
  }
}
async function releaseUnclaimedSnapshot(
  id: string,
  userId: string,
  internalKey?: string,
) {
  await prisma.$transaction(async (db) => {
    if (!(await db.studioJob.count({ where: { snapshotId: id } }))) {
      await db.studioSnapshot.deleteMany({ where: { id } });
      if (internalKey)
        await db.studioMutation.deleteMany({
          where: { userId, key: internalKey },
        });
    }
  });
}
export async function startStudioJob(
  userId: string,
  projectId: string,
  raw: StartStudioJobInput,
): Promise<StudioJobView> {
  const input = startStudioJobSchema.parse(raw);
  await owned(userId, projectId);
  const user = await jobActor(userId, input.kind);
  const request = requestHash(`job:${projectId}`, input);
  const previous = await replay<StudioJobView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (previous) return previous;
  await assertStudioJobQuota(userId, user.role);
  if (
    (await prisma.studioJob.count({
      where: { userId, status: { in: activeJobStatuses } },
    })) >= studioJobLimits.maxActivePerAccount
  )
    throw new StudioError("JOB_QUOTA_EXCEEDED");
  const engineId = await prepareStudioEngine();
  // Separate namespace prevents collision with the account-wide outer enqueue receipt.
  const internalKey = input.idempotencyKey
    ? `job-freeze:${hash(`${userId}:${input.idempotencyKey}:${request}`)}`
    : undefined;
  const frozen = await freezeStudioProject(userId, projectId, {
    expectedVersion: input.expectedVersion,
    revision: input.revision,
    idempotencyKey: internalKey,
  });
  try {
    validateRequest(input, frozen);
    return await prisma.$transaction(async (db) => {
      await owned(userId, projectId, db);
      const user = await jobActor(userId, input.kind, db);
      const old = await replay<StudioJobView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (old) return old;
      await assertStudioJobQuota(userId, user.role, db);
      if (
        (await db.studioJob.count({
          where: { userId, status: { in: activeJobStatuses } },
        })) >= studioJobLimits.maxActivePerAccount
      )
        throw new StudioError("JOB_QUOTA_EXCEEDED");
      const row = await db.studioJob.create({
        data: {
          userId,
          projectId,
          snapshotId: frozen.snapshotId,
          kind: input.kind,
          inputJson: JSON.stringify(input),
          engineId,
        },
      });
      const result = await jobView(row, db);
      await receipt(db, userId, input.idempotencyKey, request, result);
      return result;
    });
  } catch (error) {
    const old = await replay<StudioJobView>(
      prisma,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    throw error;
  } finally {
    await releaseUnclaimedSnapshot(frozen.snapshotId, userId, internalKey);
  }
}
export async function getStudioJob(userId: string, id: string) {
  return jobView(await ownedJob(userId, id));
}
export async function cancelStudioJob(userId: string, id: string) {
  return prisma.$transaction(async (db) => {
    await ownedJob(userId, id, db);
    await db.studioJob.updateMany({
      where: { id, status: { in: activeJobStatuses } },
      data: { status: "canceled", error: null },
    });
    return jobView(await db.studioJob.findUniqueOrThrow({ where: { id } }), db);
  });
}
export async function deleteStudioJob(userId: string, id: string) {
  const row = await prisma.$transaction(async (db) => {
    const row = await ownedJob(userId, id, db);
    if (
      activeJobStatuses.includes(row.status) ||
      (row.leaseUntil && row.leaseUntil > new Date())
    )
      throw new StudioError("JOB_ACTIVE");
    await db.studioJob.delete({ where: { id } });
    if (
      row.snapshotId &&
      !(await db.studioJob.count({ where: { snapshotId: row.snapshotId } }))
    )
      await db.studioSnapshot.delete({ where: { id: row.snapshotId } });
    return row;
  });
  await cleanupDirectory(jobDirectory(row.userId, row.id));
  return { deleted: true as const, id };
}
/** Trusted adapters only: never accept a client path, and authenticate on every read. */
export async function getStudioJobArtifact(userId: string, id: string) {
  const row = await ownedJob(userId, id);
  if (row.status !== "done" || !row.resultJson || !row.leaseToken)
    throw new StudioError("RESULT_NOT_READY");
  const result = JSON.parse(row.resultJson) as StudioJobResult;
  const file = await safeFile(
    `${jobDirectory(userId, id)}/attempts/${row.leaseToken}/${path.basename(result.resource.name)}`,
  );
  if ((await fileHash(file)) !== result.resource.hash)
    throw new StudioError("RESULT_HASH_MISMATCH");
  return { path: file, ...result.resource };
}
