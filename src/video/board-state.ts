import type {
  BoardAction, BoardCard, BoardDefinition, BoardResolution, BoardState, Participant,
} from "./types";
import { videoResourceLimits } from "./resource-limits";

export class BoardRuleError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "BoardRuleError";
  }
}
const fail = (code: string, message: string): never => { throw new BoardRuleError(code, message); };
export const createBoardState = (): BoardState => ({ placements: {}, lockedCardIds: [], spent: 0 });
const has = (state: BoardState, id: string) => Object.hasOwn(state.placements, id);
const copy = (state: BoardState): BoardState => ({ ...state, placements: { ...state.placements }, lockedCardIds: [...state.lockedCardIds] });

/** Atomic, immutable and independent of rendering. `cards` are the currently available occurrences. */
export function applyBoardAction(board: BoardDefinition, state: BoardState, action: BoardAction, cards: BoardCard[]): BoardState {
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const card = cardById.get(action.cardId);
  if (!card) fail("BOARD_CARD_NOT_AVAILABLE", `Card ${action.cardId} has not been introduced or is no longer available.`);
  const next = copy(state);
  const unlocked = (id: string) => {
    if (next.lockedCardIds.includes(id)) fail("BOARD_CARD_LOCKED", `Card ${id} is locked.`);
  };
  const placed = (id: string) => {
    if (!has(next, id)) fail("BOARD_CARD_NOT_PLACED", `Card ${id} is not placed.`);
  };
  const reserve = (id: string) => {
    if (has(next, id)) fail("BOARD_CARD_ALREADY_PLACED", `Card ${id} is already placed; use move.`);
  };
  const slot = (id: string) => {
    const found = board.slots.find((s) => s.id === id);
    if (!found) fail("BOARD_SLOT_NOT_FOUND", `Slot ${id} does not exist.`);
    return found!;
  };
  if (action.type !== "unlock") unlocked(action.cardId);
  switch (action.type) {
    case "place": reserve(action.cardId); slot(action.slotId); next.placements[action.cardId] = action.slotId; break;
    case "move":
      if (board.allowMoves === false) fail("BOARD_MOVE_FORBIDDEN", "Moves are disabled.");
      placed(action.cardId); slot(action.slotId); next.placements[action.cardId] = action.slotId; break;
    case "replace":
      if (board.allowReplacements === false) fail("BOARD_REPLACE_FORBIDDEN", "Replacements are disabled.");
      unlocked(action.replaceCardId); reserve(action.cardId); placed(action.replaceCardId); slot(action.slotId);
      if (next.placements[action.replaceCardId] !== action.slotId) fail("BOARD_REPLACEMENT_SLOT_MISMATCH", "Replaced card must occupy the target slot.");
      delete next.placements[action.replaceCardId]; next.placements[action.cardId] = action.slotId; break;
    case "swap": {
      if (board.allowMoves === false) fail("BOARD_MOVE_FORBIDDEN", "Moves are disabled.");
      unlocked(action.otherCardId); placed(action.cardId); placed(action.otherCardId);
      const old = next.placements[action.cardId];
      next.placements[action.cardId] = next.placements[action.otherCardId];
      next.placements[action.otherCardId] = old; break;
    }
    case "remove": placed(action.cardId); delete next.placements[action.cardId]; break;
    case "lock": placed(action.cardId); next.lockedCardIds.push(action.cardId); break;
    case "unlock": placed(action.cardId); next.lockedCardIds = next.lockedCardIds.filter((id) => id !== action.cardId); break;
  }
  if (board.lockOnPlace && (action.type === "place" || action.type === "replace")) next.lockedCardIds.push(action.cardId);
  next.lockedCardIds = [...new Set(next.lockedCardIds)].filter((id) => has(next, id));
  const counts = new Map<string, number>();
  const participants = new Set<string>();
  let spent = 0;
  for (const [id, destination] of Object.entries(next.placements)) {
    const c = cardById.get(id);
    if (!c) fail("BOARD_CARD_NOT_AVAILABLE", `Placed card ${id} is not available.`);
    if (!board.allowRepeatParticipants && participants.has(c!.participantId)) fail("BOARD_PARTICIPANT_REPEATED", `Participant ${c!.participantId} is already on the board.`);
    participants.add(c!.participantId);
    const count = (counts.get(destination) ?? 0) + 1; counts.set(destination, count);
    if (count > (slot(destination).capacity ?? Infinity)) fail("BOARD_SLOT_FULL", `Slot ${destination} is full.`);
    if (!Number.isFinite(c!.cost ?? 0) || (c!.cost ?? 0) < 0) fail("BOARD_COST_INVALID", "Card cost must be finite and nonnegative.");
    spent += c!.cost ?? 0;
  }
  if (!Number.isFinite(spent) || (board.budget !== undefined && spent > board.budget + 1e-9)) fail("BOARD_BUDGET_EXCEEDED", `Placement costs ${spent}, budget is ${board.budget}.`);
  next.spent = spent;
  return next;
}

