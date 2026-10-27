import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

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

// T13: the GraphQL poster lookup used to fail on the first 429 and the import
// silently fell back to the low-res legacy poster. It now shares the REST
// retry path: the same schedule, Retry-After and attempt budget.
const GRAPHQL_OK = { data: { animes: [{ id: "5", poster: { originalUrl: "/uploads/poster/animes/5/x.jpeg" } }] } };

function rateLimited(retryAfter?: string): Response {
  return new Response("slow down", {
    status: 429,
    headers: retryAfter ? { "Retry-After": retryAfter } : {},
  });
}

it("retries a GraphQL 429 and returns the answer that follows", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv("SHIKIMORI_RETRY_MS", "");
  const fetchMock = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(rateLimited())
    .mockResolvedValueOnce(new Response(JSON.stringify(GRAPHQL_OK), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchFreshPosterUrls } = await import("./shikimori");

  const urls = fetchFreshPosterUrls("anime", [5]);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await urls).get(5)).toBe("/uploads/poster/animes/5/x.jpeg");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toMatch(/\/api\/graphql$/);
    expect(init.method).toBe("POST");
  }
});

it("waits for Retry-After before repeating a GraphQL request", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv("SHIKIMORI_RETRY_MS", "");
  const fetchMock = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(rateLimited("5"))
    .mockResolvedValueOnce(new Response(JSON.stringify(GRAPHQL_OK), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchGraphql } = await import("./shikimori");

  const body = fetchGraphql("{animes(ids: \"5\", limit: 1){ id }}");
  // the default schedule would retry after 2 s; the server asked for 5 s
  await vi.advanceTimersByTimeAsync(4_900);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(400);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await body).toEqual(GRAPHQL_OK);
});

it("gives up on GraphQL after as many attempts as REST", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv("SHIKIMORI_RETRY_MS", "");
  const fetchMock = vi.fn(async () => rateLimited());
  vi.stubGlobal("fetch", fetchMock);
  const { fetchGraphql, fetchUserRaw } = await import("./shikimori");

  const rest = fetchUserRaw("test").catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(((await rest) as Error).message).toBe("RATE_LIMITED");
  const restAttempts = fetchMock.mock.calls.length;
  // first try + one per step of the 2/8/20 s schedule
  expect(restAttempts).toBe(4);

  fetchMock.mockClear();
  const graphql = fetchGraphql("{animes(ids: \"5\", limit: 1){ id }}").catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(((await graphql) as Error).message).toBe("RATE_LIMITED");
  expect(fetchMock).toHaveBeenCalledTimes(restAttempts);
});
