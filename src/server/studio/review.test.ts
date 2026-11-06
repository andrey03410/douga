import { beforeEach, expect, it, vi } from "vitest";
import { createVideoDocument, compileVideo } from "@/video";
const mocks = vi.hoisted(() => ({ load: vi.fn(), owned: vi.fn(), enqueue: vi.fn(), transform: vi.fn() }));
vi.mock("./storyboard", () => ({ loadInspectionProject: mocks.load, enqueueInspection: mocks.enqueue }));
vi.mock("./shared", async original => ({ ...(await original<object>()), owned: mocks.owned }));
vi.mock("./projects", () => ({ transformStudioDraft: mocks.transform }));
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
});
