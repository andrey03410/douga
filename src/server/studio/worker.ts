import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { cleanupDirectory } from "./assets";
import { runStudioChild } from "./engine";
import { jobActor, jobDirectory, jobView, assertStudioJobQuota } from "./jobs";
import { canonical, hash } from "./shared";
import {
  cleanupImportPool,
  importBudget,
  publishImport,
  stageImportPublication,
  type PreparedStudioImport,
} from "./imports";
import { StudioError } from "./errors";
import {
  studioJobLimits,
  type StartStudioJobInput,
  type StudioJobResult,
} from "./job-types";
import type { StudioFrozenRevision } from "./types";
const slot = "heavy";
export async function claimStudioJob(
  options: { jobId?: string; workerId?: string } = {},
) {
  const now = new Date(),
    token = randomUUID(),
    until = new Date(now.getTime() + studioJobLimits.leaseMs);
  return prisma.$transaction(async (db) => {
    await db.studioWorkerLease.upsert({
      where: { id: slot },
      create: { id: slot },
      update: {},
    });
    const acquired = await db.studioWorkerLease.updateMany({
      where: { id: slot, OR: [{ until: null }, { until: { lte: now } }] },
      data: { token, until },
    });
    if (!acquired.count) return null;
    // Scope recovery as well as selection: test/review workers must never touch another job.
    const scope = options.jobId ? { id: options.jobId } : {};
    await db.studioJob.updateMany({
      where: {
        ...scope,
        status: "running",
        leaseUntil: { lte: now },
        attempts: { gte: studioJobLimits.maxAttempts },
      },
      data: { status: "failed", error: "LEASE_EXPIRED", leaseUntil: null },
    });
    const row = await db.studioJob.findFirst({
      where: {
        ...scope,
        attempts: { lt: studioJobLimits.maxAttempts },
        OR: [
          { status: "queued", availableAt: { lte: now } },
          { status: "running", leaseUntil: { lte: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!row) {
      await db.studioWorkerLease.update({
        where: { id: slot },
        data: { token: null, until: null },
      });
      return null;
    }
    const claimed = await db.studioJob.updateMany({
      where: { id: row.id, status: row.status, leaseToken: row.leaseToken },
      data: {
        status: "running",
        workerId: options.workerId ?? `worker-${process.pid}`,
        leaseToken: token,
        leaseUntil: until,
        attempts: { increment: 1 },
        progress: 0,
        error: null,
      },
    });
    if (!claimed.count) throw new StudioError("CLAIM_CONFLICT");
    return db.studioJob.findUniqueOrThrow({ where: { id: row.id } });
  });
}
export async function heartbeatStudioJob(
  jobId: string,
  token: string,
  progress?: number,
) {
  const now = new Date(),
    until = new Date(now.getTime() + studioJobLimits.leaseMs);
  return prisma.$transaction(async (db) => {
    const lease = await db.studioWorkerLease.updateMany({
      where: { id: slot, token, until: { gt: now } },
      data: { until },
    });
    if (!lease.count) return false;
    const update = await db.studioJob.updateMany({
      where: {
        id: jobId,
        status: "running",
        leaseToken: token,
        leaseUntil: { gt: now },
      },
      data: {
        leaseUntil: until,
        ...(progress === undefined
          ? {}
          : { progress: Math.max(0, Math.min(0.99, progress)) }),
      },
    });
    return Boolean(update.count);
  });
}
const terminalErrors = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "SNAPSHOT_HASH_MISMATCH",
  "ENGINE_HASH_MISMATCH",
  "ENGINE_RUNTIME_MISMATCH",
  "INPUT_BUDGET_EXCEEDED",
  "OUTPUT_BUDGET_EXCEEDED",
  "JOB_QUOTA_EXCEEDED",
  "JOB_TIMEOUT",
  "POOL_QUOTA",
  "IMPORT_DURATION_EXCEEDED",
  "IMPORT_MEDIA_INVALID",
]);
export async function runStudioWorkerOnce(
  options: { jobId?: string; workerId?: string } = {},
) {
  const job = await claimStudioJob(options);
  if (!job) return null;
  const token = job.leaseToken!,
    directory = `${jobDirectory(job.userId, job.id)}/attempts/${token}`;
  const abort = new AbortController();
  let progress = 0,
    heartbeating = false,
    published = false;
  const timer = setInterval(async () => {
    if (heartbeating) return;
    heartbeating = true;
    try {
      if (!(await heartbeatStudioJob(job.id, token, progress))) abort.abort();
    } catch {
      abort.abort();
    } finally {
      heartbeating = false;
    }
  }, studioJobLimits.heartbeatMs);
  try {
    await jobActor(job.userId, job.kind);
    let imported: PreparedStudioImport | undefined;
    let result: import("./job-types").StudioJobOutput;
    if (job.kind === "import") {
      await cleanupImportPool(job);
      const maxBytes = await importBudget(job.userId);
      imported = await runStudioChild<PreparedStudioImport>(
        {
          operation: "import",
          jobId: job.id,
          leaseToken: token,
          directory,
          input: JSON.parse(job.inputJson),
          maxBytes,
        },
        {
          timeoutMs: studioJobLimits.importTimeoutMs,
          signal: abort.signal,
          onProgress: (n) => {
            progress = n;
          },
        },
      );
      imported = await stageImportPublication(job, imported);
      result = imported.result;
    } else {
      if (!job.snapshotId) throw new StudioError("SNAPSHOT_MISSING");
      const snapshot = await prisma.studioSnapshot.findUniqueOrThrow({
        where: { id: job.snapshotId },
      });
      const frozen = JSON.parse(snapshot.payloadJson) as StudioFrozenRevision;
      const { snapshotId: _, hash: expected, ...content } = frozen;
      if (hash(canonical(content)) !== expected)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      if (!(await heartbeatStudioJob(job.id, token)))
        throw new StudioError("LEASE_LOST");
      result = await runStudioChild<StudioJobResult>(
        {
          operation: "render",
          jobId: job.id,
          leaseToken: token,
          directory,
          engineId: job.engineId,
          frozen,
          input: JSON.parse(job.inputJson) as StartStudioJobInput,
        },
        {
          timeoutMs:
            job.kind === "render"
              ? studioJobLimits.renderTimeoutMs
              : studioJobLimits.previewTimeoutMs,
          signal: abort.signal,
          onProgress: (n) => {
            progress = n;
          },
        },
      );
    }
    await prisma.$transaction(async (db) => {
      const user = await jobActor(job.userId, job.kind, db);
      if (result.kind !== "import")
        await assertStudioJobQuota(
          job.userId,
          user.role,
          db,
          result.resource.bytes,
        );
      const now = new Date();
      const slotRow = await db.studioWorkerLease.findFirst({
        where: { id: slot, token, until: { gt: now } },
      });
      if (!slotRow) throw new StudioError("LEASE_LOST");
      if (imported) await publishImport(db, job, imported);
      const changed = await db.studioJob.updateMany({
        where: {
          id: job.id,
          status: "running",
          leaseToken: token,
          leaseUntil: { gt: now },
        },
        data: {
          status: "done",
          progress: 1,
          resultJson: JSON.stringify(result),
          outputBytes: result.kind === "import" ? 0 : result.resource.bytes,
          leaseUntil: null,
          error: null,
        },
      });
      if (!changed.count) throw new StudioError("LEASE_LOST");
    });
    published = true;
  } catch (error) {
    const code =
      error instanceof StudioError
        ? error.code
        : job.kind === "import"
          ? "IMPORT_FAILED"
          : "RENDER_FAILED";
    await prisma.studioJob.updateMany({
      where: {
        id: job.id,
        status: "running",
        leaseToken: token,
        leaseUntil: { gt: new Date() },
      },
      data: {
        status:
          terminalErrors.has(code) ||
          job.attempts >= studioJobLimits.maxAttempts
            ? "failed"
            : "queued",
        error: code,
        leaseUntil: null,
        availableAt: new Date(Date.now() + 1000 * job.attempts),
      },
    });
  } finally {
    clearInterval(timer);
    abort.abort();
    if (job.kind === "import") {
      await cleanupDirectory(directory);
      await cleanupImportPool(job, token);
    } else if (published) await cleanupDirectory(`${directory}/serve`);
    else await cleanupDirectory(directory);
    await prisma.$transaction(async (db) => {
      await db.studioJob.updateMany({
        where: { id: job.id, leaseToken: token, status: "canceled" },
        data: { leaseUntil: null },
      });
      await db.studioWorkerLease.updateMany({
        where: { id: slot, token },
        data: { until: null, token: null },
      });
    });
  }
  const row = await prisma.studioJob.findUnique({ where: { id: job.id } });
  return row ? jobView(row) : null;
}
