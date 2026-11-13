import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video";
import * as studio from "@/server/studio";
import { ownedStudioMedia } from "@/server/studio/http-media";
import { loadPublicWatch, publicWatchMedia } from "@/server/studio/watch-public";

let owner: string;
beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `font-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id;
});
afterAll(async () => {
  if (!owner) return;
  for (const project of await studio.listStudioProjects(owner)) await studio.deleteStudioProject(owner, project.id);
  await prisma.user.delete({ where: { id: owner } });
  await removePath(`studio/${owner}`);
});

it("preserves selected measured font bytes in revisions, snapshots, public watch and standalone HTML", async () => {
  const document = createVideoDocument({ kind: "top", title: "Pinned typography", participants: [] });
  document.schemaVersion = 1;
  delete document.segments;
  document.scenes = [{ id: "text-scene", block: "custom", duration: { sec: 1 }, nodes: [
    { id: "text", type: "text", text: "Ария 東京", rect: { x: 0.05, y: 0.05, width: 0.9, height: 0.3 }, typography: { font: "arimo", weight: 700, fontSize: 60, minFontSize: 20 } },
    { id: "regular", type: "text", text: "Arimo regular", rect: { x: 0.05, y: 0.5, width: 0.9, height: 0.3 }, typography: { font: "arimo", weight: 400, fontSize: 40, minFontSize: 20 } },
  ] }];
  const project = await studio.createStudioProject(owner, { document, idempotencyKey: randomUUID() });
  expect(project.validation.diagnostics).toEqual([]);
  expect(project.plan?.fonts?.map((font) => font.id).sort()).toEqual(["arimo-400-normal", "arimo-700-normal", "noto-sans-jp-700-normal"]);
  const frozen = await studio.freezeStudioProject(owner, project.id);
  expect(Object.keys(frozen.fontFiles ?? {})).toHaveLength(4);
  const face = frozen.plan.fonts![0];
  const file = frozen.fontFiles![face.hash];
  expect(await ownedStudioMedia(owner, file.path)).toMatchObject({ mimeType: "font/ttf" });
  const publication = await studio.publishStudioProject(owner, project.id, { idempotencyKey: randomUUID() });
  const watch = await loadPublicWatch(publication.token);
  expect(watch.ok).toBe(true);
  if (!watch.ok) return;
  expect(watch.plan.fonts![0].src).toMatch(/^\/api\/watch\//);
  const publicName = `${face.hash}.ttf`;
  const response = await publicWatchMedia(publication.token, publicName, new Request("http://localhost/font"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("font/ttf");
  expect((await response.arrayBuffer()).byteLength).toBe(face.bytes);
  const estimate = await studio.estimateStudioExport(owner, project.id);
  const download = await studio.streamStudioExport(owner, project.id);
  const data = new Uint8Array(await download.arrayBuffer());
  expect(data.length).toBe(estimate.bytes);
  const html = new TextDecoder().decode(data);
  expect(html).toContain(`id="font-${face.hash}" data-mime="font/ttf"`);
  expect(html.split(`id="font-${face.hash}"`).length - 1).toBe(1);
  expect(html).toContain("data-mime=\"text/plain\"");
  expect(html).not.toContain('data:font/woff2');
  expect(html).toContain('slice:font-');
  await studio.unpublishStudioProject(owner, project.id, { idempotencyKey: randomUUID() });
});

it.each(["text", "badge", "card"] as const)("measures a rich-only %s through the saved project service", async (type) => {
  const document = createVideoDocument({ kind: "top", participants: [{ id: "participant", label: "Имя" }] });
  document.schemaVersion = 1;
  delete document.segments;
  delete document.settings.typography;
  const rich = { runs: [{ text: "Имя", color: "yellow", weight: 400 as const }] };
  const base = { id: "rich-only", rect: { x: 0.05, y: 0.05, width: 0.9, height: 0.8 } };
  const node = type === "card"
    ? { ...base, type, participantId: "participant", label: rich }
    : type === "badge"
      ? { ...base, type, kind: "label" as const, text: rich }
      : { ...base, type, text: rich };
  document.scenes = [{ id: "rich-scene", block: "custom", duration: { sec: 1 }, nodes: [node] }];
  const project = await studio.createStudioProject(owner, { document, idempotencyKey: randomUUID() });
  expect(project.validation.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("TEXT_LAYOUT_REQUIRED");
  expect(project.validation).toMatchObject({ ready: true });
  expect(project.validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const measured = project.plan?.scenes[0].nodes.find((candidate) => candidate.id.endsWith("rich-only"));
  expect(measured?.textLayout?.lines[0].runs[0]).toMatchObject({ text: "Имя", color: "yellow", weight: 400 });
  expect(measured?.textLayout?.lines[0].width).toBeGreaterThan(0);
  const frozen = await studio.freezeStudioProject(owner, project.id);
  expect(frozen.plan.fonts?.map((face) => face.id)).toContain("arimo-400-normal");
  expect(Object.keys(frozen.fontFiles ?? {})).toHaveLength(2);
});
