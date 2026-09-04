import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("starts the network timeout after waiting for the minute quota", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new Error("aborted before network request");
    return new Response(JSON.stringify({ id: 1, nickname: "test" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { fetchUserRaw } = await import("./shikimori");
  // The 81st call waits for the 60-second sliding window, longer than the
  // 10-second fetch timeout. The wait itself must not expire the request.
  const results = Promise.allSettled(Array.from({ length: 81 }, () => fetchUserRaw("test")));
  await vi.advanceTimersByTimeAsync(61000);
  expect((await results).every(r => r.status === "fulfilled")).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(81);
});
