import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseVideoDocument, videoDocumentSchema } from "@douga/video/schema";
import type { StudioProjectView } from "./types";
import {
  canonical,
  hash,
  jsonText,
  owned,
  requestHash,
  type Db,
} from "./shared";
import { setReferences } from "./assets";
import { StudioError } from "./errors";

const prefix = "review-backup:";
const backupIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const backupSchema = z
  .object({
    backupId: backupIdSchema,
    projectId: z.string().min(1),
    version: z.number().int().positive(),
    document: videoDocumentSchema,
    createdAt: z.string().datetime(),
    origin: z
      .object({
        projectId: z.string().min(1),
        version: z.number().int().positive(),
        revision: z.number().int().positive().nullable(),
        documentHash: backupIdSchema,
      })
      .strict(),
  })
  .strict();
export type StudioReviewBackup = z.infer<typeof backupSchema>;
export const reviewBackupLimits = {
  count: 128,
  bytes: 16 * 1024 * 1024,
} as const;
const backupRequestHash = (userId: string, backup: StudioReviewBackup) =>
  requestHash("review-backup-record", { userId, backup });
async function projectBackups(db: Db, userId: string, projectId: string) {
  const rows = await db.studioMutation.findMany({
    where: {
      userId,
      key: { startsWith: prefix },
      resultJson: { contains: `"projectId":${JSON.stringify(projectId)}` },
    },
    select: { id: true, resultJson: true },
  });
  return rows.filter((row) => {
    try {
      return JSON.parse(row.resultJson)?.projectId === projectId;
    } catch {
      return false;
    }
  });
}
/** Called after CAS, inside the same transaction as the draft and its receipt. */
export async function preserveStudioReviewBackup(
  db: Db,
  userId: string,
  projectId: string,
  request: string,
  current: Pick<
    StudioProjectView,
    "version" | "revision" | "document" | "draft"
  >,
): Promise<string> {
  const backupId = hash(canonical({ userId, projectId, request }));
  const document = parseVideoDocument(
    current.draft ? current.draft.document : current.document,
  );
  const createdAt = new Date();
  const backup: StudioReviewBackup = {
    backupId,
    projectId,
    version: current.version,
    document,
    createdAt: createdAt.toISOString(),
    origin: {
      projectId,
      version: current.version,
      revision: current.draft ? null : current.revision,
      documentHash: hash(canonical(document)),
    },
  };
  const resultJson = jsonText(backup);
  const previous = await projectBackups(db, userId, projectId);
  if (
    previous.length >= reviewBackupLimits.count ||
    previous.reduce(
      (sum, row) => sum + Buffer.byteLength(row.resultJson),
      Buffer.byteLength(resultJson),
    ) > reviewBackupLimits.bytes
  )
    throw new StudioError("REVIEW_BACKUP_QUOTA_EXCEEDED");

  await db.studioMutation.create({
    data: {
      userId,
      key: `${prefix}${backupId}`,
      requestHash: backupRequestHash(userId, backup),
      resultJson,
      createdAt,
    },
  });
  await setReferences(db, userId, projectId, `${prefix}${backupId}`, document);
  return backupId;
}
/** Exact key, ownership, project membership and content hash are independently checked. */
export async function getStudioReviewBackup(
  userId: string,
  projectId: string,
  backupId: string,
): Promise<StudioReviewBackup> {
  await owned(userId, projectId);
  if (!backupIdSchema.safeParse(backupId).success)
    throw new StudioError("NOT_FOUND");
  const row = await prisma.studioMutation.findUnique({
    where: { userId_key: { userId, key: `${prefix}${backupId}` } },
  });
  if (!row) throw new StudioError("NOT_FOUND");
  let parsed;
  try {
    parsed = backupSchema.safeParse(JSON.parse(row.resultJson));
  } catch {
    throw new StudioError("NOT_FOUND");
  }
  if (!parsed.success) throw new StudioError("NOT_FOUND");
  const backup = parsed.data;
  if (
    backup.backupId !== backupId ||
    backup.projectId !== projectId ||
    backup.origin.projectId !== projectId ||
    backup.version !== backup.origin.version ||
    backup.origin.documentHash !== hash(canonical(backup.document)) ||
    row.requestHash !== backupRequestHash(userId, backup)
  )
    throw new StudioError("NOT_FOUND");
  return backup;
}
/** StudioMutation has a user FK only; project deletion explicitly removes its backups. */
export async function deleteStudioReviewBackups(
  db: Db,
  userId: string,
  projectId: string,
) {
  const rows = await projectBackups(db, userId, projectId);
  if (rows.length)
    await db.studioMutation.deleteMany({
      where: {
        userId,
        id: { in: rows.map((row) => row.id) },
        key: { startsWith: prefix },
      },
    });
}
