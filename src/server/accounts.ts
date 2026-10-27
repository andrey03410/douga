import "server-only";
import bcrypt from "bcryptjs";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureAdminRole } from "@/server/roles";

// Accounts by email. New accounts store the email trimmed and lowercased;
// rows registered before that keep the case they were typed in and are never
// rewritten. Every lookup by email (login, MCP actor, the registration
// duplicate check) goes through findUserByEmail so the two kinds of rows
// behave the same.

/** Canonical stored form of an email: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Find the account for an email regardless of its case.
 *
 * 1. Exact match on the normalized email: hits the unique index and every
 *    account created since emails are stored lowercased.
 * 2. Fallback for legacy mixed-case rows: `lower(email) = ?` via raw SQL
 *    (portable between SQLite and Postgres). If several legacy rows differ
 *    only in case, the one typed exactly wins, otherwise the oldest.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const exact = await prisma.user.findUnique({ where: { email: normalized } });
  if (exact) return exact;

  const rows = await prisma.$queryRaw<{ id: string; email: string }[]>`
    SELECT "id", "email" FROM "User"
    WHERE lower("email") = ${normalized}
    ORDER BY "createdAt" ASC, "id" ASC`;
  if (rows.length === 0) return null;
  const typed = email.trim();
  const match = rows.find((r) => r.email === typed) ?? rows[0];
  return prisma.user.findUnique({ where: { id: match.id } });
}

/**
 * Create an account with the default role (ADMIN_EMAILS bootstrap applied).
 * Throws EMAIL_TAKEN when an account with the same email in any case exists.
 */
export async function registerAccount(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  if (await findUserByEmail(normalized)) throw new Error("EMAIL_TAKEN");
  const passwordHash = await bcrypt.hash(password, 10);
  let user: User;
  try {
    user = await prisma.user.create({ data: { email: normalized, passwordHash } });
  } catch (e) {
    // a concurrent registration of the same email won the unique index
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("EMAIL_TAKEN");
    }
    throw e;
  }
  const role = await ensureAdminRole(user);
  return { ...user, role };
}

/**
 * Check a login: the account for the email (any case) and its password.
 * Applies the ADMIN_EMAILS bootstrap on success. Null on any mismatch.
 */
export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;
  const role = await ensureAdminRole(user);
  return { ...user, role };
}
