import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type {
  IsolationLevel,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  Transaction,
} from "@prisma/driver-adapter-utils";

/** FIFO async lock: `acquire` resolves with a release function once the lock is free. */
class Lock {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}

/**
 * SQLite adapter for the Prisma 7 client.
 *
 * - DateTime stays integer milliseconds, the format Prisma 5 wrote. The adapter
 *   default (ISO text) would mix formats in an existing database, and SQLite
 *   compares every number as smaller than any text: leases and deadlines break.
 * - `fileMustExist`: a wrong path fails instead of creating an empty database.
 * - The adapter serves the whole process over one connection and only orders
 *   transactions among themselves. A query that arrives while a transaction is
 *   open would run inside it and be rolled back with it. Here every query outside
 *   a transaction waits until the open transaction ends. Unlike Prisma 5, whose
 *   pool let reads run beside a writing transaction, reads wait too.
 *   So inside `$transaction(async (db) => …)` use only `db`: a query through the
 *   shared client there waits for the transaction itself until its timeout, then
 *   runs on its own after the rollback.
 */
export function sqliteAdapter(
  url: string,
  options: { busyTimeoutMs?: number } = {},
): SqlMigrationAwareDriverAdapterFactory {
  const inner = new PrismaBetterSqlite3(
    { url, fileMustExist: true, timeout: options.busyTimeoutMs ?? 5000 },
    { timestampFormat: "unixepoch-ms" },
  );
  return {
    provider: inner.provider,
    adapterName: inner.adapterName,
    connect: async () => serialized(await inner.connect()),
    connectToShadowDb: async () => serialized(await inner.connectToShadowDb()),
  };
}

function serialized(adapter: SqlDriverAdapter): SqlDriverAdapter {
  const lock = new Lock();
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    const release = await lock.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return {
    provider: adapter.provider,
    adapterName: adapter.adapterName,
    queryRaw: (query: SqlQuery) => exclusive(() => adapter.queryRaw(query)),
    executeRaw: (query: SqlQuery) => exclusive(() => adapter.executeRaw(query)),
    executeScript: (script: string) => exclusive(() => adapter.executeScript(script)),
    getConnectionInfo: adapter.getConnectionInfo ? () => adapter.getConnectionInfo!() : undefined,
    dispose: () => adapter.dispose(),
    async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
      const release = await lock.acquire();
      try {
        return holdUntilDone(await adapter.startTransaction(isolationLevel), release);
      } catch (e) {
        release();
        throw e;
      }
    },
  };
}

const ROLLBACK: SqlQuery = { sql: "ROLLBACK", args: [], argTypes: [] };

/**
 * The transaction keeps the lock until it commits or rolls back.
 *
 * The client sends COMMIT through `executeRaw` and, when it fails, calls only
 * `rollback()`, which in this adapter sends nothing. SQLite keeps a transaction
 * open after a COMMIT that failed on a lock (SQLITE_BUSY: another process still
 * reads), so the connection would stay inside it and nothing later would be
 * committed. Roll it back here.
 */
function holdUntilDone(tx: Transaction, release: () => void): Transaction {
  let held = true;
  let commitFailed = false;
  const finish = () => {
    if (held) {
      held = false;
      release();
    }
  };
  return {
    provider: tx.provider,
    adapterName: tx.adapterName,
    options: tx.options,
    queryRaw: (query: SqlQuery) => tx.queryRaw(query),
    executeRaw: async (query: SqlQuery) => {
      try {
        return await tx.executeRaw(query);
      } catch (e) {
        if (query.sql.trim().toUpperCase() === "COMMIT") commitFailed = true;
        throw e;
      }
    },
    commit: () => tx.commit().finally(finish),
    rollback: async () => {
      try {
        if (commitFailed) await tx.executeRaw(ROLLBACK).catch(() => undefined);
        await tx.rollback();
      } finally {
        finish();
      }
    },
    createSavepoint: tx.createSavepoint ? (name: string) => tx.createSavepoint!(name) : undefined,
    rollbackToSavepoint: tx.rollbackToSavepoint
      ? (name: string) => tx.rollbackToSavepoint!(name)
      : undefined,
    releaseSavepoint: tx.releaseSavepoint ? (name: string) => tx.releaseSavepoint!(name) : undefined,
  };
}
