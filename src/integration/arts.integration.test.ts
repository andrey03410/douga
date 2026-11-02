import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import {
  listArts,
  createArt,
  renameArt,
  deleteArt,
  deleteArts,
  MAX_BULK_DELETE,
} from "@/server/arts";

// Integration tests for the arts service layer on the real Prisma schema.

const EMAIL = "integration-arts@test.local";
const EMAIL_OTHER = "integration-arts-other@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userId: string;
let otherUserId: string;

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { in: [EMAIL, EMAIL_OTHER] } },
  });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: EMAIL_OTHER, passwordHash: "x" },
  });
  otherUserId = other.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("arts service", () => {
  it("uploads with a default label from the file name and stores the file", async () => {
    const art = await createArt(userId, { fileName: "Roaring Tides.png", data: PNG });
    expect(art.label).toBe("Roaring Tides");
    expect(existsSync(absPath(art.filePath))).toBe(true);
  });

  it("rejects unsupported extensions", async () => {
    await expect(
      createArt(userId, { fileName: "notes.txt", data: PNG }),
    ).rejects.toThrow("BAD_EXT");
  });

  it("searches by label and paginates without gaps or overlap", async () => {
    const labels = ["Alpha", "Alpha Two", "Beta", "Gamma", "Delta"];
    for (const label of labels) {
      await createArt(userId, { fileName: `${label}.png`, data: PNG, label });
    }

    const found = await listArts(userId, { q: "alpha" });
    expect(found.arts.map((a) => a.label).sort()).toEqual(["Alpha", "Alpha Two"]);

    // walk all pages with limit 2
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listArts(userId, { limit: 2, cursor: cursor ?? undefined });
      expect(page.arts.length).toBeLessThanOrEqual(2);
      seen.push(...page.arts.map((a) => a.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const all = await listArts(userId, { limit: 100 });
    expect(new Set(seen).size).toBe(seen.length); // no overlap
    expect(seen.length).toBe(all.arts.length); // no gaps
  });

  it("does not leak other users' arts", async () => {
    await createArt(otherUserId, { fileName: "foreign.png", data: PNG });
    const mine = await listArts(userId, { q: "foreign" });
    expect(mine.arts).toHaveLength(0);
  });

  it("renames own art and refuses a foreign one", async () => {
    const art = await createArt(userId, { fileName: "rename-me.png", data: PNG });
    await renameArt(userId, art.id, "Renamed");
    const reloaded = await prisma.art.findUnique({ where: { id: art.id } });
    expect(reloaded?.label).toBe("Renamed");

    await expect(renameArt(otherUserId, art.id, "Hijack")).rejects.toThrow("NOT_FOUND");
  });

  it("deletes an art: file and row are gone", async () => {
    const art = await createArt(userId, { fileName: "doomed.png", data: PNG });

    await deleteArt(userId, art.id);

    expect(await prisma.art.findUnique({ where: { id: art.id } })).toBeNull();
    expect(existsSync(absPath(art.filePath))).toBe(false);
  });

  it("refuses to delete a foreign art", async () => {
    const art = await createArt(otherUserId, { fileName: "keep.png", data: PNG });
    await expect(deleteArt(userId, art.id)).rejects.toThrow("NOT_FOUND");
  });
});

describe("art usage breakdown", () => {
  it("counts studio references and refuses to delete a referenced media", async () => {
    const art = await createArt(userId, { fileName: "usage-poster.png", data: PNG });
    const project = await prisma.studioProject.create({
      data: {
        userId,
        title: "Usage studio",
        kind: "top",
        documentJson: "{}",
      },
    });
    await prisma.studioAssetReference.create({
      data: { projectId: project.id, scope: "draft", artId: art.id },
    });
    await prisma.studioAssetReference.create({
      data: { projectId: project.id, scope: "head", artId: art.id },
    });

    const listed = await listArts(userId, { q: "usage-poster" });
    expect(listed.arts[0]?.usage).toEqual({ studio: 2, total: 2 });
    expect(listed.arts[0]?.usageCount).toBe(2);
    await expect(deleteArt(userId, art.id)).rejects.toThrow("STUDIO_ASSET_IN_USE");

    await prisma.studioProject.delete({ where: { id: project.id } });
    await deleteArt(userId, art.id);
    expect(await prisma.art.findUnique({ where: { id: art.id } })).toBeNull();
  });

  it("reports zeros for media nothing points at", async () => {
    const lonely = await createArt(userId, { fileName: "usage-lonely.png", data: PNG });
    const listed = await listArts(userId, { q: "usage-lonely" });
    expect(listed.arts[0]?.usage).toEqual({ studio: 0, total: 0 });
    await deleteArt(userId, lonely.id);
  });
});

describe("bulk delete", () => {
  it("deletes many at once, wipes their files and reports the ids", async () => {
    const a = await createArt(userId, { fileName: "bulk-a.png", data: PNG });
    const b = await createArt(userId, { fileName: "bulk-b.png", data: PNG });
    const paths = [absPath(a.filePath), absPath(b.filePath)];

    const res = await deleteArts(userId, [a.id, b.id]);
    expect(res.deleted.sort()).toEqual([a.id, b.id].sort());
    expect(res.failed).toEqual([]);
    expect(paths.some((p) => existsSync(p))).toBe(false);
    expect(await prisma.art.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
  });

  it("skips what it cannot delete and still deletes the rest", async () => {
    const mine = await createArt(userId, { fileName: "bulk-mine.png", data: PNG });
    const foreign = await createArt(otherUserId, { fileName: "bulk-foreign.png", data: PNG });

    const res = await deleteArts(userId, [mine.id, foreign.id, "cmsnosuchid0000000000000"]);
    expect(res.deleted).toEqual([mine.id]);
    expect(res.failed.map((f) => f.id).sort()).toEqual(
      [foreign.id, "cmsnosuchid0000000000000"].sort(),
    );
    expect(res.failed.every((f) => f.reason === "NOT_FOUND")).toBe(true);
    expect(await prisma.art.count({ where: { id: foreign.id } })).toBe(1);
    await deleteArt(otherUserId, foreign.id);
  });

  it("skips media a studio project still references", async () => {
    const free = await createArt(userId, { fileName: "bulk-free.png", data: PNG });
    const used = await createArt(userId, { fileName: "bulk-used.png", data: PNG });
    const project = await prisma.studioProject.create({
      data: { userId, title: "Bulk studio", kind: "top", documentJson: "{}" },
    });
    await prisma.studioAssetReference.create({
      data: { projectId: project.id, scope: "head", artId: used.id },
    });

    const res = await deleteArts(userId, [free.id, used.id]);
    expect(res.deleted).toEqual([free.id]);
    expect(res.failed).toEqual([{ id: used.id, reason: "STUDIO_ASSET_IN_USE" }]);
    expect(await prisma.art.count({ where: { id: used.id } })).toBe(1);

    await prisma.studioProject.delete({ where: { id: project.id } });
    await deleteArt(userId, used.id);
  });

  it("ignores duplicate ids and refuses an empty or oversized batch", async () => {
    const art = await createArt(userId, { fileName: "bulk-dup.png", data: PNG });
    const res = await deleteArts(userId, [art.id, art.id]);
    expect(res.deleted).toEqual([art.id]);
    expect(res.failed).toEqual([]);

    await expect(deleteArts(userId, [])).rejects.toThrow("NO_IDS");
    await expect(
      deleteArts(userId, Array.from({ length: MAX_BULK_DELETE + 1 }, (_, i) => `id${i}`)),
    ).rejects.toThrow("TOO_MANY");
  });
});
