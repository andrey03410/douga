import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";

/** Personal tokens for MCP over HTTP: `dga_` + 32 random bytes; only the SHA-256 is stored. */
export const API_TOKEN_PREFIX = "dga_";
const TOKEN = /^dga_[A-Za-z0-9_-]{43}$/;
const MAX_ACTIVE = 10;

export const issueApiTokenSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export class ApiTokenError extends Error {
  constructor(public code: "TOKEN_LIMIT" | "NOT_FOUND" | "FORBIDDEN") {
    super(code);
  }
}

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const view = (row: {
  id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
}): ApiTokenView => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
});

/** The secret is returned once and never again. Guests have no account and no tokens. */
export async function issueApiToken(userId: string, raw: z.input<typeof issueApiTokenSchema>) {
  const { name } = issueApiTokenSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role === "guest") throw new ApiTokenError("FORBIDDEN");
  if ((await prisma.apiToken.count({ where: { userId, revokedAt: null } })) >= MAX_ACTIVE)
    throw new ApiTokenError("TOKEN_LIMIT");
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({
    data: { userId, name, prefix: token.slice(0, 10), tokenHash: digest(token) },
  });
  return { token, ...view(row) };
}

export async function listApiTokens(userId: string): Promise<ApiTokenView[]> {
  const rows = await prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(view);
}

export async function revokeApiToken(userId: string, id: string): Promise<ApiTokenView> {
  const row = await prisma.apiToken.findFirst({ where: { id, userId } });
  if (!row) throw new ApiTokenError("NOT_FOUND");
  return view(row.revokedAt ? row : await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } }));
}

/** The account of a live token, or null. Every MCP request resolves it again. */
export async function resolveApiToken(token: string | null | undefined) {
  if (!token || !TOKEN.test(token)) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { select: { id: true, email: true, role: true } } },
  });
  if (!row || row.revokedAt || row.user.role === "guest") return null;
  // A coarse stamp is enough and keeps writes rare.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000)
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { userId: row.user.id, email: row.user.email, role: row.user.role };
}
