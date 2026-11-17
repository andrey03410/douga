// Roles & permissions matrix — the single source of truth for access control.
// All checks in routes/services go through `can()` and `quotasFor()`; nothing
// outside this file compares role names. Adding a role = adding one entry here.

export type Permission =
  | "tournament:create"
  | "render:run"
  | "media:upload"
  | "admin:users";

export interface Quotas {
  /** Max simultaneously existing tournaments; null = unlimited. */
  maxTournaments: number | null;
  /** Max size of one uploaded archive in bytes. */
  maxArchiveBytes: number;
  /** Max total size of the user's media pool in bytes; null = unlimited. */
  maxPoolBytes: number | null;
}

export interface RoleDef {
  /** Human-readable name for UI badges and the admin panel. */
  label: string;
  permissions: readonly Permission[];
  quotas: Quotas;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const ADMIN: RoleDef = {
  label: "Администратор",
  permissions: ["tournament:create", "media:upload", "render:run", "admin:users"],
  quotas: { maxTournaments: null, maxArchiveBytes: 10 * GB, maxPoolBytes: null },
};

// "guest" is virtual: no DB row ever holds it, it models the absence of a
// session (and is the fallback for unknown role strings).
export const ROLES: Record<string, RoleDef> = {
  guest: {
    label: "Гость",
    permissions: [],
    quotas: { maxTournaments: 0, maxArchiveBytes: 0, maxPoolBytes: 0 },
  },
  // Legacy database rows and already-open sessions have the same rights now.
  user: ADMIN,
  admin: ADMIN,
};

/** All registered accounts are admins; `user` is only a legacy read alias. */
export const ASSIGNABLE_ROLES = ["admin"];

function roleDef(role: string | null | undefined): RoleDef {
  return Object.prototype.hasOwnProperty.call(ROLES, role ?? "guest")
    ? ROLES[role ?? "guest"]
    : ROLES.guest;
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  return roleDef(role).permissions.includes(permission);
}

export function quotasFor(role: string | null | undefined): Quotas {
  return roleDef(role).quotas;
}

export function roleLabel(role: string | null | undefined): string {
  return Object.prototype.hasOwnProperty.call(ROLES, role ?? "")
    ? roleDef(role).label
    : role || "Гость";
}

export function isAssignableRole(role: string): boolean {
  return ASSIGNABLE_ROLES.includes(role);
}

/**
 * Can the user create one more tournament, given how many they already have?
 */
export function canCreateTournament(role: string, existingCount: number): boolean {
  if (!can(role, "tournament:create")) return false;
  const { maxTournaments } = quotasFor(role);
  return maxTournaments === null || existingCount < maxTournaments;
}

/** Would adding a file of `addBytes` keep the pool within the role's quota? */
export function fitsPoolQuota(role: string, usedBytes: number, addBytes: number): boolean {
  const { maxPoolBytes } = quotasFor(role);
  return maxPoolBytes === null || usedBytes + addBytes <= maxPoolBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} ГБ`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${Math.round(bytes)} Б`;
}
