import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  evaluate: vi.fn(),
  actor: vi.fn(),
  owned: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("./projects", () => ({
  getStudioProject: mocks.reconcile,
  view: mocks.project,
  applyStudioTypographyDraft: vi.fn(),
}));
vi.mock("./assets", async (original) => ({
  ...(await original<object>()),
  evaluate: mocks.evaluate,
}));
vi.mock("./shared", async (original) => ({
  ...(await original<object>()),
  actor: mocks.actor,
  owned: mocks.owned,
}));
import {
  inspectStudioText,
  inspectStudioTextSchema,
  typographyPreviewSchema,
} from "./typography";

const node = (id: string) => ({
  id,
  type: "text",
  text: id,
  textLayout: {
    fontSize: 32,
    lines: [
      {
        text: id,
        width: 90,
        runs: [] as { text: string; width: number; fonts: string[] }[],
      },
    ],
    overflow: false,
    fonts: ["manrope-700-normal"],
  },
  typography: { font: "manrope" },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "u", role: "admin" });
  mocks.owned.mockResolvedValue({ id: "p", version: 7 });
  mocks.reconcile.mockImplementation((...args) => mocks.project(...args));
  mocks.project.mockResolvedValue({
    id: "p",
    version: 7,
    revision: 2,
    document: {},
    draft: null,
  });
  mocks.evaluate.mockResolvedValue({
    validation: { ready: true, diagnostics: [] },
    plan: {
      width: 1920,
      height: 1080,
      fps: 30,
      scenes: [{ id: "s", segmentId: "seg", nodes: [node("a"), node("b")] }],
    },
  });
});
describe("typography service", () => {
  it("bounds line and run details even when one overflowing node has thousands of lines", async () => {
    const huge = node("huge");
    huge.textLayout.lines = Array.from({ length: 5000 }, (_, i) => ({
      text: `line ${i}`,
      width: 90,
      runs: Array.from({ length: 100 }, () => ({
        text: "a".repeat(200),
        width: 20,
        fonts: [],
      })),
    }));
    mocks.evaluate.mockResolvedValueOnce({
      validation: { ready: false, diagnostics: [] },
      plan: { scenes: [{ id: "s", nodes: [huge] }] },
    });
    const result = await inspectStudioText("u", "p", {
      limit: 1,
      lineLimit: 12,
    });
    expect(result.items[0].layout!.lines).toHaveLength(12);
    expect(result.items[0].layout!.totalLines).toBe(5000);
    expect(result.items[0].layout!.nextLineOffset).toBe(12);
    expect(result.items[0].layout!.lines[0].runs.length).toBeLessThanOrEqual(
      20,
    );
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(256 * 1024);
  });
  it("inspects stored source state without calling the source-reconciling read", async () => {
    await inspectStudioText("u", "p", {});
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.owned).toHaveBeenCalledWith("u", "p");
  });
  it("paginates measured text and pins response to project version", async () => {
    const first = await inspectStudioText("u", "p", { limit: 1 });
    expect(first.version).toBe(7);
    expect(first.items.map((n) => n.nodeId)).toEqual(["a"]);
    expect(first.nextCursor).toBe("1");
    const second = await inspectStudioText("u", "p", {
      cursor: first.nextCursor!,
    });
    expect(second.items.map((n) => n.nodeId)).toEqual(["b"]);
    expect(second.nextCursor).toBeNull();
    expect(mocks.owned).toHaveBeenCalledWith("u", "p");
  });
  it("filters by segment and node without exposing other content", async () => {
    const result = await inspectStudioText("u", "p", {
      segmentId: "seg",
      nodeId: "b",
    });
    expect(result.total).toBe(1);
    expect(result.items[0].nodeId).toBe("b");
  });
  it("rejects stale reads before measuring a different draft", async () => {
    await expect(
      inspectStudioText("u", "p", { expectedVersion: 6 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("does not bypass ownership or invalid resources for diagnostic PNG", async () => {
    mocks.project.mockRejectedValueOnce(
      Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" }),
    );
    await expect(inspectStudioText("u", "other", {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    mocks.evaluate.mockResolvedValueOnce({
      validation: {
        ready: false,
        diagnostics: [{ severity: "error", code: "ASSET_NOT_FOUND" }],
      },
      plan: { scenes: [] },
    });
    await expect(
      inspectStudioText("u", "p", { preview: true }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("bounds expensive and text inputs", () => {
    expect(inspectStudioTextSchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(inspectStudioTextSchema.safeParse({ cursor: "-1" }).success).toBe(
      false,
    );
    expect(inspectStudioTextSchema.safeParse({ frame: -1 }).success).toBe(
      false,
    );
    expect(
      typographyPreviewSchema.safeParse({ text: "a".repeat(10001) }).success,
    ).toBe(false);
    expect(
      typographyPreviewSchema.safeParse({ theme: "unknown" }).success,
    ).toBe(false);
  });
});
