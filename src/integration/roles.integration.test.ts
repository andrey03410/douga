import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";
import { createTournament, deleteTournament } from "@/server/tournaments";
import { createArt, poolUsageBytes } from "@/server/arts";
import { ensureAdminRole } from "@/server/roles";
import {
  findUserByEmail,
  normalizeEmail,
  registerAccount,
  verifyCredentials,
} from "@/server/accounts";
import {
  usageSummary,
  listArchiveRows,
  deleteRenderJob,
  listUsers,
  setUserRole,
  deleteUser,
} from "@/server/users";
import type { ExtractedTrack } from "@/lib/upload";

// Phase-5 integration tests: quotas, role bootstrap, cabinet usage, admin
// user management — on the real Prisma schema (SQLite) and the real storage.

const EMAIL_USER = "integration-roles-user@test.local";
const EMAIL_ADMIN = "integration-roles-admin@test.local";
const EMAIL_VICTIM = "integration-roles-victim@test.local";
// T08: registration stores lowercase; legacy rows may still be mixed-case.
const EMAIL_NEW = "integration-roles-new@test.local";
const EMAIL_LEGACY = "Integration-Roles-Legacy@Test.Local";
const EMAIL_TWIN_A = "Integration-Roles-Twin@test.local";
const EMAIL_TWIN_B = "INTEGRATION-ROLES-TWIN@test.local";
const ALL_EMAILS = [
  EMAIL_USER,
  EMAIL_ADMIN,
  EMAIL_VICTIM,
  EMAIL_NEW,
  EMAIL_LEGACY,
  EMAIL_TWIN_A,
  EMAIL_TWIN_B,
];

// The admin route resolves the actor through @/auth; tests pick the session.
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", async () => {
  const { prisma } = await import("@/lib/db");
  return {
    requireUser: async () => {
      const user = session.id
        ? await prisma.user.findUnique({
            where: { id: session.id },
            select: { id: true, email: true, role: true },
          })
        : null;
      if (!user) throw new Error("UNAUTHENTICATED");
      return user;
    },
  };
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeTracks(n = 2, bytes = 64): ExtractedTrack[] {
  return Array.from({ length: n }, (_, i) => ({
    filename: `t${i}.mp3`,
    title: `T${i}`,
    artist: null,
    durationSec: 1,
    kind: "audio" as const,
    data: Buffer.alloc(bytes, i + 1),
  }));
}

let userId: string;
let adminId: string;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: ALL_EMAILS } } });
  for (const u of users) {
    const tournaments = await prisma.tournament.findMany({ where: { userId: u.id } });
    for (const t of tournaments) await removePath(path.join("tournaments", t.id));
    await removePath(path.join("arts", u.id));
  }
  await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
}

