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
 * Every account an email can mean, best match first: the row typed exactly,
 * then the canonical lowercase row, then legacy case variants, oldest first.
 * Matching is `lower(email) = ?` via raw SQL (portable between SQLite and
 * Postgres). SQLite's lower() folds ASCII only, so a legacy row with a
 * non-ASCII capital is found only when typed exactly as stored.
 */
async function findUsersByEmail(email: string): Promise<User[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const typed = email.trim();
  const rows = await prisma.$queryRaw<{ id: string; email: string }[]>`
    SELECT "id", "email" FROM "User"
    WHERE lower("email") = ${normalized} OR "email" = ${typed}
    ORDER BY "createdAt" ASC, "id" ASC`;
  if (rows.length === 0) return [];
  const rank = (r: { email: string }) => (r.email === typed ? 0 : r.email === normalized ? 1 : 2);
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b)); // stable: oldest first within a rank
  const users = await prisma.user.findMany({ where: { id: { in: ordered.map((r) => r.id) } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ordered.flatMap((r) => byId.get(r.id) ?? []);
}

/** The account for an email regardless of its case (best match, see findUsersByEmail). */
export async function findUserByEmail(email: string): Promise<User | null> {
  return (await findUsersByEmail(email))[0] ?? null;
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
  // Legacy rows may differ only in case (`Bob@x` and `bob@x`): the password
  // decides which of them is signing in.
  for (const user of await findUsersByEmail(email)) {
    if (!(await bcrypt.compare(password, user.passwordHash))) continue;
    const role = await ensureAdminRole(user);
    return { ...user, role };
  }
  return null;
}
