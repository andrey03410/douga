import { describe, it, expect } from "vitest";
import {
  compileVideo,
  collectVideoAssetKeys,
  getVideoDocumentJsonSchema,
  createVideoDocument,
  extractVideoPreset,
  applyVideoPreset,
  parseVideoDocument,
  patchVideoDocument,
  scene,
  node,
  frame,
  getBuiltinPreset,
  type AssetManifest,
} from "./index";
const assets: AssetManifest = {
  image: { id: "i", kind: "image", src: "/i.png" },
  video: {
    id: "v",
    kind: "video",
    src: "/v.mp4",
    durationSec: 1,
    hasAudio: true,
  },
  audio: { id: "a", kind: "audio", src: "/a.mp3", durationSec: 3 },
};
const top = () =>
  createVideoDocument({
    kind: "top",
    participants: [
      { id: "b", label: "B", rank: 2 },
      { id: "a", label: "A", rank: 1 },
    ],
  });
describe("SDK boundary invariants", () => {
  it("source ordering does not silently sort authors ordering", () => {
    const d = top();
    d.settings.top = { order: "source" };
    expect(compileVideo(d).plan.scenes.map((s) => s.participantId)).toEqual([
      "b",
      "a",
    ]);
    d.settings.top.order = "ascending";
    expect(compileVideo(d).plan.scenes.map((s) => s.participantId)).toEqual([
      "a",
      "b",
    ]);
  });
  it("preserves inherited snippet fields across a local snippet mode override", () => {
    const d = top();
    d.source.participants = d.source.participants.slice(0, 1);
    d.source.participants[0].media = { audio: "audio" };
    d.settings.top = {
      snippet: { mode: "manual", startSec: 1, durationSec: 1 },
    };
    d.source.participants[0].settings = {
      top: { snippet: { mode: "manual" } },
    };
    const p = compileVideo(d, assets).plan;
    expect(p.scenes[0].durationInFrames).toBe(30);
    expect(p.audio[0].offsetFrames).toBe(30);
  });
  it("resolves custom media/audio primitives with frame-exact timings and muted visuals", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "custom",
        duration: frame(90),
        nodes: [
          node({
            type: "video",
            id: "v",
            asset: "video",
            rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
            style: { loop: false, playSound: true },
            timing: { at: frame(10), duration: frame(60) },
          }),
          node({
            type: "audio",
            id: "voice",
            asset: "audio",
            role: "voice",
            timing: { at: frame(5), duration: frame(10) },
          }),
        ],
      }),
    ];
    const p = compileVideo(d, assets).plan;
    expect(p.scenes[0].nodes[0].media).toMatchObject({
      loopFrames: null,
      freezeAtFrame: 29,
    });
    expect(p.audio.map((a) => [a.role, a.from, a.durationInFrames])).toEqual([
      ["voice", 5, 10],
      ["primary", 10, 30],
    ]);
  });
  it("custom participant cards resolve separate audio and honor hidden rank", () => {
    const d = top();
    d.source.participants[0].media = { audio: "audio" };
    d.settings.labels = { showRank: false };
    d.scenes = [
      scene({
        id: "custom",
        duration: frame(60),
        nodes: [node({ id: "c", type: "card", participantId: "b" })],
      }),
    ];
    const p = compileVideo(d, assets).plan;
    expect(p.scenes[0].nodes[0].showRank).toBe(false);
    expect(p.audio[0]).toMatchObject({ role: "primary", durationInFrames: 60 });
  });
  it("unsetting a missing intermediate path never deletes a different existing field", () => {
    const d = top();
    const p = patchVideoDocument(d, [
      {
        op: "unset",
        target: { type: "participant", id: "b" },
        path: ["settings", "label"],
      },
    ]);
    expect(p.source.participants[0].label).toBe("B");
  });
  it("rejects wrong manifest kind, pinned hash mismatch and invalid loop offsets", () => {
    const d = top();
    d.source.participants[0].media = { visual: "audio" };
    expect(compileVideo(d, assets).diagnostics[0].code).toBe(
      "ASSET_KIND_MISMATCH",
    );
    d.source.participants[0].media = { visual: "video" };
    d.bindings.video = { kind: "pool", assetId: "v", hash: "expected" };
    expect(compileVideo(d, assets).diagnostics[0].code).toBe(
      "ASSET_HASH_MISMATCH",
    );
    delete d.bindings.video;
    d.source.participants[0].settings = { card: { offsetSec: 1 } };
    expect(compileVideo(d, assets).diagnostics[0].code).toBe(
      "MEDIA_OFFSET_OUT_OF_RANGE",
    );
  });
  it("refuses a pool manifest that resolves the wrong asset id", () => {
    const d = top();
    d.source.participants[0].media = { visual: "image" };
    d.bindings.image = { kind: "pool", assetId: "another" };
    expect(compileVideo(d, assets).diagnostics[0].code).toBe(
      "ASSET_ID_MISMATCH",
    );
  });
  it("prevents CSS media URLs from becoming hidden bindings", () => {
    const d = top();
    d.settings.background = "url(https://foreign.test/secret.png)";
    expect(() => parseVideoDocument(d)).toThrow();
  });
  it("extracts binding prefixes and media references without leaking project content", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "secretScene",
        repeat: "participants",
        nodes: [
          node({
            type: "text",
            id: "t",
            text: {
              bind: "participant.label",
              prefix: "SECRET ",
              suffix: " PRIVATE",
            },
          }),
          node({ type: "video", id: "v", asset: "secret-video" }),
        ],
      }),
    ];
    const p = extractVideoPreset(d, { id: "p", name: "Layout" });
    expect(JSON.stringify(p)).not.toMatch(
      /SECRET|PRIVATE|secret-video|secretScene/,
    );
    expect(p.scenes[0].nodes[0]).toMatchObject({
      text: { bind: "participant.label" },
    });
  });
  it("refuses actual media and participant bindings inside user-supplied presets", () => {
    const d = top();
    const p = getBuiltinPreset("top.classic.wide")!;
    p.scenes[0].nodes = [node({ type: "video", id: "v", asset: "private-id" })];
    expect(() => applyVideoPreset(d, p)).toThrow();
    p.scenes[0].nodes = [
      node({ type: "card", id: "c", participantId: "private-person" }),
    ];
    expect(() => applyVideoPreset(d, p)).toThrow();
  });
  it("rejects zero frame scenes, mismatched repetition and overflowing timestamps before compile", () => {
    const d = top();
    d.scenes = [scene({ id: "x", duration: frame(0), nodes: [] })];
    expect(() => parseVideoDocument(d)).toThrow();
    d.scenes = [
      { id: "x", block: "picker", repeat: "participants", nodes: [] },
    ];
    expect(() => parseVideoDocument(d)).toThrow();
    d.scenes = [
      {
        id: "x",
        block: "custom",
        nodes: [],
        duration: { sec: Number.MAX_VALUE },
      },
    ];
    expect(() => parseVideoDocument(d)).toThrow();
  });
  it("diagnoses invalid free placements and duplicate/missing group membership", () => {
    const d = createVideoDocument({ kind: "picker", roundCount: 1 });
    d.source.rounds[0].groups = [
      { id: "g", cardIds: ["card-1-1", "card-1-1"] },
    ];
    expect(compileVideo(d).diagnostics.map((d) => d.code)).toContain(
      "GROUP_MEMBERSHIP_INVALID",
    );
    delete d.source.rounds[0].groups;
    d.settings.layout = { type: "free", positions: [] };
    expect(compileVideo(d).diagnostics.map((d) => d.code)).toContain(
      "LAYOUT_POSITIONS_MISMATCH",
    );
  });
  it("keeps only one primary voice per group and handles null music as explicit silence", () => {
    const d = createVideoDocument({
      kind: "picker",
      presetId: "picker.two-groups.wide",
      roundCount: 1,
    });
    d.source.participants.forEach((p) => (p.media = { visual: "video" }));
    d.settings.card = { playSound: true };
    d.source.rounds[0].music = null;
    d.audio = { playlist: { tracks: ["audio"], loop: true } };
    const p = compileVideo(d, assets).plan;
    expect(p.audio.filter((a) => a.role === "primary")).toHaveLength(2);
    expect(p.audio.find((a) => a.role === "music")?.muteWindows).toEqual([
      { from: 0, to: p.durationInFrames },
    ]);
  });
});

