import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { deleteUser } from "@/server/users";
import * as studio from "@/server/studio";

let owner: string;
let other: string;
let admin: string;

const doc = (title = "Сохранено") =>
  createVideoDocument({
    kind: "top",
    title,
    participants: [{ id: "object", label: "Стул" }],
  });

async function project() {
  return studio.createStudioProject(owner, {
    document: doc(),
    idempotencyKey: randomUUID(),
  });
}

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `pub-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `pub-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  admin = (
    await prisma.user.create({
      data: {
        email: `pub-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "admin",
      },
    })
  ).id;
});

afterAll(async () => {
  for (const id of [owner, other]) {
    if (!id) continue;
    await prisma.user.update({ where: { id }, data: { role: "user" } }).catch(() => {});
    const projects = await studio.listStudioProjects(id).catch(() => []);
    for (const row of projects) await studio.deleteStudioProject(id, row.id);
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await removePath(`studio/${id}`);
    await removePath(`studio-exports/${id}`);
  }
  if (admin) await prisma.user.delete({ where: { id: admin } }).catch(() => {});
});

describe("studio publication", () => {
  it("publishes the saved revision, keeps the token, and ignores an unsaved draft", async () => {
    const created = await project();
    const first = await studio.publishStudioProject(owner, created.id, {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
    });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.revision).toBe(created.revision);
    expect(first.updated).toBe(false);

    const again = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(again.token).toBe(first.token);
    expect(again.snapshotId).toBe(first.snapshotId);
    expect(await prisma.studioSnapshot.count({ where: { projectId: created.id } })).toBe(1);

    const drafted = await studio.saveStudioDraft(owner, created.id, {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      document: doc("Черновик не для ссылки"),
    });
    expect(drafted.revision).toBe(created.revision);
    expect(drafted.draft).not.toBeNull();
    const duringDraft = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(duringDraft.revision).toBe(created.revision);
    expect(duringDraft.snapshotId).toBe(first.snapshotId);
    const payload = JSON.parse(
      (await prisma.studioSnapshot.findUniqueOrThrow({ where: { id: first.snapshotId } }))
        .payloadJson,
    ) as { document: { title: string } };
    expect(payload.document.title).toBe("Сохранено");

    const committed = await studio.commitStudioDraft(owner, created.id, {
      expectedVersion: drafted.version,
      idempotencyKey: randomUUID(),
    });
    expect(committed.revision).toBe(created.revision + 1);
    const updated = await studio.publishStudioProject(owner, created.id, {
      expectedVersion: committed.version,
      idempotencyKey: randomUUID(),
    });
    expect(updated.token).toBe(first.token);
    expect(updated.revision).toBe(committed.revision);
    expect(updated.snapshotId).not.toBe(first.snapshotId);
    expect(updated.updated).toBe(true);
    expect(await prisma.studioSnapshot.count({ where: { projectId: created.id } })).toBe(1);

    await expect(
      studio.deleteStudioRevision(owner, created.id, updated.revision, {
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("REVISION_IN_USE");

    await studio.unpublishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(await studio.findPublicationByToken(first.token)).toBeNull();
    expect(await prisma.studioSnapshot.count({ where: { projectId: created.id } })).toBe(0);

    const republished = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(republished.token).not.toBe(first.token);
    expect(await studio.findPublicationByToken(first.token)).toBeNull();
    expect(await studio.findPublicationByToken(republished.token)).toMatchObject({
      token: republished.token,
      revision: republished.revision,
    });
  });

  it("hides a project from another author and a role without media upload", async () => {
    const created = await project();
    await expect(
      studio.publishStudioProject(other, created.id, { idempotencyKey: randomUUID() }),
    ).rejects.toThrow("NOT_FOUND");
    await prisma.user.update({ where: { id: owner }, data: { role: "locked" } });
    try {
      await expect(
        studio.publishStudioProject(owner, created.id, { idempotencyKey: randomUUID() }),
      ).rejects.toThrow("FORBIDDEN");
    } finally {
      await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
    }
  });

  it("keeps a published snapshot when its last job is deleted, and releases it on unpublish", async () => {
    const created = await project();
    const pub = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    await expect(
      studio.deleteStudioSnapshot(owner, pub.snapshotId),
    ).rejects.toThrow("PUBLICATION_IN_USE");
    const job = await prisma.studioJob.create({
      data: {
        userId: owner,
        projectId: created.id,
        snapshotId: pub.snapshotId,
        kind: "still",
        inputJson: "{}",
        engineId: "engine",
        status: "done",
      },
    });
    await studio.deleteStudioJob(owner, job.id);
    expect(
      await prisma.studioSnapshot.findUnique({ where: { id: pub.snapshotId } }),
    ).not.toBeNull();
    await studio.unpublishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(
      await prisma.studioSnapshot.findUnique({ where: { id: pub.snapshotId } }),
    ).toBeNull();
  });

  it("deletes the project together with its publication, and still blocks on a job", async () => {
    const created = await project();
    const pub = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    const job = await prisma.studioJob.create({
      data: {
        userId: owner,
        projectId: created.id,
        kind: "still",
        inputJson: "{}",
        engineId: "engine",
        status: "done",
      },
    });
    await expect(
      studio.deleteStudioProject(owner, created.id, { idempotencyKey: randomUUID() }),
    ).rejects.toThrow("JOB_IN_USE");
    expect(
      await prisma.studioPublication.findUnique({ where: { projectId: created.id } }),
    ).not.toBeNull();
    await prisma.studioJob.delete({ where: { id: job.id } });
    await studio.deleteStudioProject(owner, created.id, { idempotencyKey: randomUUID() });
    expect(await studio.findPublicationByToken(pub.token)).toBeNull();
    expect(
      await prisma.studioPublication.findUnique({ where: { projectId: created.id } }),
    ).toBeNull();
  });

  it("lists only the author's publications with the snapshot size", async () => {
    const created = await project();
    const pub = await studio.publishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    const mine = await studio.listStudioPublications(owner);
    expect(mine).toContainEqual(
      expect.objectContaining({
        projectId: created.id,
        revision: pub.revision,
        bytes: pub.bytes,
      }),
    );
    expect(mine.every((row) => row.projectId !== "foreign")).toBe(true);
    expect(await studio.listStudioPublications(other)).toEqual([]);
    await studio.unpublishStudioProject(owner, created.id, {
      idempotencyKey: randomUUID(),
    });
    expect(
      (await studio.listStudioPublications(owner)).some(
        (row) => row.projectId === created.id,
      ),
    ).toBe(false);
  });

  it("deletes an account that still has a publication", async () => {
    const victim = await prisma.user.create({
      data: { email: `pub-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    const created = await studio.createStudioProject(victim.id, {
      document: doc(),
      idempotencyKey: randomUUID(),
    });
    const pub = await studio.publishStudioProject(victim.id, created.id, {
      idempotencyKey: randomUUID(),
    });
    await deleteUser(admin, victim.id);
    expect(await prisma.user.findUnique({ where: { id: victim.id } })).toBeNull();
    expect(await studio.findPublicationByToken(pub.token)).toBeNull();
    expect(
      await prisma.studioSnapshot.count({ where: { projectId: created.id } }),
    ).toBe(0);
  });
});
