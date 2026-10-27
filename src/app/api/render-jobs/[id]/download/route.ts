import { readFile } from "node:fs/promises";
import { userOr401, notFound } from "@/lib/api";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { renderDownloadDisposition } from "@/lib/domain/render-jobs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const job = await prisma.renderJob.findFirst({
    where: {
      id: params.id,
      OR: [{ tournament: { userId: auth.userId } }, { project: { userId: auth.userId } }],
    },
    include: {
      tournament: { select: { title: true } },
      project: { select: { title: true } },
    },
  });
  if (!job || !job.outputPath) return notFound();

  // The file is named after the tournament / project; the owner id backs the
  // ASCII fallback name.
  const ownerId = job.tournamentId ?? job.projectId ?? job.id;
  const title = job.tournament?.title ?? job.project?.title ?? null;

  const data = await readFile(absPath(job.outputPath));
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": renderDownloadDisposition(ownerId, title),
    },
  });
}
