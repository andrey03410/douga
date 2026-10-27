import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import {
  listArts,
  listRecentArts,
  createArt,
  renameArt,
  deleteArt,
  deleteArts,
  MAX_BULK_DELETE,
} from "@/server/arts";
import { patchRenderItem } from "@/server/render-items";

// Integration tests for the arts service layer + render-item patching, on the
// real Prisma schema (SQLite). Covers every scenario from the phase-3 spec.

const EMAIL = "integration-arts@test.local";
const EMAIL_OTHER = "integration-arts-other@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userId: string;
let otherUserId: string;
let itemId: string;

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

  // Minimal tournament -> render config -> one item, to exercise assignment/crop.
  const tournament = await prisma.tournament.create({
    data: { userId, title: "Arts IT", scheme: "merge", status: "completed", topSize: 1 },
  });
  const track = await prisma.track.create({
    data: { tournamentId: tournament.id, title: "T", filePath: "fake/t.mp3", order: 0 },
  });
  const config = await prisma.renderConfig.create({
    data: {
      tournamentId: tournament.id,
      items: { create: [{ trackId: track.id, rank: 1 }] },
    },
    include: { items: true },
  });
  itemId = config.items[0].id;
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

  it("tracks recent arts only after they are used", async () => {
    const art = await createArt(userId, { fileName: "recent.png", data: PNG });
    expect((await listRecentArts(userId)).map((a) => a.id)).not.toContain(art.id);

    await patchRenderItem(userId, itemId, { artId: art.id });
    const recent = await listRecentArts(userId);
    expect(recent[0]?.id).toBe(art.id);

    const listed = await listArts(userId, { q: "recent" });
    expect(listed.arts[0]?.usageCount).toBe(1);
  });

  it("deletes an art: file and row gone, positions freed, crop cleared", async () => {
    const art = await createArt(userId, { fileName: "doomed.png", data: PNG });
    await patchRenderItem(userId, itemId, {
      artId: art.id,
      artCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    });

    await deleteArt(userId, art.id);

    expect(await prisma.art.findUnique({ where: { id: art.id } })).toBeNull();
    expect(existsSync(absPath(art.filePath))).toBe(false);
    const item = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(item?.artId).toBeNull();
    expect(item?.artCropX).toBeNull();
    expect(item?.artCropW).toBeNull();
  });

  it("refuses to delete a foreign art", async () => {
    const art = await createArt(otherUserId, { fileName: "keep.png", data: PNG });
    await expect(deleteArt(userId, art.id)).rejects.toThrow("NOT_FOUND");
  });
});

