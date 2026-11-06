import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { createStudioProject, deleteStudioProject, saveStudioDraft } from "@/server/studio/projects";
vi.mock("@/server/studio/engine", async (original) => ({
  ...(await original<object>()),
  prepareStudioEngine: async () => "a".repeat(64),
}));
import { startStudioStoryboard, loadInspectionProject, getStoryboardFrame } from "@/server/studio/storyboard";
import { verifyTypographyFonts } from "@/server/studio/typography-fonts";
import { reviewStudioVideo, applyStudioReview } from "@/server/studio/review";

let uid: string, other: string, pid: string;
beforeAll(async () => {
  uid = (await prisma.user.create({ data: { email: `storyboard-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id;
  other = (await prisma.user.create({ data: { email: `storyboard-other-${randomUUID()}@test.local`, passwordHash: "x", role: "user" } })).id;
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.scenes = [{ id: "intro", block: "custom", duration: { sec: 3 }, nodes: [{ id: "title", type: "text", text: "Раскадровка — 残酷な天使", rect: { x: .1, y: .2, width: .8, height: .3 } }] }];
  pid = (await createStudioProject(uid, { document })).id;
});
afterAll(async () => {
  for (const job of await prisma.studioJob.findMany({ where: { userId: uid } })) await removePath(`studio-jobs/${uid}/${job.id}`);
  await prisma.studioJob.deleteMany({ where: { userId: uid } });
  if (pid) await deleteStudioProject(uid, pid);
  await prisma.user.deleteMany({ where: { id: { in: [uid, other].filter(Boolean) } } });
});
it("enqueues one pinned grid without reconciling, committing or changing a draft", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({ where: { id: pid } });
  const p = await saveStudioDraft(uid, pid, { expectedVersion: before.version, document: JSON.parse(before.documentJson) });
  const snapshot = await prisma.studioProject.findUniqueOrThrow({ where: { id: pid } });
  const job = await startStudioStoryboard(uid, pid, { expectedVersion: p.version });
  expect(job.kind).toBe("storyboard");
  expect(job.status).toBe("queued");
  expect(job.inspection?.origin.version).toBe(p.version);
  expect(job.inspection?.selection.scenesCovered).toBe(1);
  const after = await prisma.studioProject.findUniqueOrThrow({ where: { id: pid } });
  expect(after).toEqual(snapshot);
  expect(await prisma.studioSnapshot.count({ where: { projectId: pid } })).toBe(0);
  const repeat = await startStudioStoryboard(uid, pid, { expectedVersion: p.version });
  expect(repeat.id).toBe(job.id);
});
it("refuses wrong actor/version, including frame access", async () => {
  const p = await prisma.studioProject.findUniqueOrThrow({ where: { id: pid } });
  await expect(startStudioStoryboard(other, pid, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(startStudioStoryboard(uid, pid, { expectedVersion: p.version + 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const job = await startStudioStoryboard(uid, pid, {});
  await expect(getStoryboardFrame(other, job.id, "0")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getStoryboardFrame(uid, job.id, "../inputs")).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("pins real recipe font and license bytes with the inspection input", async () => {
  const document = createVideoDocument({ kind: "top", presetId: "recipe.clean.top.wide" });
  const project = await createStudioProject(uid, { document });
  try {
    const job = await startStudioStoryboard(uid, project.id, {});
    const stored = await prisma.studioJob.findUniqueOrThrow({ where: { id: job.id } });
    const { frozen } = JSON.parse(stored.inputJson);
    expect(frozen.plan.fonts.length).toBeGreaterThan(0);
    await expect(verifyTypographyFonts(frozen.plan.fonts, frozen.fontFiles)).resolves.toBeUndefined();
  } finally {
    const jobs = await prisma.studioJob.findMany({ where: { projectId: project.id } });
    for (const j of jobs) { await prisma.studioJob.delete({ where: { id: j.id } }); await removePath(`studio-jobs/${uid}/${j.id}`); }
    await deleteStudioProject(uid, project.id);
  }
});
it("labels the allowed overflowing-text image as diagnostic, never ordinary ready output", async () => {
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.settings.typography = { theme: "clean" };
  document.scenes = [{ id: "diagnostic", block: "custom", duration: { sec: 3 }, nodes: [{ id: "label", type: "text", text: "Имя", units: "px", rect: { x: 100, y: 100, width: 100, height: 50 }, typography: { role: "label", fontSize: 32, minFontSize: 20, fit: "fixed", maxLines: 1 } }] }];
  const project = await createStudioProject(uid, { document });
  try {
    const label = document.scenes[0].nodes[0];
    if (label.type !== "text") throw new Error("Expected text fixture");
    label.text = "Очень длинное имя ".repeat(100);
    const draft = await saveStudioDraft(uid, project.id, { expectedVersion: project.version, document });
    expect(draft.validation.ready).toBe(false);
    const job = await startStudioStoryboard(uid, project.id, { expectedVersion: draft.version });
    expect(job.inspection?.diagnostic).toMatchObject({ ready: false, codes: ["TEXT_OVERFLOW"] });
  } finally {
    for (const job of await prisma.studioJob.findMany({ where: { projectId: project.id } })) {
      await prisma.studioJob.delete({ where: { id: job.id } }); await removePath(`studio-jobs/${uid}/${job.id}`);
    }
    await deleteStudioProject(uid, project.id);
  }
});
it("never substitutes a last-good preview for malformed current JSON", async () => {
  const p = await prisma.studioProject.findUniqueOrThrow({ where: { id: pid } });
  await saveStudioDraft(uid, pid, { expectedVersion: p.version, text: "{" });
  await expect(startStudioStoryboard(uid, pid, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(loadInspectionProject(uid, pid, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const historical = await loadInspectionProject(uid, pid, { revision: 1 });
  expect(historical.origin.revision).toBe(1);
  expect(historical.plan.scenes[0].id).toBe("intro");
});
it("rechecks a real authoring fix and replays it without a second mutation", async () => {
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.settings.typography = { theme: "clean" };
  document.scenes = [{ id: "review", block: "custom", duration: { sec: 5 }, nodes: [{ id: "label", type: "text", text: "Имя героя", rect: { x: .1, y: .2, width: .8, height: .2 }, typography: { role: "label", font: "rubik", fontSize: 36 } }] }];
  const project = await createStudioProject(uid, { document });
  try {
    const before = await prisma.studioProject.findUniqueOrThrow({ where: { id: project.id } });
    const report = await reviewStudioVideo(uid, project.id, { expectedVersion: project.version });
    expect(await prisma.studioProject.findUnique({ where: { id: project.id } })).toEqual(before);
    const beforeJob = await startStudioStoryboard(uid, project.id, { expectedVersion: project.version });
    const suggestion = report.suggestions.find(s => s.kind === "return-label-theme")!;
    expect(suggestion).toBeDefined();
    const input = { expectedVersion: project.version, reportId: report.reportId, suggestionIds: [suggestion.id], idempotencyKey: randomUUID() };
    const fixed = await applyStudioReview(uid, project.id, input);
    const repeat = await applyStudioReview(uid, project.id, input);
    expect(repeat.version).toBe(fixed.version);
    expect(fixed.revision).toBe(project.revision);
    const after = await reviewStudioVideo(uid, project.id, { expectedVersion: fixed.version });
    expect(after.issues.some(i => i.code === "LABEL_THEME_OVERRIDE")).toBe(false);
    const draft = fixed.draft!.document as typeof document;
    expect(draft.scenes[0].nodes[0]).toMatchObject({ text: "Имя героя" });
    expect(draft.source).toEqual(document.source);
    expect(draft.bindings).toEqual(document.bindings);
    const comparison = await startStudioStoryboard(uid, project.id, { expectedVersion: fixed.version, mode: "compare", compareJobId: beforeJob.id });
    expect(comparison.inspection?.comparison?.changesTotal).toBeGreaterThan(0);
    expect(comparison.inspection?.comparison?.resolvedIssues.some(i => i.code === "LABEL_THEME_OVERRIDE")).toBe(true);
    await expect(applyStudioReview(uid, project.id, { ...input, expectedVersion: fixed.version, idempotencyKey: undefined })).rejects.toMatchObject({ code: "REVIEW_STALE" });
  } finally {
    for (const job of await prisma.studioJob.findMany({ where: { projectId: project.id } })) {
      await prisma.studioJob.delete({ where: { id: job.id } }); await removePath(`studio-jobs/${uid}/${job.id}`);
    }
    await deleteStudioProject(uid, project.id);
  }
});
