import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { readFile, writeFile, stat, readdir, mkdir } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import {
  createVideoDocument,
  extractVideoPreset,
  applyVideoPreset,
  compileVideo,
} from "@/video";
import { createArt, deleteArt, listArts } from "@/server/arts";
import { deleteTournament } from "@/server/tournaments";
import { deleteUser, usageSummary } from "@/server/users";
import * as studio from "@/server/studio";
import * as studioAssets from "@/server/studio/assets";

let owner: string, other: string;
const mutation = (version: number) => ({
  expectedVersion: version,
  idempotencyKey: randomUUID(),
});
const doc = () =>
  createVideoDocument({
    kind: "top",
    participants: [{ id: "object", label: "Стул" }],
  });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `studio-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `studio-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
});
afterAll(async () => {
  for (const id of [owner, other])
    if (id) {
      const projects = await studio.listStudioProjects(id);
      for (const p of projects) await studio.deleteStudioProject(id, p.id);
      await prisma.user.delete({ where: { id } });
      await removePath(`arts/${id}`);
      await removePath(`studio/${id}`);
    }
});
describe("persistent Studio projects with real SQLite and files", () => {
  it("creates arbitrary objects, scopes ownership and replays create without duplicates", async () => {
    const input = { document: doc(), idempotencyKey: randomUUID() };
    const p = await studio.createStudioProject(owner, input);
    expect(p.document.source.participants[0].label).toBe("Стул");
    expect(p.validation.ready).toBe(true);
    expect((await studio.createStudioProject(owner, input)).id).toBe(p.id);
    await expect(
      studio.createStudioProject(owner, {
        ...input,
        document: { ...input.document, title: "Different" },
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(studio.getStudioProject(other, p.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(await studio.listStudioProjects(other)).toEqual([]);
  });
  it("retains malformed draft text and last good preview, rejects invalid freeze and commit atomically", async () => {
    const p = await studio.createStudioProject(owner, { document: doc() });
    const invalid = await studio.saveStudioDraft(owner, p.id, {
      ...mutation(p.version),
      text: '{"broken"',
    });
    expect(invalid.draft?.text).toBe('{"broken"');
    expect(invalid.validation.ready).toBe(false);
    expect(
      invalid.plan?.scenes[0].nodes.find((n) => n.type === "card")?.label,
    ).toBe("Стул");
    expect(invalid.previewStale).toBe(true);
    await expect(
      studio.commitStudioDraft(owner, p.id, mutation(invalid.version)),
    ).rejects.toThrow("VALIDATION_FAILED");
    await expect(studio.freezeStudioProject(owner, p.id)).rejects.toThrow(
      "VALIDATION_FAILED",
    );
    expect((await studio.getStudioProject(owner, p.id)).revision).toBe(1);
  });
  it("CAS protects concurrent drafts, commits and idempotent retries", async () => {
    const p = await studio.createStudioProject(owner, { document: doc() });
    const input = {
      ...mutation(p.version),
      document: { ...p.document, title: "First" },
    };
    const saved = await studio.saveStudioDraft(owner, p.id, input);
    expect((await studio.saveStudioDraft(owner, p.id, input)).version).toBe(
      saved.version,
    );
    await expect(
      studio.saveStudioDraft(owner, p.id, {
        ...mutation(p.version),
        document: { ...p.document, title: "Lost" },
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      studio.commitStudioDraft(owner, p.id, mutation(p.version)),
    ).rejects.toThrow("VERSION_CONFLICT");
    const committed = await studio.commitStudioDraft(
      owner,
      p.id,
      mutation(saved.version),
    );
    expect(committed.document.title).toBe("First");
    expect(committed.revision).toBe(2);
    const restored = await studio.restoreStudioRevision(owner, p.id, {
      ...mutation(committed.version),
      revision: 1,
    });
    expect(restored.document.title).toBe(p.title);
    expect(restored.revision).toBe(3);
    await expect(studio.deleteStudioRevision(owner, p.id, 3)).rejects.toThrow(
      "REVISION_IN_USE",
    );
    await studio.deleteStudioRevision(owner, p.id, 2);
    expect(
      (await studio.listStudioRevisions(owner, p.id)).map((r) => r.revision),
    ).toEqual([3, 1]);
  });
  it("protects invalid drafts and historical asset references before unlink and releases on project deletion", async () => {
    const art = await createArt(owner, { fileName: "pixel.png", data: png });
    const p = await studio.createStudioProject(owner, { document: doc() });
    const bad = {
      ...p.document,
      bindings: { unused: { kind: "pool", assetId: art.id, hash: 17 } },
      output: { fps: 17 },
    };
    const saved = await studio.saveStudioDraft(owner, p.id, {
      ...mutation(p.version),
      document: bad,
    });
    expect(saved.validation.ready).toBe(false);
    await expect(deleteArt(owner, art.id)).rejects.toThrow(
      "STUDIO_ASSET_IN_USE",
    );
    expect((await stat(absPath(art.filePath))).size).toBe(png.length);
    expect(
      (await listArts(owner)).arts.find((a) => a.id === art.id)?.usage.studio,
    ).toBeGreaterThan(0);
    const raw = await studio.saveStudioDraft(owner, p.id, {
      ...mutation(saved.version),
      text: "{",
    });
    await expect(deleteArt(owner, art.id)).rejects.toThrow(
      "STUDIO_ASSET_IN_USE",
    );
    expect(raw.draft?.text).toBe("{");
    await studio.deleteStudioProject(owner, p.id);
    await deleteArt(owner, art.id);
  });
  it("resolves actual dimensions and freezes immutable media bytes and revision data", async () => {
    const art = await createArt(owner, { fileName: "pixel.png", data: png });
    const d = doc();
    d.bindings.image = { kind: "pool", assetId: art.id };
    d.source.participants[0].media = { visual: "image" };
    d.settings.card = {
      fit: "cover",
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
    };
    const p = await studio.createStudioProject(owner, { document: d });
    const frozen = await studio.freezeStudioProject(owner, p.id);
    expect(frozen.manifest.image).toMatchObject({ width: 1, height: 1 });
    const before = await readFile(absPath(frozen.files.image.path));
    await writeFile(absPath(art.filePath), Buffer.from("changed"));
    expect(await readFile(absPath(frozen.files.image.path))).toEqual(before);
    expect(frozen.document.source.participants[0].label).toBe("Стул");
    await expect(deleteArt(owner, art.id)).rejects.toThrow(
      "STUDIO_ASSET_IN_USE",
    );
    await studio.deleteStudioProject(owner, p.id);
    await deleteArt(owner, art.id);
  });
  it("rejects other-owner bindings atomically even in invalid documents", async () => {
    const art = await createArt(other, { fileName: "foreign.png", data: png });
    const p = await studio.createStudioProject(owner, { document: doc() });
    await expect(
      studio.saveStudioDraft(owner, p.id, {
        ...mutation(p.version),
        document: { bindings: { bad: { kind: "pool", assetId: art.id } } },
      }),
    ).rejects.toThrow("ASSET_NOT_FOUND");
    expect((await studio.getStudioProject(owner, p.id)).version).toBe(
      p.version,
    );
  });
  it("syncs real ranking changes by hash while preserving per-ID caption/media and old snapshots", async () => {
    const t = await prisma.tournament.create({
      data: {
        userId: owner,
        title: "Rank source",
        scheme: "merge",
        status: "completed",
        topSize: 2,
      },
    });
    const a = await prisma.track.create({
      data: {
        tournamentId: t.id,
        title: "A",
        filePath: "missing-a.wav",
        sizeBytes: 0,
        kind: "audio",
        order: 0,
      },
    });
    const b = await prisma.track.create({
      data: {
        tournamentId: t.id,
        title: "B",
        filePath: "missing-b.wav",
        sizeBytes: 0,
        kind: "audio",
        order: 1,
      },
    });
    await prisma.ranking.createMany({
      data: [
        { tournamentId: t.id, trackId: a.id, rank: 1, score: 1 },
        { tournamentId: t.id, trackId: b.id, rank: 2, score: 0 },
      ],
    });
    const artA = await createArt(owner, {
      fileName: "source-a.png",
      data: png,
    });
    const artB = await createArt(owner, {
      fileName: "source-b.png",
      data: png,
    });
    const d = doc();
    d.bindings.A = { kind: "pool", assetId: artA.id };
    d.bindings.B = { kind: "pool", assetId: artB.id };
    d.source = {
      kind: "tournament",
      tournamentId: t.id,
      participants: [
        {
          id: a.id,
          label: "old",
          caption: "Personal",
          media: { visual: "A" },
          settings: { card: { volume: 0.3 } },
        },
        { id: b.id, label: "Old B", media: { visual: "B" } },
      ],
      rounds: [],
    };
    const p = await studio.createStudioProject(owner, { document: d });
    expect(p.document.source.participants.map((x) => x.id)).toEqual([
      a.id,
      b.id,
    ]);
    await prisma.ranking.update({
      where: { tournamentId_trackId: { tournamentId: t.id, trackId: b.id } },
      data: { rank: 1 },
    });
    await prisma.ranking.update({
      where: { tournamentId_trackId: { tournamentId: t.id, trackId: a.id } },
      data: { rank: 2 },
    });
    const sync = await studio.getStudioProject(owner, p.id);
    expect(sync.sourceVersion).not.toBe(p.sourceVersion);
    expect(sync.document.source.participants[0].media?.visual).toBe("B");
    expect(sync.document.source.participants[1].label).toBe("A");
    expect(sync.validation.ready).toBe(true);
    expect(sync.document.source.participants.map((x) => x.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(sync.document.source.participants[1]).toMatchObject({
      caption: "Personal",
      media: { visual: "A" },
      settings: { card: { volume: 0.3 } },
    });
    await expect(
      studio.saveStudioDraft(owner, p.id, {
        ...mutation(p.version),
        document: p.document,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    const c = await prisma.track.create({
      data: {
        tournamentId: t.id,
        title: "C",
        filePath: "missing-c.wav",
        sizeBytes: 0,
        order: 2,
      },
    });
    await prisma.ranking.delete({
      where: { tournamentId_trackId: { tournamentId: t.id, trackId: b.id } },
    });
    await prisma.ranking.create({
      data: { tournamentId: t.id, trackId: c.id, rank: 1, score: 2 },
    });
    const added = await studio.getStudioProject(owner, p.id);
    expect(added.document.source.participants.map((x) => x.id)).toEqual([
      c.id,
      a.id,
    ]);
    expect(added.validation.ready).toBe(false);
    expect(added.previewStale).toBe(true);
    expect(added.previewRevision).toBe(sync.revision);
    await prisma.tournament.update({
      where: { id: t.id },
      data: { topSize: 1 },
    });
    expect(
      (
        await studio.getStudioProject(owner, p.id)
      ).document.source.participants.map((x) => x.id),
    ).toEqual([c.id]);
    await expect(deleteTournament(owner, t.id)).rejects.toThrow(
      "STUDIO_SOURCE_IN_USE",
    );
    await studio.deleteStudioProject(owner, p.id);
    await deleteTournament(owner, t.id);
  });
  it("saves media-free personal presets and checks current database role", async () => {
    const d = doc();
    d.source.participants[0].caption = "Private";
    d.bindings.secret = { kind: "builtin", name: "tick" };
    const preset = await studio.saveStudioPreset(owner, {
      document: d,
      name: "Mine",
      idempotencyKey: randomUUID(),
    });
    expect(JSON.stringify(preset)).not.toContain("Private");
    expect(JSON.stringify(preset)).not.toContain("secret");
    expect(
      (await studio.listStudioPresets(owner)).some((p) => p.id === preset.id),
    ).toBe(true);
    await expect(studio.deleteStudioPreset(other, preset.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    await studio.deleteStudioPreset(owner, preset.id);
    await prisma.user.update({ where: { id: owner }, data: { role: "guest" } });
    await expect(
      studio.createStudioProject(owner, { document: doc() }),
    ).rejects.toThrow("FORBIDDEN");
    await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
  });
});

it("analyses real PCM per scene, caches by hash/window, and leaves authored windows untouched", async () => {
  const rate = 8000;
  const data = Buffer.alloc(44 + rate * 6 * 2);
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
  for (let i = 0; i < rate * 6; i++)
    data.writeInt16LE(
      Math.round(
        Math.sin((i * 2 * Math.PI * 440) / rate) *
          (i >= rate * 2 && i < rate * 4 ? 24000 : 100),
      ),
      44 + i * 2,
    );
  const art = await createArt(owner, { fileName: "active.wav", data });
  const d = doc();
  d.bindings.sound = { kind: "pool", assetId: art.id };
  d.source.participants[0].media = { audio: "sound" };
  d.scenes = [
    {
      id: "short",
      block: "top",
      repeat: "participants",
      settings: { top: { snippet: { mode: "active", durationSec: 1 } } },
      nodes: [],
    },
    {
      id: "long",
      block: "top",
      repeat: "participants",
      settings: { top: { snippet: { mode: "active", durationSec: 2 } } },
      nodes: [],
    },
  ];
  const p = await studio.createStudioProject(owner, { document: d });
  expect(p.validation.ready).toBe(true);
  const frozen = await studio.freezeStudioProject(owner, p.id);
  expect(frozen.plan.scenes.map((s) => s.durationInFrames)).toEqual([30, 60]);
  expect(frozen.plan.audio[0].offsetFrames).toBeGreaterThanOrEqual(59);
  expect(frozen.plan.audio[0].offsetFrames).toBeLessThanOrEqual(61);
  expect(frozen.plan.audio[1].offsetFrames).toBe(60);
  expect(
    await prisma.studioAnalysis.count({
      where: { key: { startsWith: frozen.manifest.sound.hash } },
    }),
  ).toBe(2);
  const explicit = structuredClone(d);
  explicit.scenes[0].settings!.top!.snippet = {
    mode: "active",
    activeStartSec: 0.5,
    activeEndSec: 1.5,
  };
  const saved = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    document: explicit,
  });
  expect(saved.plan?.audio[0].offsetFrames).toBe(15);
});
it("allows exactly one real concurrent draft writer for a shared token", async () => {
  const p = await studio.createStudioProject(owner, { document: doc() });
  const results = await Promise.allSettled(
    ["One", "Two"].map((title) =>
      studio.saveStudioDraft(owner, p.id, {
        ...mutation(p.version),
        document: { ...p.document, title },
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(rejected.reason.message).toBe("VERSION_CONFLICT");
  expect((await studio.getStudioProject(owner, p.id)).version).toBe(
    p.version + 1,
  );
});

it("counts Studio storage in account usage and deletes an account before releasing its referenced bytes", async () => {
  const admin = await prisma.user.create({
    data: {
      email: `studio-admin-${randomUUID()}@test.local`,
      passwordHash: "x",
      role: "admin",
    },
  });
  const victim = await prisma.user.create({
    data: {
      email: `studio-victim-${randomUUID()}@test.local`,
      passwordHash: "x",
    },
  });
  try {
    const art = await createArt(victim.id, {
      fileName: "account.png",
      data: png,
    });
    const d = doc();
    d.bindings.image = { kind: "pool", assetId: art.id };
    d.source.participants[0].media = { visual: "image" };
    const p = await studio.createStudioProject(victim.id, { document: d });
    await studio.freezeStudioProject(victim.id, p.id);
    const usage = await usageSummary(victim.id);
    expect(usage.studio).toMatchObject({
      projects: 1,
      revisions: 1,
      snapshots: 1,
      bytes: png.length,
    });
    await deleteUser(admin.id, victim.id);
    expect(
      await prisma.studioProject.count({ where: { userId: victim.id } }),
    ).toBe(0);
    await expect(stat(absPath(`studio/${victim.id}`))).rejects.toThrow();
  } finally {
    const projects = await prisma.studioProject.findMany({
      where: { userId: victim.id },
    });
    for (const p of projects) await studio.deleteStudioProject(victim.id, p.id);
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, victim.id] } },
    });
    await removePath(`studio/${victim.id}`);
    await removePath(`arts/${victim.id}`);
  }
});
it("rejects corrupt and escaping media files with actionable diagnostics", async () => {
  const art = await createArt(owner, {
    fileName: "corrupt.png",
    data: Buffer.from("not an image"),
  });
  const d = doc();
  d.bindings.image = { kind: "pool", assetId: art.id };
  d.source.participants[0].media = { visual: "image" };
  const p = await studio.createStudioProject(owner, { document: d });
  expect(p.validation.ready).toBe(false);
  expect(
    p.validation.diagnostics.some((x) => x.code === "ASSET_MEDIA_INVALID"),
  ).toBe(true);
});
it("releases historical media only after both frozen snapshot and old revision are deleted", async () => {
  const art = await createArt(owner, { fileName: "history.png", data: png });
  const d = doc();
  d.bindings.image = { kind: "pool", assetId: art.id };
  d.source.participants[0].media = { visual: "image" };
  const p = await studio.createStudioProject(owner, { document: d });
  const frozen = await studio.freezeStudioProject(owner, p.id, {
    idempotencyKey: randomUUID(),
  });
  const bad = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    text: "{",
  });
  expect(
    (await studio.freezeStudioProject(owner, p.id, { revision: 1 })).document
      .source.participants[0].media?.visual,
  ).toBe("image");
  const saved = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(bad.version),
    document: doc(),
  });
  await studio.commitStudioDraft(owner, p.id, mutation(saved.version));
  await expect(studio.deleteStudioRevision(owner, p.id, 1)).rejects.toThrow(
    "REVISION_IN_USE",
  );
  await expect(deleteArt(owner, art.id)).rejects.toThrow("STUDIO_ASSET_IN_USE");
  const snapshots = await prisma.studioSnapshot.findMany({
    where: { projectId: p.id },
  });
  for (const snapshot of snapshots)
    await studio.deleteStudioSnapshot(owner, snapshot.id);
  await studio.deleteStudioRevision(owner, p.id, 1);
  await deleteArt(owner, art.id);
  await expect(stat(absPath(frozen.files.image.path))).rejects.toThrow();
  const input = { idempotencyKey: randomUUID() };
  expect(await studio.deleteStudioProject(owner, p.id, input)).toEqual({
    deleted: true,
    id: p.id,
  });
  expect(await studio.deleteStudioProject(owner, p.id, input)).toEqual({
    deleted: true,
    id: p.id,
  });
});

it("serializes concurrent idempotent creates without leaving orphan media copies", async () => {
  const art = await createArt(owner, { fileName: "concurrent.png", data: png });
  const d = doc();
  d.bindings.image = { kind: "pool", assetId: art.id };
  const existing: string[] = await readdir(absPath(`studio/${owner}`)).catch(
    () => [] as string[],
  );
  const input = { document: d, idempotencyKey: randomUUID() };
  const [a, b] = await Promise.all([
    studio.createStudioProject(owner, input),
    studio.createStudioProject(owner, input),
  ]);
  expect(a.id).toBe(b.id);
  const created = (await readdir(absPath(`studio/${owner}`))).filter(
    (id) => !existing.includes(id),
  );
  expect(created).toEqual([a.id]);
});
it("atomically commits and freezes the current valid draft with idempotent replay", async () => {
  const p = await studio.createStudioProject(owner, { document: doc() });
  const draft = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    document: { ...p.document, title: "Freeze this" },
  });
  const input = {
    expectedVersion: draft.version,
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    studio.freezeStudioProject(owner, p.id, input),
    studio.freezeStudioProject(owner, p.id, input),
  ]);
  expect(a.snapshotId).toBe(b.snapshotId);
  expect(a.revision).toBe(2);
  expect(a.document.title).toBe("Freeze this");
  const current = await studio.getStudioProject(owner, p.id);
  expect(current.draft).toBeNull();
  expect(current.revision).toBe(2);
  expect(
    await prisma.studioSnapshot.count({ where: { projectId: p.id } }),
  ).toBe(1);
});
it("labels a retained last-good draft preview by its edit token, not the committed revision", async () => {
  const p = await studio.createStudioProject(owner, { document: doc() });
  const changed = structuredClone(p.document);
  changed.source.participants[0].caption = "Draft caption";
  const good = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    document: changed,
  });
  const bad = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(good.version),
    text: "{",
  });
  expect(bad.plan?.scenes[0].nodes.find((n) => n.type === "card")?.label).toBe(
    "Draft caption",
  );
  expect(bad.previewRevision).toBeNull();
  expect(bad.previewVersion).toBe(good.version);
  expect(bad.previewStale).toBe(true);
});
it("protects the media of the retained last-good draft after a semantically invalid replacement", async () => {
  const art = await createArt(owner, { fileName: "last-good.png", data: png });
  const p = await studio.createStudioProject(owner, { document: doc() });
  const d = structuredClone(p.document);
  d.bindings.image = { kind: "pool", assetId: art.id };
  d.source.participants[0].media = { visual: "image" };
  const good = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    document: d,
  });
  d.bindings = {};
  const bad = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(good.version),
    document: d,
  });
  expect(bad.validation.ready).toBe(false);
  expect(bad.previewStale).toBe(true);
  await expect(deleteArt(owner, art.id)).rejects.toThrow("STUDIO_ASSET_IN_USE");
});
it("does not trust client sourceVersion to overwrite source-owned labels or ranks", async () => {
  const t = await prisma.tournament.create({
    data: {
      userId: owner,
      title: "Authoritative",
      scheme: "merge",
      topSize: 1,
    },
  });
  const track = await prisma.track.create({
    data: {
      tournamentId: t.id,
      title: "Original source label",
      filePath: "not-used",
      sizeBytes: 0,
      order: 0,
    },
  });
  await prisma.ranking.create({
    data: { tournamentId: t.id, trackId: track.id, rank: 1, score: 1 },
  });
  const d = doc();
  d.source = {
    kind: "tournament",
    tournamentId: t.id,
    participants: [{ id: track.id, label: "ignored", media: {} }],
    rounds: [],
  };
  const p = await studio.createStudioProject(owner, { document: d });
  const tampered = structuredClone(p.document);
  tampered.source.participants[0].label = "Fake";
  tampered.source.participants[0].rank = 999;
  tampered.source.participants[0].caption = "My caption";
  const saved = await studio.saveStudioDraft(owner, p.id, {
    ...mutation(p.version),
    document: tampered,
  });
  expect(
    (saved.draft!.document as typeof d).source.participants[0],
  ).toMatchObject({
    label: "Original source label",
    rank: 1,
    caption: "My caption",
  });
});