describe("portable compiler output", () => {
  it("produces a JSON round-trippable plan with no undefined properties", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "custom",
        nodes: [node({ type: "text", id: "t", text: "Hello" })],
      }),
    ];
    const p = compileVideo(d).plan;
    expect(JSON.parse(JSON.stringify(p))).toStrictEqual(p);
  });
  it("diagnoses overlapping keyframe timestamps after FPS rounding", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "custom",
        nodes: [
          node({
            type: "text",
            id: "t",
            text: "Hello",
            animation: [
              {
                property: "opacity",
                keyframes: [
                  { at: { sec: 0 }, value: 0 },
                  { at: { sec: 0.001 }, value: 1 },
                ],
              },
            ],
          }),
        ],
      }),
    ];
    expect(compileVideo(d).diagnostics.map((d) => d.code)).toContain(
      "ANIMATION_KEYFRAMES_INVALID",
    );
  });
  it("keeps generated scene identifiers unambiguous when source identifiers contain slashes", () => {
    const d = top();
    d.source.participants = [
      { id: "c", label: "C" },
      { id: "b/c", label: "BC" },
    ];
    d.scenes = [
      { id: "a/b", block: "top", participantId: "c", nodes: [] },
      { id: "a", block: "top", participantId: "b/c", nodes: [] },
    ];
    expect(new Set(compileVideo(d).plan.scenes.map((s) => s.id)).size).toBe(2);
  });
});

