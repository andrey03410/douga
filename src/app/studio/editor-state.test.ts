import { expect, it } from "vitest";
import { acceptRemote, editBuffer, openBuffer } from "./editor-state";
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
