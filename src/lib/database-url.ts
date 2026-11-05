import path from "node:path";

/**
 * Absolute `file:` URL of the SQLite database.
 *
 * Prisma 5 resolved a relative `file:` path from the schema folder (`prisma/`),
 * so `.env` says `DATABASE_URL="file:./dev.db"`. Prisma 7 would resolve it from
 * the working directory and open an empty `./dev.db`; keep the old rule here.
 * No variable means `prisma/dev.db`. Shared by prisma.config.ts and src/lib/db.ts.
 */
export function resolveDatabaseUrl(raw: string | undefined, root: string = process.cwd()): string {
  const prismaDir = path.join(root, "prisma");
  if (!raw) return `file:${path.join(prismaDir, "dev.db")}`;
  if (!raw.startsWith("file:")) return raw;
  const target = raw.slice("file:".length);
  return path.isAbsolute(target) ? raw : `file:${path.resolve(prismaDir, target)}`;
}