it("initializes real silent source videos without audio while preserving voiced tracks and authored overrides", async () => {
  const tournament = await prisma.tournament.create({
    data: {
      userId: owner,
      title: "Real video source streams",
      scheme: "merge",
      topSize: 3,
    },
  });
  const directory = `tournaments/${tournament.id}/tracks`;
  await mkdir(absPath(directory), { recursive: true });
  const ffmpeg = promisify(execFile);
  let projectId: string | undefined;
  try {
    await ffmpeg(ffmpegPath as unknown as string, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:r=30:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      absPath(`${directory}/silent.mp4`),
    ]);
    await ffmpeg(ffmpegPath as unknown as string, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x32:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      absPath(`${directory}/voiced.mp4`),
    ]);
    await ffmpeg(ffmpegPath as unknown as string, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=1",
      absPath(`${directory}/audio.wav`),
    ]);
    const tracks = [];
    for (const [order, name, kind] of [
      [0, "silent.mp4", "video"],
      [1, "voiced.mp4", "video"],
      [2, "audio.wav", "audio"],
    ] as const) {
      const track = await prisma.track.create({
        data: {
          tournamentId: tournament.id,
          title: name,
          filePath: `${directory}/${name}`,
          sizeBytes: (await stat(absPath(`${directory}/${name}`))).size,
          kind,
          order,
          durationSec: 1,
        },
      });
      await prisma.ranking.create({
        data: {
          tournamentId: tournament.id,
          trackId: track.id,
          rank: order + 1,
          score: 3 - order,
        },
      });
      tracks.push(track);
    }
    const [silent, voiced, audio] = tracks;
    const document = doc();
    document.source = {
      kind: "tournament",
      tournamentId: tournament.id,
      participants: [],
      rounds: [],
    };
    document.settings.top = {
      order: "source",
      snippet: { mode: "active", durationSec: 0.2 },
    };
    const project = await studio.createStudioProject(owner, { document });
    projectId = project.id;
    expect(project.validation.ready).toBe(true);
    expect(project.document.source.participants[0].media).toEqual({
      visual: `source:${silent.id}`,
    });
    expect(project.document.source.participants[1].media).toEqual({
      visual: `source:${voiced.id}`,
      audio: `source:${voiced.id}`,
    });
    expect(project.document.source.participants[2].media).toEqual({
      audio: `source:${audio.id}`,
    });
    const frozen = await studio.freezeStudioProject(owner, project.id);
    expect(frozen.manifest[`source:${silent.id}`].hasAudio).toBe(false);
    expect(frozen.plan.audio.map((cue) => cue.asset.id)).toEqual([
      voiced.id,
      audio.id,
    ]);
    expect(frozen.plan.scenes.map((scene) => scene.durationInFrames)).toEqual([
      6, 6, 6,
    ]);

    const authored = structuredClone(project.document);
    authored.source.participants[0].media!.audio = `source:${voiced.id}`;
    const saved = await studio.saveStudioDraft(owner, project.id, {
      ...mutation(project.version),
      document: authored,
    });
    await prisma.track.update({
      where: { id: silent.id },
      data: { title: "Renamed silent track" },
    });
    const synced = await studio.getStudioProject(owner, project.id);
    expect(synced.version).toBeGreaterThan(saved.version);
    expect(
      (synced.draft!.document as typeof authored).source.participants[0],
    ).toMatchObject({
      label: "Renamed silent track",
      media: { visual: `source:${silent.id}`, audio: `source:${voiced.id}` },
    });
    expect(synced.validation.ready).toBe(true);

    const explicitSilent = structuredClone(
      synced.draft!.document as typeof authored,
    );
    explicitSilent.source.participants[0].media!.audio = `source:${silent.id}`;
    const invalid = await studio.saveStudioDraft(owner, project.id, {
      ...mutation(synced.version),
      document: explicitSilent,
    });
    expect(
      (invalid.draft!.document as typeof authored).source.participants[0].media!
        .audio,
    ).toBe(`source:${silent.id}`);
    expect(
      invalid.validation.diagnostics.some(
        (d) => d.code === "ASSET_KIND_MISMATCH",
      ),
    ).toBe(true);
  } finally {
    if (projectId) await studio.deleteStudioProject(owner, projectId);
    await deleteTournament(owner, tournament.id);
  }
});

