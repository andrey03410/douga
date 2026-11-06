import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), start: vi.fn(), resource: vi.fn(), get: vi.fn(), content: vi.fn(), review: vi.fn(), apply: vi.fn() }));
vi.mock("@/server/studio/shared", () => ({ actor: mocks.actor }));
vi.mock("@/server/studio/storyboard", async original => ({ ...(await original<object>()), startStudioStoryboard: mocks.start }));
vi.mock("@/server/studio/inspection", () => ({ readStudioJobResource: mocks.resource }));
vi.mock("@/server/studio/jobs", async original => ({ ...(await original<object>()), getStudioJob: mocks.get }));
vi.mock("@/server/studio/content", async original => ({ ...(await original<object>()), setStudioContent: mocks.content }));
vi.mock("@/server/studio/review", async original => ({ ...(await original<object>()), reviewStudioVideo: mocks.review, applyStudioReview: mocks.apply }));
import { registerStoryboardTools } from "./storyboard-tools";
let registered: Map<string, { schema: Record<string, unknown>; run: (args: object) => Promise<any> }>;
beforeEach(() => {
  vi.clearAllMocks(); registered = new Map();
  mocks.actor.mockResolvedValue({ role: "user" });
  registerStoryboardTools({ registerTool(name: string, config: any, run: any) { registered.set(name, { schema: config.inputSchema, run }); } } as any, { userId: "u" } as any);
});
it("registers four strict guided tools and returns one native image without JSON base64", async () => {
  expect([...registered.keys()]).toEqual(["video_content_set", "video_storyboard", "video_review", "video_review_apply"]);
  mocks.start.mockResolvedValue({ id: "j", kind: "storyboard", status: "done", result: { kind: "storyboard" } });
  mocks.resource.mockResolvedValue({ blob: "aW1hZ2U=", mimeType: "image/png" });
  const result = await registered.get("video_storyboard")!.run({ projectId: "p" });
  expect(result.content.filter((c: any) => c.type === "image")).toEqual([expect.objectContaining({ data: "aW1hZ2U=", mimeType: "image/png" })]);
  expect(JSON.stringify(result.structuredContent)).not.toContain("aW1hZ2U=");
});
it("returns a ready status action for queued work without creating per-tile jobs", async () => {
  mocks.start.mockResolvedValue({ id: "j", kind: "storyboard", status: "queued" });
  mocks.get.mockResolvedValue({ id: "j", status: "queued" });
  const result = await registered.get("video_storyboard")!.run({ projectId: "p", waitMs: 0 });
  expect(result.structuredContent.nextAction).toMatchObject({ tool: "video_job_get", arguments: { jobId: "j" } });
  expect(mocks.start).toHaveBeenCalledTimes(1);
});
it("offers the frozen continuation as the next action when a ready sheet has more pages", async () => {
  const nextPageAction = { tool: "video_storyboard", arguments: { projectId: "p", sourceJobId: "j", page: 1, pageSize: 12, mode: "overview" } };
  mocks.start.mockResolvedValue({ id: "j", kind: "storyboard", status: "done", nextPageAction });
  mocks.resource.mockResolvedValue({ blob: "aW1hZ2U=", mimeType: "image/png" });
  const result = await registered.get("video_storyboard")!.run({ projectId: "p" });
  expect(result.structuredContent.nextAction).toEqual(nextPageAction);
});
it("lets the service inherit a pinned continuation's mode and page size", async () => {
  mocks.start.mockResolvedValue({ id: "j", kind: "storyboard", status: "queued" });
  await registered.get("video_storyboard")!.run({ projectId: "p", sourceJobId: "old", page: 1 });
  expect(mocks.start.mock.calls[0][2].mode).toBeUndefined();
  expect(mocks.start.mock.calls[0][2].pageSize).toBeUndefined();
});
