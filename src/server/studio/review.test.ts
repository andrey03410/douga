import { beforeEach, expect, it, vi } from "vitest";
import { createVideoDocument, compileVideo } from "@/video";
const mocks = vi.hoisted(() => ({ load: vi.fn(), pinned: vi.fn(), owned: vi.fn(), enqueue: vi.fn(), transform: vi.fn() }));
vi.mock("./storyboard", () => ({ loadInspectionProject: mocks.load, loadPinnedInspectionProject: mocks.pinned, enqueueInspection: mocks.enqueue }));
vi.mock("./shared", async original => ({ ...(await original<object>()), owned: mocks.owned }));
vi.mock("./projects", () => ({ transformStudioDraft: mocks.transform }));
vi.mock("./engine", () => ({ prepareStudioEngine: async () => "a".repeat(64) }));
import { reviewStudioVideo, applyStudioReview } from "./review";
import { getTypographyMeasureText } from "./typography-fonts";
beforeEach(() => {
  vi.clearAllMocks();
  const document = createVideoDocument({ kind: "picker", roundCount: 1, cardsPerRound: 2 });
  const { plan } = compileVideo(document, {});
  mocks.load.mockResolvedValue({ document, plan, validation: { ready: true, diagnostics: [] }, origin: { projectId: "p", version: 3, revision: null, documentHash: "d", contentHash: "c", format: { width: 1920, height: 1080, fps: 30 } }, projectVersion: 3 });
  mocks.owned.mockResolvedValue({ version: 3 });
});
it("returns a pinned compact report and honest unperformed motion/audio checks", async () => {
  const report = await reviewStudioVideo("u", "p", { expectedVersion: 3 });
  expect(report.origin.version).toBe(3);
  expect(report.reportId).toMatch(/^[a-f0-9]{64}$/);
  expect(report.checks.some(c => c.id === "motion" && c.status === "notChecked")).toBe(true);
  expect(report.checks.some(c => c.id === "audio" && c.status === "notChecked")).toBe(true);
  expect(mocks.transform).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("refuses a report from another document before mutating the draft", async () => {
  await expect(applyStudioReview("u", "p", { expectedVersion: 3, reportId: "0".repeat(64), suggestionIds: ["fake"] })).rejects.toMatchObject({ code: "REVIEW_STALE" });
  expect(mocks.transform).not.toHaveBeenCalled();
});
it("does not offer a compact-label candidate that cannot resolve the measured overflow", async () => {
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.settings.typography = { theme: "clean" };
  document.scenes = [{ id: "tiny", block: "custom", duration: { sec: 5 }, nodes: [{
    id: "label", type: "text", text: "Очень длинное имя героя ".repeat(100), units: "px",
    rect: { x: 100, y: 100, width: 80, height: 30 },
    typography: { role: "label", fontSize: 36, minFontSize: 20, maxLines: 1, fit: "fixed" },
  }] }];
  const compiled = compileVideo(document, {}, { measureText: await getTypographyMeasureText() });
  const prepared = await mocks.load();
  mocks.load.mockResolvedValue({ ...prepared, document, plan: compiled.plan, manifest: {}, validation: { ready: compiled.ready, diagnostics: compiled.diagnostics } });
  const report = await reviewStudioVideo("u", "p", {});
  expect(report.issues.some(i => i.code === "TEXT_OVERFLOW")).toBe(true);
  expect(report.suggestions.some(s => s.kind === "compact-label")).toBe(false);
  const historical = await mocks.load();
  mocks.load.mockResolvedValue({ ...historical, origin: { ...historical.origin, version: null, revision: 1 } });
  const historyReport = await reviewStudioVideo("u", "p", { revision: 1 });
  expect(historyReport.nextAction).toMatchObject({ tool: "video_storyboard", arguments: { revision: 1 } });
});
it("turns a reading risk into a deep preview of that exact scene and interval", async () => {
  const document = createVideoDocument({ kind: "picker", roundCount: 0 });
  document.settings.typography = { theme: "clean" };
  document.scenes = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, block: "custom" as const,
    duration: { sec: i === 1 ? .2 : 5 }, nodes: [{ id: `label-${i}`, type: "text" as const,
      text: "Короткая подпись", rect: { x: .1, y: .2, width: .8, height: .2 }, typography: { role: "label" as const } }] }));
  const result = compileVideo(document, {}, { measureText: await getTypographyMeasureText() });
  const initial = await mocks.load();
  mocks.load.mockResolvedValue({ ...initial, document, plan: result.plan, manifest: {}, validation: { ready: result.ready, diagnostics: result.diagnostics } });
  mocks.enqueue.mockImplementation(async (_uid, _pid, _prepared, _engine, render, inspection) => ({ id: "focused", status: "queued", kind: "clip", inspection, input: render }));
  const quick = await reviewStudioVideo("u", "p");
  expect(quick.nextAction.arguments).toMatchObject({ mode: "deep", sceneId: "s2" });
  const { projectId: _, ...request } = quick.nextAction.arguments;
  await reviewStudioVideo("u", "p", request as Parameters<typeof reviewStudioVideo>[2]);
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  const render = mocks.enqueue.mock.calls[0][4];
  const scene = result.plan.scenes[1];
  expect(render.fromFrame).toBe(scene.from);
  expect(render.durationFrames).toBe(scene.durationInFrames);
  expect(mocks.enqueue.mock.calls[0][5].selection.tiles[0].sceneId).toBe("s2");
});
it("reviews the storyboard's frozen inputs and engine when live media have changed", async () => {
  const prepared = await mocks.load();
  mocks.load.mockClear();
  mocks.pinned.mockResolvedValue({ prepared: { ...prepared, pinned: true }, engineId: "b".repeat(64), input: { render: { kind: "storyboard" } } });
  mocks.enqueue.mockImplementation(async (_uid, _pid, _prepared, _engine, _render, inspection) => ({ id: "pinned-preview", status: "queued", kind: "clip", inspection }));
  const quick = await reviewStudioVideo("u", "p", { sourceJobId: "frozen" });
  expect(quick.origin.contentHash).toBe("c");
  expect(quick.sourceJobId).toBe("frozen");
  expect(mocks.load).not.toHaveBeenCalled();
  await reviewStudioVideo("u", "p", { sourceJobId: "frozen", mode: "deep" });
  expect(mocks.enqueue.mock.calls[0][3]).toBe("b".repeat(64));
  expect(mocks.enqueue.mock.calls[0][6]).toMatchObject({ sourceJobId: "frozen" });
});