/** Resolve authored rounds without guessing choices. Invalid actions leave the prior state intact. */
export function resolveBoard(board: BoardDefinition, participants: Participant[]): BoardResolution {
  const result: BoardResolution = { rounds: [], final: createBoardState(), diagnostics: [] };
  const known = new Map<string, BoardCard>();
  const ids = new Set(participants.map((p) => p.id));
  const report = (code: string, message: string, path: string) => result.diagnostics.push({ severity: "error", code, message, path });
  let state = createBoardState();
  const estimate = (board.rounds.length + board.rounds.reduce((n, r) => n + r.cards.length + r.actions.length, 0) + 1) * (board.slots.length * 4 + board.rounds.reduce((n, r) => n + r.cards.length, 0) * 2 + 10);
  if (estimate > videoResourceLimits.maxExpandedNodes) {
    report("RESOURCE_BUDGET_EXCEEDED", "Board state expansion exceeds node budget.", "board"); return result;
  }
  for (const round of board.rounds) {
    const path = `board.rounds.${round.id}`;
    if (board.mode === "rounds" && !board.carry) { state = createBoardState(); known.clear(); }
    if (round.clearSlotIds) {
      for (const id of round.clearSlotIds) if (!board.slots.some((s) => s.id === id)) report("BOARD_SLOT_NOT_FOUND", `Slot ${id} does not exist.`, `${path}.clearSlotIds`);
      const next = copy(state);
      for (const [id, slotId] of Object.entries(next.placements)) if (round.clearSlotIds.includes(slotId)) delete next.placements[id];
      next.lockedCardIds = next.lockedCardIds.filter((id) => has(next, id));
      next.spent = Object.keys(next.placements).reduce((sum, id) => sum + (known.get(id)?.cost ?? 0), 0); state = next;
    }
    const seen = new Set<string>();
    for (const c of round.cards) {
      if (!ids.has(c.participantId)) report("BOARD_PARTICIPANT_NOT_FOUND", `Participant ${c.participantId} does not exist.`, `${path}.cards.${c.id}`);
      if (!board.allowRepeatParticipants && seen.has(c.participantId)) report("BOARD_PARTICIPANT_REPEATED", `Participant ${c.participantId} occurs twice in this round.`, `${path}.cards.${c.id}`);
      if (known.has(c.id)) report("BOARD_CARD_DUPLICATE", `Card ${c.id} was already introduced.`, `${path}.cards.${c.id}`);
      seen.add(c.participantId); known.set(c.id, c);
    }
    const resolved = { round, initial: copy(state), steps: [] as BoardResolution["rounds"][number]["steps"], final: copy(state) };
    for (const action of round.actions) {
      try {
        const after = applyBoardAction(board, state, action, [...known.values()]);
        resolved.steps.push({ action, before: copy(state), after: copy(after) }); state = after;
      } catch (error) {
        if (!(error instanceof BoardRuleError)) throw error;
        report(error.code, error.message, `${path}.actions.${action.id}`);
      }
    }
    if (board.requireAllAssigned && round.cards.some((c) => !has(state, c.id))) report("BOARD_ASSIGNMENT_MISSING", "Every candidate in this round must be assigned.", `${path}.actions`);
    resolved.final = copy(state); result.rounds.push(resolved);
  }
  result.final = copy(state); return result;
}
