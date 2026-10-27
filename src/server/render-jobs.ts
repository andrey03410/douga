import "server-only";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";

// Renders run inside the Next process (fire-and-forget), so a server restart
// orphans the job row in queued/running forever — and an "active" job can be
// neither deleted nor re-run. A live render keeps updatedAt fresh: progress
// writes, plus a heartbeat (withRenderJob) through long phases that write no
// progress (bundling, re-encoding a long video), so anything active but
// silent for minutes is dead. Same rule as DownloadJob (listDownloads); an
// in-memory registry would mark live jobs dead after a dev HMR reload.

const STALE_AFTER_MS = 10 * 60 * 1000;
const ACTIVE = ["queued", "running"];

/** Heartbeat interval of a live render; far below STALE_AFTER_MS. */
export const RENDER_HEARTBEAT_MS = 60 * 1000;

export const STALE_RENDER_JOB_ERROR = "Рендер прерван перезапуском сервера — запустите заново";

/** Mark the user's orphaned queued/running render jobs as failed. */
export async function failStaleRenderJobs(userId: string): Promise<void> {
  await prisma.renderJob.updateMany({
    where: {
      status: { in: ACTIVE },
      updatedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      OR: [{ tournament: { userId } }, { project: { userId } }],
    },
    data: { status: "failed", error: STALE_RENDER_JOB_ERROR },
  });
}

/** Heartbeat: keep a live job's updatedAt fresh. Best effort. */
export async function touchRenderJob(jobId: string): Promise<void> {
  await prisma.renderJob
    .updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: { updatedAt: new Date() },
    })
    .catch(() => {});
}

/**
 * Final write of a finished render. Only a job still running becomes done; a
 * job deleted or failed meanwhile stays as it is, and the MP4 nobody points
 * at is removed. Returns whether the job was marked done.
 */
export async function completeRenderJob(
  jobId: string,
  output: { outputPath: string; outputBytes: number },
): Promise<boolean> {
  const { count } = await prisma.renderJob.updateMany({
    where: { id: jobId, status: "running" },
    data: { status: "done", progress: 1, ...output },
  });
  if (count === 0) await removePath(output.outputPath).catch(() => {});
  return count > 0;
}

/** Mark an active job failed; never throws (the job may be gone already). */
export async function failRenderJob(jobId: string, error: string): Promise<void> {
  await prisma.renderJob
    .updateMany({ where: { id: jobId, status: { in: ACTIVE } }, data: { status: "failed", error } })
    .catch(() => {});
}
