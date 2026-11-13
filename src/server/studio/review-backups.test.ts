import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { removePath, absPath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video/builders";
import {
  createStudioProject,
  deleteStudioProject,
  saveStudioDraft,
  transformStudioDraft,
} from "./projects";
import { applyStudioReview, reviewStudioVideo } from "./review";
import * as assets from "./assets";
import { getStudioReviewBackup } from "./review-backups";
let owner: string, other: string, artId: string;
const projects: string[] = [];
async function project() {
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.settings.typography = { theme: "clean" };
  document.scenes = [
    {
      id: "review",
      block: "custom",
      duration: { sec: 5 },
      nodes: [
        {
          id: "label",
          type: "text",
          text: "Имя героя",
          rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 },
          typography: { role: "label" },
        },
      ],
    },
  ];
  const result = await createStudioProject(owner, { document });
  projects.push(result.id);
  return result;
}
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: {
        email: `review-backup-${randomUUID()}@test.local`,
        role: "admin",
        passwordHash: "x",
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        email: `review-backup-other-${randomUUID()}@test.local`,
        role: "user",
        passwordHash: "x",
      },
    })
  ).id;
  await mkdir(absPath(`studio/${owner}`), { recursive: true });
  await promisify(execFile)(ffmpeg!, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64",
    "-frames:v",
    "1",
    absPath(`studio/${owner}/backup.png`),
  ]);
  artId = (
    await prisma.art.create({
      data: {
        userId: owner,
        kind: "image",
        filePath: `studio/${owner}/backup.png`,
      },
    })
  ).id;
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const id of projects)
    if (await prisma.studioProject.findUnique({ where: { id } }))
      await deleteStudioProject(owner, id);
  for (const userId of [owner, other])
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
      await removePath(`studio/${userId}`);
    }
});
async function applyOverride(idempotencyKey?: string) {
  const head = await project();
  const before = structuredClone(head.document);
  const node = before.scenes[0].nodes[0];
  node.typography = { role: "label", font: "rubik", fontSize: 36 };
  before.bindings["unused-owned-material"] = { kind: "pool", assetId: artId };
  const saved = await saveStudioDraft(owner, head.id, {
    expectedVersion: head.version,
    document: before,
  });
  const report = await reviewStudioVideo(owner, head.id, {
    expectedVersion: saved.version,
  });
  const suggestion = report.suggestions.find(
    (item) => item.kind === "return-label-theme",
  );
  expect(suggestion).toBeDefined();
  const input = {
    expectedVersion: saved.version,
    reportId: report.reportId,
    suggestionIds: [suggestion!.id],
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
  const applied = await applyStudioReview(owner, head.id, input);
  return { head, before, saved, input, applied };
}
it("preserves uncommitted before overrides without a client key and protects backup media references", async () => {
  const { head, before, saved, applied } = await applyOverride();
  expect(applied.draftBackupId).toMatch(/^[a-f0-9]{64}$/);
  const backup = await getStudioReviewBackup(
    owner,
    head.id,
    applied.draftBackupId!,
  );
  expect(backup.document).toEqual(before);
  expect(backup.origin).toMatchObject({
    projectId: head.id,
    version: saved.version,
    revision: null,
  });
  expect(applied.revision).toBe(head.revision);
  expect(applied.draft!.document).not.toEqual(before);
  await saveStudioDraft(owner, head.id, {
    expectedVersion: applied.version,
    document: head.document,
  });
  expect(
    await prisma.studioAssetReference.findMany({
      where: { projectId: head.id, artId },
    }),
  ).toEqual([
    expect.objectContaining({
      scope: `review-backup:${applied.draftBackupId}`,
    }),
  ]);
  expect(
    (await getStudioReviewBackup(owner, head.id, applied.draftBackupId!))
      .document,
  ).toEqual(before);
  const otherProject = await project();
  await expect(
    getStudioReviewBackup(other, head.id, applied.draftBackupId!),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    getStudioReviewBackup(owner, otherProject.id, applied.draftBackupId!),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("replays the same backup and receipt without storing a second copy", async () => {
  const { head, input, applied } = await applyOverride(randomUUID());
  const count = await prisma.studioMutation.count({
    where: { userId: owner, key: { startsWith: "review-backup:" } },
  });
  expect(applied.draftBackupId).toMatch(/^[a-f0-9]{64}$/);
  const replay = await applyStudioReview(owner, head.id, input);
  expect(replay.draftBackupId).toBe(applied.draftBackupId);
  expect(replay.version).toBe(applied.version);
  expect(
    await prisma.studioMutation.count({
      where: { userId: owner, key: { startsWith: "review-backup:" } },
    }),
  ).toBe(count);
});
it("rolls back backup and draft together when reference publication fails after CAS", async () => {
  const head = await project();
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: head.id },
  });
  const count = await prisma.studioMutation.count({
    where: { userId: owner, key: { startsWith: "review-backup:" } },
  });
  const actual = assets.setReferences;
  const spy = vi
    .spyOn(assets, "setReferences")
    .mockImplementation(async (...args) => {
      if (args[3].startsWith("review-backup:"))
        throw new Error("Injected backup reference failure");
      return actual(...args);
    });
  try {
    await expect(
      transformStudioDraft(
        owner,
        head.id,
        { expectedVersion: head.version, identity: { test: "rollback" } },
        (doc) => ({ ...doc, title: "Changed" }),
      ),
    ).rejects.toThrow("Injected backup reference failure");
  } finally {
    spy.mockRestore();
  }
  expect(
    await prisma.studioProject.findUniqueOrThrow({ where: { id: head.id } }),
  ).toEqual(before);
  expect(
    await prisma.studioMutation.count({
      where: { userId: owner, key: { startsWith: "review-backup:" } },
    }),
  ).toBe(count);
});
it("publishes only one backup when two transforms race for one version", async () => {
  const head = await project();
  const count = await prisma.studioMutation.count({
    where: { userId: owner, key: { startsWith: "review-backup:" } },
  });
  const result = await Promise.allSettled(
    ["A", "B"].map((title) =>
      transformStudioDraft(
        owner,
        head.id,
        { expectedVersion: head.version, identity: { title } },
        (doc) => ({ ...doc, title }),
      ),
    ),
  );
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(result.filter((item) => item.status === "rejected")).toHaveLength(1);
  expect(
    await prisma.studioMutation.count({
      where: { userId: owner, key: { startsWith: "review-backup:" } },
    }),
  ).toBe(count + 1);
});
it("removes only exact project backups and their references when the project is deleted", async () => {
  const a = await applyOverride(),
    b = await applyOverride();
  await deleteStudioProject(owner, a.head.id);
  expect(
    await prisma.studioMutation.findUnique({
      where: {
        userId_key: {
          userId: owner,
          key: `review-backup:${a.applied.draftBackupId}`,
        },
      },
    }),
  ).toBeNull();
  expect(
    await prisma.studioAssetReference.count({
      where: { projectId: a.head.id },
    }),
  ).toBe(0);
  expect(
    (await getStudioReviewBackup(owner, b.head.id, b.applied.draftBackupId!))
      .document,
  ).toEqual(b.before);
});

it("keeps existing restore points when the per-project backup quota is reached", async () => {
  const head = await project();
  const padding = "x".repeat(140000);
  await prisma.studioMutation.createMany({
    data: Array.from({ length: 127 }, (_, i) => ({
      userId: owner,
      key: `review-backup:${randomUUID()}`,
      requestHash: "test",
      resultJson: JSON.stringify({ projectId: head.id, padding }),
    })),
  });
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: head.id },
  });
  await expect(
    transformStudioDraft(
      owner,
      head.id,
      { expectedVersion: head.version, identity: "quota" },
      (doc) => ({ ...doc, title: "Must not change" }),
    ),
  ).rejects.toMatchObject({ code: "REVIEW_BACKUP_QUOTA_EXCEEDED" });
  expect(
    await prisma.studioProject.findUniqueOrThrow({ where: { id: head.id } }),
  ).toEqual(before);
  expect(
    await prisma.studioMutation.count({
      where: {
        userId: owner,
        key: { startsWith: "review-backup:" },
        resultJson: { contains: `"projectId":${JSON.stringify(head.id)}` },
      },
    }),
  ).toBe(127);
});

it("permits the last count slot and refuses another backup without evicting old state", async () => {
  const head = await project();
  await prisma.studioMutation.createMany({
    data: Array.from({ length: 127 }, () => ({
      userId: owner,
      key: `review-backup:${randomUUID()}`,
      requestHash: "test",
      resultJson: JSON.stringify({ projectId: head.id }),
    })),
  });
  const last = await transformStudioDraft(
    owner,
    head.id,
    { expectedVersion: head.version, identity: "last-slot" },
    (doc) => ({ ...doc, title: "Allowed last backup" }),
  );
  expect(last.draftBackupId).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    transformStudioDraft(
      owner,
      head.id,
      { expectedVersion: last.version, identity: "over-count" },
      (doc) => ({ ...doc, title: "Excess" }),
    ),
  ).rejects.toMatchObject({ code: "REVIEW_BACKUP_QUOTA_EXCEEDED" });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: head.id } }))
      .version,
  ).toBe(last.version);
});
