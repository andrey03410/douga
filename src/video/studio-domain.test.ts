import { describe, it, expect } from "vitest";
import {
  createVideoDocument,
  compileVideo,
  extractVideoPreset,
  applyVideoPreset,
  parseVideoDocument,
} from "./index";
import type { VideoDocument } from "./types";

const sound = {
  id: "sound",
  kind: "audio" as const,
  src: "/sound.wav",
  durationSec: 1,
};
describe("studio presentation and declarative sound parity", () => {
  it("keeps an editable caption separate from source labels, below card overrides", () => {
    const doc = createVideoDocument({
      kind: "top",
      participants: [{ id: "object", label: "Source", caption: "Caption" }],
    });
    expect(
      compileVideo(doc).plan.scenes[0].nodes.find((n) => n.type === "card")
        ?.label,
    ).toBe("Caption");
    const picker = createVideoDocument({
      kind: "picker",
      participants: doc.source.participants,
      rounds: [
        {
          id: "r",
          cards: [{ id: "c", participantId: "object", label: "Closest" }],
        },
      ],
    });
    expect(
      compileVideo(picker).plan.scenes[0].nodes.find((n) => n.type === "card")
        ?.label,
    ).toBe("Closest");
  });
  it("resolves sound anchors from repeated scenes after duration and source order changes", () => {
    const doc = createVideoDocument({
      kind: "top",
      participants: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
    doc.settings.top = { order: "source", durationSec: 2 };
    doc.bindings.sound = { kind: "builtin", name: "reveal" };
    doc.audio = {
      cues: [
        {
          id: "cue",
          asset: "sound",
          role: "sfx",
          anchor: { event: "scene.start", participantId: "b" },
          at: { sec: 0.2 },
        },
      ],
    };
    expect(compileVideo(doc, { sound }).plan.audio[0]?.from).toBe(66);
    doc.source.participants.reverse();
    doc.settings.top.durationSec = 4;
    expect(compileVideo(doc, { sound }).plan.audio[0]?.from).toBe(6);
    expect(parseVideoDocument(doc).audio?.cues?.[0].anchor?.event).toBe(
      "scene.start",
    );
  });
  it("extracts media-free sound rules and remaps scene references while retaining timing", () => {
    const doc = createVideoDocument({
      kind: "picker",
      roundCount: 1,
      cardsPerRound: 2,
    });
    doc.settings.picker = { ...doc.settings.picker, tick: "private-tick" };
    doc.audio = {
      cues: [
        {
          id: "private-cue",
          asset: "private-media",
          role: "sfx",
          anchor: {
            event: "timer.start",
            sceneId: doc.scenes[0].id,
            participantId: "private-person",
          },
          at: { sec: 0.25 },
          volume: 0.4,
          loop: true,
          fadeInSec: 0.1,
        },
      ],
    };
    const preset = extractVideoPreset(doc, { id: "personal", name: "Rules" });
    expect(JSON.stringify(preset)).not.toContain("private-");
    expect(preset.settings.picker?.tick).toMatch(/^slot:/);
    expect(preset.audio?.cues?.[0]).toMatchObject({
      anchor: { event: "timer.start", sceneId: "scene-1" },
      at: { sec: 0.25 },
      volume: 0.4,
      loop: true,
    });
    const applied = applyVideoPreset(
      createVideoDocument({ kind: "picker", roundCount: 1, cardsPerRound: 2 }),
      preset,
    );
    expect(applied.audio?.cues?.[0].volume).toBe(0.4);
    expect(applied.bindings).toEqual({});
  });
});

it("allows media-free and image-only objects under active snippet defaults", () => {
  const d = createVideoDocument({
    kind: "top",
    participants: [
      { id: "a", label: "Object" },
      { id: "b", label: "Image", media: { visual: "image" } },
    ],
  });
  d.settings.top = { snippet: { mode: "active", durationSec: 2 } };
  d.bindings.image = { kind: "pool", assetId: "i" };
  const result = compileVideo(d, {
    image: { id: "i", kind: "image", src: "/i.png", width: 1, height: 1 },
  });
  expect(result.ready).toBe(true);
  expect(result.plan.durationInFrames).toBe(120);
});
it("preserves project-owned sound assignments when applying extracted sound rules", () => {
  const d = createVideoDocument({
    kind: "picker",
    roundCount: 1,
    cardsPerRound: 2,
  });
  d.settings.picker = { tick: "my-tick" };
  d.bindings["my-tick"] = { kind: "builtin", name: "tick" };
  d.bindings["my-cue"] = { kind: "builtin", name: "answer" };
  d.audio = {
    cues: [
      {
        id: "assigned",
        asset: "my-cue",
        role: "sfx",
        at: { sec: 0.2 },
        anchor: { event: "answer.start" },
      },
    ],
  };
  const p = extractVideoPreset(d, { id: "personal", name: "Rules" });
  const applied = applyVideoPreset(d, p);
  expect(applied.bindings[applied.settings.picker!.tick!]).toEqual({
    kind: "builtin",
    name: "tick",
  });
  expect(applied.bindings[applied.audio!.cues![0].asset]).toEqual({
    kind: "builtin",
    name: "answer",
  });
});
it("retains distinct global and scene countdown sound slots in presets", () => {
  const d = createVideoDocument({
    kind: "picker",
    roundCount: 1,
    cardsPerRound: 2,
  });
  d.settings.picker = { tick: "global" };
  d.scenes[0].settings = { picker: { tick: "local" } };
  d.bindings.global = { kind: "builtin", name: "tick" };
  d.bindings.local = { kind: "builtin", name: "reveal" };
  const p = extractVideoPreset(d, { id: "slots", name: "Slots" });
  expect(p.settings.picker!.tick).not.toBe(p.scenes[0].settings!.picker!.tick);
  const applied = applyVideoPreset(d, p);
  expect(applied.bindings[applied.scenes[0].settings!.picker!.tick!]).toEqual({
    kind: "builtin",
    name: "reveal",
  });
});
it("anchors card, timer, answer and transition sounds to compiled picker phases", () => {
  const d = createVideoDocument({
    kind: "picker",
    participants: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    rounds: [
      {
        id: "r",
        cards: [
          { id: "a-card", participantId: "a" },
          { id: "b-card", participantId: "b" },
        ],
        answer: { cardIds: ["b-card"] },
      },
    ],
  });
  d.settings.picker = { leadSec: 1, revealSec: 2, timerSec: 3, answerSec: 2 };
  d.scenes[0].transition = { type: "fade", duration: { sec: 0.3 } };
  d.bindings.sound = { kind: "builtin", name: "answer" };
  d.audio = {
    cues: [
      {
        id: "card",
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        anchor: { event: "card.reveal", cardId: "b-card" },
      },
      {
        id: "timer",
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        anchor: { event: "timer.start", roundId: "r" },
      },
      {
        id: "answer",
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        anchor: { event: "answer.start", roundId: "r" },
      },
      {
        id: "transition",
        role: "sfx",
        asset: "sound",
        at: { sec: 0 },
        anchor: { event: "transition.start" },
      },
    ],
  };
  expect(
    compileVideo(d, { sound }).plan.audio.map((a) => [a.id, a.from]),
  ).toEqual([
    ["transition/0", 0],
    ["card/0", 90],
    ["timer/0", 150],
    ["answer/0", 240],
  ]);
  d.settings.picker.revealSec = 1;
  d.settings.picker.answerMode = "separate";
  const adjusted = compileVideo(d, { sound });
  expect(adjusted.plan.audio.find((a) => a.id === "card/0")?.from).toBe(60);
  expect(adjusted.plan.audio.find((a) => a.id === "timer/0")?.from).toBe(90);
  expect(adjusted.plan.audio.find((a) => a.id === "answer/0")?.from).toBe(180);
  d.audio.cues![0].anchor!.cardId = "missing";
  expect(
    compileVideo(d, { sound }).diagnostics.some(
      (x) => x.code === "AUDIO_ANCHOR_NOT_FOUND",
    ),
  ).toBe(true);
});
