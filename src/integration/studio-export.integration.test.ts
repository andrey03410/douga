import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { createArt, deleteArt } from "@/server/arts";
import { studioJobLimits } from "@/server/studio/job-types";
import { exportCommitGate } from "@/server/studio/export-slice";
import * as studio from "@/server/studio";

let owner: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function wav(seconds: number) {
  const rate = 8000;
  const samples = rate * seconds;
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 8000),
      44 + i * 2,
    );
  return data;
}

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `export-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
});

afterAll(async () => {
  if (!owner) return;
  await prisma.user.update({ where: { id: owner }, data: { role: "user" } }).catch(() => {});
  const projects = await studio.listStudioProjects(owner).catch(() => []);
  for (const row of projects) await studio.deleteStudioProject(owner, row.id);
  const arts = await prisma.art.findMany({ where: { userId: owner } });
  for (const art of arts) await deleteArt(owner, art.id).catch(() => {});
  await prisma.user.delete({ where: { id: owner } }).catch(() => {});
  await removePath(`studio/${owner}`);
  await removePath(`studio-exports/${owner}`);
  await removePath(`arts/${owner}`);
});

describe("html export", () => {
  it("downloads one offline file of the saved revision without publishing", async () => {
    const image = await createArt(owner, { fileName: "pixel.png", data: png });
    const sound = await createArt(owner, { fileName: "tone.wav", data: wav(6) });
    const document = createVideoDocument({
      kind: "top",
      title: "Сохранено",
      participants: [{ id: "object", label: "Стул" }],
    });
    document.bindings.image = { kind: "pool", assetId: image.id };
    document.bindings.sound = { kind: "pool", assetId: sound.id };
    document.source.participants[0].media = { visual: "image", audio: "sound" };
    document.settings.top = { ...document.settings.top, durationSec: 0.5 };
    const created = await studio.createStudioProject(owner, {
      document,
      idempotencyKey: randomUUID(),
    });
    const drafted = await studio.saveStudioDraft(owner, created.id, {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      document: { ...document, title: "Черновик не для файла" },
    });
    expect(drafted.revision).toBe(created.revision);

    const estimate = await studio.estimateStudioExport(owner, created.id);
    expect(estimate.bytes).toBeGreaterThan(10_000);
    expect(estimate.warning).toBe(false);
    expect(await prisma.studioPublication.count({ where: { projectId: created.id } })).toBe(0);
    expect((await studio.getStudioProject(owner, created.id)).revision).toBe(created.revision);

    const response = await studio.streamStudioExport(owner, created.id);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(estimate.bytes);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = body.toString("utf8");
    expect(html).toContain("Сохранено");
    expect(html).not.toContain("Черновик не для файла");
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain('type="module"');
    const shell = html.slice(0, html.lastIndexOf('<script>"use strict"'));
    expect(shell).not.toMatch(/src="https?:/);
    expect(shell).not.toMatch(/href="https?:/);
    expect(shell).not.toMatch(/url\(https?:/);
    expect(shell).not.toMatch(/fetch\("https?:/);
    const again = await studio.estimateStudioExport(owner, created.id);
    expect(again.bytes).toBe(estimate.bytes);
    const caches = await prisma.studioExportCache.findMany({
      where: { projectId: created.id },
    });
    expect(caches.length).toBeGreaterThan(0);
    const soundCache = caches.find((row) => row.relativePath.endsWith(".m4a"));
    expect(soundCache).toBeTruthy();
    const sliced = await stat(absPath(soundCache!.relativePath));
    const original = await stat(absPath(sound.filePath));
    expect(sliced.size).toBeLessThan(original.size / 2);

    await prisma.studioExportCache.create({
      data: {
        userId: owner,
        projectId: created.id,
        revisionId: (
          await prisma.studioRevision.findFirstOrThrow({
            where: { projectId: created.id, revision: created.revision },
          })
        ).id,
        key: `quota-${randomUUID()}`,
        bytes: studioJobLimits.maxResultBytesPerAccount,
        relativePath: `studio-exports/${owner}/quota-marker`,
      },
    });
    const otherImage = await createArt(owner, { fileName: "other.png", data: png });
    const second = createVideoDocument({
      kind: "top",
      title: "Второй",
      participants: [{ id: "object", label: "Стул" }],
    });
    second.bindings.image = { kind: "pool", assetId: otherImage.id };
    second.source.participants[0].media = { visual: "image" };
    const blocked = await studio.createStudioProject(owner, {
      document: second,
      idempotencyKey: randomUUID(),
    });
    await expect(studio.estimateStudioExport(owner, blocked.id)).rejects.toThrow(
      "EXPORT_QUOTA_EXCEEDED",
    );
    await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
    await expect(studio.estimateStudioExport(owner, blocked.id)).resolves.toMatchObject({
      bytes: expect.any(Number),
    });
    await prisma.user.update({ where: { id: owner }, data: { role: "user" } });

    await studio.deleteStudioProject(owner, created.id, { idempotencyKey: randomUUID() });
    expect(await prisma.studioExportCache.count({ where: { projectId: created.id } })).toBe(0);
    await expect(readFile(absPath(soundCache!.relativePath))).rejects.toThrow();
  });

  it("lets only one of two simultaneous exports pass a tight quota", async () => {
    const image = await createArt(owner, { fileName: "race.png", data: png });
    const make = async (title: string) => {
      const document = createVideoDocument({
        kind: "top",
        title,
        participants: [{ id: "object", label: "Стул" }],
      });
      document.bindings.image = { kind: "pool", assetId: image.id };
      document.source.participants[0].media = { visual: "image" };
      document.settings.top = { ...document.settings.top, durationSec: 0.4 };
      return studio.createStudioProject(owner, {
        document,
        idempotencyKey: randomUUID(),
      });
    };
    const probe = await make("Проба");
    await studio.estimateStudioExport(owner, probe.id);
    const learned =
      (
        await prisma.studioExportCache.aggregate({
          where: { projectId: probe.id },
          _sum: { bytes: true },
        })
      )._sum.bytes ?? 0;
    expect(learned).toBeGreaterThan(0);
    await studio.deleteStudioProject(owner, probe.id, {
      idempotencyKey: randomUUID(),
    });
    const used =
      (
        await prisma.studioExportCache.aggregate({
          where: { userId: owner },
          _sum: { bytes: true },
        })
      )._sum.bytes ?? 0;
    const holder = await make("Держатель");
    const revision = await prisma.studioRevision.findFirstOrThrow({
      where: { projectId: holder.id },
    });
    await prisma.studioExportCache.create({
      data: {
        userId: owner,
        projectId: holder.id,
        revisionId: revision.id,
        key: `race-${randomUUID()}`,
        bytes: studioJobLimits.maxResultBytesPerAccount - used - learned,
        relativePath: `studio-exports/${owner}/race-marker`,
      },
    });
    const left = await make("Левый");
    const right = await make("Правый");
    const releaseFirst: { current: (() => void) | null } = { current: null };
    let entered = 0;
    const firstInside = new Promise<void>((resolve) => {
      exportCommitGate.wait = async () => {
        entered += 1;
        if (entered === 1) {
          resolve();
          await new Promise<void>((done) => {
            releaseFirst.current = done;
          });
        }
      };
    });
    try {
      const pending = Promise.allSettled([
        studio.estimateStudioExport(owner, left.id),
        studio.estimateStudioExport(owner, right.id),
      ]);
      await Promise.race([
        firstInside,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("export lock was not taken")), 20000),
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(entered).toBe(1);
      releaseFirst.current?.();
      const settled = await pending;
      const denied = settled.filter((item) => item.status === "rejected");
      expect(denied).toHaveLength(1);
      expect(String((denied[0] as PromiseRejectedResult).reason)).toContain(
        "EXPORT_QUOTA_EXCEEDED",
      );
      const total =
        (
          await prisma.studioExportCache.aggregate({
            where: { userId: owner },
            _sum: { bytes: true },
          })
        )._sum.bytes ?? 0;
      expect(total).toBeLessThanOrEqual(studioJobLimits.maxResultBytesPerAccount);
    } finally {
      exportCommitGate.wait = null;
      releaseFirst.current?.();
    }
  });
});
