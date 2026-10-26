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
it.each([
  { rounds: 125, voice: false, rejected: true },
  { rounds: 100, voice: true, rejected: true },
  { rounds: 100, voice: false, rejected: false },
])(
  "bounds aggregate muted-round playlist policies before retaining window arrays: %o",
  ({ rounds, voice, rejected }) => {
    const doc = createVideoDocument({
      kind: "picker",
      roundCount: rounds,
      cardsPerRound: 1,
    });
    for (const round of doc.source.rounds) round.music = null;
    doc.bindings.music = { kind: "builtin", name: "tick" };
    doc.audio = {
      playlist: { tracks: ["music"], loop: true, crossfadeSec: 0 },
      ...(voice
        ? {
            cues: [
              {
                id: "voice",
                role: "voice" as const,
                asset: "music",
                at: { sec: 0 },
                anchor: {
                  event: "scene.start" as const,
                  sceneId: doc.scenes[0].id,
                },
              },
            ],
          }
        : {}),
    };
    const result = compileVideo(doc, {
      music: { id: "music", kind: "audio", src: "music.wav", durationSec: 0.5 },
    });
    expect(result.ready).toBe(!rejected);
    expect(
      result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
    ).toBe(rejected);
    expect(
      result.plan.audio.reduce(
        (n, cue) => n + cue.muteWindows.length + cue.duckWindows.length,
        0,
      ),
    ).toBe(rejected ? 0 : 150_000);
  },
);
it("rejects repeated-scene sound anchors before active-snippet expansion", () => {
  const doc = createVideoDocument({
    kind: "top",
    participants: Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      media: { audio: "sound" },
    })),
  });
  doc.settings.top = { snippet: { mode: "active", durationSec: 1 } };
  doc.bindings.sound = { kind: "builtin", name: "tick" };
  doc.audio = {
    cues: Array.from({ length: 500 }, (_, i) => ({
      id: `cue${i}`,
      role: "sfx",
      asset: "sound",
      at: { sec: 0 },
      anchor: { event: "scene.start", sceneId: doc.scenes[0].id },
    })),
  };
  const result = compileVideo(doc, {
    sound: { id: "sound", kind: "audio", src: "sound.wav", durationSec: 2 },
  });
  expect(
    result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
  ).toBe(true);
  expect(result.plan.scenes).toHaveLength(0);
  expect(result.plan.audio).toHaveLength(0);
});
