import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";
import {
  createVideoDocument,
  compileVideo,
  getBuiltinPresets,
  parseVideoDocument,
  type VideoDocument,
} from "@douga/video";
import { reconcileSource } from "@/server/studio/sources";
import {
  createStudioProjectFromPreset,
  deleteStudioProject,
  getStudioProject,
  saveStudioDraft,
} from "@/server/studio/projects";
import { getStudioSource, listStudioSources } from "@/server/studio/queries";
import { resolveAssets, references, evaluate } from "@/server/studio/assets";
import { createArt, deleteArt } from "@/server/arts";
import { saveStudioPreset } from "@/server/studio/presets";
import { readFile } from "node:fs/promises";

let owner: string, other: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
function wav() {
  const data = Buffer.alloc(44 + 8000 * 2);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  return data;
}
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `bridge-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `bridge-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
});
afterAll(async () => {
  for (const userId of [owner, other])
    if (userId) {
      for (const project of await prisma.studioProject.findMany({
        where: { userId },
      }))
        await deleteStudioProject(userId, project.id);
      await prisma.tournament.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      await removePath(`arts/${userId}`);
      await removePath(`verification/27-segments/bridge-media/${userId}`);
    }
});
async function fixture() {
  const tournament = await prisma.tournament.create({
    data: {
      userId: owner,
      title: "Эпизоды",
      scheme: "merge",
      status: "in_progress",
    },
  });
  const first = await prisma.tournamentSegment.create({
    data: {
      tournamentId: tournament.id,
      title: "Эпизод 1",
      order: 0,
      status: "completed",
      topSize: 1,
    },
  });
  const second = await prisma.tournamentSegment.create({
    data: {
      tournamentId: tournament.id,
      title: "Эпизод 2",
      order: 1,
      status: "in_progress",
      topSize: 1,
    },
  });
  const tracks = [];
  for (const [order, segment] of [first, first, second].entries()) {
    const filePath = `verification/27-segments/bridge-media/${owner}/${randomUUID()}.wav`;
    await saveFile(filePath, wav());
    tracks.push(
      await prisma.track.create({
        data: {
          tournamentId: tournament.id,
          segmentId: segment.id,
          title: `Track ${order}`,
          artist: "Artist",
          filePath,
          durationSec: 1,
          sizeBytes: wav().length,
          kind: "audio",
          order,
        },
      }),
    );
  }
  await prisma.ranking.createMany({
    data: tracks.map((track, i) => ({
      tournamentId: tournament.id,
      segmentId: track.segmentId,
      trackId: track.id,
      rank: i === 1 ? 2 : 1,
      score: 10 - i,
    })),
  });
  return { tournament, first, second, tracks };
}
function sourceDocument(tournamentId: string, v2 = true) {
  const document = createVideoDocument({ kind: "top", participants: [] });
  document.source = {
    kind: "tournament",
    tournamentId,
    participants: [],
    rounds: [],
  };
  if (v2)
    Object.assign(document, { schemaVersion: 2, scenes: [], segments: [] });
  return document;
}

