import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyVideoPreset,
  collectVideoAssetKeys,
  compileVideo,
  createVideoDocument,
  getBuiltinPreset,
  parseVideoDocument,
  patchVideoDocument,
  type AssetManifest,
  type VideoDocument,
} from "./index";

const manifest: AssetManifest = {
  picture: { id: "picture", kind: "image", src: "picture.png" },
  song: { id: "song", kind: "audio", src: "song.wav", durationSec: 60 },
};
function mixed(): VideoDocument {
  const d: any = createVideoDocument({
    kind: "top",
    participants: [
      {
        id: "a",
        label: "A",
        rank: 1,
        comment: "Quiet",
        album: "Episode 1",
        score: 9.5,
        bestMomentSec: 12,
        media: { visual: "picture", audio: "song" },
      },
      { id: "b", label: "B", rank: 1 },
    ],
  });
  d.schemaVersion = 2;
  d.scenes = [];
  d.source.segments = [
    {
      id: "source-a",
      title: "Episode 1",
      poster: "picture",
      participantIds: ["a"],
    },
    { id: "source-b", title: "Episode 2", participantIds: ["b"] },
  ];
  d.segments = [
    {
      id: "intro",
      kind: "custom",
      title: "Opening",
      scenes: [
        { id: "intro-scene", block: "custom", duration: { sec: 1 }, nodes: [] },
      ],
    },
    {
      id: "first",
      kind: "top",
      title: "Episode 1",
      subtitle: "Beginning",
      poster: "picture",
      sourceSegmentId: "source-a",
      scenes: [
        {
          id: "first-scene",
          block: "top",
          repeat: "participants",
          duration: { sec: 2 },
          nodes: [],
        },
      ],
    },
    {
      id: "second",
      kind: "picker",
      title: "Episode 2",
      participantIds: ["b"],
      roundIds: ["round"],
      scenes: [
        { id: "picker-scene", block: "picker", repeat: "rounds", nodes: [] },
      ],
    },
  ];
  d.source.rounds = [
    { id: "round", cards: [{ id: "card-b", participantId: "b" }] },
  ];
  return d;
}
describe("segmented SDK", () => {
  it("retains the exact v1 compiled plan", () => {
    const d = createVideoDocument({
      kind: "top",
      participants: [
        { id: "a", label: "Alpha", rank: 1 },
        { id: "b", label: "Beta", rank: 2 },
      ],
    });
    expect(
      createHash("sha256")
        .update(JSON.stringify(compileVideo(d).plan))
        .digest("hex"),
    ).toBe("4f13e68768aa7a23c60b6ba829eaa0ef0d35e93739f3a0a05b34c9de5646309a");
  });
  it("compiles mixed segment scopes into contiguous intervals with local ranks", () => {
    const r = compileVideo(mixed(), manifest);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.plan.segments).toEqual([
      { id: "intro", kind: "custom", title: "Opening", from: 0, to: 30 },
      { id: "first", kind: "top", title: "Episode 1", from: 30, to: 90 },
      { id: "second", kind: "picker", title: "Episode 2", from: 90, to: 315 },
    ]);
    expect(
      r.plan.scenes.map((s) => [
        s.segmentId,
        s.segmentTitle,
        s.participantId,
        s.roundId,
      ]),
    ).toEqual([
      ["intro", "Opening", undefined, undefined],
      ["first", "Episode 1", "a", undefined],
      ["second", "Episode 2", undefined, "round"],
    ]);
    expect(r.plan.audio[0].offsetFrames).toBe(360);
  });
  it("enforces version and reference contracts and skips preserved disabled segments", () => {
    const d: any = mixed();
    expect(() => parseVideoDocument({ ...d, schemaVersion: 1 })).toThrow();
    const noSegments = { ...d };
    delete noSegments.segments;
    expect(() => parseVideoDocument(noSegments)).toThrow();
    d.segments[1].enabled = false;
    expect(compileVideo(d, manifest).plan.segments?.map((s) => s.id)).toEqual([
      "intro",
      "second",
    ]);
    d.segments[2].participantIds = ["missing"];
    expect(() => parseVideoDocument(d)).toThrow();
  });
  it("binds segment and participant metadata and dynamic media inside repeated participant templates", () => {
    const d: any = mixed();
    d.segments = d.segments.slice(1, 2);
    d.segments[0].scenes = [
      {
        id: "metadata",
        block: "custom",
        repeat: "participants",
        duration: { sec: 2 },
        nodes: [
          ...[
            "segment.title",
            "segment.subtitle",
            "segment.number",
            "segment.count",
            "participant.comment",
            "participant.album",
            "participant.score",
          ].map((bind, i) => ({
            id: `text${i}`,
            type: "text",
            text: { bind },
          })),
          {
            id: "cover",
            type: "image",
            asset: "$participant.visual",
            style: { blur: 8 },
          },
          { id: "poster", type: "image", asset: "$segment.poster" },
          {
            id: "sound",
            type: "audio",
            asset: "$participant.audio",
            role: "primary",
          },
        ],
      },
    ];
    const r = compileVideo(d, manifest);
    expect(r.ready).toBe(true);
    expect(
      r.plan.scenes[0].nodes
        .filter((n) => n.type === "text")
        .map((n) => n.text),
    ).toEqual([
      "Episode 1",
      "Beginning",
      "1",
      "1",
      "Quiet",
      "Episode 1",
      "9.5",
    ]);
    expect(
      r.plan.scenes[0].nodes.find((n) => n.type === "image")?.style.blur,
    ).toBe(8);
    expect(r.plan.audio[0].asset.id).toBe("song");
    expect(collectVideoAssetKeys(d)).toEqual(["picture", "song"]);
  });
  it("lays out participant templates by segment, document and revealed selection", () => {
    const d: any = mixed();
    d.segments = d.segments.slice(1, 2);
    d.segments[0].participantIds = ["a", "b"];
    d.segments[0].scenes = [
      {
        id: "collection",
        block: "custom",
        repeat: "participants",
        duration: { sec: 1 },
        nodes: [
          {
            id: "set",
            type: "container",
            repeat: "participants",
            selection: "revealed",
            layout: { type: "grid", columns: 2, padding: 0, gap: 0 },
            children: [
              { id: "name", type: "text", text: { bind: "participant.label" } },
            ],
          },
        ],
      },
    ];
    const r = compileVideo(d, manifest);
    expect(r.ready).toBe(true);
    expect(
      r.plan.scenes.map((s) =>
        s.nodes.filter((n) => n.type === "text").map((n) => n.text),
      ),
    ).toEqual([["A"], ["A", "B"]]);
    expect(new Set(r.plan.scenes[1].nodes.map((n) => n.id)).size).toBe(
      r.plan.scenes[1].nodes.length,
    );
    expect(
      r.plan.scenes[1].nodes
        .filter((n) => n.type === "text")
        .every((n) => n.rect.width === 960),
    ).toBe(true);
    d.segments[0].participantIds = ["a"];
    d.segments[0].scenes[0].nodes[0].selection = "document";
    expect(
      compileVideo(d, manifest)
        .plan.scenes[0].nodes.filter((n) => n.type === "text")
        .map((n) => n.text),
    ).toEqual(["A", "B"]);
  });
  it("patches segments and their stable node IDs and applies presets without losing local overrides", () => {
    let d = mixed();
    d = patchVideoDocument(d, [
      {
        op: "set",
        target: { type: "segment", id: "first" },
        path: ["settings", "card", "blur"],
        value: 6,
      },
      {
        op: "set",
        target: { type: "segment", id: "first" },
        path: ["title"],
        value: "Renamed",
      },
    ]);
    const p = applyVideoPreset(d, getBuiltinPreset("top.minimal.vertical")!);
    expect(p.segments?.map((s) => s.title)).toEqual([
      "Opening",
      "Renamed",
      "Episode 2",
    ]);
    expect(p.segments?.[1].settings?.card?.blur).toBe(6);
    expect(p.segments?.[1].scenes[0].block).toBe("top");
    expect(p.segments?.[2].scenes[0].block).toBe("picker");
    expect(compileVideo(p, manifest).ready).toBe(true);
  });
  it("rejects aggregate scene and nested participant container expansion before allocation", () => {
    const d: any = mixed();
    d.source.participants = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
    }));
    d.source.segments = [];
    d.segments = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      title: `S${i}`,
      kind: "top",
      scenes: [
        { id: `scene${i}`, block: "top", repeat: "participants", nodes: [] },
      ],
    }));
    expect(
      compileVideo(d).diagnostics.some(
        (d) => d.code === "RESOURCE_BUDGET_EXCEEDED",
      ),
    ).toBe(true);
    d.segments = d.segments.slice(0, 1);
    d.segments[0].scenes = [
      {
        id: "set-scene",
        block: "custom",
        nodes: [
          {
            id: "set1",
            type: "container",
            repeat: "participants",
            children: [
              {
                id: "set2",
                type: "container",
                repeat: "participants",
                children: [
                  {
                    id: "set3",
                    type: "container",
                    repeat: "participants",
                    children: [{ id: "leaf", type: "text", text: "x" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const r = compileVideo(d);
    expect(r.ready).toBe(false);
    expect(r.plan.scenes).toHaveLength(0);
    expect(r.diagnostics[0].code).toBe("RESOURCE_BUDGET_EXCEEDED");
  });
  it("bounds blur and accepts track covers", () => {
    const d: any = mixed();
    d.bindings.cover = {
      kind: "track",
      tournamentId: "t",
      trackId: "a",
      media: "cover",
    };
    expect(() => parseVideoDocument(d)).not.toThrow();
    d.segments[0].settings = { card: { blur: 201 } };
    expect(() => parseVideoDocument(d)).toThrow();
  });
});

it("keeps disabled segment templates when their source and participants disappear", () => {
  const d: any = mixed();
  d.segments[1].enabled = false;
  d.source.participants = d.source.participants.filter(
    (p: any) => p.id !== "a",
  );
  d.source.segments = d.source.segments.filter((s: any) => s.id !== "source-a");
  expect(() => parseVideoDocument(d)).not.toThrow();
  expect(compileVideo(d, manifest).ready).toBe(true);
});
it("uses a participant best moment in custom cards and dynamic audio", () => {
  const d: any = mixed();
  d.segments = d.segments.slice(1, 2);
  d.segments[0].scenes = [
    {
      id: "custom",
      block: "custom",
      repeat: "participants",
      duration: { sec: 2 },
      nodes: [
        {
          id: "card",
          type: "card",
          participantId: "$participant",
          style: { offsetSec: 3 },
        },
        {
          id: "sound",
          type: "audio",
          asset: "$participant.audio",
          role: "primary",
          offsetSec: 4,
        },
      ],
    },
  ];
  const r = compileVideo(d, manifest);
  expect(r.ready).toBe(true);
  expect(r.plan.audio.map((a) => a.offsetFrames)).toEqual([360, 360]);
});
it("inherits document music but mutes it under segment playlists and round overrides", () => {
  const d: any = mixed();
  d.audio = { playlist: { tracks: ["song"] } };
  d.source.rounds[0].music = null;
  d.segments[1].audio = { playlist: { tracks: ["song"] } };
  const r = compileVideo(d, manifest);
  expect(r.ready).toBe(true);
  const root = r.plan.audio.find((a) => a.id === "playlist/0")!;
  expect(root.muteWindows).toEqual([
    { from: 30, to: 90 },
    { from: 90, to: 315 },
  ]);
});
it("retains a content-free reusable design when extracting a v2 preset", async () => {
  const { extractVideoPreset } = await import("./index");
  const p = extractVideoPreset(mixed(), { id: "design", name: "Design" });
  expect(p.scenes).toHaveLength(1);
  expect(p.scenes[0].block).toBe("top");
  expect(JSON.stringify(p)).not.toContain("Episode");
});
it("renames segment sound anchors when preset scenes receive global stable IDs", () => {
  const d: any = mixed();
  d.segments = d.segments.slice(1, 2);
  d.segments[0].audio = {
    cues: [
      {
        id: "hit",
        asset: "song",
        role: "sfx",
        at: { sec: 0 },
        duration: { sec: 0.1 },
        anchor: { event: "scene.start", sceneId: "first-scene" },
      },
    ],
  };
  const p = applyVideoPreset(d, getBuiltinPreset("top.minimal.wide")!);
  const r = compileVideo(p, manifest);
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(r.plan.audio.find((a) => a.role === "sfx")?.from).toBe(0);
});
it("counts participants in segment.count and bounds aggregate duration", () => {
  const d: any = mixed();
  d.segments = d.segments.slice(1, 2);
  d.segments[0].participantIds = ["a", "b"];
  d.segments[0].scenes = [
    {
      id: "count",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        { id: "count-text", type: "text", text: { bind: "segment.count" } },
      ],
    },
  ];
  expect(compileVideo(d, manifest).plan.scenes[0].nodes[0].text).toBe("2");
  d.segments = [
    {
      ...d.segments[0],
      id: "long1",
      scenes: [
        { id: "l1", block: "custom", duration: { sec: 4000 }, nodes: [] },
      ],
    },
    {
      ...d.segments[0],
      id: "long2",
      scenes: [
        { id: "l2", block: "custom", duration: { sec: 4000 }, nodes: [] },
      ],
    },
  ];
  const r = compileVideo(d, manifest);
  expect(r.ready).toBe(false);
  expect(r.plan.scenes).toHaveLength(0);
  expect(r.diagnostics[0].code).toBe("RESOURCE_BUDGET_EXCEEDED");
});

it("preserves dynamic media when a design is extracted and reapplied", async () => {
  const { extractVideoPreset } = await import("./index");
  const d: any = mixed();
  d.segments = d.segments.slice(1, 2);
  d.segments[0].scenes = [
    {
      id: "dynamic",
      block: "custom",
      repeat: "participants",
      duration: { sec: 1 },
      nodes: [
        { id: "visual", type: "image", asset: "$participant.visual" },
        {
          id: "audio",
          type: "audio",
          asset: "$participant.audio",
          role: "primary",
        },
      ],
    },
  ];
  const preset = extractVideoPreset(d, {
    id: "dynamic-preset",
    name: "Dynamic",
  });
  const applied = applyVideoPreset(d, preset);
  expect(compileVideo(applied, manifest).ready).toBe(true);
  expect(applied.segments?.[0].scenes[0].nodes[0]).toMatchObject({
    asset: "$participant.visual",
  });
});
it("preserves per-segment sound slot assignments when applying a reusable design", async () => {
  const { extractVideoPreset } = await import("./index");
  const d: any = mixed();
  d.segments = d.segments.slice(1, 2);
  d.bindings.song = { kind: "pool", assetId: "song" };
  d.segments[0].scenes = [
    {
      id: "design",
      block: "custom",
      duration: { sec: 1 },
      nodes: [{ id: "cue", type: "audio", asset: "song", role: "sfx" }],
    },
  ];
  const applied = applyVideoPreset(
    d,
    extractVideoPreset(d, { id: "sound-preset", name: "Sound" }),
  );
  expect(compileVideo(applied, manifest).ready).toBe(true);
});
it("rejects selection without participant repetition", () => {
  const d: any = mixed();
  d.segments[0].scenes[0].nodes = [
    {
      id: "invalid-set",
      type: "container",
      selection: "segment",
      children: [],
    },
  ];
  expect(() => parseVideoDocument(d)).toThrow();
});

it("reports malformed segment inputs instead of throwing before schema validation", () => {
  for (const sourceSegments of [{}, [null]]) {
    const d: any = mixed();
    d.source.segments = sourceSegments;
    expect(() => compileVideo(d, manifest)).not.toThrow();
    expect(compileVideo(d, manifest).ready).toBe(false);
  }
});
it("reorders segments through a document array patch and addresses nested nodes by stable ID", () => {
  const d: any = mixed();
  d.segments[0].scenes[0].nodes = [
    { id: "title", type: "text", text: "Original" },
  ];
  const patched = patchVideoDocument(d, [
    {
      op: "set",
      target: { type: "document" },
      path: ["segments"],
      value: [d.segments[2], d.segments[0], d.segments[1]],
    },
    {
      op: "set",
      target: { type: "node", id: "title" },
      path: ["text"],
      value: "Changed",
    },
  ]);
  expect(
    compileVideo(patched, manifest).plan.segments?.map((s) => s.id),
  ).toEqual(["second", "intro", "first"]);
  expect(patched.segments?.[1].scenes[0].nodes[0]).toMatchObject({
    text: "Changed",
  });
});
it("uses the best moment when participant audio is played in a picker", () => {
  const d: any = mixed();
  d.segments = d.segments.slice(2);
  d.segments[0].participantIds = ["a"];
  d.source.rounds[0].cards[0].participantId = "a";
  const r = compileVideo(d, manifest);
  expect(r.ready).toBe(true);
  expect(r.plan.audio[0].offsetFrames).toBe(360);
});

it("bounds aggregate retained audio policy windows across segments", () => {
  const d: any = mixed();
  d.source.participants = Array.from({ length: 50 }, (_, i) => ({
    id: `p${i}`,
    label: `P${i}`,
    media: { audio: "long" },
  }));
  d.source.segments = [];
  d.segments = Array.from({ length: 7 }, (_, i) => ({
    id: `s${i}`,
    kind: "custom",
    title: `S${i}`,
    audio: { playlist: { tracks: ["tiny"], crossfadeSec: 0 } },
    scenes: [
      {
        id: `scene${i}`,
        block: "custom",
        duration: { sec: 20 },
        nodes: [
          {
            id: `set${i}`,
            type: "container",
            repeat: "participants",
            children: [
              { id: `card${i}`, type: "card", participantId: "$participant" },
            ],
          },
        ],
      },
    ],
  }));
  const r = compileVideo(d, {
    long: { id: "long", kind: "audio", src: "long.wav", durationSec: 60 },
    tiny: { id: "tiny", kind: "audio", src: "tiny.wav", durationSec: 1 / 30 },
  });
  expect(r.ready).toBe(false);
  expect(r.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED")).toBe(
    true,
  );
  expect(r.plan.audio).toHaveLength(0);
});

it("keeps resolved preset slot bindings when applying an extracted design to v2", async () => {
  const { extractVideoPreset } = await import("./index");
  const d: any = createVideoDocument({
    kind: "picker",
    roundCount: 1,
    cardsPerRound: 2,
  });
  d.settings.picker.tick = "assigned-tick";
  d.bindings["assigned-tick"] = { kind: "builtin", name: "tick" };
  Object.assign(d, {
    schemaVersion: 2,
    segments: [
      { id: "picker", kind: "picker", title: "Picker", scenes: d.scenes },
    ],
    scenes: [],
  });
  const applied = applyVideoPreset(
    d,
    extractVideoPreset(d, { id: "sound-design", name: "Sound" }),
  );
  const tick = applied.settings.picker!.tick!;
  expect(applied.bindings[tick]).toEqual({ kind: "builtin", name: "tick" });
  // The service resolves the returned document's bindings, including new aliases.
  const resolved: AssetManifest = {};
  for (const [key, binding] of Object.entries(applied.bindings))
    if (binding.kind === "builtin")
      resolved[key] = {
        id: binding.name,
        kind: "audio",
        src: "tick.wav",
        durationSec: 0.1,
      };
  const compiled = compileVideo(applied, resolved);
  expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
  expect(compiled.ready).toBe(true);
});

it("starts dynamic participant video and its sound at the best moment", () => {
  const d: any = createVideoDocument({
    kind: "top",
    participants: [
      {
        id: "p",
        label: "P",
        bestMomentSec: 12,
        media: { visual: "clip", audio: "clip" },
      },
    ],
  });
  Object.assign(d, {
    schemaVersion: 2,
    scenes: [],
    segments: [
      {
        id: "clip-segment",
        kind: "top",
        title: "Clip",
        participantIds: ["p"],
        scenes: [
          {
            id: "clip-scene",
            block: "custom",
            repeat: "participants",
            duration: { sec: 2 },
            nodes: [
              {
                id: "dynamic-video",
                type: "video",
                asset: "$participant.visual",
                style: { playSound: true, offsetSec: 3 },
              },
              {
                id: "authored-video",
                type: "video",
                asset: "clip",
                style: { playSound: false, offsetSec: 3 },
              },
            ],
          },
        ],
      },
    ],
  });
  const result = compileVideo(d, {
    clip: {
      id: "clip",
      kind: "video",
      src: "clip.mp4",
      durationSec: 60,
      hasAudio: true,
    },
  });
  expect(result.ready).toBe(true);
  expect(
    result.plan.scenes[0].nodes.find((n) => n.id.endsWith("dynamic-video"))
      ?.media?.offsetFrames,
  ).toBe(360);
  expect(result.plan.audio).toHaveLength(1);
  expect(result.plan.audio[0].offsetFrames).toBe(360);
  expect(
    result.plan.scenes[0].nodes.find((n) => n.id.endsWith("authored-video"))
      ?.media?.offsetFrames,
  ).toBe(90);
});

it.each(["node", "participant", "scene", "container", "document"])(
  "mutes v2 custom participant audio only when %s explicitly disables card sound",
  (layer) => {
    const d: any = createVideoDocument({
      kind: "top",
      participants: [{ id: "p", label: "P", media: { audio: "song" } }],
    });
    const card: any = { id: "card", type: "card", participantId: "p" };
    d.scenes = [
      { id: "custom", block: "custom", duration: { sec: 1 }, nodes: [card] },
    ];
    const compile = () =>
      compileVideo(
        {
          ...d,
          schemaVersion: 2,
          scenes: [],
          segments: [
            { id: "muted-v2", kind: "top", title: "Muted", scenes: d.scenes },
          ],
        },
        manifest,
      );
    expect(compile().plan.audio).toHaveLength(1);
    if (layer === "node") card.style = { playSound: false };
    if (layer === "participant")
      d.source.participants[0].settings = { card: { playSound: false } };
    if (layer === "scene")
      d.scenes[0].settings = { card: { playSound: false } };
    if (layer === "container")
      d.scenes[0].nodes = [
        {
          id: "muted",
          type: "container",
          style: { playSound: false },
          children: [card],
        },
      ];
    if (layer === "document") d.settings.card = { playSound: false };
    const muted = compile();
    expect(muted.ready).toBe(true);
    expect(muted.plan.audio).toHaveLength(0);
    card.style = { playSound: true };
    expect(compile().plan.audio).toHaveLength(1);
  },
);
it("does not require a muted v2 custom card's unused participant audio", () => {
  const d: any = createVideoDocument({
    kind: "top",
    participants: [{ id: "p", label: "P", media: { audio: "unresolved" } }],
  });
  d.scenes = [
    {
      id: "muted",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        {
          id: "card",
          type: "card",
          participantId: "p",
          style: { playSound: false },
        },
      ],
    },
  ];
  const result = compileVideo({
    ...d,
    schemaVersion: 2,
    scenes: [],
    segments: [
      { id: "muted-v2", kind: "top", title: "Muted", scenes: d.scenes },
    ],
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.plan.audio).toEqual([]);
});

it.each([false, true])(
  "counts local and document audio policies together (global playlist: %s)",
  (globalPlaylist) => {
    const d: any = createVideoDocument({
      kind: "picker",
      participants: [{ id: "p", label: "P" }],
      rounds: Array.from({ length: 200 }, (_, i) => ({
        id: `policy-round${i}`,
        cards: [{ id: `policy-card${i}`, participantId: "p" }],
        music: null,
      })),
    });
    d.settings.picker = { leadSec: 0, revealSec: 1, timerSec: 0 };
    Object.assign(d, {
      schemaVersion: 2,
      scenes: [],
      segments: Array.from({ length: 2 }, (_, i) => ({
        id: `policy-segment${i}`,
        kind: "picker",
        title: `S${i}`,
        roundIds: Array.from(
          { length: 100 },
          (_, r) => `policy-round${i * 100 + r}`,
        ),
        audio: { playlist: { tracks: ["local"], crossfadeSec: 0 } },
        scenes: [
          {
            id: `policy-scene${i}`,
            block: "picker",
            repeat: "rounds",
            nodes: [],
          },
        ],
      })),
    });
    if (globalPlaylist)
      d.audio = { playlist: { tracks: ["global"], crossfadeSec: 0 } };
    const result = compileVideo(d, {
      local: { id: "local", kind: "audio", src: "local.wav", durationSec: 0.1 },
      global: {
        id: "global",
        kind: "audio",
        src: "global.wav",
        durationSec: 1,
      },
    });
    expect(result.ready).toBe(!globalPlaylist);
    expect(
      result.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED"),
    ).toBe(globalPlaylist);
    expect(
      result.plan.audio.reduce(
        (sum, cue) => sum + cue.muteWindows.length + cue.duckWindows.length,
        0,
      ),
    ).toBe(globalPlaylist ? 0 : 200000);
  },
);

it.each([false, true])(
  "keeps distinct scene tick assignments across picker segments after preset extraction (global tick: %s)",
  async (globalTick) => {
    const { extractVideoPreset } = await import("./index");
    const d: any = createVideoDocument({
      kind: "picker",
      participants: [{ id: "p", label: "P" }],
      rounds: [
        { id: "rA", cards: [{ id: "cA", participantId: "p" }] },
        { id: "rB", cards: [{ id: "cB", participantId: "p" }] },
      ],
    });
    d.bindings = {
      toneA: { kind: "pool", assetId: "audioA" },
      toneB: { kind: "pool", assetId: "audioB" },
    };
    d.settings.picker = {
      leadSec: 0,
      revealSec: 0.2,
      timerSec: 1,
      ...(globalTick ? { tick: "toneA" } : {}),
    };
    Object.assign(d, {
      schemaVersion: 2,
      scenes: [],
      segments: [
        {
          id: "first",
          kind: "picker",
          title: "First",
          roundIds: ["rA"],
          scenes: [
            {
              id: "sceneA",
              block: "picker",
              roundId: "rA",
              settings: { picker: { tick: "toneA" } },
              nodes: [],
            },
          ],
        },
        {
          id: "second",
          kind: "picker",
          title: "Second",
          roundIds: ["rB"],
          scenes: [
            {
              id: "sceneB",
              block: "picker",
              roundId: "rB",
              settings: { picker: { tick: "toneB" } },
              nodes: [],
            },
          ],
        },
      ],
    });
    const applied = applyVideoPreset(
      d,
      extractVideoPreset(d, { id: "tick-design", name: "Ticks" }),
    );
    const resolved: AssetManifest = {};
    for (const [key, binding] of Object.entries(applied.bindings))
      if (binding.kind === "pool")
        resolved[key] = {
          id: binding.assetId,
          kind: "audio",
          src: binding.assetId + ".wav",
          durationSec: 0.1,
        };
    const result = compileVideo(applied, resolved);
    expect(result.ready).toBe(true);
    expect(
      result.plan.audio
        .filter((c) => c.id.startsWith("first/"))
        .map((c) => c.asset.id),
    ).toEqual(["audioA"]);
    expect(
      result.plan.audio
        .filter((c) => c.id.startsWith("second/"))
        .map((c) => c.asset.id),
    ).toEqual(["audioB"]);
    const firstTick = applied.segments![0].scenes[0].settings!.picker!.tick!;
    const secondTick = applied.segments![1].scenes[0].settings!.picker!.tick!;
    expect(firstTick).not.toBe(secondTick);
    expect(applied.bindings[firstTick]).toEqual({
      kind: "pool",
      assetId: "audioA",
    });
    expect(applied.bindings[secondTick]).toEqual({
      kind: "pool",
      assetId: "audioB",
    });
  },
);

it("retains v1 separate participant audio when custom card disables only visual sound", () => {
  const d = createVideoDocument({
    kind: "top",
    participants: [{ id: "legacy", label: "Legacy", media: { audio: "song" } }],
  });
  d.scenes = [
    {
      id: "legacy-custom",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        {
          id: "legacy-card",
          type: "card",
          participantId: "legacy",
          style: { playSound: false },
        },
      ],
    },
  ];
  const result = compileVideo(d, manifest);
  expect(result.ready).toBe(true);
  expect(
    result.plan.audio.map((c) => ({
      from: c.from,
      duration: c.durationInFrames,
      offset: c.offsetFrames,
      asset: c.asset.id,
    })),
  ).toEqual([{ from: 0, duration: 30, offset: 0, asset: "song" }]);
});
