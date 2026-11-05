import { PrismaClient } from "@/generated/prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { sqliteAdapter } from "@/lib/sqlite-adapter";

/**
 * Prisma 7 client over the better-sqlite3 adapter (see sqlite-adapter.ts for the
 * date format and the queue around transactions). A relative DATABASE_URL counts
 * from prisma/, as in Prisma 5.
 */
export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: sqliteAdapter(resolveDatabaseUrl(url)) });
}

// Reuse the client across hot reloads in dev to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