describe("render-item art assignment and crop", () => {
  it("sets and updates the crop on an item that has an art", async () => {
    const art = await createArt(userId, { fileName: "crop-target.png", data: PNG });
    await patchRenderItem(userId, itemId, {
      artId: art.id,
      artCrop: { x: 0, y: 0, w: 1, h: 1 },
    });
    let item = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(item?.artCropW).toBe(1);

    await patchRenderItem(userId, itemId, { artCrop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    item = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(item?.artCropX).toBe(0.25);
    expect(item?.artCropW).toBe(0.5);
  });

  it("resets the crop to auto-cover with an explicit null", async () => {
    await patchRenderItem(userId, itemId, { artCrop: null });
    const item = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(item?.artCropX).toBeNull();
    expect(item?.artCropH).toBeNull();
  });

  it("resets the crop when the art changes without a new crop", async () => {
    await patchRenderItem(userId, itemId, { artCrop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    const another = await createArt(userId, { fileName: "another.png", data: PNG });
    await patchRenderItem(userId, itemId, { artId: another.id });
    const item = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(item?.artId).toBe(another.id);
    expect(item?.artCropX).toBeNull();
  });

  it("rejects an invalid crop rect", async () => {
    await expect(
      patchRenderItem(userId, itemId, { artCrop: { x: 0.8, y: 0, w: 0.5, h: 1 } }),
    ).rejects.toThrow("INVALID_CROP");
    await expect(
      patchRenderItem(userId, itemId, { artCrop: { x: 0 } }),
    ).rejects.toThrow("INVALID_CROP");
  });

  it("rejects a crop on an item without an art", async () => {
    await patchRenderItem(userId, itemId, { artId: null });
    await expect(
      patchRenderItem(userId, itemId, { artCrop: { x: 0, y: 0, w: 1, h: 1 } }),
    ).rejects.toThrow("NO_ART");
  });

  it("rejects a foreign art and a foreign item", async () => {
    const foreign = await createArt(otherUserId, { fileName: "foreign2.png", data: PNG });
    await expect(
      patchRenderItem(userId, itemId, { artId: foreign.id }),
    ).rejects.toThrow("ART_NOT_FOUND");
    await expect(
      patchRenderItem(otherUserId, itemId, { artId: foreign.id }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

// Phase 17: the pool used to count only top positions, so a poster standing as
// a card in thirty picker rounds reported "not used" — and deleting it took the
// cards along (PickerTile.artId cascades).
describe("art usage breakdown", () => {
  it("counts cards, playlist entries, backgrounds and top positions", async () => {
    const poster = await createArt(userId, { fileName: "usage-poster.png", data: PNG });
    const music = await prisma.art.create({
      data: { userId, filePath: "fake/m.mp3", label: "usage-music", kind: "audio", sizeBytes: 10 },
    });

    const project = await prisma.videoProject.create({
      data: {
        userId,
        title: "Usage IT",
        kind: "picker",
        bgArtId: poster.id,
        bgMusicArtId: music.id,
      },
    });
    const round = await prisma.pickerRound.create({
      data: { projectId: project.id, order: 0, bgArtId: poster.id },
    });
    await prisma.pickerTile.createMany({
      data: [
        { roundId: round.id, artId: poster.id, order: 0 },
        { roundId: round.id, artId: poster.id, order: 1 },
      ],
    });
    await prisma.pickerPlaylistItem.create({
      data: { projectId: project.id, order: 0, artId: music.id },
    });
    await patchRenderItem(userId, itemId, { artId: poster.id });

    const listed = await listArts(userId, { q: "usage-" });
    const posterRow = listed.arts.find((a) => a.id === poster.id);
    const musicRow = listed.arts.find((a) => a.id === music.id);

    // two cards + one position + project background + round background
    expect(posterRow?.usage).toEqual({
      positions: 1,
      audioPositions: 0,
      cards: 2,
      playlist: 0,
      backgrounds: 2,
      total: 5,
    });
    expect(posterRow?.usageCount).toBe(5);
    expect(musicRow?.usage).toEqual({
      positions: 0,
      audioPositions: 0,
      cards: 0,
      playlist: 1,
      backgrounds: 1,
      total: 2,
    });

    // deleting the poster is what the warning is about: the cards go with it
    await deleteArt(userId, poster.id);
    expect(await prisma.pickerTile.count({ where: { roundId: round.id } })).toBe(0);
    const freed = await prisma.renderItem.findUnique({ where: { id: itemId } });
    expect(freed?.artId).toBeNull();
    const rounds = await prisma.pickerRound.findUnique({ where: { id: round.id } });
    expect(rounds?.bgArtId).toBeNull();

    await prisma.videoProject.delete({ where: { id: project.id } });
    await prisma.art.delete({ where: { id: music.id } });
  });

  // T02: RenderItem.audioArtId cascades, so a manual-top position that sounds
  // with the media is deleted with it, while a picture-only position is freed.
  it("tells positions that sound with the media from those that only show it", async () => {
    const mkMedia = (label: string, kind: string) =>
      prisma.art.create({
        data: { userId, filePath: `fake/${label}`, label, kind, sizeBytes: 10, hasAudio: kind !== "image" },
      });
    const song = await mkMedia("usage-audio-song", "audio");
    const clip = await mkMedia("usage-audio-clip", "video");
    const cover = await mkMedia("usage-audio-cover", "image");
    const project = await prisma.videoProject.create({
      data: { userId, title: "Usage audio IT", kind: "top" },
    });
    const config = await prisma.renderConfig.create({
      data: {
        projectId: project.id,
        items: {
          create: [
            { rank: 1, audioArtId: song.id, artId: cover.id },
            // one video as both the sound and the picture of the same position
            { rank: 2, audioArtId: clip.id, artId: clip.id },
          ],
        },
      },
    });

    const listed = await listArts(userId, { q: "usage-audio-" });
    const usage = (id: string) => listed.arts.find((a) => a.id === id)?.usage;
    expect(usage(song.id)).toMatchObject({ positions: 0, audioPositions: 1, total: 1 });
    expect(usage(cover.id)).toMatchObject({ positions: 1, audioPositions: 0, total: 1 });
    // the position goes away with the clip, so it is not "freed" as well
    expect(usage(clip.id)).toMatchObject({ positions: 0, audioPositions: 1, total: 1 });

    await deleteArt(userId, clip.id);
    await deleteArt(userId, song.id);
    // both positions sounded with deleted media and went away (cascade)
    expect(await prisma.renderItem.count({ where: { renderConfigId: config.id } })).toBe(0);

    await prisma.videoProject.delete({ where: { id: project.id } });
    await deleteArt(userId, cover.id);
  });

  it("reports zeros for media nothing points at", async () => {
    const lonely = await createArt(userId, { fileName: "usage-lonely.png", data: PNG });
    const listed = await listArts(userId, { q: "usage-lonely" });
    expect(listed.arts[0]?.usage).toEqual({
      positions: 0,
      audioPositions: 0,
      cards: 0,
      playlist: 0,
      backgrounds: 0,
      total: 0,
    });
    await deleteArt(userId, lonely.id);
  });
});

// Phase 17: cleaning a pool of a thousand posters one file at a time is the
// reason bulk delete exists; partial failures must not stop the rest.
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
    // the other user's media is untouched
    expect(await prisma.art.count({ where: { id: foreign.id } })).toBe(1);
    await deleteArt(otherUserId, foreign.id);
  });

  it("takes the cards of a deleted media with it, as a single delete does", async () => {
    const art = await createArt(userId, { fileName: "bulk-card.png", data: PNG });
    const project = await prisma.videoProject.create({
      data: { userId, title: "Bulk IT", kind: "picker" },
    });
    const round = await prisma.pickerRound.create({
      data: { projectId: project.id, order: 0 },
    });
    await prisma.pickerTile.create({ data: { roundId: round.id, artId: art.id, order: 0 } });

    await deleteArts(userId, [art.id]);
    expect(await prisma.pickerTile.count({ where: { roundId: round.id } })).toBe(0);
    await prisma.videoProject.delete({ where: { id: project.id } });
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
