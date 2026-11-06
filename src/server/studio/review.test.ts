import { beforeEach, expect, it, vi } from "vitest";
import { createVideoDocument, compileVideo } from "@/video";
const mocks = vi.hoisted(() => ({ load: vi.fn(), owned: vi.fn(), enqueue: vi.fn(), transform: vi.fn() }));
vi.mock("./storyboard", () => ({ loadInspectionProject: mocks.load, enqueueInspection: mocks.enqueue }));
vi.mock("./shared", async original => ({ ...(await original<object>()), owned: mocks.owned }));
vi.mock("./projects", () => ({ transformStudioDraft: mocks.transform }));
import { reviewStudioVideo, applyStudioReview } from "./review";
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
