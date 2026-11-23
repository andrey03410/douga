import "server-only";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveLimit, freshUser, kanameEnabled, kanameEnv } from "./kaname";
import { StudioError } from "./studio/errors";

type Db = Prisma.TransactionClient;

async function treeBytes(file: string): Promise<number> {
  try {
    const info = await lstat(file);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    let bytes = 0;
    for (const entry of await readdir(file)) bytes += await treeBytes(path.join(file, entry));
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

// Measure owned files once by physical path, including original uploads, archived revisions,
// fonts, preview outputs, snapshots' files and the offline export cache.
export async function storedBytes(userId: string, db: Db = prisma) {
  const tournaments = await db.tournament.findMany({ where: { userId }, select: { id: true } });
  const paths = ["arts", "studio", "studio-jobs", "studio-exports", "studio-diagnostics"].map(root => path.join(root, userId));
  paths.push(...tournaments.map(({ id }) => path.join("tournaments", id)));
  let bytes = 0;
  for (const relative of paths) bytes += await treeBytes(absPath(relative));
  const [payload] = await db.$queryRaw<{ bytes: bigint }[]>`
    SELECT COALESCE(SUM(n), 0) AS bytes FROM (
      SELECT length(CAST(documentJson AS BLOB)) + coalesce(length(CAST(draftText AS BLOB)),0) + coalesce(length(CAST(previewJson AS BLOB)),0) + coalesce(length(CAST(draftValidationJson AS BLOB)),0) n FROM StudioProject WHERE userId=${userId}
      UNION ALL SELECT length(CAST(r.documentJson AS BLOB)) + length(CAST(r.validationJson AS BLOB)) + coalesce(length(CAST(r.planJson AS BLOB)),0) + coalesce(length(CAST(r.assetsJson AS BLOB)),0) FROM StudioRevision r JOIN StudioProject p ON p.id=r.projectId WHERE p.userId=${userId}
      UNION ALL SELECT length(CAST(s.payloadJson AS BLOB)) FROM StudioSnapshot s JOIN StudioProject p ON p.id=s.projectId WHERE p.userId=${userId}
      UNION ALL SELECT length(CAST(presetJson AS BLOB)) FROM StudioPreset WHERE userId=${userId}
      UNION ALL SELECT length(CAST(resultJson AS BLOB)) FROM StudioMutation WHERE userId=${userId}
      UNION ALL SELECT length(CAST(inputJson AS BLOB)) + coalesce(length(CAST(resultJson AS BLOB)),0) FROM StudioJob WHERE userId=${userId}
    )`;
  return bytes + Number(payload.bytes);
}
export async function assertStorage(userId: string, db: Db, additional = 0) {
  if (!kanameEnabled()) return;
  const { grant } = await freshUser(userId, db);
  const max = effectiveLimit(grant!, "storageBytes");
  if (max === null) return;
  const reservations = await db.art.aggregate({ where: { userId, filePath: "" }, _sum: { sizeBytes: true } });
  if ((await storedBytes(userId, db)) + (reservations._sum.sizeBytes ?? 0) + additional > max)
    throw new StudioError("POOL_QUOTA");
}
export async function publicationCount(userId: string, db: Db) {
  return await db.studioPublication.count({ where: { userId } }) +
    await db.studioInteractivePublication.count({ where: { userId } });
}
export async function assertRoom(userId: string, key: "projects" | "publications", db: Db) {
  if (!kanameEnabled()) return;
  const { grant } = await freshUser(userId, db);
  const limit = effectiveLimit(grant!, key);
  if (limit === null) return;
  const n = key === "projects" ? await db.studioProject.count({ where: { userId } }) : await publicationCount(userId, db);
  if (n >= limit) throw new StudioError(key === "projects" ? "PROJECT_LIMIT" : "PUBLICATION_LIMIT");
}
export async function usageForSubject(subject: string) {
  const binding = await prisma.kanameIdentity.findUnique({ where: { issuer_subject: { issuer: kanameEnv("KANAME_OIDC_ISSUER"), subject } } });
  if (!binding) return { storageBytes: 0, counts: { projects: 0, publications: 0 }, lastActiveAt: null, activeDays30: 0 };
  const userId = binding.userId;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  const [storageBytes, projects, publications, last, activeDays30] = await Promise.all([
    storedBytes(userId), prisma.studioProject.count({ where: { userId } }), publicationCount(userId, prisma),
    prisma.kanameActiveDay.findFirst({ where: { userId }, orderBy: { day: "desc" } }),
    prisma.kanameActiveDay.count({ where: { userId, day: { gte: since.toISOString().slice(0, 10) } } }),
  ]);
  return { storageBytes, counts: { projects, publications }, lastActiveAt: last?.lastActiveAt.toISOString() ?? null, activeDays30 };
}
