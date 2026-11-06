import { describe, expect, it } from "vitest";
import * as sdk from "./index";
import type { VideoDocument } from "./types";
const names =
  "fade pop slide-up slide-down slide-left slide-right zoom-in zoom-out flip-x flip-y tilt blur-reveal wipe-reveal iris elastic spin float breathe sway drift ken-burns shimmer orbit pulse bounce shake nudge glow outline stamp spotlight flash strike wiggle text-words text-lines text-letters text-wipe text-counter text-slam".split(
    " ",
  );
function custom(): VideoDocument {
  const d = sdk.createVideoDocument({ kind: "top", participants: [] });
  d.scenes = [
    {
      id: "s",
      block: "custom",
      duration: { frame: 30 },
      nodes: [0, 1, 2].map((i) => ({
        id: `n${i}`,
        type: "text" as const,
        text: `${i}`,
        rect: { x: i * 0.3, y: 0, width: 0.3, height: 1 },
      })),
    },
  ];
  return d;
}
const compile = (d: VideoDocument, manifest = {}) =>
  sdk.compileVideo(d, manifest);
const motion = (d: VideoDocument, value: unknown) => {
  (d.settings as any).motion = value;
  return d;
};
describe("declarative motion contract", () => {
  it("accepts every closed effect and flip alias, rejecting arbitrary CSS and unknown names", () => {
    for (const name of [...names, "flip"])
      expect(
        sdk.videoDocumentSchema.safeParse(motion(custom(), { enter: name }))
          .success,
        name,
      ).toBe(true);
    for (const value of [
      { enter: "evil" },
      { enter: { name: "fade", css: "url(x)" } },
      { profile: "anything" },
    ])
      expect(
        sdk.videoDocumentSchema.safeParse(motion(custom(), value)).success,
      ).toBe(false);
  });
  it("exports the complete discoverable versioned catalogue", () => {
    const catalog = (sdk as any).motionCatalog;
    expect(catalog?.version).toBe(1);
    expect(
      catalog.entries.filter((e: any) => e.category === "effect"),
    ).toHaveLength(40);
    expect(
      catalog.entries.filter((e: any) => e.category === "choreography"),
    ).toHaveLength(10);
    expect(
      catalog.entries.filter((e: any) => e.category === "backdrop"),
    ).toHaveLength(5);
    expect((sdk as any).getMotionCatalogEntry("flip").name).toBe("flip-y");
  });
  it("does not add IR fields without opt in", () => {
    const r = compile(custom());
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0]).not.toHaveProperty("backdrop");
    for (const n of r.plan.scenes[0].nodes)
      expect(n).not.toHaveProperty("motion");
  });
  it("clips enter and exit inside visible windows while preserving handwritten keyframes", () => {
    const d = motion(custom(), {
      enter: { name: "flip", duration: { sec: 10 } },
      exit: { name: "fade", duration: { sec: 10 } },
    });
    d.scenes[0].nodes[0].animation = [
      {
        property: "x",
        keyframes: [
          { at: { frame: 0 }, value: 10 },
          { at: { frame: 29 }, value: 20 },
        ],
      },
    ];
    const r = compile(d);
    expect(r.ready).toBe(true);
    const n = r.plan.scenes[0].nodes[0];
    expect(n.animation[0].keyframes[1].value).toBe(20);
    expect((n as any).motion).toHaveLength(2);
    for (const c of (n as any).motion) {
      expect(c.name).not.toBe("flip");
      expect(c.from).toBeGreaterThanOrEqual(0);
      expect(c.from + c.durationInFrames).toBeLessThanOrEqual(30);
    }
  });
  it.each(["forward", "reverse", "center", "rows"])(
    "normalizes %s cascade without changing duration or audio",
    (order) => {
      const d = custom(),
        before = compile(d).plan;
      motion(d, { enter: "pop", stagger: { interval: { frame: 4 }, order } });
      const r = compile(d);
      expect(r.ready).toBe(true);
      expect(r.plan.durationInFrames).toBe(before.durationInFrames);
      expect(r.plan.audio).toEqual(before.audio);
      const clips = r.plan.scenes[0].nodes.map((n: any) => n.motion[0]);
      expect(new Set(clips.map((c) => c.from)).size).toBeGreaterThan(1);
      if (order === "reverse")
        expect(clips[0].from).toBeGreaterThan(clips[2].from);
      if (order === "center") expect(clips[1].from).toBeLessThan(clips[0].from);
    },
  );
  it("supports local null and channel override", () => {
    const d = motion(custom(), { enter: "pop", loop: "float" });
    (d.scenes[0].nodes[0] as any).motion = { enter: null, loop: "sway" };
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(
      (r.plan.scenes[0].nodes[0] as any).motion.map((c: any) => c.name),
    ).toEqual(["sway"]);
  });
  it("resolves event anchors and diagnoses absent events", () => {
    const d = custom();
    (d.scenes[0].nodes[0] as any).motion = {
      emphasis: { name: "pulse", at: { event: "timer.start" } },
    };
    expect(
      compile(d).diagnostics.some((x) => x.code === "MOTION_EVENT_UNAVAILABLE"),
    ).toBe(true);
    (d.scenes[0].nodes[0] as any).motion = {
      emphasis: {
        name: "pulse",
        at: { event: "scene.start", offset: { frame: 3 } },
      },
    };
    expect((compile(d).plan.scenes[0].nodes[0] as any).motion[0].from).toBe(3);
  });
  it("diagnoses incompatible choreography", () => {
    const r = compile(motion(custom(), { choreography: "board-swap" }));
    expect(
      r.diagnostics.some((x) => x.code === "MOTION_CHOREOGRAPHY_INCOMPATIBLE"),
    ).toBe(true);
  });
  it("resolves backdrop assets and treats an explicit absent asset as error", () => {
    const d = custom();
    (d.settings as any).backdrop = {
      preset: "art-blur",
      source: "asset",
      asset: "missing",
    };
    expect(
      compile(d).diagnostics.some(
        (x) => x.code === "ASSET_NOT_FOUND" && x.severity === "error",
      ),
    ).toBe(true);
    (d.settings as any).backdrop.asset = "art";
    const r = compile(d, {
      art: { id: "art", kind: "image" as const, src: "/art.png" },
    });
    expect(r.ready).toBe(true);
    expect((r.plan.scenes[0] as any).backdrop.layers[0].media.asset.src).toBe(
      "/art.png",
    );
    expect(sdk.collectVideoAssetKeys(d)).toContain("art");
  });
  it("bounds particles and text fragments", () => {
    const d = motion(custom(), { enter: "text-letters" });
    (d.scenes[0].nodes[0] as any).text = "x".repeat(501);
    expect(
      compile(d).diagnostics.some(
        (x) => x.code === "MOTION_TEXT_BUDGET_EXCEEDED",
      ),
    ).toBe(true);
    (d.settings as any).backdrop = { preset: "particles", particles: 33 };
    expect(sdk.videoDocumentSchema.safeParse(d).success).toBe(false);
  });
  it.each([24, 25, 30, 50, 60])(
    "compiles finite normalized clips at %s fps in every format",
    (fps) => {
      for (const format of ["wide", "vertical", "square"] as const) {
        const d = motion(custom(), {
          enter: "elastic",
          loop: "orbit",
          emphasis: "stamp",
          exit: "iris",
        });
        d.output = { fps, format };
        const r = compile(d);
        expect(r.ready).toBe(true);
        for (const n of r.plan.scenes[0].nodes)
          for (const c of (n as any).motion)
            expect(
              [c.from, c.durationInFrames, c.intensity].every(Number.isFinite),
            ).toBe(true);
      }
    },
  );
  it("accepts typed widgets and incoming transitions", () => {
    const d = custom();
    (d.settings as any).timer = { variant: "ring" };
    (d.settings as any).versus = { variant: "impact" };
    d.scenes[0].nodes = [
      { id: "vs", type: "versus", variant: "neon" },
      { id: "badge", type: "badge", kind: "label", text: "Round" },
      { id: "progress", type: "progress", scope: "video" },
    ] as any;
    d.scenes[0].transition = {
      type: "split",
      duration: { frame: 8 },
      direction: "left",
    } as any;
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0].nodes.map((n) => n.type)).toEqual([
      "versus",
      "badge",
      "progress",
    ]);
    expect(r.plan.scenes[0].transition).toMatchObject({
      type: "split",
      direction: "left",
    });
  });
});
function picker(): VideoDocument {
  return sdk.createVideoDocument({
    kind: "picker",
    participants: [
      { id: "a", label: "A", rank: 1, media: { visual: "a" } },
      { id: "b", label: "B", rank: 2, media: { visual: "b" } },
    ],
    rounds: [
      {
        id: "r",
        background: "round",
        cards: [
          { id: "ca", participantId: "a" },
          { id: "cb", participantId: "b" },
        ],
        answer: { cardIds: ["cb"] },
      },
    ],
  });
}
const arts = {
  a: { id: "a", kind: "image" as const, src: "/a.png" },
  b: { id: "b", kind: "image" as const, src: "/b.png" },
  round: { id: "round", kind: "image" as const, src: "/round.png" },
};
function board(): VideoDocument {
  const d = custom();
  d.kind = "board";
  d.source.participants = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  d.scenes = [
    {
      id: "board",
      block: "board",
      nodes: [],
      board: {
        version: 1,
        mode: "accumulate",
        allowMoves: true,
        slots: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
        rounds: [
          {
            id: "r",
            cards: [
              { id: "ca", participantId: "a" },
              { id: "cb", participantId: "b" },
            ],
            actions: [
              { id: "place-a", type: "place", cardId: "ca", slotId: "x" },
              { id: "place-b", type: "place", cardId: "cb", slotId: "y" },
              { id: "swap", type: "swap", cardId: "ca", otherCardId: "cb" },
            ],
          },
        ],
      },
    },
  ];
  return d;
}
describe("motion semantic integration", () => {
  it("preserves inherited timer variant on custom and generated widgets", () => {
    const d = custom();
    d.settings.timer = { variant: "segments", warningSec: 2 };
    d.scenes[0].nodes = [{ id: "t", type: "timer" }];
    expect(compile(d).plan.scenes[0].nodes[0].timer?.variant).toBe("segments");
  });
  it("inherits participant and card motion and honors null in custom cards", () => {
    const d = picker();
    d.settings.motion = { enter: "pop" };
    d.source.participants[0].settings = { motion: { enter: "fade" } };
    d.source.rounds[0].cards[1].settings = { motion: { enter: null } };
    let r = compile(d, arts);
    expect(r.ready).toBe(true);
    expect(
      r.plan.scenes[0].nodes.find((n) => n.cardId === "ca")?.motion?.[0].name,
    ).toBe("fade");
    expect(
      r.plan.scenes[0].nodes.find((n) => n.cardId === "cb")?.motion,
    ).toBeUndefined();
    d.scenes = [
      {
        id: "custom",
        block: "custom",
        nodes: [{ id: "c", type: "card", participantId: "a" }],
      },
    ];
    r = compile(d, arts);
    expect(r.plan.scenes[0].nodes[0].motion?.[0].name).toBe("fade");
  });
  it("resolves timer and answer events without moving semantic phases or audio", () => {
    const d = picker(),
      old = compile(d, arts).plan;
    d.scenes[0].nodes = [
      {
        id: "timer-pulse",
        type: "shape",
        shape: "rect",
        motion: {
          emphasis: {
            name: "pulse",
            at: { event: "timer.start", offset: { frame: 2 } },
          },
        },
      },
      {
        id: "answer",
        type: "text",
        text: "Answer",
        motion: { enter: { name: "fade", at: { event: "answer.reveal" } } },
      },
    ];
    const r = compile(d, arts);
    expect(r.ready).toBe(true);
    const s = r.plan.scenes[0];
    expect(s.phases).toEqual(old.scenes[0].phases);
    expect(r.plan.audio).toEqual(old.audio);
    expect(
      s.nodes.find((n) => n.id.endsWith("timer-pulse"))?.motion?.[0].from,
    ).toBe(s.phases.timerStartFrame! + 2);
    expect(s.nodes.find((n) => n.id.endsWith("answer"))?.motion?.[0].from).toBe(
      s.phases.answerStartFrame,
    );
  });
  it("keeps the round source throughout decision and only selects the winner after answer", () => {
    const d = picker();
    d.settings.backdrop = { preset: "art-blur", source: "current-card" };
    for (const mode of ["inline", "separate"] as const) {
      d.settings.picker = { ...d.settings.picker, answerMode: mode };
      const r = compile(d, arts);
      expect(r.ready).toBe(true);
      for (const s of r.plan.scenes) {
        const timer = s.phases.timerStartFrame,
          answer = s.phases.answerStartFrame;
        if (timer !== undefined) {
          const decision = s.backdrop!.layers.filter(
            (l) =>
              l.from <= (answer ?? s.durationInFrames) - 1 &&
              l.to > timer &&
              l.from >= timer,
          );
          expect(decision.every((l) => l.media.asset.id === "round")).toBe(
            true,
          );
        }
        if (s.kind === "answer")
          expect(s.backdrop!.layers[0].media.asset.id).toBe("b");
      }
    }
  });
  it("uses neutral optional missing art but diagnoses an explicit missing asset", () => {
    const d = custom();
    d.settings.backdrop = { preset: "art-blur", source: "current-card" };
    expect(compile(d).ready).toBe(true);
    expect(compile(d).plan.scenes[0].backdrop?.layers).toEqual([]);
  });
  it("compiles both board recipes only on the corresponding events and preserves the board keyframes", () => {
    const d = board(),
      base = compile(d).plan;
    for (const choreography of ["board-place", "board-swap"] as const) {
      d.settings.motion = { choreography };
      const r = compile(d);
      expect(r.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
      const clips = r.plan.scenes.flatMap((s) =>
        s.nodes.flatMap((n) => n.motion ?? []),
      );
      expect(clips.length).toBeGreaterThan(0);
      expect(new Set(clips.map((c) => c.name))).toEqual(
        new Set([choreography === "board-place" ? "stamp" : "outline"]),
      );
      expect(r.plan.scenes.map((s) => s.nodes.map((n) => n.animation))).toEqual(
        base.scenes.map((s) => s.nodes.map((n) => n.animation)),
      );
    }
  });
  it.each([
    "versus-impact",
    "picker-cascade",
    "winner-spotlight",
    "rank-reveal",
    "podium-finale",
    "title-reveal",
    "cinematic-pan",
    "round-intro",
  ] as const)("expands %s into meaningful clips", (choreography) => {
    const d =
      choreography === "rank-reveal"
        ? sdk.createVideoDocument({
            kind: "top",
            participants: picker().source.participants,
          })
        : picker();
    if (choreography === "title-reveal")
      d.scenes[0].nodes.push({
        id: "title",
        type: "text",
        text: "Hello world",
      });
    d.settings.motion = { choreography };
    const r = compile(d, arts);
    expect(r.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(
      r.plan.scenes.flatMap((s) => s.nodes.flatMap((n) => n.motion ?? []))
        .length,
    ).toBeGreaterThan(0);
  });
  it("cleans backdrop identities in presets and rebinds destination media", () => {
    const d = picker();
    d.bindings.round = { kind: "pool", assetId: "round" };
    d.settings.backdrop = {
      preset: "art-blur",
      source: "asset",
      asset: "round",
    };
    const p = sdk.extractVideoPreset(d, {
      id: "motion-preset",
      name: "Motion",
    });
    expect(p.settings.backdrop?.asset).toMatch(/^slot:/);
    expect(JSON.stringify(p)).not.toContain('"asset":"round"');
    const applied = sdk.applyVideoPreset(d, p);
    expect(applied.bindings[applied.settings.backdrop!.asset!]).toEqual(
      d.bindings.round,
    );
    const bad = structuredClone(p);
    bad.settings.backdrop!.asset = "actual-id";
    expect(sdk.videoPresetSchema.safeParse(bad).success).toBe(false);
  });
  it("supports video progress across v2 segments", () => {
    const d = custom();
    d.schemaVersion = 2;
    d.segments = [
      { id: "one", kind: "custom", title: "1", scenes: d.scenes },
      {
        id: "two",
        kind: "custom",
        title: "2",
        scenes: [
          {
            id: "two",
            block: "custom",
            duration: { frame: 60 },
            nodes: [{ id: "progress", type: "progress", scope: "video" }],
          },
        ],
      },
    ];
    d.scenes = [];
    const r = compile(d);
    expect(r.ready).toBe(true);
    const s = r.plan.scenes[1],
      n = s.nodes[0];
    expect(n.progress).toMatchObject({
      from: -s.from,
      durationInFrames: r.plan.durationInFrames,
    });
  });
});
describe("motion contract edge cases", () => {
  it("bounds all text animation fragments across a scene", () => {
    const d = motion(custom(), { enter: "text-letters" });
    d.scenes[0].nodes.forEach((n: any) => (n.text = "x".repeat(200)));
    expect(
      compile(d).diagnostics.some(
        (x) => x.code === "MOTION_TEXT_BUDGET_EXCEEDED",
      ),
    ).toBe(true);
  });
  it("diagnoses an unresolvable semantic badge and gates winner badges to the answer", () => {
    const d = custom();
    d.scenes[0].nodes = [{ id: "rank", type: "badge", kind: "rank" }];
    expect(
      compile(d).diagnostics.some(
        (x) => x.code === "WIDGET_BINDING_UNRESOLVED",
      ),
    ).toBe(true);
    const p = picker();
    p.scenes[0].nodes = [{ id: "winner", type: "badge", kind: "winner" }];
    const r = compile(p, arts),
      s = r.plan.scenes[0];
    expect(r.ready).toBe(true);
    expect(s.nodes.find((n) => n.type === "badge")?.visible[0].from).toBe(
      s.phases.answerStartFrame,
    );
  });
  it("keeps backdrop source crossfades inside windows without showing future winner", () => {
    const d = picker();
    d.settings.backdrop = { preset: "art-blur", source: "current-card" };
    const s = compile(d, arts).plan.scenes[0],
      layers = s.backdrop!.layers;
    const winner = layers.find(
      (l) => l.media.asset.id === "b" && l.from === s.phases.answerStartFrame,
    )!;
    expect(winner).toBeDefined();
    const before = layers[layers.indexOf(winner) - 1];
    expect(before.to).toBeGreaterThan(winner.from);
  });
  it("exposes compatible block kinds for each catalogue choreography", () => {
    for (const e of sdk.motionCatalog.entries.filter(
      (e) => e.category === "choreography",
    ))
      expect((e as any).blocks.length).toBeGreaterThan(0);
  });
  it("keeps bound backdrop slots distinct between v2 segments", () => {
    const d = picker();
    d.bindings.round = { kind: "pool", assetId: "round" };
    d.settings.backdrop = {
      preset: "art-blur",
      source: "asset",
      asset: "round",
    };
    const p = sdk.extractVideoPreset(d, { id: "backdrop", name: "Backdrop" });
    d.schemaVersion = 2;
    d.segments = [
      {
        id: "one",
        kind: "picker",
        title: "1",
        scenes: d.scenes,
        settings: {
          backdrop: { preset: "art-blur", source: "asset", asset: "round" },
        },
      },
      {
        id: "two",
        kind: "picker",
        title: "2",
        scenes: [{ ...d.scenes[0], id: "second" }],
        settings: {
          backdrop: { preset: "art-blur", source: "asset", asset: "round" },
        },
      },
    ];
    d.scenes = [];
    const applied = sdk.applyVideoPreset(d, p);
    expect(sdk.videoDocumentSchema.safeParse(applied).success).toBe(true);
    for (const segment of applied.segments!)
      expect(applied.bindings[segment.settings!.backdrop!.asset!]).toEqual(
        d.bindings.round,
      );
  });
});
describe("container and local choreography semantics", () => {
  it("animates an explicitly configured container once without inheriting that transform into its children", () => {
    const d = custom();
    d.scenes[0].nodes = [
      {
        id: "container",
        type: "container",
        motion: { enter: "pop" },
        children: [{ id: "child", type: "text", text: "Child" }],
      },
    ];
    const s = compile(d).plan.scenes[0];
    expect(s.nodes.find((n) => n.type === "container")?.motion?.[0].name).toBe(
      "pop",
    );
    expect(s.nodes.find((n) => n.type === "text")?.motion).toBeUndefined();
  });
  it("applies a global entrance to leaves without doubling it on implicit containers", () => {
    const d = motion(custom(), { enter: "pop" });
    d.scenes[0].nodes = [
      {
        id: "container",
        type: "container",
        children: [{ id: "child", type: "text", text: "Child" }],
      },
    ];
    const s = compile(d).plan.scenes[0];
    expect(s.nodes.find((n) => n.type === "container")?.motion).toBeUndefined();
    expect(s.nodes.find((n) => n.type === "text")?.motion?.[0].name).toBe(
      "pop",
    );
  });
  it("diagnoses an incompatible locally selected choreography", () => {
    const d = custom();
    d.scenes[0].nodes[0].motion = { choreography: "board-swap" };
    expect(
      compile(d).diagnostics.some(
        (x) => x.code === "MOTION_CHOREOGRAPHY_INCOMPATIBLE",
      ),
    ).toBe(true);
  });
});
describe("semantic motion windows", () => {
  it("finishes a generated card entrance within its own reveal window", () => {
    const d = picker();
    d.settings.motion = {
      enter: { name: "fade", duration: { sec: 100 } },
      stagger: { interval: { sec: 100 }, order: "reverse" },
    };
    const r = compile(d, arts);
    for (const n of r.plan.scenes[0].nodes.filter((n) => n.type === "card")) {
      const c = n.motion![0];
      expect(c.from + c.durationInFrames).toBeLessThanOrEqual(
        n.activeWindow!.to,
      );
    }
  });
  it("leaves a fully visible hold frame between long entrance and exit", () => {
    const d = motion(custom(), {
      enter: { name: "fade", duration: { sec: 100 } },
      exit: { name: "fade", duration: { sec: 100 } },
    });
    const n = compile(d).plan.scenes[0].nodes[0];
    expect(n.motion![0].from + n.motion![0].durationInFrames).toBeLessThan(
      n.motion![1].from,
    );
  });
});
it("allows explicit text on semantic badge variants without requiring an automatic binding", () => {
  for (const kind of ["rank", "round", "winner"] as const) {
    const d = custom();
    d.scenes[0].nodes = [
      { id: "badge", type: "badge", kind, text: "My label" },
    ];
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0].nodes[0].text).toBe("My label");
  }
});
it("diagnoses an entrance event that occurs after the semantic reveal window", () => {
  const d = picker();
  d.source.rounds[0].cards[0].settings = {
    motion: { enter: { name: "fade", at: { event: "timer.start" } } },
  };
  expect(
    compile(d, arts).diagnostics.some(
      (x) => x.code === "MOTION_EVENT_OUTSIDE_WINDOW",
    ),
  ).toBe(true);
});
it("extracts reusable badge text without content and reapplies the destination label", () => {
  const d = custom();
  d.scenes[0].nodes = [
    { id: "badge", type: "badge", kind: "label", text: "Private winner title" },
  ];
  const p = sdk.extractVideoPreset(d, { id: "badge-preset", name: "Badge" });
  expect(JSON.stringify(p)).not.toContain("Private winner title");
  const applied = sdk.applyVideoPreset(d, p);
  expect((applied.scenes[0].nodes[0] as any).text).toBe("Private winner title");
});
it("removes authored event identities from reusable presets and rejects unsanitized ones", () => {
  const d = custom();
  d.settings.motion = {
    emphasis: {
      name: "pulse",
      at: { event: "board.place", cardId: "private-card" },
    },
  };
  d.scenes[0].nodes[0].motion = {
    emphasis: {
      name: "pulse",
      at: { event: "board.place", actionId: "private-action" },
    },
  };
  const p = sdk.extractVideoPreset(d, { id: "event-preset", name: "Event" });
  expect(JSON.stringify(p)).not.toContain("private-card");
  expect(JSON.stringify(p)).not.toContain("private-action");
  p.settings.motion = {
    emphasis: {
      name: "pulse",
      at: { event: "board.place", cardId: "private-card" },
    },
  };
  expect(sdk.videoPresetSchema.safeParse(p).success).toBe(false);
});
