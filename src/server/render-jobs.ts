import "server-only";
import { prisma } from "@/lib/db";

// Renders run inside the Next process (fire-and-forget), so a server restart
// orphans the job row in queued/running forever — and an "active" job can be
// neither deleted nor re-run. A live render bumps updatedAt every few seconds
// via progress writes, so anything active but silent for minutes is dead.
// Same rule as DownloadJob (listDownloads); an in-memory registry would mark
// live jobs dead after a dev HMR reload.

const STALE_AFTER_MS = 10 * 60 * 1000;

export const STALE_RENDER_JOB_ERROR = "Рендер прерван перезапуском сервера — запустите заново";

/** Mark the user's orphaned queued/running render jobs as failed. */
export async function failStaleRenderJobs(userId: string): Promise<void> {
  await prisma.renderJob.updateMany({
    where: {
      status: { in: ["queued", "running"] },
      updatedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      OR: [{ tournament: { userId } }, { project: { userId } }],
    },
    data: { status: "failed", error: STALE_RENDER_JOB_ERROR },
  });
}
