import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";
import { createArt } from "@/server/arts";
import { usageSummary, listArchiveRows, listRenderRows } from "@/server/users";
import { createStudioProject, deleteStudioProject } from "@/server/studio";
import { createVideoDocument } from "@/video";

// Phase 17: the cabinet used to load every art row and stat() every render file
// on each visit. The summary is now pure aggregates and the lists are paged.

const EMAIL = "integration-account@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userId: string;
let tournamentId: string;

const EMAIL_OTHER = `other-${EMAIL}`;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: "x", role: "admin" },
  });
  userId = user.id;

  // one archive with two tracks of known size
  const tournament = await prisma.tournament.create({
    data: { userId, title: "Account IT", scheme: "merge", status: "completed", topSize: 2 },
  });
  tournamentId = tournament.id;
  await prisma.track.createMany({
    data: [
      { tournamentId, title: "A", filePath: "fake/a.mp3", order: 0, sizeBytes: 100 },
      { tournamentId, title: "B", filePath: "fake/b.mp3", order: 1, sizeBytes: 150 },
    ],
  });

  // pool: two images and one audio
  await createArt(userId, { fileName: "acc-1.png", data: PNG });
  await createArt(userId, { fileName: "acc-2.png", data: PNG });
  await prisma.art.create({
    data: { userId, filePath: "fake/x.mp3", label: "acc-audio", kind: "audio", sizeBytes: 500 },
  });

  // three render jobs: one finished with a real file, one finished with a
  // measured size, one still running
  const rel = `renders/account-it.mp4`;
  await saveFile(rel, Buffer.alloc(2048, 1));
  await prisma.renderJob.create({
    data: { tournamentId, status: "done", progress: 1, outputPath: rel }, // outputBytes null
  });
  await prisma.renderJob.create({
    data: { tournamentId, status: "done", progress: 1, outputPath: rel, outputBytes: 4096 },
  });
  await prisma.renderJob.create({ data: { tournamentId, status: "running", progress: 0.3 } });
});

afterAll(async () => {
  await removePath("renders/account-it.mp4");
  await cleanup();
  await prisma.$disconnect();
});

describe("usageSummary", () => {
  it("reports aggregates only — no per-row lists", async () => {
    const s = await usageSummary(userId);

    expect(s.role).toBe("admin");
    expect(s.pool).toEqual({
      count: 3,
      bytes: PNG.length * 2 + 500,
      byKind: {
        image: { count: 2, bytes: PNG.length * 2 },
        video: { count: 0, bytes: 0 },
        audio: { count: 1, bytes: 500 },
      },
    });
    expect(s.archives).toEqual({ count: 1, bytes: 250 });
    // 2048 backfilled from disk + 4096 already measured; the running job has none
    expect(s.renders).toEqual({ count: 3, ready: 2, bytes: 2048 + 4096 });

    // the heavy arrays are gone
    expect((s as unknown as Record<string, unknown>).arts).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).tournaments).toBeUndefined();

    // and the backfill was persisted, so the next visit costs no stat()
    const measured = await prisma.renderJob.findMany({
      where: { tournamentId, outputPath: { not: null } },
      select: { outputBytes: true },
    });
    expect(measured.every((j) => j.outputBytes !== null)).toBe(true);
  });

  it("backfills track sizes it finds missing", async () => {
    const rel = "renders/account-legacy.mp3";
    await saveFile(rel, Buffer.alloc(70, 2));
    const legacy = await prisma.track.create({
      data: { tournamentId, title: "Legacy", filePath: rel, order: 9, sizeBytes: null },
    });

    const s = await usageSummary(userId);
    expect(s.archives.bytes).toBe(250 + 70);
    const row = await prisma.track.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row.sizeBytes).toBe(70);

    await prisma.track.delete({ where: { id: legacy.id } });
    await removePath(rel);
  });
});

describe("usageSummary.studio (T10)", () => {
  it("is all zeros for an account without Studio data", async () => {
    const other = await prisma.user.create({ data: { email: EMAIL_OTHER, passwordHash: "x" } });
    try {
      expect((await usageSummary(other.id)).studio).toEqual({
        projects: 0,
        revisions: 0,
        snapshots: 0,
        bytes: 0,
        jobs: 0,
        resultBytes: 0,
      });
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("counts the account's projects, jobs and result bytes", async () => {
    const project = await createStudioProject(userId, {
      document: createVideoDocument({ kind: "top", participants: [{ id: "a", label: "A" }] }),
    });
    const jobs = await Promise.all(
      [1000, 234].map((outputBytes) =>
        prisma.studioJob.create({
          data: {
            userId,
            projectId: project.id,
            kind: "still",
            engineId: "account-test",
            inputJson: "{}",
            status: "done",
            outputBytes,
          },
        }),
      ),
    );
    try {
      const { studio } = await usageSummary(userId);
      expect(studio).toMatchObject({ projects: 1, revisions: 1, jobs: 2, resultBytes: 1234 });
      expect(Object.keys(studio).sort()).toEqual(
        ["bytes", "jobs", "projects", "resultBytes", "revisions", "snapshots"],
      );
    } finally {
      await prisma.studioJob.deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } });
      await deleteStudioProject(userId, project.id);
      await removePath(`studio/${userId}`);
    }
  });
});

describe("cabinet lists", () => {
  it("lists archives with their track count and size", async () => {
    const rows = await listArchiveRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: tournamentId, title: "Account IT", trackCount: 2, sizeBytes: 250 });
  });

  it("pages renders newest-first and reports the measured size", async () => {
    const first = await listRenderRows(userId, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.rows.every((r) => r.title === "Account IT")).toBe(true);

    const second = await listRenderRows(userId, { limit: 2, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const all = [...first.rows, ...second.rows];
    expect(all.filter((r) => r.hasOutput)).toHaveLength(2);
    expect(all.find((r) => !r.hasOutput)?.sizeBytes).toBe(0);
    expect(all.filter((r) => r.hasOutput).map((r) => r.sizeBytes).sort((a, b) => a - b)).toEqual([
      2048, 4096,
    ]);
    // ids are unique across the pages (no repeat at the cursor boundary)
    expect(new Set(all.map((r) => r.id)).size).toBe(3);
  });

  it("never shows another user's renders", async () => {
    const other = await prisma.user.create({ data: { email: EMAIL_OTHER, passwordHash: "x" } });
    const rows = await listRenderRows(other.id, { limit: 10 });
    expect(rows.rows).toEqual([]);
    expect(await listArchiveRows(other.id)).toEqual([]);
    await prisma.user.delete({ where: { id: other.id } });
  });
});
