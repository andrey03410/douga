import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/domain/permissions";
import { StudioError } from "./errors";
export type Db = Prisma.TransactionClient;
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function actor(userId: string, db: Db = prisma) {
  const user = await db.user.findUnique({ where: { id: userId } });
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
) {
  if (key)
    await db.studioMutation.create({
      data: {
        userId,
        key,
        requestHash: request,
        resultJson: JSON.stringify(result),
      },
    });
}
export function jsonText(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text || text.length > 2_000_000)
    throw new StudioError("DOCUMENT_TOO_LARGE");
  return text;
}
