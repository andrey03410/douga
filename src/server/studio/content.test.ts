import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { absPath } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video/builders";
import {
  createStudioProject,
  deleteStudioProject,
  transformStudioDraft,
} from "./projects";
import { setStudioContent } from "./content";
import { selectStudioRecipes } from "./recipes";
import { StudioError } from "./errors";
import * as source from "./sources";
let owner: string, other: string, project: string, audio: string;
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: {
        email: `content-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "admin",
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        email: `other-content-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "user",
      },
    })
  ).id;
  const wave = Buffer.alloc(44 + 16000);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(16000, 40);
  await mkdir(absPath(`studio/${owner}`), { recursive: true });
  await writeFile(absPath(`studio/${owner}/content-test.wav`), wave);
  audio = (
    await prisma.art.create({
      data: {
        userId: owner,
        filePath: `studio/${owner}/content-test.wav`,
        kind: "audio",
        hasAudio: true,
        durationSec: 1,
      },
    })
  ).id;
  project = (
    await createStudioProject(owner, {
      document: createVideoDocument({ kind: "top" }),
    })
  ).id;
});
afterAll(async () => {
  if (project) await deleteStudioProject(owner, project);
  for (const id of [owner, other])
    if (id) {
      await prisma.user.delete({ where: { id } });
      await removePath(`studio/${id}`);
    }
});
it("sets content atomically with replay and rejects stale or foreign mutations", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const input = {
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    content: {
      kind: "top" as const,
      mode: "merge" as const,
      title: "Новое имя",
    },
  };
  const result = await setStudioContent(owner, project, input);
  expect(result.version).toBe(before.version + 1);
  expect(result.draft!.document).toMatchObject({ title: "Новое имя" });
  expect(result.revision).toBe(before.revision);
  expect((await setStudioContent(owner, project, input)).version).toBe(
    result.version,
  );
  await expect(
    setStudioContent(owner, project, {
      ...input,
      content: { ...input.content, title: "Другое" },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    setStudioContent(owner, project, { ...input, idempotencyKey: undefined }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    setStudioContent(other, project, {
      ...input,
      expectedVersion: result.version,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .version,
  ).toBe(result.version);
});
it("does not source-reconcile stale content or overwrite after a concurrent mutation", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const spy = vi.spyOn(source, "reconcileSource");
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version - 1,
      content: { kind: "top", mode: "merge", title: "Stale" },
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  const inputs = ["One", "Two"].map((title) => ({
    expectedVersion: row.version,
    content: { kind: "top" as const, mode: "merge" as const, title },
  }));
  const results = await Promise.allSettled(
    inputs.map((input) => setStudioContent(owner, project, input)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("checks asset ownership instead of saving unauthorized assignments", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: {
        kind: "top",
        mode: "merge",
        participants: [{ id: "participant-1", visualAssetId: "not-owned" }],
      },
    }),
  ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .version,
  ).toBe(row.version);
});
it("rejects an owned audio asset assigned as a visual without changing the draft", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: {
        kind: "top",
        mode: "merge",
        participants: [{ id: "participant-1", visualAssetId: audio }],
      },
    }),
  ).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "ASSET_KIND_MISMATCH" }),
    ]),
  });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .draftText,
  ).toBe(row.draftText);
});
it("binds internal transform receipts to the full trusted identity", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const input = {
    expectedVersion: row.version,
    idempotencyKey: randomUUID(),
    identity: { fixes: ["a"] },
  };
  const result = await transformStudioDraft(owner, project, input, (doc) => ({
    ...doc,
    title: "Transform",
  }));
  expect(result.draft!.document).toMatchObject({ title: "Transform" });
  await expect(
    transformStudioDraft(
      owner,
      project,
      { ...input, identity: { fixes: ["b"] } },
      (doc) => doc,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("recommends at most three compatible metadata cards and explains unsupported requests", async () => {
  const result = await selectStudioRecipes(owner, {
    kind: "picker",
    format: "vertical",
  });
  expect(result.items.length).toBeLessThanOrEqual(3);
  expect(result.recommended).toBe("recipe.clean.picker.vertical");
  expect(
    result.items.every((r) => r.kind === "picker" && r.format === "vertical"),
  ).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(12000);
  const unsupported = await selectStudioRecipes(owner, {
    kind: "board",
    style: "cinematic",
  });
  expect(unsupported.items).toEqual([]);
  expect(unsupported.reason).toBeTruthy();
  expect(unsupported.alternatives).toContain("recipe.board-clear.board.wide");
});

it("returns domain content errors through the normal Studio error contract", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: { kind: "picker", mode: "merge", title: "Wrong" },
    }),
  ).rejects.toBeInstanceOf(StudioError);
});