beforeAll(async () => {
  await cleanup();
  userId = (
    await prisma.user.create({ data: { email: EMAIL_USER, passwordHash: "x" } })
  ).id;
  adminId = (
    await prisma.user.create({
      data: { email: EMAIL_ADMIN, passwordHash: "x", role: "admin" },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
});

describe("tournament slot quota", () => {
  afterEach(async () => {
    const ts = await prisma.tournament.findMany({ where: { userId } });
    for (const t of ts) await deleteTournament(userId, t.id);
  });

  it("registration default role is user", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.role).toBe("user");
  });

  it("allows the first tournament, rejects the second, frees the slot on delete", async () => {
    const first = await createTournament(
      userId,
      { title: "A", scheme: "merge", blindMode: false },
      makeTracks(),
      { maxTournaments: 1 },
    );
    await expect(
      createTournament(
        userId,
        { title: "B", scheme: "merge", blindMode: false },
        makeTracks(),
        { maxTournaments: 1 },
      ),
    ).rejects.toThrow("TOURNAMENT_LIMIT");

    await deleteTournament(userId, first.id);
    const second = await createTournament(
      userId,
      { title: "B", scheme: "merge", blindMode: false },
      makeTracks(),
      { maxTournaments: 1 },
    );
    expect(second.id).toBeTruthy();
  });

  it("two concurrent creates cannot both squeeze past the quota", async () => {
    const attempt = () =>
      createTournament(
        userId,
        { title: "race", scheme: "merge", blindMode: false },
        makeTracks(),
        { maxTournaments: 1 },
      ).then(
        () => "ok" as const,
        (e) => (e as Error).message,
      );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "TOURNAMENT_LIMIT")).toHaveLength(1);
    expect(await prisma.tournament.count({ where: { userId } })).toBe(1);
  });

  it("null limit means unlimited (admin)", async () => {
    const a = await createTournament(
      adminId,
      { title: "A1", scheme: "merge", blindMode: false },
      makeTracks(),
      { maxTournaments: null },
    );
    const b = await createTournament(
      adminId,
      { title: "A2", scheme: "merge", blindMode: false },
      makeTracks(),
    );
    expect(a.id).not.toBe(b.id);
    await deleteTournament(adminId, a.id);
    await deleteTournament(adminId, b.id);
  });

  it("fills Track.sizeBytes on upload", async () => {
    const t = await createTournament(
      userId,
      { title: "S", scheme: "merge", blindMode: false },
      makeTracks(2, 128),
      { maxTournaments: 1 },
    );
    const tracks = await prisma.track.findMany({ where: { tournamentId: t.id } });
    expect(tracks.map((tr) => tr.sizeBytes)).toEqual([128, 128]);
  });
});

describe("pool quota", () => {
  afterEach(async () => {
    await prisma.art.deleteMany({ where: { userId } });
    await removePath(path.join("arts", userId));
  });

  it("fills Art.sizeBytes and tracks pool usage", async () => {
    await createArt(userId, { fileName: "a.png", data: PNG, maxPoolBytes: null });
    expect(await poolUsageBytes(userId)).toBe(PNG.length);
  });

  it("rejects an upload that would exceed the quota, boundary inclusive", async () => {
    await createArt(userId, { fileName: "a.png", data: PNG, maxPoolBytes: PNG.length });
    await expect(
      createArt(userId, { fileName: "b.png", data: PNG, maxPoolBytes: PNG.length }),
    ).rejects.toThrow("POOL_QUOTA");
    // nothing half-created: one row, one file's worth of usage
    expect(await prisma.art.count({ where: { userId } })).toBe(1);
  });
});

describe("admin bootstrap via ADMIN_EMAILS", () => {
  const prev = process.env.ADMIN_EMAILS;
  afterEach(() => {
    process.env.ADMIN_EMAILS = prev;
  });

  it("elevates a listed email (case-insensitive) and persists", async () => {
    process.env.ADMIN_EMAILS = ` Other@x.y , ${EMAIL_USER.toUpperCase()} `;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await ensureAdminRole(u)).toBe("admin");
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(fresh.role).toBe("admin");
    // put the fixture back
    await prisma.user.update({ where: { id: userId }, data: { role: "user" } });
  });

  it("leaves unlisted emails untouched", async () => {
    process.env.ADMIN_EMAILS = "someone-else@test.local";
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await ensureAdminRole(u)).toBe("user");
  });
});

