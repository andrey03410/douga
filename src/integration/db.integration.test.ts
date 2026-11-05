import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, prisma } from "@/lib/db";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { sqliteAdapter } from "@/lib/sqlite-adapter";

// The Prisma 7 client over better-sqlite3 (src/lib/sqlite-adapter.ts), on the real DB.
const PREFIX = "integration-db-";
const email = (name: string) => `${PREFIX}${name}@test.local`;
const cleanup = () => prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const emails = async (db: PrismaClient = prisma) =>
  (await db.user.findMany({ where: { email: { startsWith: PREFIX } }, orderBy: { email: "asc" } })).map(
    (u) => u.email,
  );

afterEach(cleanup);
afterAll(cleanup);

describe("SQLite client (Prisma 7 adapter)", () => {
  it("keeps DateTime as integer milliseconds, the format the existing database uses", async () => {
    const createdAt = new Date(Date.now() - 60_000);
    const user = await prisma.user.create({ data: { email: email("dates"), passwordHash: "x", createdAt } });
    const [row] = await prisma.$queryRaw<{ kind: string; value: bigint | number }[]>`
      SELECT typeof("createdAt") AS kind, "createdAt" AS value FROM "User" WHERE "id" = ${user.id}`;
    expect(row?.kind).toBe("integer");
    expect(Number(row?.value)).toBe(createdAt.getTime());
    const older = await prisma.user.count({
      where: { email: email("dates"), createdAt: { lt: new Date() } },
    });
    expect(older).toBe(1);
  });

  it("does not pull a concurrent write into another request's transaction", async () => {
    // one SQLite connection serves the whole process: without the queue a query
    // issued while a transaction is open runs inside it and is rolled back with it
    const failing = prisma
      .$transaction(async (db) => {
        await db.user.create({ data: { email: email("inside"), passwordHash: "x" } });
        await sleep(80);
        throw new Error("rollback on purpose");
      })
      .catch((e: Error) => e.message);
    await sleep(20);
    await prisma.user.create({ data: { email: email("outside"), passwordHash: "x" } });
    expect(await failing).toBe("rollback on purpose");
    expect(await emails()).toEqual([email("outside")]);
  });

  it("leaves no transaction open when COMMIT fails on a lock held by another connection", async () => {
    const url = resolveDatabaseUrl(process.env.DATABASE_URL);
    const writer = new PrismaClient({ adapter: sqliteAdapter(url, { busyTimeoutMs: 100 }) });
    const reader = createPrismaClient(url);
    try {
      // the reader holds a shared lock, so the writer's COMMIT cannot get the exclusive one
      let readerHolds!: () => void;
      const holding = new Promise<void>((resolve) => (readerHolds = resolve));
      const readerDone = reader.$transaction(async (db) => {
        await db.user.count();
        readerHolds();
        await sleep(400);
      });
      await holding;
      const outcome = await writer
        .$transaction(async (db) => {
          await db.user.create({ data: { email: email("lost"), passwordHash: "x" } });
        })
        .then(
          () => "committed",
          () => "failed",
        );
      await readerDone;
      expect(outcome).toBe("failed");
      // the writer's connection must be back in autocommit mode
      await writer.user.create({ data: { email: email("next"), passwordHash: "x" } });
      expect(await emails(reader)).toEqual([email("next")]);
      await writer.$transaction(async (db) => db.user.count());
    } finally {
      await writer.$disconnect();
      await reader.$disconnect();
    }
  });
});
