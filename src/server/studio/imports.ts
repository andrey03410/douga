import "server-only";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { StudioJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { quotasFor } from "@/lib/domain/permissions";
import { actor, receipt, replay, requestHash, type Db } from "./shared";
import { activeJobStatuses, jobView } from "./jobs";
import { cleanupDirectory, fileHash, safeFile } from "./assets";
import { StudioError } from "./errors";
import {
  startStudioImportSchema,
  studioJobLimits,
  type StartStudioImportInput,
  type StudioJobView,
  type StudioImportResult,
} from "./job-types";
import type { PreparedPoolArt } from "@/server/arts";

export async function importBudget(userId: string, db: Db = prisma, bytes = 0) {
  const user = await actor(userId, db);
  const max = quotasFor(user.role).maxPoolBytes;
  const used =
    (await db.art.aggregate({ where: { userId }, _sum: { sizeBytes: true } }))
      ._sum.sizeBytes ?? 0;
  const remaining = max === null ? studioJobLimits.maxOutputBytes : max - used;
  if (remaining <= 0 || bytes > remaining) throw new StudioError("POOL_QUOTA");
  return Math.min(remaining, studioJobLimits.maxOutputBytes);
}

export async function startStudioImport(
  userId: string,
  raw: StartStudioImportInput,
): Promise<StudioJobView> {
  const input = startStudioImportSchema.parse(raw);
  const request = requestHash("import", input);
  const enqueue = () =>
    prisma.$transaction(async (db) => {
      await actor(userId, db);
      const old = await replay<StudioJobView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (old) return old;
      await importBudget(userId, db);
      if (
        (await db.studioJob.count({
          where: { userId, status: { in: activeJobStatuses } },
        })) >= studioJobLimits.maxActivePerAccount
      )
        throw new StudioError("JOB_QUOTA_EXCEEDED");
      const row = await db.studioJob.create({
        data: {
          userId,
          kind: "import",
          inputJson: JSON.stringify(input),
          engineId: "yt-dlp-pool-v1",
        },
      });
      const result = await jobView(row, db);
      await receipt(db, userId, input.idempotencyKey, request, result);
      return result;
    });
  try {
    return await enqueue();
  } catch (error) {
    await actor(userId);
    const old = await replay<StudioJobView>(
      prisma,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    throw error;
  }
}

// Each attempt has its own final destination. The child only writes its private
// job directory; only the parent moves completed bytes here before publication.
export const importPoolDirectory = (userId: string, jobId: string) =>
  `arts/${userId}/studio-imports/${jobId}`;
export async function cleanupImportPool(
  job: Pick<StudioJob, "userId" | "id">,
  onlyToken?: string,
) {
  const base = importPoolDirectory(job.userId, job.id);
  const tokens = onlyToken
    ? [onlyToken]
    : await readdir(absPath(base)).catch(() => [] as string[]);
  for (const token of tokens) {
    const directory = `${base}/${token}`;
    // A committed winner is independent pool media, even after job deletion.
    if (
      !(await prisma.art.count({
        where: {
          userId: job.userId,
          filePath: { startsWith: `${directory}/` },
        },
      }))
    )
      await cleanupDirectory(directory);
  }
}

export interface PreparedStudioImport {
  art: PreparedPoolArt;
  result: StudioImportResult;
}
/** Parent-only move; no public Art row exists until the fenced transaction. */
export async function stageImportPublication(
  job: StudioJob,
  prepared: PreparedStudioImport,
) {
  const destination = `${importPoolDirectory(job.userId, job.id)}/${job.leaseToken!}`;
  const source = path.dirname(await safeFile(prepared.art.filePath));
  await mkdir(path.dirname(absPath(destination)), { recursive: true });
  await rename(source, absPath(destination));
  prepared.art.filePath = `${destination}/${path.basename(prepared.art.filePath)}`;
  if (prepared.art.posterPath)
    prepared.art.posterPath = `${destination}/${path.basename(prepared.art.posterPath)}`;
  if (
    (await fileHash(await safeFile(prepared.art.filePath))) !==
    prepared.result.asset.hash
  )
    throw new StudioError("RESULT_HASH_MISMATCH");
  return prepared;
}

export async function publishImport(
  db: Db,
  job: StudioJob,
  prepared: PreparedStudioImport,
) {
  await importBudget(job.userId, db, prepared.art.sizeBytes);
  // Called inside the same transaction that compares lease/status and sets done.
  await db.art.create({ data: { ...prepared.art, userId: job.userId } });
  return prepared.result;
}
