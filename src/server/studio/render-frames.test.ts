import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StudioFrozenRevision } from "./types";
const mocks = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(async () => {}), render: vi.fn(async () => {}), select: vi.fn(async () => ({ id: "Studio", width: 16, height: 16, fps: 30, durationInFrames: 1 })), engine: "" }));
vi.mock("@remotion/renderer", () => ({ openBrowser: mocks.open, renderStill: mocks.render,
  selectComposition: mocks.select }));
vi.mock("./engine", () => ({ verifyEngine: async () => mocks.engine }));
vi.mock("./assets", () => ({ fileHash: vi.fn(), safeFile: vi.fn() }));
vi.mock("./typography-fonts", () => ({ verifyTypographyFonts: async () => {} }));
import { renderStudioFrames } from "./render-frames";
const relative = `verification/32-storyboard/rasterizer-test-${randomUUID()}`;
const directory = path.resolve("storage", relative);
const frozen = { files: {}, manifest: {}, fontFiles: {}, plan: { width: 16, height: 16, fps: 30, durationInFrames: 1, scenes: [], audio: [] } } as unknown as StudioFrozenRevision;
beforeAll(async () => { mocks.engine = path.join(directory, "engine"); await mkdir(path.join(mocks.engine, "public"), { recursive: true }); });
beforeEach(() => { vi.clearAllMocks(); mocks.open.mockResolvedValue({ close: mocks.close }); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
it("pins the requested software rasterizer on the shared browser actually used for each still", async () => {
  await renderStudioFrames({ directory: `${relative}/software`, engineId: "test", frozen, frames: [0], rasterizer: "swangle" });
  expect(mocks.open).toHaveBeenCalledWith("chrome", expect.objectContaining({ chromiumOptions: { gl: "swangle" } }));
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ puppeteerInstance: await mocks.open.mock.results[0].value }));
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("preserves the default worker browser configuration when no rasterizer is requested", async () => {
  await renderStudioFrames({ directory: `${relative}/default`, engineId: "test", frozen, frames: [0] });
  expect(mocks.open.mock.calls[0][1].chromiumOptions).toBeUndefined();
  expect(mocks.render).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});

it("uses one trusted explicit browser for composition selection and every actual frame", async () => {
  vi.stubEnv("REMOTION_BROWSER_EXECUTABLE", "/test/system-browser");
  const bundled = "/test/bundled-headless-shell";
  await renderStudioFrames({ directory: `${relative}/override`, engineId: "test", frozen, frames: [0], browserExecutable: bundled, rasterizer: "swangle" });
  expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ browserExecutable: bundled }));
  expect(mocks.open).toHaveBeenCalledWith("chrome", expect.objectContaining({ browserExecutable: bundled, chromiumOptions: { gl: "swangle" } }));
  expect(process.env.REMOTION_BROWSER_EXECUTABLE).toBe("/test/system-browser");
});
it("keeps the configured system browser fallback for ordinary worker requests", async () => {
  vi.stubEnv("REMOTION_BROWSER_EXECUTABLE", "/test/system-browser");
  await renderStudioFrames({ directory: `${relative}/fallback`, engineId: "test", frozen, frames: [0] });
  expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ browserExecutable: "/test/system-browser" }));
  expect(mocks.open).toHaveBeenCalledWith("chrome", expect.objectContaining({ browserExecutable: "/test/system-browser" }));
  expect(mocks.open.mock.calls[0][1].chromiumOptions).toBeUndefined();
});
