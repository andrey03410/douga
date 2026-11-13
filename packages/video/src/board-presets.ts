import type { BoardDefinition, BoardRound, Participant, VideoDocument, VideoFormat, VideoPreset } from "./types";
import { parseVideoDocument } from "./schema";
import { resolveBoard } from "./board-state";

export const boardFamilies = ["tier", "kmk", "smash-pass", "blind-rank", "draft", "sort-quiz", "alignment", "budget-draft"] as const;
export function getBoardPresets(): VideoPreset[] {
  return boardFamilies.flatMap((family) => (["wide", "vertical", "square"] as const).map((format) => {
    const draft = family === "draft" || family === "budget-draft";
    const labels = family === "tier" ? ["S", "A", "B", "C", "D"] : family === "kmk" ? ["Kiss", "Marry", "Kill"] :
      family === "smash-pass" ? ["Smash", "Pass"] : family === "blind-rank" ? ["1", "2", "3", "4", "5"] : draft ?
      ["Captain", "Damage", "Support", "Healer"] : family === "alignment" ?
      ["Lawful good", "Neutral good", "Chaotic good", "Lawful neutral", "True neutral", "Chaotic neutral", "Lawful evil", "Neutral evil", "Chaotic evil"] : ["Anime A", "Anime B", "Anime C"];
    const colors = ["#843c5d", "#846032", "#54703d", "#32687c", "#555081"];
    const one = draft || family === "kmk" || family === "blind-rank";
    const board: BoardDefinition = {
      version: 1, mode: family === "kmk" || family === "smash-pass" || family === "sort-quiz" || draft ? "rounds" : "accumulate",
      slots: labels.map((label, i) => ({ id: `${family}-slot-${i + 1}`, label, background: colors[i % colors.length], ...(one ? { capacity: 1 } : {}) })), rounds: [],
      ...(draft ? { carry: true } : {}), ...(family === "budget-draft" ? { budget: 15 } : {}),
      ...(family === "blind-rank" ? { lockOnPlace: true, allowMoves: false } : {}),
      requireAllAssigned: !draft, layout: family === "alignment" ? "grid" : "rows",
      ...(family === "alignment" ? { columns: 3, xLabel: "Lawful → Chaotic", yLabel: "Good → Evil" } : {}),
      presentation: { reveal: "sequential", focusActive: true, rowFocusSec: family === "tier" ? 1 : 0,
        ...(family === "kmk" || draft ? { reveal: "together" as const } : {}),
        ...(family === "sort-quiz" ? { hideLabelsUntilPlaced: true, hideVisualsUntilPlaced: true } : {}),
      },
    };
    return { schemaVersion: 1, id: `board.${family}.${format}`, name: `board ${family} (${format})`, version: 1, kind: "board", output: { format, fps: 30 },
      settings: { background: "#101522", card: { borderRadius: 14, orientation: "portrait" } },
      scenes: [{ id: "main", block: "board", board, nodes: [] }], skeleton: {
        roundCount: draft ? 4 : family === "blind-rank" ? 5 : family === "tier" || family === "alignment" ? 6 : 3,
        cardsPerRound: draft || family === "kmk" ? 3 : 1, groupCount: 0,
      },
    } satisfies VideoPreset;
  }));
}

