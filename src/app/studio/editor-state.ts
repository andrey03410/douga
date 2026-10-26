import type { StudioProjectView } from "@/server/studio/types";
export interface EditorBuffer {
  text: string;
  baseVersion: number;
  dirty: boolean;
  conflict: boolean;
}
export function openBuffer(p: StudioProjectView): EditorBuffer {
  return {
    text: p.draft?.text ?? JSON.stringify(p.document, null, 2),
    baseVersion: p.version,
    dirty: false,
    conflict: false,
  };
}
export function editBuffer(b: EditorBuffer, text: string): EditorBuffer {
  return { ...b, text, dirty: true };
}
export function acceptRemote(
  b: EditorBuffer,
  p: StudioProjectView,
): EditorBuffer {
  if (p.version < b.baseVersion) return b;
  if (b.dirty)
    return { ...b, conflict: b.conflict || p.version !== b.baseVersion };
  return openBuffer(p);
}

export function acceptActionResult(
  b: EditorBuffer | null,
  p: StudioProjectView,
): EditorBuffer | null {
  return b ? acceptRemote(b, p) : null;
}
