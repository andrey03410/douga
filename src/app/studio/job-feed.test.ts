import { expect, it } from "vitest";
import type { StudioJobView } from "@/server/studio/job-types";
import { readLoadedJobWindow, type StudioJobPageReader } from "./job-feed";
const job = (id: string, status: StudioJobView["status"] = "done") =>
  ({ id, status, progress: status === "done" ? 1 : 0 }) as StudioJobView;
function catalog(initial: StudioJobView[], pageSize = 2) {
  let rows = initial;
  const read: StudioJobPageReader = async ({ limit, cursor }) => {
    const start = cursor ? rows.findIndex((j) => j.id === cursor) + 1 : 0;
    const items = rows.slice(start, start + Math.min(limit, pageSize));
    return {
      items,
      nextCursor: start + items.length < rows.length ? items.at(-1)!.id : null,
    };
  };
  return {
    read,
    replace: (next: StudioJobView[]) => {
      rows = next;
    },
  };
}
it("authoritatively removes an externally deleted sole job on polling", async () => {
  const source = catalog([job("only")]);
  let state = await readLoadedJobWindow(source.read, 2);
  expect(state.items.map((j) => j.id)).toEqual(["only"]);
  source.replace([]);
  state = await readLoadedJobWindow(source.read, 2);
  expect(state.items).toEqual([]);
  expect(state.nextCursor).toBeNull();
});
it("retains the loaded frontier through load-more, polling and another load-more across three pages", async () => {
  const source = catalog([
    job("1"),
    job("2"),
    job("3", "running"),
    job("4"),
    job("5"),
    job("6"),
  ]);
  let windowSize = 2;
  let state = await readLoadedJobWindow(source.read, windowSize);
  expect(state.nextCursor).toBe("2");
  windowSize += 2;
  state = await readLoadedJobWindow(source.read, windowSize);
  expect(state.items.map((j) => j.id)).toEqual(["1", "2", "3", "4"]);
  expect(state.nextCursor).toBe("4");
  source.replace([
    job("1"),
    job("2"),
    job("3", "done"),
    job("4"),
    job("5"),
    job("6"),
  ]);
  state = await readLoadedJobWindow(source.read, windowSize);
  expect(state.nextCursor).toBe("4");
  expect(state.items.find((j) => j.id === "3")?.status).toBe("done");
  windowSize += 2;
  state = await readLoadedJobWindow(source.read, windowSize);
  expect(state.items.map((j) => j.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  expect(state.nextCursor).toBeNull();
  source.replace([job("1"), job("2"), job("3"), job("5"), job("6")]);
  state = await readLoadedJobWindow(source.read, windowSize);
  expect(state.items.map((j) => j.id)).toEqual(["1", "2", "3", "5", "6"]);
});