describe("cabinet usage summary", () => {
  it("reports sizes per entity, totals, and backfills legacy rows", async () => {
    const t = await createTournament(
      userId,
      { title: "Usage", scheme: "merge", blindMode: false },
      makeTracks(2, 100),
      { maxTournaments: 1 },
    );
    // legacy row: file on disk but sizeBytes null -> must be backfilled by stat
    const legacyRel = await saveFile(
      path.join("tournaments", t.id, "tracks", "legacy.mp3"),
      Buffer.alloc(50),
    );
    const legacy = await prisma.track.create({
      data: {
        tournamentId: t.id,
        title: "Legacy",
        filePath: legacyRel,
        order: 99,
        sizeBytes: null,
      },
    });
    await createArt(userId, { fileName: "a.png", data: PNG, maxPoolBytes: null });

    const s = await usageSummary(userId);
    expect(s.role).toBe("user");
    expect(s.quotas.maxTournaments).toBe(1);
    // phase 17: the summary carries aggregates, the rows come from listArchiveRows
    expect(s.archives).toEqual({ count: 1, bytes: 250 }); // 100 + 100 + backfilled 50
    expect(s.archiveBytes).toBe(250);
    expect(s.poolBytes).toBe(PNG.length);
    expect(s.pool.byKind.image).toEqual({ count: 1, bytes: PNG.length });

    const archives = await listArchiveRows(userId);
    expect(archives).toHaveLength(1);
    expect(archives[0].trackCount).toBe(3);
    expect(archives[0].sizeBytes).toBe(250);

    const backfilled = await prisma.track.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(backfilled.sizeBytes).toBe(50);

    await deleteTournament(userId, t.id);
    await prisma.art.deleteMany({ where: { userId } });
    await removePath(path.join("arts", userId));
  });

  it("deleteRenderJob removes the output file and refuses active jobs", async () => {
    const t = await createTournament(
      userId,
      { title: "Jobs", scheme: "merge", blindMode: false },
      makeTracks(),
      { maxTournaments: 1 },
    );
    const outRel = await saveFile(path.join("renders", "it-job.mp4"), Buffer.alloc(10));
    const done = await prisma.renderJob.create({
      data: { tournamentId: t.id, status: "done", outputPath: outRel },
    });
    const running = await prisma.renderJob.create({
      data: { tournamentId: t.id, status: "running" },
    });

    await expect(deleteRenderJob(userId, running.id)).rejects.toThrow("JOB_ACTIVE");
    await expect(deleteRenderJob(adminId, done.id)).rejects.toThrow("NOT_FOUND"); // foreign

    expect(existsSync(absPath(outRel))).toBe(true);
    await deleteRenderJob(userId, done.id);
    expect(existsSync(absPath(outRel))).toBe(false);
    expect(await prisma.renderJob.findUnique({ where: { id: done.id } })).toBeNull();

    await prisma.renderJob.delete({ where: { id: running.id } });
    await deleteTournament(userId, t.id);
  });
});

describe("admin user management", () => {
  it("listUsers reports counts and disk usage", async () => {
    const t = await createTournament(
      userId,
      { title: "List", scheme: "merge", blindMode: false },
      makeTracks(2, 100),
      { maxTournaments: 1 },
    );
    const rows = await listUsers();
    const me = rows.find((r) => r.id === userId);
    expect(me).toBeTruthy();
    expect(me!.tournamentCount).toBe(1);
    expect(me!.diskBytes).toBe(200);
    expect(me!.role).toBe("user");
    await deleteTournament(userId, t.id);
  });

  it("setUserRole validates the role and forbids self-change", async () => {
    await expect(setUserRole(adminId, userId, "superuser")).rejects.toThrow("BAD_ROLE");
    await expect(setUserRole(adminId, adminId, "user")).rejects.toThrow("SELF_CHANGE");
    await expect(setUserRole(adminId, "missing-id", "user")).rejects.toThrow("NOT_FOUND");

    const updated = await setUserRole(adminId, userId, "admin");
    expect(updated.role).toBe("admin");
    await setUserRole(adminId, userId, "user"); // restore fixture
  });

  it("deleteUser wipes tournaments, pool and render outputs from disk", async () => {
    const victim = await prisma.user.create({
      data: { email: EMAIL_VICTIM, passwordHash: "x" },
    });
    const t = await createTournament(
      victim.id,
      { title: "Victim", scheme: "merge", blindMode: false },
      makeTracks(),
      { maxTournaments: 1 },
    );
    const art = await createArt(victim.id, {
      fileName: "v.png",
      data: PNG,
      maxPoolBytes: null,
    });
    const outRel = await saveFile(path.join("renders", "victim-job.mp4"), Buffer.alloc(9));
    const job = await prisma.renderJob.create({
      data: { tournamentId: t.id, status: "done", outputPath: outRel },
    });

    await expect(deleteUser(victim.id, victim.id)).rejects.toThrow("SELF_CHANGE");

    const trackFiles = await prisma.track.findMany({ where: { tournamentId: t.id } });
    expect(trackFiles.every((tr) => existsSync(absPath(tr.filePath)))).toBe(true);
    expect(existsSync(absPath(art.filePath))).toBe(true);

    await deleteUser(adminId, victim.id);

    expect(await prisma.user.findUnique({ where: { id: victim.id } })).toBeNull();
    expect(await prisma.tournament.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.renderJob.findUnique({ where: { id: job.id } })).toBeNull();
    expect(existsSync(absPath(path.join("tournaments", t.id)))).toBe(false);
    expect(existsSync(absPath(path.join("arts", victim.id)))).toBe(false);
    expect(existsSync(absPath(outRel))).toBe(false);
  });
});

