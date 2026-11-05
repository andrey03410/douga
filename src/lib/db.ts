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

// One client per process, in production too: dev hot reloads re-evaluate this
// module, and `next start` evaluates it once per webpack layer (pages, route
// handlers, server actions). Separate clients would mean separate SQLite
// connections whose lock waits block the event loop of the same process.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
