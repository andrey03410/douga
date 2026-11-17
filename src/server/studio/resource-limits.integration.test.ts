import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video";
import { estimateVideoResources } from "@douga/video/resource-limits";
import { largeKeyframeDocument, largePickerDocument } from "@douga/video/resource-limits.test-fixtures";
import { createStudioProject, saveStudioDraft, commitStudioDraft, getStudioProject, deleteStudioProject } from "./projects";

let owner: string;
const projects: string[] = [];
beforeAll(async () => {
  owner = (await prisma.user.create({ data: {
    email: `resource-budgets-${randomUUID()}@test.local`, passwordHash: "x",
  } })).id;
});
afterAll(async () => {
  if (!owner) return;
  for (const project of projects) await deleteStudioProject(owner, project);
  await prisma.user.delete({ where: { id: owner } });
  await removePath(`studio/${owner}`);
});

it("saves, commits and reads over one million valid explicit keyframe values", async () => {
  const initial = await createStudioProject(owner, { document: createVideoDocument({ kind: "top" }) });
  projects.push(initial.id);
  const document = largeKeyframeDocument();
  expect(estimateVideoResources(document).authoredValues).toBeGreaterThan(1_000_000);
  const text = JSON.stringify(document);
  expect(Buffer.byteLength(text)).toBeGreaterThan(2_000_000);
  const draft = await saveStudioDraft(owner, initial.id, { expectedVersion: initial.version, text });
  expect(draft.validation.ready).toBe(true);
  expect(draft.draft?.document).toEqual(document);
  const committed = await commitStudioDraft(owner, initial.id, { expectedVersion: draft.version });
  expect(committed.validation.ready).toBe(true);
  expect(committed.revision).toBe(2);
  expect(committed.draft).toBeNull();
  const read = await getStudioProject(owner, initial.id);
  expect(read.document).toEqual(document);
  expect(read.plan?.scenes[0].nodes.find((node) => node.id.endsWith("text-99"))?.animation[0].keyframes).toHaveLength(2600);
  const revision = await prisma.studioRevision.findUniqueOrThrow({ where: {
    projectId_revision: { projectId: initial.id, revision: 2 },
  } });
  expect(JSON.parse(revision.documentJson)).toEqual(document);
}, 60_000);

it("persists every card and round OST in a 300 by 6 picker through commit", async () => {
  const document = largePickerDocument();
  const project = await createStudioProject(owner, { document });
  projects.push(project.id);
  expect(project.validation.ready).toBe(true);
  const draft = await saveStudioDraft(owner, project.id, {
    expectedVersion: project.version, document: { ...document, title: "300 раундов, шесть карточек и OST" },
  });
  const committed = await commitStudioDraft(owner, project.id, { expectedVersion: draft.version });
  const read = await getStudioProject(owner, project.id);
  expect(read.revision).toBe(committed.revision);
  expect(read.document.source.rounds).toHaveLength(300);
  expect(read.document.source.rounds.every((round) => round.cards.length === 6 && round.groups?.length === 3 && round.music === "ost")).toBe(true);
  expect(read.plan?.scenes.flatMap((scene) => scene.nodes).filter((node) => node.type === "card")).toHaveLength(1800);
  expect(read.plan?.audio.filter((cue) => cue.role === "music")).toHaveLength(300);
}, 60_000);

it("preserves the existing draft and version when either save representation exceeds 32 MiB", async () => {
  const project = await createStudioProject(owner, { document: createVideoDocument({ kind: "top" }) });
  projects.push(project.id);
  const draft = await saveStudioDraft(owner, project.id, { expectedVersion: project.version, text: "{ unfinished" });
  const huge = "x".repeat(32 * 1024 * 1024 + 1);
  await expect(saveStudioDraft(owner, project.id, { expectedVersion: draft.version, text: huge })).rejects.toThrow(/serializedBytes/);
  await expect(saveStudioDraft(owner, project.id, { expectedVersion: draft.version, document: { huge } })).rejects.toMatchObject({ code: "DOCUMENT_TOO_LARGE" });
  const read = await getStudioProject(owner, project.id);
  expect(read.version).toBe(draft.version);
  expect(read.revision).toBe(draft.revision);
  expect(read.draft).toEqual(draft.draft);
  expect(read.plan).toEqual(draft.plan);
}, 30_000);
