import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { StudioError } from "./studio/errors";

export const kanameEnabled = () => process.env.KANAME_ENABLED === "1";
export function kanameEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
export function localIdentityId(issuer: string, subject: string) {
  return "k_" + createHash("sha256").update(JSON.stringify([issuer, subject])).digest("hex");
}
const limit = z.number().int().nonnegative().safe().nullable();
const grantSchema = z.object({
  subject: z.string().min(1),
  login: z.string().min(1),
  service: z.literal("douga"),
  role: z.enum(["user", "admin", "overlord"]),
  permissions: z.object({ heavy: z.boolean(), html: z.boolean() }),
  limits: z.object({ projects: limit, publications: limit, storageBytes: limit }),
});
export type Grant = z.infer<typeof grantSchema>;
export async function fetchGrant(subject: string): Promise<Grant> {
  const url = new URL(`/internal/v1/access/${encodeURIComponent(subject)}`, kanameEnv("KANAME_URL"));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${kanameEnv("KANAME_SERVICE_TOKEN")}` },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3500),
  }).catch(() => { throw new StudioError("KANAME_UNAVAILABLE"); });
  if (response.status === 403 || response.status === 404) throw new StudioError("FORBIDDEN");
  if (!response.ok) throw new StudioError("KANAME_UNAVAILABLE");
  const data = await response.json().catch(() => { throw new StudioError("KANAME_UNAVAILABLE"); });
  const parsed = grantSchema.safeParse(data);
  if (!parsed.success || parsed.data.subject !== subject || !parsed.data.permissions.html ||
      (parsed.data.role === "overlord" && subject !== process.env.KANAME_OWNER_SUBJECT) ||
      (parsed.data.permissions.heavy && parsed.data.role !== "overlord")) throw new StudioError("FORBIDDEN");
  return parsed.data;
}
export function effectiveLimit(grant: Grant, key: keyof Grant["limits"]) {
  return grant.limits[key];
}
export async function bindIdentity(subject: string) {
  const issuer = kanameEnv("KANAME_OIDC_ISSUER");
  const grant = await fetchGrant(subject);
  const id = localIdentityId(issuer, subject);
  return prisma.$transaction(async db => {
    const existing = await db.kanameIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } });
    if (existing?.suspended) throw new StudioError("FORBIDDEN");
    if (existing) {
      await db.kanameIdentity.update({ where: { userId: existing.userId }, data: { login: grant.login } });
      return existing.userId;
    }
    // The local address exists solely for the legacy unique DB column. Never link by email.
    await db.user.create({ data: {
      id, email: `${id}@kaname.invalid`, passwordHash: "!", role: "guest",
      kaname: { create: { issuer, subject, login: grant.login } },
    } });
    return id;
  });
}

export async function freshUser(id: string, db: Prisma.TransactionClient = prisma) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new StudioError("NOT_FOUND");
  if (!kanameEnabled()) return { ...user, grant: undefined as Grant | undefined };
  const identity = await db.kanameIdentity.findUnique({ where: { userId: id } });
  if (!identity || identity.suspended || identity.issuer !== kanameEnv("KANAME_OIDC_ISSUER"))
    throw new StudioError("FORBIDDEN");
  const grant = await fetchGrant(identity.subject);
  const role = grant.role === "overlord" && !grant.permissions.heavy ? "kaname-admin" : `kaname-${grant.role}`;
  return { ...user, email: grant.login, role, grant };
}
export async function requireHeavy(id: string, db: Prisma.TransactionClient = prisma) {
  if (kanameEnabled() && !(await freshUser(id, db)).grant?.permissions.heavy) throw new StudioError("FORBIDDEN");
}
export async function recordActivity(userId: string) {
  if (!kanameEnabled()) return;
  const now = new Date(), day = now.toISOString().slice(0, 10);
  await prisma.kanameActiveDay.upsert({
    where: { userId_day: { userId, day } }, create: { userId, day, lastActiveAt: now }, update: { lastActiveAt: now },
  });
}
export function reportAuthorized(header: string | null) {
  const secret = process.env.KANAME_REPORT_TOKEN;
  if (!kanameEnabled() || !secret || secret === process.env.KANAME_SERVICE_TOKEN || !header) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
