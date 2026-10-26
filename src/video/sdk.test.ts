import { describe, expect, it } from "vitest";
import {
  createVideoDocument,
  compileVideo,
  parseVideoDocument,
  getBuiltinPresets,
  getBuiltinPreset,
  extractVideoPreset,
  applyVideoPreset,
  patchVideoDocument,
  scene,
  textNode,
  containerNode,
  time,
  getVideoDocumentJsonSchema,
  type VideoDocument,
  type AssetManifest,
} from "./index";

const manifest: AssetManifest = {
  art: { id: "art1", kind: "image", src: "/art.png", width: 100, height: 100 },
  clip: {
    id: "clip1",
    kind: "video",
    src: "/clip.mp4",
    durationSec: 2,
    hasAudio: true,
  },
  song: { id: "song1", kind: "audio", src: "/song.mp3", durationSec: 4 },
  tick: { id: "tick", kind: "audio", src: "/tick.wav", durationSec: 0.1 },
};
function top(): VideoDocument {
  return createVideoDocument({
    kind: "top",
    participants: [
      { id: "a", label: "Альфа", rank: 1, media: { visual: "art" } },
      {
        id: "b",
        label: "Бета",
        rank: 2,
        settings: { card: { fit: "contain" } },
      },
    ],
  });
}
function picker(count = 4): VideoDocument {
  return createVideoDocument({
    kind: "picker",
    participants: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      label: `Карточка ${i}`,
    })),
    rounds: [
      {
        id: "r",
        prompt: "Выбери",
        cards: Array.from({ length: count }, (_, i) => ({
          id: `c${i}`,
          participantId: `p${i}`,
        })),
        answer: { cardIds: ["c1"] },
      },
    ],
  });
}
const cards = (doc: VideoDocument) =>
  compileVideo(doc, manifest)
    .plan.scenes.flatMap((s) => s.nodes)
    .filter((n) => n.type === "card");

