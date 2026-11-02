import { NextResponse } from "next/server";
import { userOr401, notFound } from "@/lib/api";
import { prisma } from "@/lib/db";
import { renderJobDto } from "@/lib/domain/render-jobs";
import { failStaleRenderJobs } from "@/server/render-jobs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  await failStaleRenderJobs(auth.userId);
  const job = await prisma.renderJob.findFirst({
    where: {
      id: params.id,
      OR: [{ tournament: { userId: auth.userId } }, { project: { userId: auth.userId } }],
    },
  });
  if (!job) return notFound();

  return NextResponse.json(renderJobDto(job));
}

export async function DELETE() {
  return notFound();
}
