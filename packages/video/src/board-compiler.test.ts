import { describe, expect, it } from "vitest";
import { compileVideo } from "./compiler";
import { evaluateNode } from "@douga/render/studio-frame";
import type { BoardDefinition, VideoDocument } from "./types";

const board = (): BoardDefinition => ({ version: 1, mode: "accumulate", slots: [
  { id: "S", label: "S", capacity: 1 }, { id: "A", label: "A" },
], rounds: [
  { id: "r1", cards: [{ id: "c1", participantId: "p1", cost: 3 }], actions: [{ id: "a1", type: "place", cardId: "c1", slotId: "S", comment: "Great" }] },
  { id: "r2", cards: [{ id: "c2", participantId: "p2", cost: 2 }], actions: [{ id: "a2", type: "place", cardId: "c2", slotId: "A" }] },
], budget: 10, presentation: { revealSec: 1, thinkSec: 1, moveSec: 1, finalSec: 1 } });
export function doc(b = board()): VideoDocument {
  return { schemaVersion: 2, id: "d", title: "Board demo", kind: "board", seed: 7,
    output: { format: "wide", fps: 30 }, settings: {}, bindings: {}, scenes: [],
    source: { kind: "manual", participants: [{ id: "p1", label: "First" }, { id: "p2", label: "Future" }], rounds: [] },
    segments: [{ id: "s", kind: "board", title: "Board", scenes: [{ id: "main", block: "board", board: b, nodes: [] }] }],
  };
}
describe("board compilation", () => {
  it("reports explicitly assigned missing audio instead of silently rendering a silent OST", () => {
    const d = doc(); d.source.participants[0].media = { audio: "missing" };
    const result = compileVideo(d);
    expect(result.ready).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("ASSET_NOT_FOUND");
  });
  it("loops a short audition for its complete active window", () => {
    const b = board(); b.presentation!.revealSec = 1.5;
    const d = doc(b); d.source.participants[0].media = { audio: "song" };
    d.settings.card = { loop: true };
    const result = compileVideo(d, { song: { id: "song", kind: "audio", src: "song.wav", durationSec: .5 } });
    expect(result.ready).toBe(true);
    const audio = result.plan.audio.find((a) => a.role === "primary")!;
    expect(audio.durationInFrames).toBe(45); expect(audio.loopFrames).toBe(15);
  });
  it("compiles authored placements and does not expose future candidates early", () => {
    const result = compileVideo(doc());
    expect(result.ready).toBe(true);
    expect(result.plan.segments![0].kind).toBe("board");
    const scenes = result.plan.scenes;
    expect(scenes.every((s) => s.kind === "board")).toBe(true);
    const firstReveal = scenes.find((s) => s.boardEvents?.some((e) => e.event === "board.reveal"))!;
    expect(firstReveal.nodes.some((n) => n.participantId === "p2")).toBe(false);
    expect(scenes.at(-1)!.boardState).toEqual({ placements: { c1: "S", c2: "A" }, lockedCardIds: [], spent: 5 });
    expect(scenes.at(-1)!.nodes.some((n) => n.text?.includes("5 / 10"))).toBe(true);
  });
  it("moves a placed card from the candidate position to its destination", () => {
    const result = compileVideo(doc());
    const scene = result.plan.scenes.find((s) => s.boardEvents?.some((e) => e.event === "board.place"))!;
    const card = scene.nodes.find((n) => n.cardId === "c1")!;
    const start = evaluateNode(card, 0, 30), end = evaluateNode(card, 29, 30);
    expect(start.x === end.x && start.y === end.y && start.scale === end.scale).toBe(false);
    expect(end.x).toBeCloseTo(0, 1);
    expect(end.scale).toBeCloseTo(1, 1);
    expect(scene.nodes.some((n) => n.text === "Great")).toBe(true);
  });
  it("plays only the active candidate and anchors a sound to its placement", () => {
    const d = doc(); d.source.participants[0].media = { audio: "song" };
    d.bindings.song = { kind: "pool", assetId: "song" };
    d.bindings.hit = { kind: "pool", assetId: "hit" };
    d.audio = { cues: [{ id: "hit", asset: "hit", role: "sfx", at: { sec: 0 }, duration: { sec: .1 }, anchor: { event: "board.place", cardId: "c1" } }] };
    d.audio.cues!.push({ id: "reveal", asset: "hit", role: "sfx", at: { sec: 0 }, duration: { sec: .1 }, anchor: { event: "card.reveal" } });
    const result = compileVideo(d, { song: { id: "song", kind: "audio", src: "song.wav", durationSec: 10 }, hit: { id: "hit", kind: "audio", src: "hit.wav", durationSec: 1 } });
    expect(result.ready).toBe(true);
    const primary = result.plan.audio.filter((a) => a.role === "primary");
    expect(primary).toHaveLength(1);
    expect(primary[0].durationInFrames).toBe(30);
    const placement = result.plan.scenes.find((s) => s.boardEvents?.some((e) => e.event === "board.place" && e.cardId === "c1"))!;
    expect(result.plan.audio.find((a) => a.id.startsWith("hit/"))!.from).toBe(placement.from);
    expect(result.plan.audio.filter((a) => a.id.startsWith("reveal/"))).toHaveLength(2);
  });
  it("defers placements until all questions were shown and hides identities", () => {
    const b = board(); b.presentation = { ...b.presentation, answerReveal: "end", hideLabelsUntilPlaced: true, hideVisualsUntilPlaced: true };
    const r = compileVideo(doc(b)); expect(r.ready).toBe(true);
    const lastReveal = Math.max(...r.plan.scenes.filter((s) => s.boardEvents?.some((e) => e.event === "board.reveal")).map((s) => s.from));
    const firstPlace = r.plan.scenes.find((s) => s.boardEvents?.some((e) => e.event === "board.place"))!;
    expect(firstPlace.from).toBeGreaterThan(lastReveal);
    expect(r.plan.scenes.filter((s) => s.from < firstPlace.from).flatMap((s) => s.nodes).some((n) => n.label === "First" || n.label === "Future")).toBe(false);
  });
  it("lays out a matrix and focus summaries inside vertical output", () => {
    const b = board(); b.layout = "grid"; b.columns = 3; b.xLabel = "Power"; b.yLabel = "Morality";
    b.slots = Array.from({ length: 9 }, (_, i) => ({ id: i === 0 ? "S" : i === 1 ? "A" : `s${i}`, label: `${i}` }));
    b.presentation = { rowFocusSec: 1 };
    const d = doc(b); d.output.format = "vertical";
    const r = compileVideo(d); expect(r.ready).toBe(true);
    expect(r.plan.scenes.flatMap((s) => s.nodes).some((n) => n.text === "Power")).toBe(true);
    expect(r.plan.scenes.some((s) => s.id.includes("focus"))).toBe(true);
    expect(r.plan.scenes.at(-1)!.nodes.filter((n) => n.id.includes("/slot-label/"))).toHaveLength(9);
    for (const s of r.plan.scenes) for (const n of s.nodes) {
      expect(n.rect.x).toBeGreaterThanOrEqual(0); expect(n.rect.y).toBeGreaterThanOrEqual(0);
      expect(n.rect.x + n.rect.width).toBeLessThanOrEqual(1080.01);
      expect(n.rect.y + n.rect.height).toBeLessThanOrEqual(1920.01);
    }
  });
});
