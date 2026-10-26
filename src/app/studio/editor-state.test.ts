import { expect, it } from "vitest";
import {
  acceptRemote,
  editBuffer,
  openBuffer,
  acceptActionResult,
} from "./editor-state";
import type { StudioProjectView } from "@/server/studio/types";
const project = (version: number, text: string) =>
  ({
    version,
    document: { title: text },
    draft: { text, document: null },
  }) as unknown as StudioProjectView;
it("polling retains dirty text and original CAS token until explicit reload", () => {
  let buffer = openBuffer(project(1, "original"));
  buffer = editBuffer(buffer, "my unsaved code");
  buffer = acceptRemote(buffer, project(2, "MCP winner"));
  expect(buffer.text).toBe("my unsaved code");
  expect(buffer.baseVersion).toBe(1);
  expect(buffer.conflict).toBe(true);
  expect(openBuffer(project(2, "MCP winner")).baseVersion).toBe(2);
});
it("clean buffers refresh without manufacturing a conflict", () => {
  const buffer = acceptRemote(
    openBuffer(project(1, "original")),
    project(3, "remote"),
  );
  expect(buffer.text).toBe("remote");
  expect(buffer.baseVersion).toBe(3);
  expect(buffer.conflict).toBe(false);
});
it("ignores an older poll that arrives after a save", () => {
  const current = openBuffer(project(4, "saved"));
  expect(acceptRemote(current, project(3, "stale"))).toEqual(current);
});
it("a delayed commit/restore/preset/job acknowledgement preserves text typed while the action is in flight", async () => {
  let release!: (value: StudioProjectView) => void;
  const response = new Promise<StudioProjectView>((resolve) => {
    release = resolve;
  });
  let buffer: import("./editor-state").EditorBuffer | null = openBuffer(
    project(1, "saved before action"),
  );
  const pending = response.then((p) => {
    buffer = acceptActionResult(buffer, p);
  });
  buffer = editBuffer(buffer, "new local text typed during freeze");
  release(project(2, "server action result"));
  await pending;
  expect(buffer?.text).toBe("new local text typed during freeze");
  expect(buffer?.baseVersion).toBe(1);
  expect(buffer?.dirty).toBe(true);
  expect(buffer?.conflict).toBe(true);
});
it("a clean action acknowledgement refreshes the buffer while a closed SDK stays closed", () => {
  expect(
    acceptActionResult(openBuffer(project(1, "before")), project(2, "after"))
      ?.text,
  ).toBe("after");
  expect(acceptActionResult(null, project(2, "after"))).toBeNull();
});