export function createBoardDocument(options: {
  id?: string; title?: string; format?: VideoFormat; fps?: number; seed?: number;
  participants?: Participant[]; board?: BoardDefinition; roundCount?: number; cardsPerRound?: number;
}, preset: VideoPreset): VideoDocument {
  const scenes = structuredClone(preset.scenes);
  const boardScenes = scenes.filter((s) => s.board);
  if (!boardScenes.length) throw new Error("Board preset requires a board scene");
  const participantMap = new Map<string, Participant>();
  let total = 0;
  for (const [sceneIndex, scene] of boardScenes.entries()) {
    const skeleton = preset.skeleton.boards?.find((b) => b.sceneId === scene.id) ?? preset.skeleton;
    const perRound = options.cardsPerRound ?? skeleton.cardsPerRound;
    const count = options.roundCount ?? (options.participants ? Math.ceil(options.participants.length / perRound) : skeleton.roundCount);
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(perRound) || perRound < 1 || (total += count * perRound) > 20000) throw new Error("RESOURCE_BUDGET_EXCEEDED: Invalid board factory counts");
    const board = structuredClone(sceneIndex === 0 && options.board ? options.board : scene.board!);
    const prefix = `board-${sceneIndex + 1}`;
    const participants = structuredClone(options.participants ?? (sceneIndex === 0 && options.board ?
      [...new Set(board.rounds.flatMap((r) => r.cards.map((c) => c.participantId)))].map((id, i) => ({ id, label: `Candidate ${i + 1}` })) :
      Array.from({ length: count * perRound }, (_, i) => ({ id: `${prefix}-participant-${i + 1}`, label: `Candidate ${i + 1}` }))));
    participants.forEach((p) => participantMap.set(p.id, p));
    if (!(sceneIndex === 0 && options.board)) {
      const occupied = new Map<string, { cardId: string; participantId: string; cost: number }>();
      const draft = board.carry === true;
      let spent = 0;
      board.rounds = Array.from({ length: count }, (_, ri): BoardRound => {
        if (board.mode === "rounds" && !board.carry) { occupied.clear(); spent = 0; }
        const length = options.participants && options.roundCount === undefined ? Math.min(perRound, Math.max(0, participants.length - ri * perRound)) : Math.min(perRound, participants.length);
        const cards = Array.from({ length }, (_, ci) => ({
          id: `${prefix}-card-${ri + 1}-${ci + 1}`, participantId: participants[(ri * perRound + ci) % participants.length].id,
          ...(board.budget !== undefined ? { cost: [5, 4, 3, 3][ri % 4] + ci } : {}),
        }));
        const selected = draft ? cards.filter((c) => board.allowRepeatParticipants || ![...occupied.values()].some((o) => o.participantId === c.participantId)).slice(0, 1) : cards;
        const actions = selected.map((c, ci) => {
          const slot = board.slots[(draft ? ri : ri * perRound + ci) % board.slots.length];
          const old = draft ? occupied.get(slot.id) : undefined;
          if (board.budget !== undefined) c.cost = Math.max(0, Math.min(c.cost ?? 0, board.budget - spent + (old?.cost ?? 0)));
          spent += (c.cost ?? 0) - (old?.cost ?? 0);
          occupied.set(slot.id, { cardId: c.id, participantId: c.participantId, cost: c.cost ?? 0 });
          return old ? { id: `${prefix}-action-${ri + 1}-${ci + 1}`, type: "replace" as const, cardId: c.id, slotId: slot.id, replaceCardId: old.cardId } :
            { id: `${prefix}-action-${ri + 1}-${ci + 1}`, type: "place" as const, cardId: c.id, slotId: slot.id };
        });
        return { id: `${prefix}-round-${ri + 1}`, prompt: `Round ${ri + 1}`, cards, actions };
      });
    }
    scene.board = board;
    const errors = resolveBoard(board, participants).diagnostics;
    if (errors.length) throw new Error(errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
  }
  return parseVideoDocument({ schemaVersion: 2, id: options.id ?? "video", title: options.title ?? "Board", kind: "board", seed: options.seed ?? 1,
    output: { format: options.format ?? preset.output.format, fps: options.fps ?? preset.output.fps },
    source: { kind: "manual", participants: [...participantMap.values()], rounds: [] }, bindings: {}, settings: preset.settings,
    ...(preset.formatSettings ? { formatSettings: preset.formatSettings } : {}), scenes: [],
    segments: [{ id: "board", title: options.title ?? "Board", kind: "board", scenes }],
    ...(preset.audio?.cues ? { audio: { cues: preset.audio.cues } } : {}), preset: { id: preset.id, version: preset.version },
  });
}

export function extractBoardDesign(board: BoardDefinition, indexes = { slot: 0, media: 0 }): BoardDefinition {
  const result = structuredClone(board); result.rounds = [];

  result.slots.forEach((s) => {
    s.id = `board-slot-${++indexes.slot}`;
    for (const key of ["image", "backgroundAsset", "sound"] as const) if (s[key]) s[key] = `slot:${key === "sound" ? "boardsound" : "boardimage"}:${++indexes.media}`;
  });
  return result;
}
