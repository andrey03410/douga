import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { readFile, writeFile, stat, readdir, mkdir } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { createArt, deleteArt, listArts } from "@/server/arts";
import { deleteTournament } from "@/server/tournaments";
import { deleteUser, usageSummary } from "@/server/users";
import * as studio from "@/server/studio";

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
