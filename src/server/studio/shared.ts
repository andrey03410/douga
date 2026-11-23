import { assertStorage } from "@/server/kaname-usage";
import "server-only";
import { freshUser, kanameEnabled } from "@/server/kaname";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/domain/permissions";
import { preflightVideoResources, resourceBudgetDiagnostic } from "@douga/video/resource-limits";
import { StudioError } from "./errors";
import { documentSizeDiagnostic } from "./document-size";
export type Db = Prisma.TransactionClient;
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const serialize = (input: unknown, path: string): string => {
    if (input && typeof input === "object") {
      if (ancestors.has(input))
        throw new StudioError("DOCUMENT_TOO_LARGE", [resourceBudgetDiagnostic("cycles", 1, 0, path)]);
      ancestors.add(input);
      const result = Array.isArray(input)
        ? `[${input.map((child, index) => serialize(child, path ? `${path}.${index}` : String(index))).join(",")}]`
        : `{${Object.entries(input)
          .filter(([, child]) => child !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child, path ? `${path}.${key}` : key)}`)
          .join(",")}}`;
      ancestors.delete(input);
      return result;
    }
    return JSON.stringify(input) ?? "null";
  };
  return serialize(value, "");
}
export async function actor(userId: string, db: Db = prisma) {
  const user = await freshUser(userId, db);
  if (!user) throw new StudioError("NOT_FOUND");
  if (!can(user.role, "media:upload")) throw new StudioError("FORBIDDEN");
  return user;
}
export async function owned(userId: string, id: string, db: Db = prisma) {
  await actor(userId, db);
  const project = await db.studioProject.findFirst({ where: { id, userId } });
  if (!project) throw new StudioError("NOT_FOUND");
  return project;
}
export function requestHash(action: string, input: unknown) {
  return hash(canonical({ action, input }));
}
export async function replay<T>(
  db: Db,
  userId: string,
  key: string | undefined,
  request: string,
): Promise<T | undefined> {
  if (!key) return;
  const receipt = await db.studioMutation.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (!receipt) return;
  if (kanameEnabled()) await freshUser(userId, db);
  if (receipt.requestHash !== request)
    throw new StudioError("IDEMPOTENCY_CONFLICT");
  return JSON.parse(receipt.resultJson) as T;
}
export async function receipt(
  db: Db,
  userId: string,
  key: string | undefined,
  request: string,
  result: unknown,
  release = false,
) {
  const resultJson = key ? JSON.stringify(result) : undefined;
  if (release && kanameEnabled()) {
    // A smaller centrally assigned cap must not trap users above quota. A
    // cleanup receipt is optional when even its metadata would exceed it.
    if (!resultJson) return;
    try { await assertStorage(userId, db, Buffer.byteLength(resultJson)); }
    catch (error) {
      if (error instanceof StudioError && error.code === "POOL_QUOTA") return;
      throw error;
    }
  }
  if (key && resultJson !== undefined)
    await db.studioMutation.create({ data: { userId, key, requestHash: request, resultJson } });
  if (!release) await assertStorage(userId, db);
}
export function jsonText(value: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    const diagnostics = preflightVideoResources(value);
    throw new StudioError("DOCUMENT_TOO_LARGE", diagnostics.length ? diagnostics : [
      resourceBudgetDiagnostic("serializableValues", 1, 0, "document"),
    ]);
  }
  if (!text) throw new StudioError("DOCUMENT_TOO_LARGE");
  const diagnostic = documentSizeDiagnostic(text);
  if (diagnostic) throw new StudioError("DOCUMENT_TOO_LARGE", [diagnostic]);
  return text;
}