describe("canonical document and deterministic compilation", () => {
  it("repeats ranked participants by stable identity and preserves rank independently of display order", () => {
    const d = top();
    d.settings.top = { order: "descending" };
    const before = compileVideo(d, manifest);
    expect(before.ready).toBe(true);
    expect(before.plan.scenes.map((s) => s.participantId)).toEqual(["b", "a"]);
    expect(cards(d).map((n) => [n.participantId, n.rank, n.style.fit])).toEqual(
      [
        ["b", 2, "contain"],
        ["a", 1, "cover"],
      ],
    );
    d.source.participants = [
      { id: "new", label: "Новый", rank: 1 },
      { ...d.source.participants[0], rank: 3 },
      { ...d.source.participants[1], rank: 2 },
    ];
    expect(cards(d).map((n) => [n.participantId, n.rank, n.style.fit])).toEqual(
      [
        ["a", 3, "cover"],
        ["b", 2, "contain"],
        ["new", 1, "cover"],
      ],
    );
    expect(compileVideo(d, manifest)).toEqual(
      compileVideo(JSON.parse(JSON.stringify(d)), manifest),
    );
  });
  it("merges project, format, scene, round and local overrides without replacing siblings", () => {
    const d = picker();
    d.settings.card = { fit: "fill", borderRadius: 8 };
    d.formatSettings = { wide: { card: { fit: "contain" } } };
    d.scenes[0].settings = { card: { borderRadius: 14 } };
    d.source.rounds[0].settings = { card: { fit: "cover" } };
    d.source.rounds[0].cards[0].settings = { card: { fit: "contain" } };
    expect(
      cards(d)
        .slice(0, 2)
        .map((n) => [n.style.fit, n.style.borderRadius]),
    ).toEqual([
      ["contain", 14],
      ["cover", 14],
    ]);
  });
  it.each(["wide", "vertical", "square"] as const)(
    "lays out 17 cards inside %s with useful positive geometry",
    (format) => {
      const d = picker(17);
      d.output.format = format;
      const p = compileVideo(d).plan;
      expect(p.scenes[0].nodes.filter((n) => n.type === "card")).toHaveLength(
        17,
      );
      for (const n of p.scenes[0].nodes) {
        expect(n.rect.x).toBeGreaterThanOrEqual(0);
        expect(n.rect.y).toBeGreaterThanOrEqual(0);
        expect(n.rect.x + n.rect.width).toBeLessThanOrEqual(p.width + 0.01);
        expect(n.rect.y + n.rect.height).toBeLessThanOrEqual(p.height + 0.01);
        expect(n.rect.width).toBeGreaterThan(0);
      }
    },
  );
  it("supports arc and free placements without silently dropping cards", () => {
    const d = picker();
    d.settings.layout = { type: "arc" };
    expect(new Set(cards(d).map((n) => n.rect.y)).size).toBeGreaterThan(1);
    d.settings.layout = {
      type: "free",
      positions: [
        { x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
        { x: 0.4, y: 0.2, width: 0.2, height: 0.3 },
        { x: 0.1, y: 0.6, width: 0.2, height: 0.3 },
        { x: 0.4, y: 0.6, width: 0.2, height: 0.3 },
      ],
    };
    expect(cards(d)[0].rect).toEqual({
      x: 192,
      y: 216,
      width: 384,
      height: 324,
    });
  });
  it("compiles group reveal, optional group answer, memory hiding and separate answer scenes", () => {
    const d = picker();
    const r = d.source.rounds[0];
    r.groups = [
      { id: "g1", label: "Первый", cardIds: ["c0", "c1"] },
      { id: "g2", label: "Второй", cardIds: ["c2", "c3"] },
    ];
    r.answer = { groupIds: ["g2"] };
    d.settings.picker = {
      hideAfterReveal: true,
      answerMode: "separate",
      revealSec: 1,
      timerSec: 2,
      leadSec: 0,
      answerSec: 1,
    };
    const p = compileVideo(d).plan;
    expect(p.scenes.map((s) => s.kind)).toEqual(["picker", "answer"]);
    expect(p.scenes[0].phases.timerStartFrame).toBe(60);
    expect(p.scenes[0].nodes.filter((n) => n.type === "group")).toHaveLength(2);
    expect(
      p.scenes[1].nodes.filter((n) => n.type === "card" && n.answer),
    ).toHaveLength(2);
    expect(
      p.scenes[0].nodes.find((n) => n.id.endsWith("/c0"))?.visible,
    ).toEqual([
      { from: 0, to: 30 },
      { from: 60, to: 120 },
    ]);
    delete r.answer;
    expect(compileVideo(d).plan.scenes).toHaveLength(1);
  });
  it.each(["always", "finale", "never", "active", "answer"] as const)(
    "resolves %s label phases",
    (mode) => {
      const d = picker();
      d.settings.labels = { mode };
      d.settings.picker = {
        leadSec: 0,
        revealSec: 1,
        timerSec: 2,
        answerSec: 1,
      };
      const n = cards(d)[0];
      const wanted = {
        always: [{ from: 0, to: 210 }],
        finale: [{ from: 120, to: 210 }],
        never: [],
        active: [{ from: 0, to: 30 }],
        answer: [{ from: 180, to: 210 }],
      };
      expect(n.labelWindows).toEqual(wanted[mode]);
    },
  );
  it("resolves footage crop/fit/offset/loop and keeps separate primary audio", () => {
    const d = top();
    d.source.participants = d.source.participants.slice(0, 1);
    d.source.participants[0].media = { visual: "clip", audio: "song" };
    d.source.participants[0].settings = {
      card: {
        fit: "fill",
        crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
        offsetSec: 1,
        loop: true,
        playSound: true,
      },
    };
    const p = compileVideo(d, manifest).plan;
    const n = p.scenes[0].nodes.find((n) => n.type === "card")!;
    expect(n.media).toMatchObject({
      asset: manifest.clip,
      offsetFrames: 30,
      loopFrames: 30,
      fit: "fill",
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    });
    expect(p.audio.filter((a) => a.role === "primary")).toHaveLength(1);
    expect(p.audio[0].asset.id).toBe("song1");
  });
  it("supports manual/full/active audio snippets and no-audio top objects", () => {
    for (const [mode, duration] of [
      ["manual", 60],
      ["full", 120],
      ["active", 60],
    ] as const) {
      const d = top();
      d.source.participants = d.source.participants.slice(0, 1);
      d.source.participants[0].media = { audio: "song" };
      d.settings.top = {
        durationSec: 3,
        snippet: {
          mode,
          startSec: 0,
          durationSec: 2,
          activeStartSec: 1,
          activeEndSec: 3,
        },
      };
      expect(compileVideo(d, manifest).plan.scenes[0].durationInFrames).toBe(
        duration,
      );
    }
    const d = top();
    d.source.participants.forEach((p) => delete p.media);
    expect(compileVideo(d).ready).toBe(true);
    expect(compileVideo(d).plan.audio).toEqual([]);
  });
  it("compiles layered voice/sfx, crossfaded looping music, ducking and round override mute windows", () => {
    const d = picker();
    d.source.participants[0].media = { visual: "clip" };
    d.settings.card = { playSound: true };
    d.bindings = { tick: { kind: "builtin", name: "tick" } };
    d.settings.picker = { tick: "tick", timerSec: 2 };
    d.audio = {
      playlist: { tracks: ["song"], crossfadeSec: 1, loop: true, volume: 0.5 },
      cues: [
        {
          id: "voice",
          role: "voice",
          asset: "song",
          at: time(1),
          duration: time(2),
        },
        { id: "fx", role: "sfx", asset: "tick", at: time(0) },
      ],
    };
    const p = compileVideo(d, manifest).plan;
    expect(new Set(p.audio.map((a) => a.role))).toEqual(
      new Set(["music", "voice", "sfx", "primary"]),
    );
    const music = p.audio.filter((a) => a.role === "music");
    expect(music.length).toBeGreaterThan(1);
    expect(music[1].from).toBe(90);
    expect(music[0].duckWindows.length).toBeGreaterThan(0);
    d.source.rounds[0].music = "song";
    expect(
      compileVideo(d, manifest).plan.audio.find((a) =>
        a.id.startsWith("playlist"),
      )?.muteWindows[0],
    ).toEqual({ from: 0, to: p.scenes[0].durationInFrames });
  });
  it("compiles recursive containers, sequential timing, data-bound text, keyframes and bookends", () => {
    const d = top();
    d.scenes.unshift(
      scene({
        id: "intro",
        duration: time(2),
        nodes: [
          containerNode({
            id: "stack",
            flow: "sequence",
            children: [
              textNode({
                id: "hello",
                text: "Привет",
                timing: { duration: time(0.5) },
                animation: [
                  {
                    property: "opacity",
                    keyframes: [
                      { at: time(0), value: 0 },
                      { at: time(0.5), value: 1 },
                    ],
                  },
                ],
              }),
              textNode({
                id: "next",
                text: "Далее",
                timing: { duration: time(0.5) },
              }),
            ],
          }),
        ],
      }),
    );
    d.scenes.push(
      scene({
        id: "outro",
        duration: time(1),
        nodes: [textNode({ id: "end", text: { bind: "document.title" } })],
      }),
    );
    const p = compileVideo(d, manifest).plan;
    const a = p.scenes[0].nodes;
    expect(a.find((n) => n.id === "intro/node/next")?.from).toBe(15);
    expect(
      a.find((n) => n.id === "intro/node/hello")?.animation[0].keyframes,
    ).toEqual([
      { frame: 0, value: 0 },
      { frame: 15, value: 1 },
    ]);
    expect(p.scenes.at(-1)?.nodes[0].text).toBe(d.title);
  });
  it("reports missing references and assets with actionable paths rather than replacing participants", () => {
    const d = picker();
    d.source.rounds[0].cards[0].participantId = "gone";
    d.source.participants[1].media = { visual: "missing" };
    const r = compileVideo(d);
    expect(r.ready).toBe(false);
    expect(r.diagnostics.map((x) => x.code)).toEqual(
      expect.arrayContaining(["PARTICIPANT_NOT_FOUND", "ASSET_NOT_FOUND"]),
    );
    expect(r.diagnostics.every((x) => x.path && x.message)).toBe(true);
  });
  it("rejects unknown nested values, unknown blocks, nonfinite geometry, duplicate IDs and invalid crop", () => {
    const d = top();
    for (const mutation of [
      (x: any) => (x.settings.card = { wat: 1 }),
      (x: any) => (x.scenes[0].block = "execute-js"),
      (x: any) => (x.output.fps = Infinity),
      (x: any) => x.source.participants.push(x.source.participants[0]),
      (x: any) =>
        (x.settings.card = { crop: { x: 0.8, y: 0, width: 0.5, height: 1 } }),
    ]) {
      const copy = structuredClone(d);
      mutation(copy);
      expect(() => parseVideoDocument(copy)).toThrow();
    }
    expect(getVideoDocumentJsonSchema()).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });
  it("patches by stable ID atomically and forbids changing identity or prototype traversal", () => {
    const d = top();
    const updated = patchVideoDocument(d, [
      {
        op: "set",
        target: { type: "participant", id: "b" },
        path: ["label"],
        value: "Новое имя",
      },
    ]);
    expect(updated.source.participants[1].label).toBe("Новое имя");
    expect(d.source.participants[1].label).toBe("Бета");
    expect(() =>
      patchVideoDocument(d, [
        {
          op: "set",
          target: { type: "participant", id: "b" },
          path: ["id"],
          value: "a",
        },
      ]),
    ).toThrow();
    expect(() =>
      patchVideoDocument(d, [
        {
          op: "set",
          target: { type: "document" },
          path: ["__proto__", "x"],
          value: 1,
        },
      ]),
    ).toThrow();
    const reset = patchVideoDocument(d, [
      {
        op: "unset",
        target: { type: "participant", id: "b" },
        path: ["settings", "card", "fit"],
      },
    ]);
    expect(cards(reset)[0].style.fit).toBe("cover");
  });
  it("extracts content-free presets and preserves content/media/round count when applying another", () => {
    const d = picker(12);
    d.title = "Secret title";
    d.source.rounds[0].prompt = "Secret prompt";
    d.source.participants[0].label = "Secret person";
    d.source.participants[0].media = { visual: "secret-media" };
    d.bindings = { "secret-media": { kind: "pool", assetId: "private-id" } };
    d.scenes.push(
      scene({
        id: "secret-node",
        duration: time(1),
        nodes: [textNode({ id: "secret-text", text: "Secret answer" })],
      }),
    );
    const preset = extractVideoPreset(d, { id: "mine", name: "My design" });
    const json = JSON.stringify(preset);
    for (const secret of [
      "Secret",
      "private-id",
      "secret-media",
      "secret-node",
      "secret-text",
    ])
      expect(json).not.toContain(secret);
    const applied = applyVideoPreset(
      d,
      getBuiltinPreset("picker.arc.vertical")!,
    );
    expect(applied.source).toEqual(d.source);
    expect(applied.bindings).toEqual(d.bindings);
    expect(applied.title).toBe("Secret title");
    expect(applied.output.format).toBe("vertical");
  });
  it("ships all media-free families in three formats with useful picker skeletons", () => {
    const presets = getBuiltinPresets();
    expect(presets).toHaveLength(30);
    for (const preset of presets) {
      expect(preset.schemaVersion).toBe(1);
      const d = createVideoDocument({ kind: preset.kind, presetId: preset.id });
      expect(d.output.format).toBe(preset.output.format);
      expect(compileVideo(d).ready).toBe(true);
      if (preset.kind === "picker") {
        expect(d.source.rounds).toHaveLength(30);
        expect(d.source.rounds[0].cards).toHaveLength(4);
      }
    }
    const short = createVideoDocument({
      kind: "picker",
      presetId: "picker.classic.wide",
      roundCount: 2,
      cardsPerRound: 12,
    });
    expect(short.source.rounds).toHaveLength(2);
    expect(short.source.rounds[0].cards).toHaveLength(12);
  });
});
