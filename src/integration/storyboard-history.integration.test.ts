import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";
import { createStudioProjectFromPreset, deleteStudioProject } from "@/server/studio/projects";
import { updateTrackMetadata } from "@/server/track-metadata";
import { fileHash } from "@/server/studio/assets";
vi.mock("@/server/studio/engine", async (original) => ({ ...(await original<object>()), prepareStudioEngine: async () => "a".repeat(64) }));
import { loadInspectionProject, startStudioStoryboard } from "@/server/studio/storyboard";
let owner: string, other: string;
const directory = `verification/32-storyboard/history-${randomUUID()}`;
beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `history-owner-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id;
  other = (await prisma.user.create({ data: { email: `history-other-${randomUUID()}@test.local`, passwordHash: "x", role: "user" } })).id;
  await mkdir(absPath(directory), { recursive: true });
});
afterAll(async () => {
  for (const job of await prisma.studioJob.findMany({ where: { userId: owner } })) await removePath(`studio-jobs/${owner}/${job.id}`);
  await prisma.studioJob.deleteMany({ where: { userId: owner } });
  for (const project of await prisma.studioProject.findMany({ where: { userId: owner } })) await deleteStudioProject(owner, project.id);
  await prisma.tournament.deleteMany({ where: { userId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, other].filter(Boolean) } } });
  await removePath(directory);
});
async function fixture() {
  const token = randomUUID(), covers = [];
  for (const color of ["red", "blue"]) {
    const filePath = `${directory}/${token}-${color}.png`;
    execFileSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=16x16`, "-frames:v", "1", absPath(filePath)]);
    covers.push(await prisma.art.create({ data: { userId: owner, kind: "image", filePath, label: color, sizeBytes: (await readFile(absPath(filePath))).length } }));
  }
  const wav = Buffer.alloc(44 + 16000); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  const audioPath = `${directory}/${token}.wav`; await saveFile(audioPath, wav);
  const tournament = await prisma.tournament.create({ data: { userId: owner, title: "Historical media", scheme: "merge", status: "completed", topSize: 1 } });
  const segment = await prisma.tournamentSegment.create({ data: { tournamentId: tournament.id, title: "Saved source", order: 0, status: "completed", topSize: 1 } });
  const track = await prisma.track.create({ data: { tournamentId: tournament.id, segmentId: segment.id, title: "Оригинальный трек / 光", filePath: audioPath, kind: "audio", durationSec: 1, order: 0, coverArtId: covers[0].id } });
  await prisma.ranking.create({ data: { tournamentId: tournament.id, segmentId: segment.id, trackId: track.id, rank: 1, score: 1 } });
  const project = await createStudioProjectFromPreset(owner, { presetId: "recipe.clean.top.wide", sourceId: tournament.id });
  const revision = await prisma.studioRevision.findUniqueOrThrow({ where: { projectId_revision: { projectId: project.id, revision: 1 } } });
  const assets = JSON.parse(revision.assetsJson!), plan = JSON.parse(revision.planJson!);
  const coverKey = Object.keys(assets.manifest).find((key) => assets.manifest[key].kind === "image")!;
  expect(assets.manifest[coverKey].hash).toBe(await fileHash(absPath(covers[0].filePath)));
  await updateTrackMetadata(owner, track.id, { coverArtId: covers[1].id });
  const state = async () => ({ project: await prisma.studioProject.findUniqueOrThrow({ where: { id: project.id } }), revisions: await prisma.studioRevision.findMany({ where: { projectId: project.id }, orderBy: { revision: "asc" } }), snapshots: await prisma.studioSnapshot.count({ where: { projectId: project.id } }), source: await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id }, include: { tracks: true, rankings: true, segments: true } }) });
  return { project, revision, assets, plan, coverKey, covers, state };
}
it("reads immutable revision cover A while live current draft resolves changed cover B without reconciling source", async () => {
  const f = await fixture(), before = await f.state();
  const historical = await loadInspectionProject(owner, f.project.id, { revision: 1 });
  expect(historical.manifest[f.coverKey].hash).toBe(f.assets.manifest[f.coverKey].hash);
  expect(historical.files).toEqual(f.assets.files);
  expect(historical.plan).toEqual(f.plan);
  expect(historical.resolvedDocument).toEqual(f.assets.resolvedDocument);
  expect(historical.frozen.fontFiles).toEqual(f.assets.fontFiles);
  const current = await loadInspectionProject(owner, f.project.id, {});
  expect(current.manifest[f.coverKey].hash).toBe(await fileHash(absPath(f.covers[1].filePath)));
  expect(current.origin.contentHash).not.toBe(historical.origin.contentHash);
  expect(historical.origin.revision).toBe(1); expect(historical.origin.version).toBeNull();
  expect(await f.state()).toEqual(before);
});
it("pins compareRevision to saved cover A and current side to B", async () => {
  const f = await fixture(), before = await f.state();
  const job = await startStudioStoryboard(owner, f.project.id, { mode: "compare", compareRevision: 1 });
  const stored = await prisma.studioJob.findUniqueOrThrow({ where: { id: job.id } }), input = JSON.parse(stored.inputJson);
  expect(input.compareFrozen.manifest[f.coverKey].hash).toBe(f.assets.manifest[f.coverKey].hash);
  expect(input.frozen.manifest[f.coverKey].hash).toBe(await fileHash(absPath(f.covers[1].filePath)));
  expect(input.compareFrozen.plan).toEqual(f.plan);
  expect(await f.state()).toEqual(before);
});
it("fails explicitly for missing historical plans or erroneous saved validation", async () => {
  const f = await fixture();
  await prisma.studioRevision.update({ where: { id: f.revision.id }, data: { planJson: null } });
  await expect(loadInspectionProject(owner, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await prisma.studioRevision.update({ where: { id: f.revision.id }, data: { planJson: JSON.stringify(f.plan), validationJson: JSON.stringify({ ready: false, diagnostics: [{ severity: "error", code: "SAVED_INVALID", message: "Saved failure", path: "document" }] }) } });
  await expect(loadInspectionProject(owner, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("verifies saved media and font bytes instead of accepting current replacements", async () => {
  const f = await fixture(), file = absPath(f.assets.files[f.coverKey].path), original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from("corrupt")]));
  await expect(loadInspectionProject(owner, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });
  await writeFile(file, original);
  const font = Object.values(f.assets.fontFiles)[0] as { path: string }, fontPath = absPath(font.path), bytes = await readFile(fontPath);
  await writeFile(fontPath, Buffer.concat([bytes, Buffer.from("corrupt")]));
  try { await expect(loadInspectionProject(owner, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" }); }
  finally { await writeFile(fontPath, bytes); }
});
it("checks project and pinned revision-media ownership", async () => {
  const f = await fixture();
  await expect(loadInspectionProject(other, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await prisma.art.update({ where: { id: f.covers[0].id }, data: { userId: other } });
  try { await expect(loadInspectionProject(owner, f.project.id, { revision: 1 })).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" }); }
  finally { await prisma.art.update({ where: { id: f.covers[0].id }, data: { userId: owner } }); }
});
