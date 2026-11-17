import { it, expect } from "vitest";
import { compileVideo, createVideoDocument } from "./index";
import { estimateVideoResources, preflightVideoResources } from "./resource-limits";
import { largeKeyframeDocument, largePickerDocument } from "./resource-limits.test-fixtures";

it("accepts over one million authored values in valid explicit keyframes", () => {
  const document = largeKeyframeDocument();
  expect(estimateVideoResources(document).authoredValues).toBeGreaterThan(1_000_000);
  const result = compileVideo(document);
  expect(result.ready).toBe(true);
  expect(result.plan.scenes[0].nodes.filter((node) => node.type === "text")).toHaveLength(100);
  expect(result.plan.scenes[0].nodes[0].animation[0].keyframes).toHaveLength(2600);
}, 30_000);

it("compiles every card and OST in a 300 by 6 picker", () => {
  const result = compileVideo(largePickerDocument(), {
    ost: { id: "ost", kind: "audio", src: "ost.wav", durationSec: 30 },
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.plan.scenes.filter((scene) => scene.roundId)).toHaveLength(300);
  expect(result.plan.scenes.flatMap((scene) => scene.nodes).filter((node) => node.type === "card")).toHaveLength(1800);
  expect(result.plan.audio.filter((cue) => cue.asset.id === "ost")).toHaveLength(300);
});

it.each([
  { input: { values: Array(2_000_000).fill(0) }, resource: "authoredValues", used: 2_000_001, limit: 2_000_000, path: "values.1999998" },
  { input: { scenes: Array.from({ length: 2001 }, () => ({ nodes: [] })) }, resource: "expandedScenes", used: 2001, limit: 2000, path: "scenes.2000" },
  { input: { scenes: [{ nodes: Array.from({ length: 100_001 }, () => ({})) }] }, resource: "expandedNodes", used: 100001, limit: 100000, path: "scenes.0.nodes.100000" },
  { input: { audio: { cues: Array.from({ length: 20_001 }, () => ({})) }, scenes: [] }, resource: "audioCues", used: 20001, limit: 20000, path: "audio.cues.20000" },
  { input: { scenes: [{ duration: { sec: 7201 } }] }, resource: "durationSeconds", used: 7201, limit: 7200, path: "scenes.0.duration.sec" },
])("reports the exact $resource budget and offending path", ({ input, resource, used, limit, path }) => {
  const [diagnostic] = preflightVideoResources(input);
  expect(diagnostic).toMatchObject({ code: "RESOURCE_BUDGET_EXCEEDED", path });
  expect(diagnostic.message).toContain(`resource=${resource}`);
  expect(diagnostic.message).toContain(`used=${used}`);
  expect(diagnostic.message).toContain(`limit=${limit}`);
});

it("rejects cycles promptly without retaining a growing traversal stack", () => {
  const input: Record<string, unknown> = {};
  input.self = input;
  const [diagnostic] = preflightVideoResources(input);
  expect(diagnostic.path).toBe("self");
  expect(diagnostic.message).toContain("resource=cycles; used=1; limit=0");
});

it("accepts exactly two million authored values and stops at the next value", () => {
  const input = { values: Array(1_999_998).fill(0) };
  expect(estimateVideoResources(input)).toMatchObject({ authoredValues: 2_000_000, complete: true, diagnostics: [] });
  input.values.push(0);
  expect(estimateVideoResources(input)).toMatchObject({ authoredValues: 2_000_001, complete: false });
});

it("keeps the authored node depth boundary at 32 with an exact child path", () => {
  let node: any = { id: "leaf", type: "text", text: "x" };
  for (let i = 0; i < 31; i++) node = { id: `n${i}`, type: "container", children: [node] };
  const input = { scenes: [{ nodes: [node] }] };
  expect(preflightVideoResources(input)).toEqual([]);
  node.children = [{ id: "overflow", type: "container", children: node.children }];
  const [diagnostic] = preflightVideoResources(input);
  expect(diagnostic.path).toBe(`scenes.0.nodes.0${".children.0".repeat(32)}`);
  expect(diagnostic.message).toContain("resource=nodeDepth; used=33; limit=32");
});

it("keeps the structural JSON depth boundary at 96", () => {
  let input: unknown = 0;
  for (let i = 0; i < 96; i++) input = { child: input };
  expect(preflightVideoResources(input)).toEqual([]);
  const [diagnostic] = preflightVideoResources({ child: input });
  expect(diagnostic).toMatchObject({
    path: Array(97).fill("child").join("."),
    message: "resource=authoredDepth; used=97; limit=96",
  });
});

it("accepts the expanded node estimate at 100000 and rejects 100001", () => {
  const input = { scenes: [{ nodes: Array.from({ length: 99_990 }, () => ({})) }] };
  expect(estimateVideoResources(input)).toMatchObject({ expandedNodes: 100_000, complete: true, diagnostics: [] });
  input.scenes[0].nodes.push({});
  expect(preflightVideoResources(input)[0]).toMatchObject({
    path: "scenes.0", message: "resource=expandedNodes; used=100001; limit=100000",
  });
});

it("counts shared noncyclic values each time they will be serialized", () => {
  const shared = { nested: [1, 2, 3] };
  expect(preflightVideoResources({ first: shared, second: shared })).toEqual([]);
  expect(estimateVideoResources({ first: shared, second: shared })).toMatchObject({
    authoredValues: 11, authoredDepth: 3, complete: true, diagnostics: [],
  });
});

it("estimates repeated nodes without allocating expanded scenes", () => {
  expect(estimateVideoResources({
    scenes: [{ id: "s", repeat: "participants", nodes: [{}] }],
    source: { participants: [{}, {}] },
  })).toMatchObject({
    authoredValues: 11, authoredDepth: 4, nodeDepth: 1,
    expandedScenes: 2, expandedNodes: 22, audioCues: 0,
    complete: true, diagnostics: [],
  });
});

it.each([
  { kind: "picker" as const, roundCount: 2001, cardsPerRound: 1, resource: "expandedScenes", used: 2001, limit: 2000, path: "roundCount" },
  { kind: "picker" as const, roundCount: 2, cardsPerRound: 50001, resource: "expandedNodes", used: 100002, limit: 100000, path: "cardsPerRound" },
  { kind: "board" as const, roundCount: 20001, cardsPerRound: 1, resource: "boardFactoryParticipants", used: 20001, limit: 20000, path: "roundCount" },
])("rejects $kind factory allocation with its resource and count", ({ kind, roundCount, cardsPerRound, resource, used, limit, path }) => {
  try {
    createVideoDocument({ kind, roundCount, cardsPerRound });
    throw new Error("Expected bounded factory rejection");
  } catch (error) {
    expect(error).toMatchObject({ code: "RESOURCE_BUDGET_EXCEEDED", diagnostics: [{
      code: "RESOURCE_BUDGET_EXCEEDED", path,
      message: `resource=${resource}; used=${used}; limit=${limit}`,
    }] });
    expect((error as Error).message).toContain("RESOURCE_BUDGET_EXCEEDED");
  }
});

it.each([1, 2] as const)("reports the exact cumulative duration path for document version %s", (version) => {
  const document = createVideoDocument({ kind: "top", participants: [] });
  const scenes = ["first", "second"].map((id) => ({
    id, block: "custom" as const, duration: { sec: 4000 }, nodes: [],
  }));
  document.schemaVersion = version;
  document.scenes = version === 1 ? scenes : [];
  if (version === 2) document.segments = [
    { id: "disabled", kind: "custom", title: "Disabled", enabled: false, scenes: [] },
    ...scenes.map((scene) => ({ id: scene.id, kind: "custom" as const, title: scene.id, scenes: [scene] })),
  ];
  const result = compileVideo(document);
  expect(result.diagnostics).toContainEqual({
    severity: "error", code: "RESOURCE_BUDGET_EXCEEDED",
    path: version === 1 ? "scenes.1.duration" : "segments.2.scenes",
    message: "resource=durationSeconds; used=8000; limit=7200",
  });
  expect(result.plan.scenes).toHaveLength(0);
});
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
  expect(result.diagnostics.find((d) => d.code === "RESOURCE_BUDGET_EXCEEDED")).toMatchObject({
    path: "audio.playlist", message: "resource=audioCues; used=20001; limit=20000",
  });
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
    if (rejected) expect(result.diagnostics.find((d) => d.code === "RESOURCE_BUDGET_EXCEEDED")?.message).toMatch(/resource=audioPolicyWindows; used=\d+; limit=200000/);
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