async function imageRankingSource(title: string) {
  const tournament = await prisma.tournament.create({
    data: { userId: owner, title, scheme: "merge", topSize: 2 },
  });
  const art = await createArt(owner, { fileName: "source.png", data: png });
  const document = doc();
  document.bindings.image = { kind: "pool", assetId: art.id };
  const tracks = [];
  for (let index = 0; index < 2; index++) {
    const track = await prisma.track.create({
      data: {
        tournamentId: tournament.id,
        title: `${title}-${index}`,
        filePath: "unused-source.wav",
        sizeBytes: 0,
        order: index,
      },
    });
    await prisma.ranking.create({
      data: {
        tournamentId: tournament.id,
        trackId: track.id,
        rank: index + 1,
        score: 2 - index,
      },
    });
    tracks.push(track);
  }
  document.source = {
    kind: "tournament",
    tournamentId: tournament.id,
    participants: tracks.map((t) => ({
      id: t.id,
      label: t.title,
      media: { visual: "image" },
    })),
    rounds: [],
  };
  return { tournament, tracks, document };
}
async function reverseRanking(
  source: Awaited<ReturnType<typeof imageRankingSource>>,
) {
  await prisma.$transaction(
    source.tracks.map((track, index) =>
      prisma.ranking.update({
        where: {
          tournamentId_trackId: {
            tournamentId: source.tournament.id,
            trackId: track.id,
          },
        },
        data: { rank: 2 - index },
      }),
    ),
  );
}
async function storedFiles(relative: string): Promise<string[]> {
  const entries = await readdir(absPath(relative), {
    withFileTypes: true,
  }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await storedFiles(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
it("protects a saved revision backing an invalid-draft preview after a newer valid source revision", async () => {
  const source = await imageRankingSource("Preview retention");
  const project = await studio.createStudioProject(owner, {
    document: source.document,
  });
  const first = await prisma.studioRevision.findUniqueOrThrow({
    where: { projectId_revision: { projectId: project.id, revision: 1 } },
  });
  const file = JSON.parse(first.assetsJson!).files.image.path as string;
  await studio.saveStudioDraft(owner, project.id, {
    ...mutation(project.version),
    text: "{",
  });
  await reverseRanking(source);
  const changed = await studio.getStudioProject(owner, project.id);
  expect(changed.revision).toBe(2);
  expect(changed.previewRevision).toBe(1);
  expect(changed.previewStale).toBe(true);
  await expect(
    studio.deleteStudioRevision(owner, project.id, 1),
  ).rejects.toThrow("REVISION_IN_USE");
  expect(await readFile(absPath(file))).toEqual(png);
  const repaired = await studio.saveStudioDraft(owner, project.id, {
    ...mutation(changed.version),
    document: changed.document,
  });
  expect(repaired.previewRevision).toBeNull();
  await studio.deleteStudioRevision(owner, project.id, 1);
  await expect(stat(absPath(file))).rejects.toThrow();
});
it.each(["manual", "other-tournament"] as const)(
  "reconciles a draft source switch from %s and rejects its previous edit token",
  async (kind) => {
    const head =
      kind === "manual"
        ? doc()
        : (await imageRankingSource("Head source")).document;
    const source = await imageRankingSource("Draft source");
    const project = await studio.createStudioProject(owner, { document: head });
    const saved = await studio.saveStudioDraft(owner, project.id, {
      ...mutation(project.version),
      document: source.document,
    });
    const prior = saved.draft!.document as typeof source.document;
    await reverseRanking(source);
    await expect(
      studio.commitStudioDraft(owner, project.id, mutation(saved.version)),
    ).rejects.toThrow("VERSION_CONFLICT");
    const changed = await studio.getStudioProject(owner, project.id);
    const current = changed.draft!.document as typeof source.document;
    expect(changed.version).toBe(saved.version + 1);
    expect(changed.revision).toBe(project.revision);
    expect(current.source.version).not.toBe(prior.source.version);
    expect(current.source.participants.map((p) => p.id)).toEqual(
      source.tracks.map((t) => t.id).reverse(),
    );
    await expect(
      studio.saveStudioDraft(owner, project.id, {
        ...mutation(saved.version),
        document: source.document,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
  },
);
it("rechecks a candidate draft source changed after real evaluation but before the save transaction", async () => {
  const source = await imageRankingSource("Candidate source");
  const project = await studio.createStudioProject(owner, { document: doc() });
  let reached!: () => void, release!: () => void;
  const evaluated = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = studioAssets.evaluate;
  // Keep real SQLite/files/compiler evaluation; pause only the race boundary deterministically.
  const pause = vi
    .spyOn(studioAssets, "evaluate")
    .mockImplementation(async (...args) => {
      const result = await original(...args);
      reached();
      await gate;
      return result;
    });
  try {
    const pending = studio.saveStudioDraft(owner, project.id, {
      ...mutation(project.version),
      document: source.document,
    });
    await evaluated;
    await reverseRanking(source);
    release();
    await expect(pending).rejects.toThrow("VERSION_CONFLICT");
    const unchanged = await prisma.studioProject.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(unchanged.version).toBe(project.version);
    expect(unchanged.draftText).toBeNull();
  } finally {
    release();
    pause.mockRestore();
  }
});
it("removes failed immutable copies when an invalid historical revision is released", async () => {
  const corrupt = await createArt(owner, {
    fileName: "bad-version.png",
    data: Buffer.from("invalid image bytes"),
  });
  const document = doc();
  document.bindings.bad = { kind: "pool", assetId: corrupt.id };
  document.source.participants[0].media = { visual: "bad" };
  const before = (await usageSummary(owner)).studio.bytes;
  const project = await studio.createStudioProject(owner, { document });
  expect(project.validation.ready).toBe(false);
  expect(await storedFiles(`studio/${owner}/${project.id}`)).toEqual([]);
  expect((await usageSummary(owner)).studio.bytes).toBe(before);
  const replacement = await studio.saveStudioDraft(owner, project.id, {
    ...mutation(project.version),
    document: doc(),
  });
  await studio.commitStudioDraft(
    owner,
    project.id,
    mutation(replacement.version),
  );
  await studio.deleteStudioRevision(owner, project.id, 1);
  expect(await storedFiles(`studio/${owner}/${project.id}`)).toEqual([]);
  expect(await readFile(absPath(corrupt.filePath))).toEqual(
    Buffer.from("invalid image bytes"),
  );
});

it("cleans failed staged bytes without unlinking a successful shared-hash copy", async () => {
  const valid = await createArt(owner, {
    fileName: "shared-success.png",
    data: png,
  });
  const wrongKind = await prisma.art.create({
    data: {
      userId: owner,
      filePath: valid.filePath,
      kind: "audio",
      sizeBytes: png.length,
    },
  });
  const corrupt = await createArt(owner, {
    fileName: "failed-copy.png",
    data: Buffer.from("bad image"),
  });
  const before = (await usageSummary(owner)).studio.bytes;
  const document = doc();
  document.bindings = {
    "a-good": { kind: "pool", assetId: valid.id },
    "z-alias": { kind: "pool", assetId: wrongKind.id },
    "z-corrupt": { kind: "pool", assetId: corrupt.id },
  };
  document.source.participants[0].media = { visual: "a-good" };
  const project = await studio.createStudioProject(owner, { document });
  expect(project.validation.ready).toBe(false);
  const files = await storedFiles(`studio/${owner}/${project.id}`);
  expect(files).toHaveLength(1);
  expect(await readFile(absPath(files[0]))).toEqual(png);
  expect((await usageSummary(owner)).studio.bytes - before).toBe(png.length);
});

it("saves author-declared generic preset text and geometry with server metadata and no concrete bindings", async () => {
  const art = await createArt(owner, {
    fileName: "preset-private.png",
    data: png,
  });
  const document = createVideoDocument({
    kind: "top",
    participants: [
      { id: "private-participant", label: "Thematic participant" },
    ],
  });
  const geometry = "M 0 100 L 50 0 L 100 100 Z";
  document.bindings["private-media"] = { kind: "pool", assetId: art.id };
  document.scenes = [
    {
      id: "private-scene",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        { id: "private-text", type: "text", text: "Concrete holiday theme" },
        { id: "private-shape", type: "shape", shape: "path", path: geometry },
        { id: "private-image", type: "image", asset: "private-media" },
      ],
    },
  ];
  const template = extractVideoPreset(document, {
    id: "caller-id",
    name: "Ignored name",
    version: 99,
  });
  const text = template.scenes[0].nodes.find((n) => n.type === "text")!;
  if (text.type === "text") text.text = "Выбери персонажа";
  const input = {
    preset: template,
    name: "Saved generic template",
    idempotencyKey: randomUUID(),
  };
  const saved = await studio.saveStudioPreset(owner, input);
  expect(saved.id).not.toBe("caller-id");
  expect(saved.name).toBe("Saved generic template");
  expect(saved.version).toBe(1);
  expect((await studio.saveStudioPreset(owner, input)).id).toBe(saved.id);
  const { personal: _catalogMetadata, ...definition } = saved;
  const applied = applyVideoPreset(doc(), definition);
  const plan = compileVideo(applied).plan;
  expect(plan.scenes[0].nodes.find((n) => n.type === "text")?.text).toBe(
    "Выбери персонажа",
  );
  expect(plan.scenes[0].nodes.find((n) => n.shape === "path")?.path).toBe(
    geometry,
  );
  expect(JSON.stringify(saved)).not.toContain(art.id);
  expect(JSON.stringify(saved)).not.toContain("private-");

  const count = await prisma.studioPreset.count({ where: { userId: owner } });
  const concreteMedia = structuredClone(template);
  concreteMedia.scenes[0].nodes.push({
    id: "bad-media",
    type: "image",
    asset: art.id,
  });
  const concreteParticipant = structuredClone(template);
  concreteParticipant.scenes[0].nodes.push({
    id: "bad-card",
    type: "card",
    participantId: "private-participant",
  });
  await expect(
    studio.saveStudioPreset(owner, {
      preset: concreteMedia,
      name: "Rejected asset",
    }),
  ).rejects.toThrow();
  await expect(
    studio.saveStudioPreset(owner, {
      preset: concreteParticipant,
      name: "Rejected participant",
    }),
  ).rejects.toThrow();
  const concreteGroup = structuredClone(template);
  concreteGroup.scenes[0].nodes.push({
    id: "bad-group-label",
    type: "text",
    text: { bind: "group.label", groupId: "private-group" },
  });
  await expect(
    studio.saveStudioPreset(owner, {
      preset: concreteGroup,
      name: "Rejected group identity",
    }),
  ).rejects.toThrow();
  await expect(
    studio.saveStudioPreset(owner, {
      preset: template,
      document,
      name: "Both",
    }),
  ).rejects.toThrow();
  await expect(
    studio.saveStudioPreset(owner, { name: "Neither" }),
  ).rejects.toThrow();
  expect(await prisma.studioPreset.count({ where: { userId: owner } })).toBe(
    count,
  );

  const extracted = await studio.saveStudioPreset(owner, {
    document,
    name: "Conservative extraction",
  });
  expect(JSON.stringify(extracted)).not.toContain("Concrete holiday theme");
  expect(JSON.stringify(extracted)).not.toContain("Thematic participant");
  expect(JSON.stringify(extracted)).not.toContain(art.id);
  expect(
    extracted.scenes[0].nodes.find((n) => n.type === "text"),
  ).toMatchObject({ text: "Text" });
  expect(
    extracted.scenes[0].nodes.find((n) => n.type === "shape"),
  ).toMatchObject({ path: geometry });
});

// Real PCM with a quiet lead-in and a loud central region exercises analysis,
// rather than supplying the active interval the service is supposed to derive.
async function activeAnchorDocument() {
  const rate = 8000;
  const data = Buffer.alloc(44 + rate * 2 * 2);
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
  for (let i = 0; i < rate * 2; i++)
    data.writeInt16LE(
      Math.round(
        Math.sin((i * 2 * Math.PI * 440) / rate) *
          (i >= rate / 2 && i < rate * 1.5 ? 24000 : 100),
      ),
      44 + i * 2,
    );
  const art = await createArt(owner, { fileName: "anchor.wav", data });
  const document = createVideoDocument({
    kind: "top",
    participants: [
      {
        id: "first-stable",
        label: "First",
        rank: 1,
        media: { audio: "sound" },
      },
      {
        id: "second-stable",
        label: "Second",
        rank: 3,
        media: { audio: "sound" },
      },
      {
        id: "third-stable",
        label: "Third",
        rank: 2,
        media: { audio: "sound" },
      },
    ],
  });
  document.settings.top = {
    order: "descending",
    snippet: { mode: "active", durationSec: 0.6 },
  };
  document.bindings.sound = { kind: "pool", assetId: art.id };
  document.audio = {
    cues: [
      {
        id: "selected-sound",
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        duration: { sec: 0.1 },
        anchor: {
          event: "scene.start",
          sceneId: "main",
          participantId: "first-stable",
        },
      },
    ],
  };
  return document;
}

describe("ACTIVE-ANCHOR-1: sound routing through active top expansion", () => {
  it("creates and freezes one participant-selected sound after real analysis and rank ordering", async () => {
    const document = await activeAnchorDocument();
    const original = JSON.stringify(document);
    const project = await studio.createStudioProject(owner, { document });
    expect(project.validation).toEqual({ ready: true, diagnostics: [] });
    expect(project.plan?.scenes.map((scene) => scene.participantId)).toEqual([
      "second-stable",
      "third-stable",
      "first-stable",
    ]);
    const frozen = await studio.freezeStudioProject(owner, project.id);
    expect(
      frozen.plan.audio
        .filter((cue) => cue.role === "sfx")
        .map((cue) => cue.from),
    ).toEqual([36]);
    expect(frozen.plan.scenes.map((scene) => scene.durationInFrames)).toEqual([
      18, 18, 18,
    ]);
    expect(
      frozen.plan.audio.filter((cue) => cue.role === "primary")[0].offsetFrames,
    ).toBeGreaterThan(0);
    expect(
      await prisma.studioAnalysis.findUnique({
        where: { key: `${frozen.manifest.sound.hash}:0.6` },
      }),
    ).not.toBeNull();
    expect(frozen.resolvedDocument.audio?.cues).toHaveLength(1);
    expect(frozen.resolvedDocument.audio?.cues?.[0].anchor?.participantId).toBe(
      "first-stable",
    );
    expect(project.document).toEqual(document);
    expect(JSON.stringify(document)).toBe(original);
  });
  it("keeps a generic scene sound for all repeated participants", async () => {
    const document = await activeAnchorDocument();
    delete document.audio!.cues![0].anchor!.participantId;
    const project = await studio.createStudioProject(owner, { document });
    expect(project.validation).toEqual({ ready: true, diagnostics: [] });
    const frozen = await studio.freezeStudioProject(owner, project.id);
    expect(
      frozen.plan.audio
        .filter((cue) => cue.role === "sfx")
        .map((cue) => cue.from),
    ).toEqual([0, 18, 36]);
  });
  it.each(["participant", "event"] as const)(
    "diagnoses a genuinely missing %s after active expansion",
    async (missing) => {
      const document = await activeAnchorDocument();
      if (missing === "participant")
        document.audio!.cues![0].anchor!.participantId = "nonexistent";
      else document.audio!.cues![0].anchor!.event = "timer.start";
      const result = await studioAssets.evaluate(owner, document);
      expect(result.validation.ready).toBe(false);
      expect(result.validation.diagnostics.map((d) => d.code)).toContain(
        "AUDIO_ANCHOR_NOT_FOUND",
      );
      expect(
        result.plan?.audio.filter((cue) => cue.role === "sfx"),
      ).toHaveLength(0);
      expect(
        result.resolvedDocument?.audio?.cues?.[0].anchor?.participantId,
      ).toBe(missing === "participant" ? "nonexistent" : "first-stable");
    },
  );
  it.each(["manual", "authored-active"] as const)(
    "retains selectors without analysis in the %s path",
    async (mode) => {
      const document = await activeAnchorDocument();
      document.settings.top!.snippet =
        mode === "manual"
          ? { mode: "manual", startSec: 0.2, durationSec: 0.6 }
          : { mode: "active", activeStartSec: 0.2, activeEndSec: 0.8 };
      const result = await studioAssets.evaluate(owner, document);
      expect(result.validation).toEqual({ ready: true, diagnostics: [] });
      expect(result.resolvedDocument?.scenes).toEqual(document.scenes);
      expect(result.resolvedDocument?.audio).toEqual(document.audio);
      expect(
        result.plan?.audio
          .filter((cue) => cue.role === "sfx")
          .map((cue) => cue.from),
      ).toEqual([36]);
    },
  );
  it("rejects repeated sound-rule multiplication before allocating or analyzing", async () => {
    const document = createVideoDocument({
      kind: "top",
      participants: Array.from({ length: 500 }, (_, i) => ({
        id: `guard-${i}`,
        label: `P${i}`,
        media: { audio: "sound" },
      })),
    });
    document.settings.top = { snippet: { mode: "active", durationSec: 0.6 } };
    document.bindings.sound = { kind: "builtin", name: "tick" };
    document.audio = {
      cues: Array.from({ length: 500 }, (_, i) => ({
        id: `guard-cue-${i}`,
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        anchor: {
          event: "scene.start",
          sceneId: "main",
          participantId: "guard-0",
        },
      })),
    };
    const result = await studioAssets.evaluate(owner, document);
    expect(result.validation.ready).toBe(false);
    expect(result.validation.diagnostics.map((d) => d.code)).toEqual([
      "RESOURCE_BUDGET_EXCEEDED",
    ]);
    expect(result.plan).toBeNull();
    expect(result.resolvedDocument).toBeNull();
    expect(result.manifest).toEqual({});
    expect(result.files).toEqual({});
  });
});