describe("ADMIN_EMAILS vs. demotion (T07)", () => {
  const prev = process.env.ADMIN_EMAILS;
  afterEach(async () => {
    process.env.ADMIN_EMAILS = prev;
    await prisma.user.update({ where: { id: userId }, data: { role: "user" } });
  });

  it("refuses to demote an email listed in ADMIN_EMAILS and flags it in listUsers", async () => {
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
    process.env.ADMIN_EMAILS = ` other@x.y , ${EMAIL_USER.toUpperCase()} `;

    await expect(setUserRole(adminId, userId, "user")).rejects.toThrow("ADMIN_BOOTSTRAP");
    const kept = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(kept.role).toBe("admin");
    // keeping the admin role is not a demotion
    expect((await setUserRole(adminId, userId, "admin")).role).toBe("admin");

    const rows = await listUsers();
    expect(rows.find((r) => r.id === userId)?.bootstrapAdmin).toBe(true);
    expect(rows.find((r) => r.id === adminId)?.bootstrapAdmin).toBe(false);

    // once the email leaves ADMIN_EMAILS the demotion goes through
    process.env.ADMIN_EMAILS = "other@x.y";
    expect((await setUserRole(adminId, userId, "user")).role).toBe("user");
    expect((await listUsers()).find((r) => r.id === userId)?.bootstrapAdmin).toBe(false);
  });

  it("the admin API answers 409 ADMIN_BOOTSTRAP with a hint to edit .env", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
    process.env.ADMIN_EMAILS = EMAIL_USER;
    session.id = adminId;
    try {
      const res = await PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ role: "user" }),
        }),
        { params: { id: userId } },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("ADMIN_BOOTSTRAP");
      expect(body.error).toContain("ADMIN_EMAILS");
      expect(body.error).toContain(".env");
      const kept = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(kept.role).toBe("admin");
    } finally {
      session.id = "";
    }
  });
});

