import "server-only";
import { prisma } from "@/lib/db";

/** Emails auto-elevated to admin on login/registration (comma-separated env). */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The role ADMIN_EMAILS grants. */
export const BOOTSTRAP_ROLE = "admin";

/**
 * Whether the email is listed in ADMIN_EMAILS. Such an account is elevated
 * back to BOOTSTRAP_ROLE on every login, so the admin panel must not demote it.
 */
export function isBootstrapAdmin(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

/**
 * Bootstrap: if the email is listed in ADMIN_EMAILS but the stored role is
 * lower, persist the elevation. Survives DB recreation.
 */
export async function ensureAdminRole(user: {
  id: string;
  email: string;
  role: string;
}): Promise<string> {
  if (user.role !== BOOTSTRAP_ROLE && isBootstrapAdmin(user.email)) {
    await prisma.user.update({ where: { id: user.id }, data: { role: BOOTSTRAP_ROLE } });
    return BOOTSTRAP_ROLE;
  }
  return user.role;
}