describe("tournament source bridge for segmented documents", () => {
  it("exposes only ready nonempty segments with local top-N, metadata and cover bindings", async () => {
    const f = await fixture();
    const poster = await createArt(owner, {
      fileName: "poster.png",
      data: png,
    });
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { subtitle: "Тема", posterArtId: poster.id },
    });
    const coverPath = `verification/27-segments/bridge-media/${owner}/cover.png`;
    await saveFile(coverPath, png);
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { album: "OST", comment: "Любимый", bestMomentSec: 0.3, coverPath },
    });
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    expect(d.source.participants.map((p) => p.id)).toEqual([f.tracks[0].id]);
    expect(d.source.participants[0]).toMatchObject({
      rank: 1,
      score: 10,
      album: "OST",
      comment: "Любимый",
      bestMomentSec: 0.3,
      media: {
        audio: `source:${f.tracks[0].id}`,
        visual: `source:${f.tracks[0].id}:cover`,
      },
    });
    expect(d.source.segments).toEqual([
      {
        id: f.first.id,
        title: "Эпизод 1",
        subtitle: "Тема",
        poster: `source:segment:${f.first.id}:poster`,
        participantIds: [f.tracks[0].id],
      },
    ]);
    expect(d.bindings[`source:${f.tracks[0].id}:cover`]).toEqual({
      kind: "track",
      tournamentId: f.tournament.id,
      trackId: f.tracks[0].id,
      media: "cover",
    });
    expect(d.bindings[`source:segment:${f.first.id}:poster`]).toEqual({
      kind: "pool",
      assetId: poster.id,
    });
  });
  it("reconciles authoritative fields while retaining authored scenes, media, captions and dormant segments", async () => {
    const f = await fixture();
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    const segment = d.segments![0];
    segment.settings = { background: "#123456" };
    segment.scenes[0].nodes.push({
      id: "my-node",
      type: "text",
      text: "Мой монтаж",
    });
    d.source.participants[0].caption = "Подпись";
    d.source.participants[0].media = { visual: "custom-cover" };
    d.bindings["custom-cover"] = { kind: "builtin", name: "tick" };
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { title: "Новое имя", comment: "Из базы", bestMomentSec: 0.6 },
    });
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed" },
    });
    const added = await reconcileSource(owner, d);
    expect(added.source.version).not.toBe(d.source.version);
    expect(added.segments).toHaveLength(2);
    expect(added.segments![0]).toMatchObject({
      settings: { background: "#123456" },
    });
    expect(added.segments![0].scenes[0].nodes.at(-1)).toMatchObject({
      text: "Мой монтаж",
    });
    expect(
      added.segments![1].scenes[0].nodes.some((n) => n.id === "my-node"),
    ).toBe(false);
    expect(added.source.participants[0]).toMatchObject({
      label: "Artist — Новое имя",
      comment: "Из базы",
      bestMomentSec: 0.6,
      caption: "Подпись",
      media: { visual: "custom-cover" },
    });
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "in_progress" },
    });
    const dormant = await reconcileSource(owner, added);
    expect(
      dormant.segments!.find((s) => s.sourceSegmentId === f.first.id)?.enabled,
    ).toBe(false);
    expect(dormant.source.segments!.map((s) => s.id)).toEqual([f.second.id]);
    expect(
      dormant.source.participants.find((p) => p.id === f.tracks[0].id)?.caption,
    ).toBe("Подпись");
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "completed" },
    });
    const restored = await reconcileSource(owner, dormant);
    expect(restored.segments![0].enabled).not.toBe(false);
    expect(restored.segments![0].settings).toEqual({ background: "#123456" });
  });
  it("updates each local ranking and preserves custom intro and metadata order", async () => {
    const f = await fixture();
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { topSize: 2 },
    });
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    d.segments!.unshift({
      id: "intro",
      kind: "custom",
      title: "Intro",
      scenes: [
        { id: "intro-scene", block: "custom", duration: { sec: 1 }, nodes: [] },
      ],
    });
    await prisma.ranking.update({
      where: {
        tournamentId_trackId: {
          tournamentId: f.tournament.id,
          trackId: f.tracks[0].id,
        },
      },
      data: { rank: 2 },
    });
    await prisma.ranking.update({
      where: {
        tournamentId_trackId: {
          tournamentId: f.tournament.id,
          trackId: f.tracks[1].id,
        },
      },
      data: { rank: 1 },
    });
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { title: "Первый", order: 2 },
    });
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed", order: 0 },
    });
    const changed = await reconcileSource(owner, d);
    expect(changed.segments!.map((s) => s.sourceSegmentId ?? s.id)).toEqual([
      "intro",
      f.first.id,
      f.second.id,
    ]);
    expect(changed.source.segments!.map((s) => s.id)).toEqual([
      f.second.id,
      f.first.id,
    ]);
    expect(changed.segments![1].participantIds).toEqual([
      f.tracks[1].id,
      f.tracks[0].id,
    ]);
    expect(changed.segments![1].title).toBe("Первый");
    expect(changed.source.participants.map((p) => p.rank)).toEqual([1, 1, 2]);
  });
  it("pins v1 to the segment containing its participants without mixing local ranks", async () => {
    const f = await fixture();
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed" },
    });
    const d = sourceDocument(f.tournament.id, false);
    d.source.participants = [
      { id: f.tracks[2].id, label: "Old", caption: "Keep" },
    ];
    const pinned = await reconcileSource(owner, d);
    expect(pinned.schemaVersion).toBe(1);
    expect(pinned.source.segmentId).toBe(f.second.id);
    expect(pinned.source.participants.map((p) => p.id)).toEqual([
      f.tracks[2].id,
    ]);
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { order: -1 },
    });
    expect(
      (await reconcileSource(owner, pinned)).source.participants.map(
        (p) => p.id,
      ),
    ).toEqual([f.tracks[2].id]);
  });
  it("retains two independently authored video segments backed by the same source segment", async () => {
    const f = await fixture();
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    const copy = structuredClone(d.segments![0]);
    copy.id = "second-edit";
    copy.scenes = [
      {
        id: "second-edit-scene",
        block: "custom",
        duration: { sec: 1 },
        nodes: [],
      },
    ];
    d.segments!.push(copy);
    const current = await reconcileSource(owner, d);
    expect(current.segments!.map((s) => s.id)).toEqual([
      `segment:${f.first.id}`,
      "second-edit",
    ]);
    expect(current.segments![1].scenes[0].id).toBe("second-edit-scene");
  });
  it("preserves authored segment order, disabled state and removal when reconciling ready source data", async () => {
    const f = await fixture();
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed" },
    });
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    d.segments!.reverse();
    d.segments![0].enabled = false;
    const reordered = await reconcileSource(owner, d);
    expect(reordered.segments!.map((s) => s.sourceSegmentId)).toEqual([
      f.second.id,
      f.first.id,
    ]);
    expect(reordered.segments![0].enabled).toBe(false);
    reordered.segments!.pop();
    const removed = await reconcileSource(owner, reordered);
    expect(removed.segments!.map((s) => s.sourceSegmentId)).toEqual([
      f.second.id,
    ]);
  });
  it("keeps an authored deletion across readiness changes until the segment is explicitly re-added", async () => {
    const f = await fixture();
    const original = await reconcileSource(
      owner,
      sourceDocument(f.tournament.id),
    );
    const edited = structuredClone(original);
    edited.segments = [];
    const removed = parseVideoDocument(await reconcileSource(owner, edited));
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "in_progress" },
    });
    const unready = parseVideoDocument(await reconcileSource(owner, removed));
    expect(unready.source.segments).toEqual([]);
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "completed" },
    });
    const ready = parseVideoDocument(await reconcileSource(owner, unready));
    expect(ready.segments).toEqual([]);
    expect(ready.source.suppressedSegmentIds).toEqual([f.first.id]);
    expect(ready.source.segments!.map((segment) => segment.id)).toEqual([
      f.first.id,
    ]);
    ready.segments!.push(structuredClone(original.segments![0]));
    const readded = parseVideoDocument(await reconcileSource(owner, ready));
    expect(readded.segments!.map((segment) => segment.sourceSegmentId)).toEqual(
      [f.first.id],
    );
    expect(readded.segments![0].enabled).toBeUndefined();
    expect(readded.source.suppressedSegmentIds ?? []).toEqual([]);
  });
  it("restores each authored enabled state after a source becomes unavailable and ready again", async () => {
    const f = await fixture();
    const initial = await reconcileSource(
      owner,
      sourceDocument(f.tournament.id),
    );
    initial.segments![0].enabled = false;
    const copy = structuredClone(initial.segments![0]);
    copy.id = "visible-copy";
    copy.enabled = true;
    copy.scenes = [
      {
        id: "visible-copy-scene",
        block: "custom",
        duration: { sec: 1 },
        nodes: [],
      },
    ];
    initial.segments!.push(copy);
    const defaultCopy = structuredClone(copy);
    defaultCopy.id = "default-copy";
    delete defaultCopy.enabled;
    defaultCopy.scenes = [
      {
        id: "default-copy-scene",
        block: "custom",
        duration: { sec: 1 },
        nodes: [],
      },
    ];
    initial.segments!.push(defaultCopy);
    const authored = parseVideoDocument(await reconcileSource(owner, initial));
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "in_progress" },
    });
    const dormant = parseVideoDocument(await reconcileSource(owner, authored));
    expect(dormant.segments!.map((segment) => segment.enabled)).toEqual([
      false,
      false,
      false,
    ]);
    dormant.segments![0].enabled = true;
    const reread = parseVideoDocument(await reconcileSource(owner, dormant));
    expect(reread.segments![0].enabled).toBe(false);
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "completed" },
    });
    const restored = parseVideoDocument(await reconcileSource(owner, reread));
    expect(restored.segments!.map((segment) => segment.enabled)).toEqual([
      false,
      true,
      undefined,
    ]);
    expect(restored.source.dormantSegments).toBeUndefined();
  });
  it("suppresses a source segment deleted while unavailable and allows an explicit later return", async () => {
    const f = await fixture();
    const initial = await reconcileSource(
      owner,
      sourceDocument(f.tournament.id),
    );
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "in_progress" },
    });
    const dormant = parseVideoDocument(await reconcileSource(owner, initial));
    expect(dormant.source.segments).toEqual([]);
    dormant.segments = [];
    const deleted = parseVideoDocument(await reconcileSource(owner, dormant));
    expect(deleted.source.suppressedSegmentIds).toEqual([f.first.id]);
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { status: "completed" },
    });
    const ready = parseVideoDocument(await reconcileSource(owner, deleted));
    expect(ready.segments).toEqual([]);
    ready.segments!.push(structuredClone(initial.segments![0]));
    const readded = parseVideoDocument(await reconcileSource(owner, ready));
    expect(readded.segments!.map((segment) => segment.sourceSegmentId)).toEqual(
      [f.first.id],
    );
    expect(readded.source.suppressedSegmentIds ?? []).toEqual([]);
  });
  it("lazily wraps an old tournament without changing its v1 compiled frames", async () => {
    const tournament = await prisma.tournament.create({
      data: {
        userId: owner,
        title: "Legacy",
        scheme: "merge",
        status: "completed",
        topSize: 1,
      },
    });
    const track = await prisma.track.create({
      data: {
        tournamentId: tournament.id,
        title: "Legacy track",
        filePath: "missing.wav",
        order: 0,
      },
    });
    await prisma.ranking.create({
      data: {
        tournamentId: tournament.id,
        trackId: track.id,
        rank: 1,
        score: 2,
      },
    });
    const d = sourceDocument(tournament.id, false);
    d.source.participants = [
      { id: track.id, label: "Legacy track", rank: 1, caption: "Stable" },
    ];
    const before = compileVideo(d).plan;
    const current = await reconcileSource(owner, d);
    expect(compileVideo(current).plan).toEqual(before);
    expect(
      await prisma.tournamentSegment.count({
        where: { tournamentId: tournament.id },
      }),
    ).toBe(1);
    expect(current.source.segmentId).toBeTruthy();
  });
  it("queries and preset creation use the ready composition before the whole tournament is complete", async () => {
    const f = await fixture();
    const source = await getStudioSource(owner, f.tournament.id);
    expect(source.items.map((p) => p.id)).toEqual([f.tracks[0].id]);
    expect(source.segments.map((s) => s.id)).toEqual([f.first.id]);
    const listed = (await listStudioSources(owner)).items.find(
      (s) => s.id === f.tournament.id,
    )!;
    expect(listed.segments.map((s) => s.id)).toEqual([f.first.id]);
    const project = await createStudioProjectFromPreset(owner, {
      presetId: "top.classic.wide",
      sourceId: f.tournament.id,
      title: "Видео",
    });
    expect(project.document.schemaVersion).toBe(2);
    expect(project.document.scenes).toEqual([]);
    expect(project.validation.ready).toBe(true);
    const draft = structuredClone(project.document);
    draft.segments![0].settings = { background: "#123456" };
    const saved = await saveStudioDraft(owner, project.id, {
      expectedVersion: project.version,
      document: draft,
    });
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed" },
    });
    const updated = await getStudioProject(owner, project.id);
    expect(updated.version).toBeGreaterThan(saved.version);
    expect(updated.document.segments).toHaveLength(2);
    expect(
      (updated.draft!.document as VideoDocument).segments![0].settings,
    ).toEqual({ background: "#123456" });
  });
  it("resolves embedded and owned pool covers as images at the cover endpoint and protects their references", async () => {
    const f = await fixture();
    const art = await createArt(owner, { fileName: "cover.png", data: png });
    const coverPath = `verification/27-segments/bridge-media/${owner}/embedded.png`;
    await saveFile(coverPath, png);
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { coverPath },
    });
    const d = sourceDocument(f.tournament.id, false);
    d.bindings.cover = {
      kind: "track",
      tournamentId: f.tournament.id,
      trackId: f.tracks[0].id,
      media: "cover",
    };
    const embedded = await resolveAssets(owner, d);
    expect(embedded.diagnostics).toEqual([]);
    expect(embedded.manifest.cover).toMatchObject({
      kind: "image",
      src: `/api/tracks/${f.tracks[0].id}/cover?hash=${embedded.manifest.cover.hash}`,
      width: 1,
      height: 1,
      hasAudio: false,
    });
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { coverArtId: art.id },
    });
    const pool = await resolveAssets(owner, d);
    expect(pool.files.cover.path).toBe(art.filePath);
    expect(await references(owner, d)).toContainEqual({ artId: art.id });
    await expect(deleteArt(owner, art.id)).rejects.toThrow(
      "TOURNAMENT_ASSET_IN_USE",
    );
    expect(await readFile(absPath(art.filePath))).toEqual(png);
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { coverArtId: null },
    });
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { posterArtId: art.id },
    });
    await expect(deleteArt(owner, art.id)).rejects.toThrow(
      "TOURNAMENT_ASSET_IN_USE",
    );
  });
  it("instantiates preset sound anchors once in each source segment", async () => {
    const f = await fixture();
    const preset = structuredClone(
      getBuiltinPresets().find((p) => p.id === "top.classic.wide")!,
    );
    preset.audio = {
      cues: [
        {
          id: "cue",
          asset: "slot:audio:0",
          role: "sfx",
          at: { sec: 0 },
          duration: { sec: 0.1 },
          anchor: { event: "scene.start", sceneId: "main" },
        },
      ],
    };
    const saved = await saveStudioPreset(owner, { name: "Сигнал", preset });
    const project = await createStudioProjectFromPreset(owner, {
      presetId: saved.id,
      sourceId: f.tournament.id,
    });
    const document = structuredClone(project.document);
    document.bindings["slot:audio:0"] = { kind: "builtin", name: "tick" };
    const first = await evaluate(owner, document);
    expect(first.validation).toEqual({ ready: true, diagnostics: [] });
    expect(first.plan!.audio.filter((a) => a.role === "sfx")).toHaveLength(1);
    await prisma.tournamentSegment.update({
      where: { id: f.second.id },
      data: { status: "completed" },
    });
    const added = await evaluate(owner, await reconcileSource(owner, document));
    expect(added.validation).toEqual({ ready: true, diagnostics: [] });
    expect(added.plan!.audio.filter((a) => a.role === "sfx")).toHaveLength(2);
  });
  it("rejects foreign pool covers even when the track belongs to the requester", async () => {
    const f = await fixture();
    const art = await createArt(other, { fileName: "foreign.png", data: png });
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { coverArtId: art.id },
    });
    const d = sourceDocument(f.tournament.id, false);
    d.bindings.cover = {
      kind: "track",
      tournamentId: f.tournament.id,
      trackId: f.tracks[0].id,
      media: "cover",
    };
    await expect(resolveAssets(owner, d)).rejects.toThrow("ASSET_NOT_FOUND");
  });
  it("analyses active snippets in v2 segments and skips authored best moments", async () => {
    const f = await fixture();
    await prisma.tournamentSegment.update({
      where: { id: f.first.id },
      data: { topSize: 2 },
    });
    await prisma.track.update({
      where: { id: f.tracks[0].id },
      data: { bestMomentSec: 0.2 },
    });
    const d = await reconcileSource(owner, sourceDocument(f.tournament.id));
    d.segments![0].settings = {
      top: { snippet: { mode: "active", durationSec: 0.17 } },
    };
    d.formatSettings = {
      wide: { top: { snippet: { mode: "manual", startSec: 0 } } },
    };
    const result = await evaluate(owner, d);
    expect(result.validation).toEqual({ ready: true, diagnostics: [] });
    expect(
      result.resolvedDocument!.segments![0].scenes.map((s) => s.participantId),
    ).toEqual([f.tracks[1].id, f.tracks[0].id]);
    const ordinary = result.resolvedDocument!.segments![0].scenes.find(
      (s) => s.participantId === f.tracks[1].id,
    )!;
    expect(ordinary.settings?.top?.snippet?.activeEndSec).toBeGreaterThan(0);
    expect(
      result.plan!.audio.find((a) => a.id.includes(f.tracks[0].id))
        ?.offsetFrames,
    ).toBe(6);
  });
});
