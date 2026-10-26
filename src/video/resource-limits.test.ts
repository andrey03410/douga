import { it, expect } from "vitest";
import { compileVideo, createVideoDocument } from "./index";
it("rejects repeat multiplication before allocating an expanded plan", () => {
  const doc = createVideoDocument({
    kind: "top",
    participants: Array.from({ length: 1000 }, (_, i) => ({
      id: `p${i}`,
      label: `Object ${i}`,
    })),
  });
  doc.scenes = Array.from({ length: 1000 }, (_, i) => ({
    ...doc.scenes[0],
    id: `s${i}`,
  }));
  const result = compileVideo(doc);
  expect(result.ready).toBe(false);
  expect(
    result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
  ).toBe(true);
  expect(result.plan.scenes).toHaveLength(0);
});
it("rejects deeply nested authored trees before recursive schema parsing", () => {
  const doc = createVideoDocument({ kind: "top", participants: [] });
  let node: any = { id: "leaf", type: "text", text: "x" };
  for (let i = 0; i < 100; i++)
    node = { id: `n${i}`, type: "container", children: [node] };
  doc.scenes = [
    { id: "s", block: "custom", duration: { sec: 1 }, nodes: [node] },
  ];
  const result = compileVideo(doc);
  expect(
    result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
  ).toBe(true);
});
it("bounds playlist cue allocation and authored duration before audio expansion", () => {
  const doc = createVideoDocument({ kind: "top", participants: [] });
  doc.scenes = [
    { id: "s", block: "custom", duration: { sec: 7200 }, nodes: [] },
  ];
  doc.bindings.tiny = { kind: "builtin", name: "tick" };
  doc.audio = { playlist: { tracks: ["tiny"], loop: true, crossfadeSec: 0 } };
  const result = compileVideo(doc, {
    tiny: { id: "tiny", kind: "audio", src: "tiny.wav", durationSec: 1 / 30 },
  });
  expect(result.ready).toBe(false);
  expect(
    result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
  ).toBe(true);
  expect(result.plan.audio.length).toBeLessThanOrEqual(20_000);
});