describe("email case (T08)", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL_NEW, EMAIL_LEGACY, EMAIL_TWIN_A, EMAIL_TWIN_B] } },
    });
  });

  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Foo.Bar@Example.COM ")).toBe("foo.bar@example.com");
  });

  it("registration stores the email lowercased and refuses a case-only duplicate", async () => {
    const created = await registerAccount(`  ${EMAIL_NEW.toUpperCase()} `, "secret1");
    expect(created.email).toBe(EMAIL_NEW);
    expect(created.role).toBe("user");
    expect(await bcrypt.compare("secret1", created.passwordHash)).toBe(true);

    await expect(registerAccount(EMAIL_NEW, "secret2")).rejects.toThrow("EMAIL_TAKEN");
    await expect(
      registerAccount("Integration-Roles-NEW@test.local", "secret2"),
    ).rejects.toThrow("EMAIL_TAKEN");
    expect(
      await prisma.user.count({ where: { email: { in: [EMAIL_NEW] } } }),
    ).toBe(1);

    // login with any case finds the lowercased row
    const user = await verifyCredentials(EMAIL_NEW.toUpperCase(), "secret1");
    expect(user?.id).toBe(created.id);
    expect(await verifyCredentials(EMAIL_NEW, "wrong-pass")).toBeNull();
  });

  it("registration elevates an ADMIN_EMAILS address regardless of case", async () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = EMAIL_NEW.toUpperCase();
    try {
      const created = await registerAccount(EMAIL_NEW, "secret1");
      expect(created.role).toBe("admin");
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.role).toBe("admin");
    } finally {
      process.env.ADMIN_EMAILS = prev;
    }
  });

  it("a legacy mixed-case row still signs in and blocks a lowercase re-registration", async () => {
    const legacy = await prisma.user.create({
      data: { email: EMAIL_LEGACY, passwordHash: await bcrypt.hash("legacy1", 4) },
    });

    expect((await findUserByEmail(EMAIL_LEGACY.toLowerCase()))?.id).toBe(legacy.id);
    expect((await findUserByEmail(EMAIL_LEGACY.toUpperCase()))?.id).toBe(legacy.id);
    expect((await findUserByEmail(` ${EMAIL_LEGACY} `))?.id).toBe(legacy.id);
    expect(await findUserByEmail("integration-roles-nobody@test.local")).toBeNull();

    expect((await verifyCredentials(EMAIL_LEGACY.toLowerCase(), "legacy1"))?.id).toBe(
      legacy.id,
    );
    expect(await verifyCredentials(EMAIL_LEGACY.toLowerCase(), "nope")).toBeNull();

    await expect(
      registerAccount(EMAIL_LEGACY.toLowerCase(), "secret1"),
    ).rejects.toThrow("EMAIL_TAKEN");
    // the existing row is not rewritten
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(stored.email).toBe(EMAIL_LEGACY);
  });

  it("two legacy rows differing only in case: the exactly typed one wins", async () => {
    const a = await prisma.user.create({ data: { email: EMAIL_TWIN_A, passwordHash: "x" } });
    const b = await prisma.user.create({ data: { email: EMAIL_TWIN_B, passwordHash: "x" } });
    expect((await findUserByEmail(EMAIL_TWIN_A))?.id).toBe(a.id);
    expect((await findUserByEmail(EMAIL_TWIN_B))?.id).toBe(b.id);
    // no exact hit: deterministic, the oldest account
    expect((await findUserByEmail("integration-roles-twin@TEST.local"))?.id).toBe(a.id);
  });

  it("a legacy mixed-case account signs in although a lowercase twin exists", async () => {
    const legacy = await prisma.user.create({
      data: { email: "Integration-Roles-Bob@Test.Local", passwordHash: await bcrypt.hash("bob-old", 4) },
    });
    const twin = await prisma.user.create({
      data: { email: "integration-roles-bob@test.local", passwordHash: await bcrypt.hash("bob-new", 4) },
    });
    try {
      // typed exactly: that row wins
      expect((await findUserByEmail("Integration-Roles-Bob@Test.Local"))?.id).toBe(legacy.id);
      // typed in another case: each owner still gets in with their own password
      expect((await verifyCredentials("INTEGRATION-ROLES-BOB@test.local", "bob-old"))?.id).toBe(
        legacy.id,
      );
      expect((await verifyCredentials("integration-roles-bob@test.local", "bob-old"))?.id).toBe(
        legacy.id,
      );
      expect((await verifyCredentials("integration-roles-bob@test.local", "bob-new"))?.id).toBe(
        twin.id,
      );
      expect(await verifyCredentials("integration-roles-bob@test.local", "wrong")).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [legacy.id, twin.id] } } });
    }
  });
});
