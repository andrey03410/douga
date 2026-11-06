import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { createStudioProject, deleteStudioProject, saveStudioDraft } from "@/server/studio/projects";
import { startStudioStoryboard, getStoryboardFrame } from "@/server/studio/storyboard";
import { getStudioJob } from "@/server/studio/jobs";
import { runStudioWorkerOnce } from "@/server/studio/worker";
import { fileHash } from "@/server/studio/assets";
import { readPngImage } from "@/server/studio/image-pixels";
let userId: string;
beforeAll(async () => { userId = (await prisma.user.create({ data: { email: `pixel-diff-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id; });
afterAll(async () => {
  await prisma.studioJob.deleteMany({ where: { userId } });
  for (const project of await prisma.studioProject.findMany({ where: { userId } })) await deleteStudioProject(userId, project.id);
  await prisma.user.delete({ where: { id: userId } }); await removePath(`studio-jobs/${userId}`);
});
async function fixture() {
  const document = createVideoDocument({ kind: "top", participants: [] });
  document.scenes = ["first", "second"].map((id) => ({ id, block: "custom" as const, duration: { sec: 2 }, nodes: [{ id: `${id}-fill`, type: "shape" as const, shape: "rect" as const, fill: "#ff0000", rect: { x: 0, y: 0, width: 1, height: 1 } }] }));
  return { document, project: await createStudioProject(userId, { document }) };
}
it("counts real diff PNGs in the frame ledger and returns measured content difference through an addressed worker", async () => {
  const { document, project } = await fixture();
  (document.scenes[0].nodes[0] as { fill: string }).fill = "#0000ff";
  const draft = await saveStudioDraft(userId, project.id, { expectedVersion: project.version, document });
  const before = await prisma.studioProject.findUniqueOrThrow({ where: { id: project.id } });
  const queued = await startStudioStoryboard(userId, project.id, { expectedVersion: draft.version, mode: "compare", compareRevision: 1, pageSize: 3, pixelDiff: true });
  expect(queued.inspection!.selection.tiles).toHaveLength(3);
  expect(await runStudioWorkerOnce({ jobId: queued.id })).not.toBeNull();
  const done = await getStudioJob(userId, queued.id);
  expect(done.status, done.error ?? undefined).toBe("done");
  const result = done.result!; expect(result.kind).toBe("storyboard");
  if (result.kind !== "storyboard") throw new Error("Expected storyboard result");
  expect(result.storyboard!.pixelComparisons).toMatchObject([{ status: "different", metrics: { maxDelta: 255 } }]);
  expect(result.storyboard!.pixelComparisons![0].metrics!.changedPixelRatio).toBeGreaterThan(0.99);
  const diff = result.storyboard!.frames.find((f) => f.side === "diff")!;
  expect(diff.id).toBe("2"); expect(result.storyboard!.frames).toHaveLength(3);
  const resource = await getStoryboardFrame(userId, done.id, diff.id);
  expect(await fileHash(resource.path)).toBe(diff.hash);
  const image = await readPngImage(resource.path); expect(image.width).toBe(720); expect(image.height).toBe(405);
  const center = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  expect(image.data[center]).toBe(255); expect(image.data[center + 1]).toBe(0); expect(image.data[center + 2]).toBe(255);
  expect(result.storageBytes).toBe(result.resource.bytes + result.storyboard!.frames.reduce((sum, frame) => sum + frame.bytes, 0));
  expect(done.nextPageAction?.arguments).toMatchObject({ sourceJobId: done.id, pixelDiff: true, pageSize: 3, mode: "compare" });
  expect(await prisma.studioProject.findUniqueOrThrow({ where: { id: project.id } })).toEqual(before);
}, 120_000);
it("enforces total tile budgets and inherits optional pixelDiff for frozen continuation", async () => {
  const { project } = await fixture();
  await expect(startStudioStoryboard(userId, project.id, { pixelDiff: true })).rejects.toThrow();
  await expect(startStudioStoryboard(userId, project.id, { mode: "compare", compareRevision: 1, pixelDiff: true, pageSize: 2 })).rejects.toThrow();
  await expect(startStudioStoryboard(userId, project.id, { mode: "compare", compareRevision: 1, pageSize: 1 })).rejects.toThrow();
  const first = await startStudioStoryboard(userId, project.id, { mode: "compare", compareRevision: 1, pixelDiff: true, pageSize: 3 });
  const next = await startStudioStoryboard(userId, project.id, { sourceJobId: first.id, page: 1 });
  expect(next.inspection!.scope).toMatchObject({ pixelDiff: true, pageSize: 3 }); expect(next.inspection!.selection.tiles).toHaveLength(3);
  expect(next.inspection!.selection.tiles[2]).toMatchObject({ side: "diff", source: 2 });
  await expect(startStudioStoryboard(userId, project.id, { sourceJobId: first.id, page: 1, pageSize: 2 })).rejects.toThrow();
});
