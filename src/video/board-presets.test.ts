import { describe, expect, it } from "vitest";
import { createVideoDocument } from "./builders";
import { getBuiltinPreset, getBuiltinPresets, extractVideoPreset, applyVideoPreset } from "./presets";
import { compileVideo } from "./compiler";
import { videoPresetSchema } from "./schema";

describe("board presets", () => {
  it("creates all eight families in all formats as ready segmented videos", () => {
    const presets = getBuiltinPresets().filter((p) => p.kind === "board");
    expect(presets).toHaveLength(24);
    for (const p of presets) {
      const d = createVideoDocument({ kind: "board", presetId: p.id });
      const result = compileVideo(d);
      expect(result.diagnostics.filter((d) => d.severity === "error"), p.id).toEqual([]);
      expect(result.ready, p.id).toBe(true);
      expect(d.schemaVersion).toBe(2);
      expect(d.segments![0].kind).toBe("board");
    }
    expect(getBuiltinPreset("board.tier")!.id).toBe("board.tier.wide");
  });
  it("extracts a media-free design and reapplies without losing decisions or media", () => {
    const d = createVideoDocument({ kind: "board", presetId: "board.tier" });
    const b = d.segments![0].scenes[0].board!;
    b.slots[0].image = "private-image";
    d.bindings["private-image"] = { kind: "pool", assetId: "secret-art" };
    b.rounds[0].actions[0].comment = "Private opinion";
    const p = extractVideoPreset(d, { id: "my-board", name: "My board" });
    const json = JSON.stringify(p);
    expect(json).not.toContain("Private opinion"); expect(json).not.toContain("secret-art"); expect(json).not.toContain("private-image");
    expect(p.scenes[0].board!.rounds).toEqual([]);
    expect(() => videoPresetSchema.parse(p)).not.toThrow();
    const applied = applyVideoPreset(d, p);
    const after = applied.segments![0].scenes[0].board!;
    expect(after.rounds[0].actions[0].id).toBe(b.rounds[0].actions[0].id);
    expect(after.rounds[0].cards[0].id).toBe(b.rounds[0].cards[0].id);
    expect(after.rounds[0].actions[0].comment).toBe("Private opinion");
    expect(applied.bindings).toEqual(d.bindings);
    expect(after.slots[0].image).toBe("private-image");
    expect(compileVideo(applied, { "private-image": { id: "secret-art", kind: "image", src: "private.png" } }).ready).toBe(true);
    expect(() => applyVideoPreset(d, getBuiltinPreset("board.kmk")!)).toThrow(/PRESET_INCOMPATIBLE/);
  });
  it("rejects actual choices inside a reusable preset", () => {
    const d = createVideoDocument({ kind: "board", presetId: "board.kmk" });
    const p = getBuiltinPreset("board.kmk")!;
    p.scenes[0].board!.rounds = d.segments![0].scenes[0].board!.rounds;
    expect(() => videoPresetSchema.parse(p)).toThrow(/generic slots/);
  });
  it("compiles a board between a top and a picker", () => {
    const d = createVideoDocument({ kind: "board", presetId: "board.blind-rank.vertical" });
    const top = createVideoDocument({ kind: "top" });
    const picker = createVideoDocument({ kind: "picker", roundCount: 1 });
    d.source.participants.push(...top.source.participants.map((p) => ({ ...p, id: `top-${p.id}` })), ...picker.source.participants.map((p) => ({ ...p, id: `pick-${p.id}` })));
    d.source.rounds = picker.source.rounds.map((r) => ({ ...r, cards: r.cards.map((c) => ({ ...c, participantId: `pick-${c.participantId}` })) }));
    d.segments!.unshift({ id: "top-s", title: "Top", kind: "top", participantIds: top.source.participants.map((p) => `top-${p.id}`), scenes: [{ id: "top-main", block: "top", repeat: "participants", nodes: [] }] });
    d.segments!.push({ id: "picker-s", title: "Picker", kind: "picker", roundIds: d.source.rounds.map((r) => r.id), scenes: [{ id: "picker-main", block: "picker", repeat: "rounds", nodes: [] }] });
    expect(compileVideo(d).plan.segments!.map((s) => s.kind)).toEqual(["top", "board", "picker"]);
    expect(compileVideo(d).ready).toBe(true);
  });
});
