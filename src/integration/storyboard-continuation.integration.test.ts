import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { createStudioProject, deleteStudioProject, saveStudioDraft } from "@/server/studio/projects";
import { updateTrackMetadata } from "@/server/track-metadata";
import { fileHash } from "@/server/studio/assets";
import { getStudioJob } from "@/server/studio/jobs";
const engine = vi.hoisted(() => ({ id: "a".repeat(64) }));
vi.mock("@/server/studio/engine", async (original) => ({ ...(await original<object>()), prepareStudioEngine: async () => engine.id }));
import { startStudioStoryboard, loadPinnedInspectionProject } from "@/server/studio/storyboard";
let owner: string, other: string;
const directory = `verification/32-storyboard/continuation-${randomUUID()}`;
beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `continuation-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id;
  other = (await prisma.user.create({ data: { email: `continuation-${randomUUID()}@test.local`, passwordHash: "x", role: "user" } })).id;
  await mkdir(absPath(directory), { recursive: true });
});
afterAll(async () => {
  for (const job of await prisma.studioJob.findMany({ where: { userId: owner } })) await removePath(`studio-jobs/${owner}/${job.id}`);
  await prisma.studioJob.deleteMany({ where: { userId: owner } });
  await removePath(`studio-jobs/${owner}`);
  for (const project of await prisma.studioProject.findMany({ where: { userId: owner } })) await deleteStudioProject(owner, project.id);
  await prisma.tournament.deleteMany({ where: { userId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, other].filter(Boolean) } } });
  await removePath(directory);
});
async function fixture(segmented = false) {
  engine.id = "a".repeat(64);
  const token = randomUUID(), covers = [];
  for (const color of ["red", "blue"]) {
    const filePath = `${directory}/${token}-${color}.png`;
    execFileSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=16x16`, "-frames:v", "1", absPath(filePath)]);
    covers.push(await prisma.art.create({ data: { userId: owner, kind: "image", filePath, sizeBytes: (await readFile(absPath(filePath))).length } }));
  }
  const tournament = await prisma.tournament.create({ data: { userId: owner, title: "Cover source", scheme: "merge" } });
  const track = await prisma.track.create({ data: { tournamentId: tournament.id, title: "Source", filePath: covers[0].filePath, kind: "video", order: 0, coverArtId: covers[0].id } });
  const document = createVideoDocument({ kind: "top", participants: [1, 2, 3].map((rank) => ({ id: `p${rank}`, label: `Герой ${rank}`, rank, media: { visual: "cover" } })) });
  document.settings.typography = { version: 1, defaults: { font: "arimo" } };
  if (segmented) { document.schemaVersion = 2; document.segments = [{ id: "pinned-segment", title: "Scope", kind: "top", scenes: document.scenes }]; document.scenes = []; }
  document.bindings.cover = { kind: "track", tournamentId: tournament.id, trackId: track.id, media: "cover" };
  const project = await createStudioProject(owner, { document });
  const state = async () => ({ project: await prisma.studioProject.findUniqueOrThrow({ where: { id: project.id } }), revisions: await prisma.studioRevision.findMany({ where: { projectId: project.id } }), snapshots: await prisma.studioSnapshot.count({ where: { projectId: project.id } }) });
  return { project, document, covers, track, state };
}
async function done(job: Awaited<ReturnType<typeof startStudioStoryboard>>) {
  await prisma.studioJob.update({ where: { id: job.id }, data: { status: "done" } });
  return getStudioJob(owner, job.id);
}
async function continuePage(job: Awaited<ReturnType<typeof startStudioStoryboard>>) {
  const { projectId, ...input } = job.nextPageAction!.arguments;
  return startStudioStoryboard(owner, projectId, input);
}
async function payload(id: string) { return JSON.parse((await prisma.studioJob.findUniqueOrThrow({ where: { id } })).inputJson); }
it("continues page one from page zero's full frozen root after cover changes at the same project version", async () => {
  const f = await fixture(), first = await done(await startStudioStoryboard(owner, f.project.id, { pageSize: 1 })), original = await payload(first.id);
  await updateTrackMetadata(owner, f.track.id, { coverArtId: f.covers[1].id });
  engine.id = "b".repeat(64);
  const before = await f.state();
  expect(before.project.version).toBe(f.project.version);
  const page = await startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1, pageSize: 1 });
  const next = await payload(page.id);
  expect(next.frozen.manifest.cover.hash).toBe(original.frozen.manifest.cover.hash);
  expect(next.frozen.manifest.cover.hash).not.toBe(await fileHash(absPath(f.covers[1].filePath)));
  expect(page.inspection!.origin).toEqual(first.inspection!.origin);
  expect(next.frozen.plan.scenes).toEqual(original.frozen.plan.scenes);
  expect(next.frozen.files.cover.path).toMatch(`studio-jobs/${owner}/${page.id}/inputs/`);
  expect(next.frozen.files.cover.path).not.toBe(original.frozen.files.cover.path);
  for (const file of Object.values(next.frozen.fontFiles) as { path: string }[]) expect(file.path).toMatch(`studio-jobs/${owner}/${page.id}/inputs/`);
  expect(page.engineId).toBe(first.engineId);
  expect(page.inspection!.selection.tiles[0].sceneId).not.toBe(first.inspection!.selection.tiles[0].sceneId);
  expect(await f.state()).toEqual(before);
  await done(page);
  await prisma.studioJob.delete({ where: { id: first.id } }); await removePath(`studio-jobs/${owner}/${first.id}`);
  const last = await done(await startStudioStoryboard(owner, f.project.id, { sourceJobId: page.id, page: 2 }));
  expect(last.inspection!.origin).toEqual(first.inspection!.origin);
  expect(last.inspection!.selection.pageSize).toBe(1); expect(last.nextPageAction).toBeUndefined();
});
it("continues a pinned view after the current draft becomes invalid and validates version against the pinned origin", async () => {
  const f = await fixture(), first = await done(await startStudioStoryboard(owner, f.project.id, { pageSize: 1 }));
  const draft = await saveStudioDraft(owner, f.project.id, { expectedVersion: f.project.version, text: "{" });
  const before = await f.state();
  const page = await startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1, pageSize: 1, expectedVersion: f.project.version });
  expect(page.inspection!.origin).toEqual(first.inspection!.origin); expect(await f.state()).toEqual(before); await done(page);
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 2, expectedVersion: draft.version })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 2, revision: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
it("returns ready page actions retaining scene filters and page size", async () => {
  const f = await fixture(true), first = await done(await startStudioStoryboard(owner, f.project.id, { mode: "scene", sceneId: "main/p3", segmentId: "pinned-segment", pageSize: 1 }));
  expect(first.nextPageAction).toEqual({ tool: "video_storyboard", arguments: { projectId: f.project.id, sourceJobId: first.id, page: 1, pageSize: 1, mode: "scene", sceneId: "main/p3", segmentId: "pinned-segment" } });
  const page = await done(await continuePage(first));
  expect(page.inspection!.selection.totalScenes).toBe(1);
  expect(page.inspection!.selection.tiles.every((tile) => tile.sceneId === "main/p3" && tile.segmentId === "pinned-segment")).toBe(true);
});
it("continues compare pages with both frozen origins without resolving either current draft or history again", async () => {
  const f = await fixture();
  await updateTrackMetadata(owner, f.track.id, { coverArtId: f.covers[1].id });
  const first = await done(await startStudioStoryboard(owner, f.project.id, { mode: "compare", compareRevision: 1, pageSize: 2 })), original = await payload(first.id);
  expect(first.nextPageAction?.arguments).toMatchObject({ mode: "compare", sourceJobId: first.id, pageSize: 2 });
  expect(first.nextPageAction!.arguments).not.toHaveProperty("compareRevision");
  await saveStudioDraft(owner, f.project.id, { expectedVersion: f.project.version, text: "{" });
  const page = await done(await continuePage(first)), next = await payload(page.id);
  expect(page.inspection!.origin).toEqual(first.inspection!.origin);
  expect(page.inspection!.compareOrigin).toEqual(first.inspection!.compareOrigin);
  expect(next.frozen.manifest.cover.hash).toBe(original.frozen.manifest.cover.hash);
  expect(next.compareFrozen.manifest.cover.hash).toBe(original.compareFrozen.manifest.cover.hash);
});
it("rejects foreign/deleted/non-storyboard source jobs and corrupted frozen payload or copied bytes", async () => {
  const f = await fixture(), first = await done(await startStudioStoryboard(owner, f.project.id, { pageSize: 1 }));
  await expect(startStudioStoryboard(other, f.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const otherProject = await fixture();
  await expect(startStudioStoryboard(owner, otherProject.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "INSPECTION_SOURCE_NOT_FOUND" });
  const plain = await prisma.studioJob.create({ data: { userId: owner, projectId: f.project.id, kind: "still", engineId: "a".repeat(64), inputJson: "{}", status: "done" } });
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: plain.id, page: 1 })).rejects.toMatchObject({ code: "INSPECTION_SOURCE_NOT_FOUND" });
  const original = await payload(first.id), changed = structuredClone(original); changed.frozen.plan.seed++;
  await prisma.studioJob.update({ where: { id: first.id }, data: { inputJson: JSON.stringify(changed) } });
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });
  await prisma.studioJob.update({ where: { id: first.id }, data: { inputJson: JSON.stringify(original) } });
  const file = absPath(original.frozen.files.cover.path), bytes = await readFile(file); await writeFile(file, Buffer.concat([bytes, Buffer.from("bad")]));
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });
  await writeFile(file, bytes);
  const font = Object.values(original.frozen.fontFiles)[0] as { path: string }, fontPath = absPath(font.path), fontBytes = await readFile(fontPath);
  await writeFile(fontPath, Buffer.concat([fontBytes, Buffer.from("bad")]));
  try { await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" }); }
  finally { await writeFile(fontPath, fontBytes); }
  await prisma.studioJob.delete({ where: { id: first.id } });
  await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: first.id, page: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("loads the exact pinned inspection for review after an invalid current draft and engine change", async () => {
  const f = await fixture(), first = await done(await startStudioStoryboard(owner, f.project.id, { pageSize: 1 }));
  const original = await payload(first.id);
  await updateTrackMetadata(owner, f.track.id, { coverArtId: f.covers[1].id });
  await saveStudioDraft(owner, f.project.id, { expectedVersion: f.project.version, text: "{" });
  engine.id = "b".repeat(64);
  const before = await f.state(), pinned = await loadPinnedInspectionProject(owner, f.project.id, first.id, { expectedVersion: f.project.version });
  expect(pinned.prepared.pinned).toBe(true);
  expect(pinned.prepared.plan).toEqual(original.frozen.plan);
  expect(pinned.prepared.manifest.cover.hash).toBe(original.frozen.manifest.cover.hash);
  expect(pinned.prepared.origin).toEqual(first.inspection!.origin);
  expect(pinned.engineId).toBe(first.engineId);
  expect(pinned.summary).toEqual(first.inspection);
  expect(pinned.input).toEqual(original);
  expect(await f.state()).toEqual(before);
});
it("allows clip/audio inspection roots for pinned review while storyboard continuation still requires a sheet root", async () => {
  const f = await fixture(), first = await done(await startStudioStoryboard(owner, f.project.id, { pageSize: 1 })), original = await payload(first.id);
  for (const kind of ["clip", "audio"] as const) {
    const input = { ...structuredClone(original), render: { kind, fromFrame: 0, durationFrames: 10 } };
    const row = await prisma.studioJob.create({ data: { userId: owner, projectId: f.project.id, kind, engineId: first.engineId, status: "done", inputJson: JSON.stringify(input) } });
    const pinned = await loadPinnedInspectionProject(owner, f.project.id, row.id);
    expect(pinned.prepared.plan.scenes).toHaveLength(3);
    expect(pinned.prepared.frozen).toEqual(original.frozen);
    expect(pinned.engineId).toBe(first.engineId);
    await expect(startStudioStoryboard(owner, f.project.id, { sourceJobId: row.id, page: 1 })).rejects.toMatchObject({ code: "INSPECTION_SOURCE_NOT_FOUND" });
  }
  await expect(loadPinnedInspectionProject(other, f.project.id, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const plain = await prisma.studioJob.create({ data: { userId: owner, projectId: f.project.id, kind: "import", engineId: first.engineId, status: "done", inputJson: "{}" } });
  await expect(loadPinnedInspectionProject(owner, f.project.id, plain.id)).rejects.toMatchObject({ code: "INSPECTION_SOURCE_NOT_FOUND" });
});
it("validates the saved comparison side in the generic pinned inspection loader", async () => {
  const f = await fixture();
  await updateTrackMetadata(owner, f.track.id, { coverArtId: f.covers[1].id });
  const first = await done(await startStudioStoryboard(owner, f.project.id, { mode: "compare", compareRevision: 1, pageSize: 2 }));
  const original = await payload(first.id), pinned = await loadPinnedInspectionProject(owner, f.project.id, first.id);
  expect(pinned.input.compareFrozen).toEqual(original.compareFrozen);
  expect(pinned.summary.compareOrigin).toEqual(first.inspection!.compareOrigin);
  const corrupt = structuredClone(original); corrupt.compareFrozen.plan.seed++;
  await prisma.studioJob.update({ where: { id: first.id }, data: { inputJson: JSON.stringify(corrupt) } });
  await expect(loadPinnedInspectionProject(owner, f.project.id, first.id)).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });
});
