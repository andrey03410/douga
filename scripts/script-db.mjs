// Database access for plain-node scripts (e2e-setup, clean-test-data).
// Plain `node` loads the generated TypeScript client via built-in type stripping
// (Node >= 22.18); the client is ESM-only since Prisma 7.
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.ts";

/** Client for prisma/dev.db with the same date format as src/lib/sqlite-adapter.ts. */
export function openDevDb() {
  const url = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url, fileMustExist: true }, { timestampFormat: "unixepoch-ms" }),
  });
}

/**
 * Deletes test accounts with their data, in the order deleteUser in
 * src/server/users.ts uses: jobs, publications, snapshots and projects, then
 * tournaments (segment posters and track covers restrict Art deletion), then
 * the user, whose cascade takes the media pool. Files in storage/ stay.
 */
export async function deleteUsersByEmail(prisma, emails) {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.studioJob.deleteMany({ where: { userId: { in: ids } } });
    await tx.studioPublication.deleteMany({ where: { userId: { in: ids } } });
    await tx.studioSnapshot.deleteMany({ where: { project: { userId: { in: ids } } } });
    await tx.studioProject.deleteMany({ where: { userId: { in: ids } } });
    await tx.tournament.deleteMany({ where: { userId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
  return ids.length;
}
