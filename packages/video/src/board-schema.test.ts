import { describe, expect, it } from "vitest";
import { parseVideoDocument, getVideoDocumentJsonSchema } from "./schema";
import { collectVideoAssetKeys } from "./assets";
import { patchVideoDocument } from "./patches";
import { preflightVideoResources } from "./resource-limits";

export const boardDocument = () => ({
  schemaVersion: 2, id: "boards", title: "Board", kind: "board", seed: 1,
  output: { format: "vertical", fps: 30 },
  source: { kind: "manual", participants: [{ id: "p1", label: "One" }], rounds: [] },
  bindings: {}, settings: {}, scenes: [],
  segments: [{ id: "board-segment", kind: "board", title: "Board", scenes: [{
    id: "board-scene", block: "board", nodes: [], board: {
      version: 1, mode: "accumulate", slots: [{ id: "S", label: "S", capacity: 1 }],
      rounds: [{ id: "r1", cards: [{ id: "c1", participantId: "p1" }],
        actions: [{ id: "a1", type: "place", cardId: "c1", slotId: "S" }] }],
    },
  }] }],
});

describe("board document contract", () => {
  it("accepts versioned boards as a v2 segment and exposes its JSON schema", () => {
    const d = parseVideoDocument(boardDocument());
    expect(d.segments![0].kind).toBe("board");
    expect(JSON.stringify(getVideoDocumentJsonSchema())).toContain("budget");
  });
  it("rejects duplicate board IDs and arbitrary styling", () => {
    const d = boardDocument();
    d.segments[0].scenes[0].board.slots.push({ id: "S", label: "again", capacity: 1 });
    expect(() => parseVideoDocument(d)).toThrow(/Duplicate/);
    const bad = boardDocument();
    Object.assign(bad.segments[0].scenes[0].board.slots[0], { color: "url(https://evil.test)" });
    expect(() => parseVideoDocument(bad)).toThrow();
  });
  it("collects board media and patches a slot by stable ID", () => {
    const input = boardDocument();
    Object.assign(input.segments[0].scenes[0].board.slots[0], {
      image: "slot-icon", backgroundAsset: "slot-bg", sound: "slot-sound",
    });
    Object.assign(input.segments[0].scenes[0].board.rounds[0].actions[0], { sound: "action-sound" });
    const d = parseVideoDocument(input);
    expect(collectVideoAssetKeys(d)).toEqual(["action-sound", "slot-bg", "slot-icon", "slot-sound"]);
    const patched = patchVideoDocument(d, [{ op: "set", target: { type: "boardSlot", id: "S" }, path: ["label"], value: "最高" }]);
    expect(patched.segments![0].scenes[0].board!.slots[0].label).toBe("最高");
    expect(d.segments![0].scenes[0].board!.slots[0].label).toBe("S");
  });
  it("rejects excessive board expansion before compilation", () => {
    const d = boardDocument();
    d.segments[0].scenes[0].board.rounds = Array.from({ length: 400 }, (_, i) => ({
      id: `r${i}`, cards: [{ id: `c${i}`, participantId: "p1" }], actions: [],
    }));
    expect(preflightVideoResources(d)[0]?.code).toBe("RESOURCE_BUDGET_EXCEEDED");
  });
});
