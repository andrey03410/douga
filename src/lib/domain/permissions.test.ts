import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  can,
  canCreateTournament,
  fitsPoolQuota,
  formatBytes,
  isAssignableRole,
  quotasFor,
  roleLabel,
} from "./permissions";

const MB = 1024 * 1024;

describe("permissions matrix", () => {
  it("guest has no permissions at all", () => {
    for (const p of ["tournament:create", "render:run", "media:upload", "admin:users"] as const) {
      expect(can("guest", p)).toBe(false);
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("legacy user can render and administer immediately", () => {
    expect(can("user", "tournament:create")).toBe(true);
    expect(can("user", "media:upload")).toBe(true);
    expect(can("user", "render:run")).toBe(true);
    expect(can("user", "admin:users")).toBe(true);
  });

  it("admin can do everything", () => {
    expect(can("admin", "tournament:create")).toBe(true);
    expect(can("admin", "media:upload")).toBe(true);
    expect(can("admin", "render:run")).toBe(true);
    expect(can("admin", "admin:users")).toBe(true);
  });

  it.each(["superuser", "constructor", "__proto__", "toString"])("unknown role %s fails closed", (role) => {
    for (const permission of ["tournament:create", "render:run", "media:upload", "admin:users"] as const) {
      expect(can(role, permission)).toBe(false);
    }
    expect(quotasFor(role)).toEqual({ maxTournaments: 0, maxArchiveBytes: 0, maxPoolBytes: 0 });
  });

  it("only admin is assignable to accounts; legacy user remains read-compatible", () => {
    expect(isAssignableRole("guest")).toBe(false);
    expect(isAssignableRole("user")).toBe(false);
    expect(isAssignableRole("admin")).toBe(true);
    expect(ASSIGNABLE_ROLES).toEqual(["admin"]);
  });
});

describe("quotas", () => {
  it("legacy user has unlimited tournaments and pool, 10 GB archives", () => {
    const q = quotasFor("user");
    expect(q.maxTournaments).toBeNull();
    expect(q.maxArchiveBytes).toBe(10 * 1024 * MB);
    expect(q.maxPoolBytes).toBeNull();
  });

  it("admin: unlimited tournaments and pool, 10 GB archive", () => {
    const q = quotasFor("admin");
    expect(q.maxTournaments).toBeNull();
    expect(q.maxPoolBytes).toBeNull();
    expect(q.maxArchiveBytes).toBe(10 * 1024 * MB);
  });

  it("registered accounts have unlimited tournament slots and guests cannot create", () => {
    expect(canCreateTournament("user", 0)).toBe(true);
    expect(canCreateTournament("user", 999)).toBe(true);
    expect(canCreateTournament("admin", 999)).toBe(true);
    expect(canCreateTournament("guest", 0)).toBe(false);
  });

  it("registered accounts have unlimited pools while guests have no storage", () => {
    expect(fitsPoolQuota("user", 10 * 1024 * MB, 10 * 1024 * MB)).toBe(true);
    expect(fitsPoolQuota("guest", 0, 1)).toBe(false);
    expect(fitsPoolQuota("admin", 10 * 1024 * MB, 10 * 1024 * MB)).toBe(true);
  });
});

describe("labels & formatting", () => {
  it("roleLabel maps known roles and falls back to the raw string", () => {
    expect(roleLabel("admin")).toBe("Администратор");
    expect(roleLabel("user")).toBe("Администратор");
    expect(roleLabel(null)).toBe("Гость");
    expect(roleLabel("moderator")).toBe("moderator");
  });

  it("formatBytes picks a sensible unit", () => {
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(10 * 1024)).toBe("10 КБ");
    expect(formatBytes(100 * MB)).toBe("100.0 МБ");
    expect(formatBytes(2 * 1024 * MB)).toBe("2.0 ГБ");
  });
});
