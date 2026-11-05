import { it, expect, vi, afterEach } from "vitest";
import { finalizeResultsBeforeNavigation } from "./[id]/results-actions";
afterEach(() => vi.unstubAllGlobals());
it("saves the selected segment before opening its source", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.stringify(JSON.parse(init.body as string)));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await finalizeResultsBeforeNavigation(
    "tournament",
    3,
    () => {
      calls.push("navigate");
    },
    "episode-2",
  );
  expect(calls).toEqual([
    JSON.stringify({ topSize: 3, segmentId: "episode-2" }),
    "navigate",
  ]);
});
