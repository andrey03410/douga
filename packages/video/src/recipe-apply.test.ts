import { describe, expect, it } from "vitest";
import { createVideoDocument } from "./builders";
import { getVideoRecipe } from "./recipes";
import { getBuiltinPreset } from "./presets";
import { compileVideo } from "./compiler";
import { getTypographyMeasureText } from "@/server/studio/typography-fonts";
import { applyVideoRecipe } from "./recipe-apply";
import type { VideoDocument } from "./types";
const preset = (id: string) => getVideoRecipe(id)!.preset;
function frCase() {
  const base = preset("recipe.clean.top.wide");
  const document = createVideoDocument({
    kind: "top",
    preset: base,
    participants: [
      { id: "p", label: "Имя героя", rank: 1, media: { visual: "art" } },
    ],
  });
  document.bindings.art = { kind: "pool", assetId: "owned-art" };
  document.settings.top = {
    order: "source",
    durationSec: 13,
    snippet: { mode: "active", durationSec: 13 },
  };
  document.scenes[0].settings = { card: { borderRadius: 77 } };
  document.scenes.unshift({
    id: "intro",
    block: "custom",
    duration: { sec: 4 },
    nodes: [
      {
        id: "intro-label",
        type: "text",
        text: "Авторское вступление",
        rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 },
        typography: {
          role: "label",
          font: "rubik",
          fontSize: 34,
          fill: "#f2c94c",
        },
      },
    ],
  });
  return { base, document };
}
const manifest = {
  art: {
    id: "owned-art",
    kind: "image" as const,
    src: "owned.png",
    width: 640,
    height: 800,
  },
};
describe("recipe appearance application", () => {
  it("preserves FR-01 intro, main timing, overrides and media while changing inherited theme", async () => {
    const { base, document } = frCase();
    const measureText = await getTypographyMeasureText();
    expect(
      compileVideo(document, manifest, { measureText }).plan.durationInFrames,
    ).toBe(510);
    const applied = applyVideoRecipe(
      document,
      preset("recipe.cinematic.top.wide"),
      { basePreset: base },
    );
    expect(applied.scenes.map((s) => s.id)).toEqual(["intro", "main"]);
    expect(applied.scenes[0]).toEqual(document.scenes[0]);
    expect(applied.scenes[1].settings!.card!.borderRadius).toBe(77);
    expect(applied.settings.typography!.theme).toBe("cinematic");
    expect(applied.settings.top).toEqual(document.settings.top);
    expect(applied.source).toEqual(document.source);
    expect(applied.bindings).toEqual(document.bindings);
    expect(
      compileVideo(applied, manifest, { measureText }).plan.durationInFrames,
    ).toBe(510);
    expect(document.preset!.id).toBe(base.id);
  });
  it("preserves explicit global and local typography and treats unknown base conservatively", () => {
    const { base, document } = frCase();
    document.settings.typography!.defaults = { font: "rubik", fill: "#123456" };
    document.source.participants[0].settings = {
      typography: { defaults: { font: "arimo" } },
    };
    const applied = applyVideoRecipe(document, preset("recipe.neon.top.wide"), {
      basePreset: base,
    });
    expect(applied.settings.typography).toMatchObject({
      theme: "neon",
      defaults: { font: "rubik", fill: "#123456" },
    });
    expect(applied.source.participants[0].settings).toEqual(
      document.source.participants[0].settings,
    );
    expect(applied.scenes[0].nodes[0].typography).toEqual(
      document.scenes[0].nodes[0].typography,
    );
    const unknown = applyVideoRecipe(document, preset("recipe.neon.top.wide"));
    expect(unknown.settings.typography).toEqual(document.settings.typography);
    const wrongVersion = applyVideoRecipe(
      document,
      preset("recipe.neon.top.wide"),
      { basePreset: { ...base, version: 2 } },
    );
    expect(wrongVersion.settings.typography).toEqual(
      document.settings.typography,
    );
  });
  it("explicit replace resets appearance overrides while retaining source, geometry and timing", async () => {
    const { base, document } = frCase();
    document.settings.layout = {
      type: "free",
      positions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.5 }],
    };
    document.settings.card = {
      ...document.settings.card,
      crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.7 },
      offsetSec: 4,
      volume: 0.4,
    };
    document.scenes[1].nodes.push({
      id: "authored-image",
      type: "image",
      asset: "art",
      rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
      timing: { at: { sec: 2 }, duration: { sec: 5 } },
      style: { borderRadius: 77, offsetSec: 3, fit: "contain" },
      typography: { font: "rubik", role: "label" },
    });
    const applied = applyVideoRecipe(
      document,
      preset("recipe.cinematic.top.wide"),
      { mode: "replace", basePreset: base },
    );
    expect(applied.settings.typography!.theme).toBe("cinematic");
    expect(applied.settings.layout).toEqual(document.settings.layout);
    expect(applied.settings.card).toMatchObject({
      borderRadius: 8,
      crop: document.settings.card.crop,
      offsetSec: 4,
      volume: 0.4,
    });
    expect(applied.scenes.map((s) => s.id)).toEqual(["intro", "main"]);
    expect(applied.scenes[1].settings?.card?.borderRadius).toBeUndefined();
    expect(applied.scenes[1].nodes[0]).toMatchObject({
      id: "authored-image",
      asset: "art",
      rect: document.scenes[1].nodes[0].rect,
      timing: document.scenes[1].nodes[0].timing,
      style: { offsetSec: 3, fit: "contain" },
    });
    expect(applied.scenes[1].nodes[0].style?.borderRadius).toBeUndefined();
    expect(applied.scenes[0].duration).toEqual({ sec: 4 });
    expect(applied.source).toEqual(document.source);
    expect(
      compileVideo(applied, manifest, {
        measureText: await getTypographyMeasureText(),
      }).plan.durationInFrames,
    ).toBe(510);
  });
  it("retains picker phases, answer mode, IDs and authored groups in both modes", async () => {
    const base = preset("recipe.clean.picker.wide");
    const document = createVideoDocument({
      kind: "picker",
      preset: base,
      roundCount: 1,
      cardsPerRound: 2,
    });
    document.settings.picker = {
      leadSec: 1.2,
      revealSec: 2.7,
      timerSec: 8,
      answerSec: 3.4,
      answerMode: "separate",
      hideAfterReveal: true,
      staggerSec: 0.3,
    };
    document.source.rounds[0].answer = {
      cardIds: [document.source.rounds[0].cards[0].id],
    };
    const measureText = await getTypographyMeasureText(),
      before = compileVideo(document, {}, { measureText }).plan;
    for (const mode of ["preserve", "replace"] as const) {
      const applied = applyVideoRecipe(
        document,
        preset("recipe.anime-impact.picker.wide"),
        { mode, basePreset: base },
      );
      const compiled = compileVideo(applied, {}, { measureText });
      expect(compiled.ready, JSON.stringify(compiled.diagnostics)).toBe(true);
      expect(applied.settings.picker).toEqual(document.settings.picker);
      expect(applied.source).toEqual(document.source);
      expect(applied.scenes.map((s) => s.id)).toEqual(
        document.scenes.map((s) => s.id),
      );
      expect(compiled.plan.durationInFrames).toBe(before.durationInFrames);
      expect(compiled.plan.scenes.map((s) => s.phases)).toEqual(
        before.scenes.map((s) => s.phases),
      );
    }
  });
  it("keeps board slots, actions, rule semantics and explicit durations in both modes", async () => {
    const base = getBuiltinPreset("board.kmk.wide")!;
    const document = createVideoDocument({
      kind: "board",
      preset: base,
      roundCount: 1,
    });
    document.segments![0].scenes[0].duration = { sec: 20 };
    document.segments![0].scenes[0].board!.slots[0].rect = {
      x: 0.1,
      y: 0.2,
      width: 0.2,
      height: 0.3,
    };
    const measureText = await getTypographyMeasureText(),
      before = compileVideo(document, {}, { measureText });
    for (const mode of ["preserve", "replace"] as const) {
      const applied = applyVideoRecipe(
        document,
        preset("recipe.board-clear.board.wide"),
        { mode, basePreset: base },
      );
      expect(applied.segments![0].scenes[0].board).toEqual(
        document.segments![0].scenes[0].board,
      );
      expect(applied.segments![0].scenes[0].duration).toEqual({ sec: 20 });
      expect(applied.source).toEqual(document.source);
      expect(
        compileVideo(applied, {}, { measureText }).plan.durationInFrames,
      ).toBe(before.plan.durationInFrames);
    }
  });
  it("keeps an intentionally empty authored board renderable", async () => {
    const base = getBuiltinPreset("board.tier.wide")!;
    const document = createVideoDocument({
      kind: "board",
      preset: base,
      roundCount: 1,
    });
    document.source.participants = [];
    const board = document.segments![0].scenes[0].board!;
    board.requireAllAssigned = false;
    board.rounds = [
      { id: "empty", prompt: "Пустая доска", cards: [], actions: [] },
    ];
    const measureText = await getTypographyMeasureText();
    expect(compileVideo(document, {}, { measureText }).ready).toBe(true);
    for (const mode of ["preserve", "replace"] as const) {
      const applied = applyVideoRecipe(
        document,
        preset("recipe.board-clear.board.wide"),
        { mode, basePreset: base },
      );
      const result = compileVideo(applied, {}, { measureText });
      expect(result.ready, JSON.stringify(result.diagnostics)).toBe(true);
      expect(applied.segments![0].scenes[0].board).toEqual(board);
    }
  });
  it("keeps custom intro renderable when the new recipe has block-specific choreography", async () => {
    const { base, document } = frCase();
    const result = applyVideoRecipe(
      document,
      preset("recipe.anime-impact.top.wide"),
      { basePreset: base },
    );
    const compiled = compileVideo(result, manifest, {
      measureText: await getTypographyMeasureText(),
    });
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
  });
});
