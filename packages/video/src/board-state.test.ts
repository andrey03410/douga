import { describe, expect, it } from "vitest";
import { applyBoardAction, createBoardState, resolveBoard } from "./board-state";
import type { BoardDefinition, BoardCard, BoardAction } from "./types";

const cards: BoardCard[] = [
  { id: "a", participantId: "p1", cost: 5 },
  { id: "b", participantId: "p2", cost: 3 },
  { id: "c", participantId: "p3", cost: 7 },
];
const design = (): BoardDefinition => ({ version: 1, mode: "accumulate", slots: [
  { id: "S", label: "S", capacity: 1 }, { id: "A", label: "A" },
], rounds: [], budget: 10 });
const act = (type: string, cardId: string, extra = {}) => ({ id: `${type}-${cardId}`, type, cardId, ...extra }) as BoardAction;
const placed = () => applyBoardAction(design(), createBoardState(), act("place", "a", { slotId: "S" }), cards);

describe("board rules", () => {
  it("places without mutating inputs and enforces capacity", () => {
    const initial = createBoardState();
    const state = applyBoardAction(design(), initial, act("place", "a", { slotId: "S" }), cards);
    expect(state).toEqual({ placements: { a: "S" }, lockedCardIds: [], spent: 5 });
    expect(initial.placements).toEqual({});
    expect(() => applyBoardAction(design(), state, act("place", "b", { slotId: "S" }), cards)).toThrow(/BOARD_SLOT_FULL/);
    expect(state.spent).toBe(5);
  });
  it("refunds the previous cost before checking an atomic replacement", () => {
    const state = applyBoardAction(design(), placed(), act("replace", "c", { slotId: "S", replaceCardId: "a" }), cards);
    expect(state.placements).toEqual({ c: "S" });
    expect(state.spent).toBe(7);
    const removed = applyBoardAction(design(), state, act("remove", "c"), cards);
    expect(removed.spent).toBe(0);
  });
  it("rejects overspending without losing the old placement", () => {
    const state = placed();
    expect(() => applyBoardAction(design(), state, act("place", "c", { slotId: "A" }), cards)).toThrow(/BOARD_BUDGET_EXCEEDED/);
    expect(state.placements).toEqual({ a: "S" });
  });
  it("swaps full slots atomically and preserves spent", () => {
    const b = design(); b.slots[1].capacity = 1;
    const state = applyBoardAction(b, placed(), act("place", "b", { slotId: "A" }), cards);
    const next = applyBoardAction(b, state, act("swap", "a", { otherCardId: "b" }), cards);
    expect(next.placements).toEqual({ a: "A", b: "S" });
    expect(next.spent).toBe(8);
  });
  it.each(["move", "remove", "swap", "replace"])("protects locked cards from %s", (type) => {
    const locked = applyBoardAction(design(), placed(), act("lock", "a"), cards);
    const action = type === "replace" ? act(type, "b", { replaceCardId: "a", slotId: "S" }) : act(type, "a", { slotId: "A", otherCardId: "b" });
    expect(() => applyBoardAction(design(), locked, action, cards)).toThrow(/BOARD_CARD_LOCKED/);
    const unlocked = applyBoardAction(design(), locked, act("unlock", "a"), cards);
    expect(unlocked.lockedCardIds).toEqual([]);
  });
  it("supports lock-on-place and rejects unknown or already placed cards", () => {
    const b = { ...design(), lockOnPlace: true };
    const state = applyBoardAction(b, createBoardState(), act("place", "a", { slotId: "S" }), cards);
    expect(state.lockedCardIds).toEqual(["a"]);
    expect(() => applyBoardAction(b, state, act("place", "missing", { slotId: "A" }), cards)).toThrow(/BOARD_CARD_NOT_AVAILABLE/);
    expect(() => applyBoardAction(design(), placed(), act("place", "a", { slotId: "A" }), cards)).toThrow(/BOARD_CARD_ALREADY_PLACED/);
  });
  it("clears rounds by default but can preserve the team and selectively clear a role", () => {
    const b = design(); b.mode = "rounds";
    b.rounds = [
      { id: "r1", cards: [cards[0]], actions: [act("place", "a", { slotId: "S" })] },
      { id: "r2", cards: [cards[1]], actions: [act("place", "b", { slotId: "A" })] },
    ];
    const participants = cards.map((c) => ({ id: c.participantId, label: c.id }));
    expect(resolveBoard(b, participants).final.placements).toEqual({ b: "A" });
    b.carry = true;
    expect(resolveBoard(b, participants).final.placements).toEqual({ a: "S", b: "A" });
    b.rounds[1].clearSlotIds = ["S"];
    expect(resolveBoard(b, participants).final.spent).toBe(3);
  });
  it("does not allow actions on future cards or discarded reserve", () => {
    const b = design(); b.mode = "rounds";
    b.rounds = [
      { id: "r1", cards: [cards[0]], actions: [act("place", "b", { slotId: "S" })] },
      { id: "r2", cards: [cards[1]], actions: [act("place", "a", { slotId: "S" })] },
    ];
    const result = resolveBoard(b, cards.map((c) => ({ id: c.participantId, label: c.id })));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["BOARD_CARD_NOT_AVAILABLE", "BOARD_CARD_NOT_AVAILABLE"]);
    expect(result.final.placements).toEqual({});
  });
  it("reports missing participants, repeated candidates and incomplete assignments", () => {
    const b = design(); b.requireAllAssigned = true;
    b.rounds = [{ id: "r", cards: [{ id: "a", participantId: "missing" }], actions: [] }];
    expect(resolveBoard(b, []).diagnostics.map((d) => d.code)).toContain("BOARD_PARTICIPANT_NOT_FOUND");
    b.rounds[0].cards = [{ id: "a", participantId: "p" }, { id: "b", participantId: "p" }];
    const result = resolveBoard(b, [{ id: "p", label: "P" }]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["BOARD_PARTICIPANT_REPEATED", "BOARD_ASSIGNMENT_MISSING"]));
  });
});