describe("discovery and service integration", () => {
  it("exports a recursive strict JSON schema for external agent authoring", () => {
    const schema = getVideoDocumentJsonSchema() as any;
    expect(schema.additionalProperties).toBe(false);
    expect(
      schema.definitions.VideoNode.anyOf.map(
        (item: any) => item.properties.type.const,
      ),
    ).toEqual([
      "container",
      "text",
      "shape",
      "image",
      "video",
      "card",
      "timer",
      "audio",
    ]);
    expect(
      schema.definitions.VideoNode.anyOf[0].properties.children.items.$ref,
    ).toBe("#/definitions/VideoNode");
  });
  it("collects all declared and reachable keys for protection, including draft-only bindings", () => {
    const d = top();
    d.bindings.unused = { kind: "pool", assetId: "draft-only" };
    d.source.participants[0].media = { visual: "image", audio: "audio" };
    d.scenes[0].background = "background";
    d.scenes[0].nodes = [
      node({
        type: "container",
        id: "parent",
        children: [
          node({ type: "audio", id: "voice", role: "voice", asset: "voice" }),
        ],
      }),
    ];
    d.formatSettings = { vertical: { picker: { tick: "tick" } } };
    d.audio = { playlist: { tracks: ["music"] } };
    expect(collectVideoAssetKeys(d)).toEqual([
      "audio",
      "background",
      "image",
      "music",
      "tick",
      "unused",
      "voice",
    ]);
  });
  it("reuses extracted bound scenes for new projects while preserving existing selections on apply", () => {
    const d = top();
    d.scenes = [scene({ id: "specific", block: "top", participantId: "b" })];
    const preset = extractVideoPreset(d, { id: "reuse", name: "Reusable" });
    expect(preset.scenes[0].repeat).toBe("participants");
    expect(preset.scenes[0].participantId).toBeUndefined();

    const applied = compileVideo(applyVideoPreset(d, preset));
    expect(applied.ready).toBe(true);
    expect(applied.plan.scenes.map((s) => s.participantId)).toEqual(["b"]);
    expect(
      applied.plan.scenes[0].nodes.find((n) => n.type === "card")?.label,
    ).toBe("B");

    const created = compileVideo(
      createVideoDocument({
        kind: "top",
        preset,
        participants: d.source.participants,
      }),
    );
    expect(created.ready).toBe(true);
    expect(created.plan.scenes.map((s) => s.participantId)).toEqual(["b", "a"]);
    expect(
      created.plan.scenes
        .flatMap((s) => s.nodes)
        .filter((n) => n.type === "card")
        .map((n) => n.label),
    ).toEqual(["B", "A"]);
  });
});

