/**
 * Interactive layer contract v1 between Douga and a game host (Asobiba).
 * Types only: safe to import from browser bundles without pulling the schema or zod.
 */
import type { BoardEvent } from "./types";

export const INTERACTIVE_CONTRACT = 1 as const;

export type InteractiveEventName =
  | "scene.start"
  | "card.reveal"
  | "timer.start"
  | "answer.reveal"
  | "scene.end"
  | BoardEvent["event"];

export type InteractiveAnchor =
  | { event: InteractiveEventName; cardId?: string }
  | { time: { sec: number } | { frame: number } };

/** The video stops at this point of the scene and waits for the game. */
export interface InteractiveMoment {
  id: string;
  /** Authored scene id (a repeated scene marks every compiled instance). */
  sceneId: string;
  at: InteractiveAnchor;
}

/** Cards of a scene a player may press. */
export interface InteractiveChoice {
  id: string;
  sceneId: string;
  /** "all" or card ids (picker), participant ids (top) or board card ids. */
  cards: "all" | string[];
}

export type MatchDataUse =
  | "players"
  | "votes"
  | "rank"
  | "score"
  | "pickedBy"
  | "answer"
  | "texts";

/** A segment or scene whose content comes from the match. */
export interface InteractiveTemplate {
  segmentId?: string;
  sceneId?: string;
  uses: MatchDataUse[];
  /** Reorder the participants of the segment by `rank` of the match data. */
  order?: "rank";
  /** The segment shows the players themselves as participants (a scoreboard). */
  participants?: "players";
}

export interface MatchPlayer {
  id: string;
  name: string;
  score?: number;
  rank?: number;
}

export interface MatchParticipantData {
  votes?: number;
  score?: number;
  rank?: number;
  /** Player ids. */
  pickedBy?: string[];
  comment?: string;
}

/** Data a game hands to Douga while a match is played. Everything is already safe to show. */
export interface MatchData {
  players?: MatchPlayer[];
  participants?: Record<string, MatchParticipantData>;
  rounds?: Record<string, { answer?: { cardIds?: string[]; groupIds?: string[] } }>;
  texts?: Record<string, string>;
}

export interface InteractiveLayer {
  version: 1;
  moments: InteractiveMoment[];
  choices: InteractiveChoice[];
  templates: InteractiveTemplate[];
  /** Sample data for storyboards, clips and the linear render. */
  sample: MatchData;
  /** Set by applyMatchData: the data this document was compiled with. */
  current?: MatchData;
}

/** Compiled interactive facts of one plan (frames are plan-absolute). */
export interface CompiledInteraction {
  contract: 1;
  scenes: CompiledInteractiveScene[];
}

export interface CompiledInteractiveScene {
  id: string;
  sourceSceneId: string;
  segmentId?: string;
  roundId?: string;
  participantId?: string;
  from: number;
  to: number;
  holds: { momentId: string; frame: number }[];
  choices: CompiledChoice[];
  uses: MatchDataUse[];
}

export interface CompiledChoice {
  choiceId: string;
  nodeId: string;
  cardId?: string;
  participantId?: string;
  label?: string;
}

export interface ChoiceHit {
  choiceId: string;
  nodeId: string;
  cardId?: string;
  participantId?: string;
}
