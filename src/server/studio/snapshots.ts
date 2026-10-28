import "server-only";
import type { Db } from "./shared";
import { prisma } from "@/lib/db";

/** Drop a frozen snapshot only when no job and no publication still point at it. */
export async function releaseSnapshotIfFree(
  snapshotId: string,
  db: Db = prisma,
): Promise<boolean> {
  if (await db.studioJob.count({ where: { snapshotId } })) return false;
  if (await db.studioPublication.count({ where: { snapshotId } })) return false;
  const removed = await db.studioSnapshot.deleteMany({ where: { id: snapshotId } });
  return removed.count > 0;
}