describe("nested authoring and stale source references", () => {
  it("does not silently lose an explicit custom-scene participant after a source deletion", () => {
    const d = top();
    d.scenes = [scene({ id: "specific", participantId: "removed", nodes: [] })];
    expect(compileVideo(d).diagnostics.map((d) => d.code)).toContain(
      "PARTICIPANT_NOT_FOUND",
    );
  });
  it("inherits container styling while preserving child exceptions", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "nested",
        nodes: [
          node({
            type: "container",
            id: "group",
            style: { fontSize: 20, color: "#ff0000" },
            children: [
              node({ type: "text", id: "a", text: "Inherited" }),
              node({
                type: "text",
                id: "b",
                text: "Local",
                style: { fontSize: 30 },
              }),
            ],
          }),
        ],
      }),
    ];
    expect(
      compileVideo(d)
        .plan.scenes[0].nodes.filter((n) => n.type === "text")
        .map((n) => [n.style.fontSize, n.style.color]),
    ).toEqual([
      [20, "#ff0000"],
      [30, "#ff0000"],
    ]);
  });
  it("resolves explicit group-label text bindings inside a repeated round", () => {
    const d = createVideoDocument({
      kind: "picker",
      presetId: "picker.two-groups.wide",
      roundCount: 1,
    });
    d.scenes[0].nodes = [
      node({
        type: "text",
        id: "group-label",
        text: { bind: "group.label", groupId: "group-1-1" },
      }),
    ];
    expect(
      compileVideo(d).plan.scenes[0].nodes.find((n) =>
        n.id.endsWith("/group-label"),
      )?.text,
    ).toBe("Group 1");
  });
  it("diagnoses malformed free layouts inside containers", () => {
    const d = top();
    d.scenes = [
      scene({
        id: "custom",
        nodes: [
          node({
            type: "container",
            id: "free",
            layout: { type: "free", positions: [] },
            children: [node({ type: "text", id: "t", text: "Hello" })],
          }),
        ],
      }),
    ];
    expect(compileVideo(d).diagnostics.map((d) => d.code)).toContain(
      "LAYOUT_POSITIONS_MISMATCH",
    );
  });
});

it("retains per-card label exceptions in a separate answer scene", () => {
  const d = createVideoDocument({
    kind: "picker",
    presetId: "picker.separate-answer.wide",
    roundCount: 1,
  });
  const r = d.source.rounds[0];
  r.answer = { cardIds: ["card-1-1"] };
  r.cards[0].settings = { labels: { mode: "never" } };
  r.cards[1].settings = { labels: { mode: "active" } };
  r.cards[2].settings = { labels: { mode: "answer" } };
  const answer = compileVideo(d).plan.scenes[1];
  expect(
    answer.nodes.filter((n) => n.type === "card").map((n) => n.labelWindows),
  ).toEqual([[], [], [{ from: 0, to: 75 }], [{ from: 0, to: 75 }]]);
});

describe("review SDK-1: same-source snippet synchronization", () => {
  const videoManifest: AssetManifest = {
    footage: {
      id: "shared-video",
      kind: "video",
      src: "/ten-seconds.mp4",
      durationSec: 10,
      hasAudio: true,
    },
    soundtrack: {
      id: "shared-video",
      kind: "video",
      src: "/ten-seconds.mp4",
      durationSec: 10,
      hasAudio: true,
    },
    separate: {
      id: "other-audio",
      kind: "audio",
      src: "/other.mp3",
      durationSec: 10,
    },
  };
  it.each(["manual", "active"] as const)(
    "synchronizes %s snippets when visual and primary audio resolve to the same video",
    (mode) => {
      const d = top();
      d.source.participants = d.source.participants.slice(0, 1);
      d.source.participants[0].media = {
        visual: "footage",
        audio: "soundtrack",
      };
      d.settings.top = {
        snippet:
          mode === "manual"
            ? { mode, startSec: 3, durationSec: 2 }
            : { mode, activeStartSec: 3, activeEndSec: 5 },
      };
      const compiled = compileVideo(d, videoManifest);
      expect(compiled.ready).toBe(true);
      expect(compiled.plan.scenes[0].durationInFrames).toBe(60);
      expect(compiled.plan.scenes[0].nodes[0].media?.offsetFrames).toBe(90);
      expect(compiled.plan.audio[0].offsetFrames).toBe(90);
    },
  );
  it.each(["document", "format", "scene", "participant"] as const)(
    "keeps an explicit independent zero footage offset at the %s layer",
    (layer) => {
      const d = top();
      d.source.participants = d.source.participants.slice(0, 1);
      d.source.participants[0].media = {
        visual: "footage",
        audio: "soundtrack",
      };
      d.settings.top = {
        snippet: { mode: "manual", startSec: 3, durationSec: 2 },
      };
      if (layer === "document") d.settings.card = { offsetSec: 0 };
      if (layer === "format")
        d.formatSettings = { wide: { card: { offsetSec: 0 } } };
      if (layer === "scene") d.scenes[0].settings = { card: { offsetSec: 0 } };
      if (layer === "participant")
        d.source.participants[0].settings = { card: { offsetSec: 0 } };
      const compiled = compileVideo(d, videoManifest);
      expect(compiled.ready).toBe(true);
      expect(compiled.plan.scenes[0].nodes[0].media?.offsetFrames).toBe(0);
      expect(compiled.plan.audio[0].offsetFrames).toBe(90);
    },
  );
  it("keeps unrelated footage independent of the selected audio snippet", () => {
    const d = top();
    d.source.participants = d.source.participants.slice(0, 1);
    d.source.participants[0].media = { visual: "footage", audio: "separate" };
    d.settings.top = {
      snippet: { mode: "manual", startSec: 3, durationSec: 2 },
    };
    const compiled = compileVideo(d, videoManifest);
    expect(compiled.plan.scenes[0].nodes[0].media?.offsetFrames).toBe(0);
    expect(compiled.plan.audio[0].offsetFrames).toBe(90);
  });
});

describe("review SDK-2: explicit references versus repetition", () => {
  it.each(["existing", "deleted"] as const)(
    "rejects participant repetition with an %s explicit identity",
    (identity) => {
      const d = top();
      d.scenes[0].participantId = identity === "existing" ? "b" : "deleted";
      expect(() => parseVideoDocument(d)).toThrow();
      const compiled = compileVideo(d);
      expect(compiled.ready).toBe(false);
      expect(compiled.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "SCHEMA_INVALID",
          path: "scenes.0.repeat",
        }),
      );
      expect(compiled.plan.scenes).toEqual([]);
    },
  );
  it.each(["existing", "deleted"] as const)(
    "rejects round repetition with an %s explicit identity",
    (identity) => {
      const d = createVideoDocument({ kind: "picker", roundCount: 1 });
      d.scenes[0].roundId = identity === "existing" ? "round-1" : "deleted";
      expect(() => parseVideoDocument(d)).toThrow();
      const compiled = compileVideo(d);
      expect(compiled.ready).toBe(false);
      expect(compiled.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "SCHEMA_INVALID",
          path: "scenes.0.repeat",
        }),
      );
      expect(compiled.plan.scenes).toEqual([]);
    },
  );
});

describe("review SDK-3: free-layout cardinality in every block", () => {
  const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  it.each(["missing", "empty", "extra"] as const)(
    "makes top plans non-ready for %s free positions while retaining inspection geometry",
    (variant) => {
      const d = top();
      d.source.participants = d.source.participants.slice(0, 1);
      d.settings.layout = {
        type: "free",
        ...(variant === "missing"
          ? {}
          : { positions: variant === "empty" ? [] : [rect, rect] }),
      };
      const compiled = compileVideo(d);
      expect(compiled.ready).toBe(false);
      expect(compiled.diagnostics).toContainEqual(
        expect.objectContaining({ code: "LAYOUT_POSITIONS_MISMATCH" }),
      );
      expect(compiled.plan.scenes[0].nodes[0].rect.width).toBeGreaterThan(0);
    },
  );
  it.each(["missing", "empty", "extra"] as const)(
    "makes grouped picker plans non-ready for %s group free positions",
    (variant) => {
      const d = createVideoDocument({
        kind: "picker",
        presetId: "picker.two-groups.wide",
        roundCount: 1,
      });
      d.source.rounds[0].groups![0].settings = {
        layout: {
          type: "free",
          ...(variant === "missing"
            ? {}
            : { positions: variant === "empty" ? [] : [rect, rect, rect] }),
        },
      };
      const compiled = compileVideo(d);
      expect(compiled.ready).toBe(false);
      expect(compiled.diagnostics).toContainEqual(
        expect.objectContaining({ code: "LAYOUT_POSITIONS_MISMATCH" }),
      );
      expect(
        compiled.plan.scenes[0].nodes.filter((n) => n.type === "card"),
      ).toHaveLength(4);
    },
  );
  it("continues accepting valid top and group placements", () => {
    const d = top();
    d.source.participants = d.source.participants.slice(0, 1);
    d.settings.layout = { type: "free", positions: [rect] };
    const topResult = compileVideo(d);
    expect(topResult.ready).toBe(true);
    expect(topResult.plan.scenes[0].nodes[0].rect).toEqual({
      x: 192,
      y: 108,
      width: 384,
      height: 216,
    });
    const grouped = createVideoDocument({
      kind: "picker",
      presetId: "picker.two-groups.wide",
      roundCount: 1,
    });
    grouped.source.rounds[0].groups![0].settings = {
      layout: { type: "free", positions: [rect, { ...rect, x: 0.5 }] },
    };
    expect(compileVideo(grouped).ready).toBe(true);
  });
});
