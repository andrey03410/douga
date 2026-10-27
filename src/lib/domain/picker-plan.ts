// Picker-mode plan: pure timing/layout math shared by the Player preview and
// the headless render (same contract idea as video-plan.ts for tops).

import type { ArtCrop, FitMode } from "./art-crop";
import { resolveFootage } from "./position-media";
import {
  pickerLayout,
  groupLayout,
  MIN_GROUPS,
  MIN_TILES,
  type TileRect,
  type TileOrientation,
} from "./picker-layout";
import type { SegmentVisual } from "./video-plan";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const TILE_ANIM_SEC = 0.4; // pop-in animation of a tile
export const PROMPT_INTRO_SEC = 1.5; // beat before the first tile when a prompt is shown
export const NO_PROMPT_INTRO_SEC = 0.5;
export const ANSWER_SEC = 2.5; // answer-highlight phase
export const ROUND_GAP_SEC = 0.7; // dark gap between rounds
export const MUSIC_FADE_SEC = 1; // playlist crossfade (and loop) length
export const GROUP_STAGGER_SEC = 0.15; // cascade between cards inside one block
export const BOOKEND_SEC = 3; // title / final card length (same as tops)

export type LabelsMode = "always" | "finale" | "never";

/** Positional block names used when a block has no name of its own. */
export const GROUP_FALLBACK_NAMES = ["Блок А", "Блок Б", "Блок В"];

/** Display name of a block: its own label, else the positional one. */
export function groupName(index: number, label: string | null | undefined): string {
  return label?.trim() || GROUP_FALLBACK_NAMES[index] || `Блок ${index + 1}`;
}

export interface PickerDefaults {
  revealSec: number;
  hideAfterReveal: boolean;
  timerSec: number;
  tickSound: boolean;
}

export interface TileMediaInput {
  kind: "image" | "video";
  /** Opaque ref: URL for preview, file path for render. */
  ref: string;
  posterRef: string | null;
  durationSec: number | null;
  hasAudio: boolean;
}

export interface PlanTileInput {
  media: TileMediaInput;
  crop: ArtCrop | null;
  startSec: number | null;
  label: string | null;
  isAnswer: boolean;
  playSound: boolean;
  fitMode: FitMode;
}

export type RoundMode = "single" | "groups";

/** One block of a group-comparison round (spec 16). */
export interface PlanGroupInput {
  label: string | null;
  isAnswer: boolean;
  tiles: PlanTileInput[];
}

export interface PlanRoundInput {
  prompt: string | null;
  showPrompt: boolean;
  labelsMode: LabelsMode;
  revealSec: number | null; // null = inherit default
  hideAfterReveal: boolean | null;
  timerSec: number | null;
  bg: { kind: "image" | "video"; ref: string; durationSec: number | null } | null;
  bgMusic: { ref: string; durationSec: number | null } | null;
  orientation: TileOrientation;
  tiles: PlanTileInput[];
  /** "single" (default) = plain tiles; "groups" = block against block. */
  mode?: RoundMode;
  /** Blocks of a group round (2-3, each 1-5 cards); ignored in single mode. */
  groups?: PlanGroupInput[];
}

export interface PlanTile {
  rect: TileRect;
  visual: SegmentVisual;
  posterRef: string | null; // static frame for the finale (video tiles)
  label: string | null;
  isAnswer: boolean;
  /** Absolute times (sec from video start). */
  revealAtSec: number;
  /** End of the tile's own window; null = stays visible until the finale. */
  hideAtSec: number | null;
  /** Sound of the tile's own footage during its window (video with audio). */
  sound: { fromSec: number; durationSec: number; ref: string; startSec: number } | null;
  showLabelDuringReveal: boolean;
  showLabelAtFinale: boolean;
}

export interface MusicTrackInput {
  /** Opaque ref: URL for preview, file basename for render. */
  ref: string;
  durationSec: number | null;
}

export interface MusicCue {
  ref: string;
  fromSec: number;
  durationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface PlanMusic {
  cues: MusicCue[];
  /** Rounds with their own music override: the playlist is silent there. */
  muteWindows: { fromSec: number; toSec: number }[];
  /** Tile-sound windows of rounds WITHOUT an override (playlist ducks there). */
  duckWindows: { fromSec: number; toSec: number }[];
}

/**
 * Lay the playlist over the whole video: tracks back to back with a crossfade
 * overlap, looping until the video ends. The last cue may overhang the video
 * end (the composition clamps it).
 */
export function buildMusicCues(
  tracks: MusicTrackInput[],
  totalSec: number,
): MusicCue[] {
  const usable = tracks.filter((t) => (t.durationSec ?? 0) > 0.2);
  if (usable.length === 0 || totalSec <= 0) return [];
  const cues: MusicCue[] = [];
  let t = 0;
  let i = 0;
  while (t < totalSec && cues.length < 500) {
    const track = usable[i % usable.length];
    const durationSec = Math.min(track.durationSec!, totalSec - t + MUSIC_FADE_SEC);
    cues.push({
      ref: track.ref,
      fromSec: t,
      durationSec,
      fadeInSec: MUSIC_FADE_SEC,
      fadeOutSec: MUSIC_FADE_SEC,
    });
    // advance by the audible (non-overlapped) part; floor keeps progress even
    // for pathologically short tracks
    t += Math.max(0.5, durationSec - MUSIC_FADE_SEC);
    i++;
  }
  return cues;
}

/** A laid-out block: panel rect, its own reveal window and its cards. */
export interface PlanGroup {
  index: number;
  label: string | null;
  isAnswer: boolean;
  panel: TileRect;
  revealAtSec: number;
  /** End of the block window; null = stays visible until the finale. */
  hideAtSec: number | null;
  tiles: PlanTile[];
}

export interface PlanRound {
  index: number;
  startSec: number;
  endSec: number;
  prompt: string | null; // null when hidden
  mode: RoundMode;
  /** Plain tiles of a single-mode round (empty in group mode). */
  tiles: PlanTile[];
  /** Blocks of a group round (empty in single mode). */
  groups: PlanGroup[];
  finaleAtSec: number;
  timerSec: number;
  tickSound: boolean;
  /** Answer-highlight phase start; null when the round has no marked answer. */
  answerAtSec: number | null;
  /** Tile own-sound windows of this round (absolute sec). */
  duckWindows: { fromSec: number; toSec: number }[];
  bg: { kind: "image" | "video"; ref: string; durationSec: number | null } | null;
  bgMusic: {
    ref: string;
    durationSec: number | null;
    /** Windows (absolute sec) where the music ducks under a tile's own sound. */
    duckWindows: { fromSec: number; toSec: number }[];
  } | null;
}

/** Title / final card: text with a length, laid at the very start / very end. */
export interface PlanBookend {
  text: string;
  fromSec: number;
  durationSec: number;
}

/** Bookend request: text (already resolved to a non-empty string) or null = off. */
export interface BookendsInput {
  intro: { text: string } | null;
  outro: { text: string } | null;
}

export interface PickerPlan {
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  durationInFrames: number;
  rounds: PlanRound[];
  /** Continuous background playlist; null when the project has none. */
  music: PlanMusic | null;
  /** Title card before the first round; null when disabled. */
  intro: PlanBookend | null;
  /** Final card after the last round; null when disabled. */
  outro: PlanBookend | null;
}

/** Everything the tile math needs beyond the input itself. */
interface TileContext {
  rect: TileRect;
  revealAtSec: number;
  /** End of the tile's own window; null = visible until the finale. */
  hideAtSec: number | null;
  /** Footage / sound window length. */
  windowSec: number;
  labelsMode: LabelsMode;
  /** May this card carry its own sound (a block gives it to one card only)? */
  withSound: boolean;
}

function planTile(
  tile: PlanTileInput,
  ctx: TileContext,
): { tile: PlanTile; duck: { fromSec: number; toSec: number } | null } {
  const start = Math.max(0, tile.startSec ?? 0);
  const footage =
    tile.media.kind === "video"
      ? resolveFootage(start, tile.media.durationSec, ctx.windowSec)
      : { startSec: 0, loopSec: null };
  const visual: SegmentVisual = {
    kind: tile.media.kind,
    path: tile.media.ref,
    crop: tile.crop,
    startSec: footage.startSec,
    loopSec: footage.loopSec,
    fitMode: tile.fitMode,
  };

  let sound: PlanTile["sound"] = null;
  let duck: { fromSec: number; toSec: number } | null = null;
  if (ctx.withSound && tile.media.kind === "video" && tile.playSound && tile.media.hasAudio) {
    const available =
      tile.media.durationSec != null
        ? Math.max(0, tile.media.durationSec - footage.startSec)
        : ctx.windowSec;
    const durationSec = Math.min(ctx.windowSec, available);
    if (durationSec > 0.05) {
      sound = {
        fromSec: ctx.revealAtSec,
        durationSec,
        ref: tile.media.ref,
        startSec: footage.startSec,
      };
      duck = { fromSec: ctx.revealAtSec, toSec: ctx.revealAtSec + durationSec };
    }
  }

  return {
    tile: {
      rect: ctx.rect,
      visual,
      posterRef: tile.media.posterRef,
      label: tile.label?.trim() || null,
      isAnswer: tile.isAnswer,
      revealAtSec: ctx.revealAtSec,
      hideAtSec: ctx.hideAtSec,
      sound,
      showLabelDuringReveal: ctx.labelsMode === "always",
      showLabelAtFinale: ctx.labelsMode !== "never",
    },
    duck,
  };
}

/** Blocks of a group round, or [] when the round is a plain one. */
function roundGroups(round: PlanRoundInput): PlanGroupInput[] {
  return round.mode === "groups" ? (round.groups ?? []) : [];
}

/**
 * The bare round shape the renderability rule reads: a plan input, a loaded DB
 * round (where `tiles` also lists the cards of its blocks) or a constructor DTO.
 */
export interface RenderableRound {
  mode?: string | null;
  tiles: readonly unknown[];
  groups?: readonly { tiles: readonly unknown[] }[] | null;
}

/**
 * Can this round appear in the video at all? A plain round needs at least
 * MIN_TILES (2) tiles; a group round needs at least two blocks with a card in
 * each. The one rule behind the preview plan, the render guard and the
 * constructor hints, so the preview never shows a round the render rejects.
 */
export function roundIsRenderable(round: RenderableRound): boolean {
  if (round.mode === "groups") {
    const groups = round.groups ?? [];
    return groups.length >= MIN_GROUPS && groups.every((g) => g.tiles.length > 0);
  }
  return round.tiles.length >= MIN_TILES;
}

/** Does the round hold any card at all (a plain tile or a card in a block)? */
function roundHasCards(round: RenderableRound): boolean {
  return round.tiles.length > 0 || (round.groups ?? []).some((g) => g.tiles.length > 0);
}

/**
 * 1-based numbers of rounds that hold cards yet are not renderable: exactly the
 * rounds that make the render refuse (ROUND_TOO_SMALL). Empty rounds are not
 * listed — the preview and the render both skip them silently.
 */
export function unrenderableRounds(rounds: readonly RenderableRound[]): number[] {
  return rounds
    .map((round, i) => ({ n: i + 1, bad: roundHasCards(round) && !roundIsRenderable(round) }))
    .filter((r) => r.bad)
    .map((r) => r.n);
}

/** Cascade step inside a block: 0.15 s, squeezed to fit a short reveal window. */
function staggerSec(cards: number, revealSec: number): number {
  if (cards < 2) return 0;
  return Math.max(0, Math.min(GROUP_STAGGER_SEC, (revealSec - 0.2) / (cards - 1)));
}

export function buildPickerPlan(
  defaults: PickerDefaults,
  rounds: PlanRoundInput[],
  playlist: MusicTrackInput[] = [],
  bookends: BookendsInput = { intro: null, outro: null },
): PickerPlan {
  // Bookends only make sense around real content: a project with no renderable
  // round stays an empty timeline (the constructor shows a hint instead).
  const hasContent = rounds.some(roundIsRenderable);
  const introSec = hasContent && bookends.intro ? BOOKEND_SEC : 0;
  const outroSec = hasContent && bookends.outro ? BOOKEND_SEC : 0;

  let cursor = introSec;
  const planRounds: PlanRound[] = [];

  rounds.forEach((round, index) => {
    if (!roundIsRenderable(round)) return; // nothing to show — skipped entirely

    const mode: RoundMode = round.mode === "groups" ? "groups" : "single";
    const revealSec = round.revealSec ?? defaults.revealSec;
    const hideAfter = round.hideAfterReveal ?? defaults.hideAfterReveal;
    const timerSec = round.timerSec ?? defaults.timerSec;

    const startSec = cursor;
    const promptShown = round.showPrompt && !!round.prompt?.trim();
    const leadSec = promptShown ? PROMPT_INTRO_SEC : NO_PROMPT_INTRO_SEC;
    const duckWindows: { fromSec: number; toSec: number }[] = [];

    let tiles: PlanTile[] = [];
    let groups: PlanGroup[] = [];
    let steps: number; // how many reveal windows the round takes
    let hasAnswer: boolean;

    if (mode === "groups") {
      const blocks = roundGroups(round);
      const layout = groupLayout(
        blocks.map((g) => g.tiles.length),
        round.orientation,
      );
      steps = blocks.length;
      hasAnswer = blocks.some((g) => g.isAnswer);
      groups = blocks.map((block, gi) => {
        const revealAtSec = startSec + leadSec + gi * revealSec;
        const hideAtSec = hideAfter ? revealAtSec + revealSec : null;
        const step = staggerSec(block.tiles.length, revealSec);
        // The whole block ducks the music once: only its first sounded card
        // actually plays, otherwise 3-5 videos turn into noise.
        let soundTaken = false;
        const cards = block.tiles.map((card, ci) => {
          const planned = planTile(card, {
            rect: layout.cards[gi][ci],
            revealAtSec: revealAtSec + ci * step,
            hideAtSec,
            windowSec: revealSec,
            labelsMode: round.labelsMode,
            withSound: !soundTaken,
          });
          if (planned.duck) {
            soundTaken = true;
            duckWindows.push(planned.duck);
          }
          return planned.tile;
        });
        return {
          index: gi,
          label: block.label?.trim() || null,
          isAnswer: block.isAnswer,
          panel: layout.panels[gi],
          revealAtSec,
          hideAtSec,
          tiles: cards,
        };
      });
    } else {
      const rects = pickerLayout(Math.max(2, Math.min(9, round.tiles.length)), round.orientation);
      steps = round.tiles.length;
      hasAnswer = round.tiles.some((t) => t.isAnswer);
      tiles = round.tiles.map((tile, i) => {
        const revealAtSec = startSec + leadSec + i * revealSec;
        const planned = planTile(tile, {
          rect: rects[i],
          revealAtSec,
          hideAtSec: hideAfter ? revealAtSec + revealSec : null,
          windowSec: revealSec,
          labelsMode: round.labelsMode,
          withSound: true,
        });
        if (planned.duck) duckWindows.push(planned.duck);
        return planned.tile;
      });
    }

    const finaleAtSec = startSec + leadSec + steps * revealSec;
    const answerAtSec = hasAnswer ? finaleAtSec + timerSec : null;
    const endSec = finaleAtSec + timerSec + (hasAnswer ? ANSWER_SEC : 0) + ROUND_GAP_SEC;

    planRounds.push({
      index,
      startSec,
      endSec,
      prompt: promptShown ? round.prompt!.trim() : null,
      mode,
      tiles,
      groups,
      finaleAtSec,
      timerSec,
      tickSound: defaults.tickSound,
      answerAtSec,
      duckWindows,
      bg: round.bg,
      bgMusic: round.bgMusic
        ? { ref: round.bgMusic.ref, durationSec: round.bgMusic.durationSec, duckWindows }
        : null,
    });
    cursor = endSec;
  });

  const durationSec = Math.max(cursor + outroSec, 1);

  let music: PlanMusic | null = null;
  if (playlist.length > 0) {
    music = {
      cues: buildMusicCues(playlist, durationSec),
      // rounds with their own music silence the playlist for their span
      muteWindows: planRounds
        .filter((r) => r.bgMusic)
        .map((r) => ({ fromSec: r.startSec, toSec: r.endSec })),
      duckWindows: planRounds
        .filter((r) => !r.bgMusic)
        .flatMap((r) => r.duckWindows),
    };
  }

  return {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    durationSec,
    durationInFrames: Math.round(durationSec * FPS),
    rounds: planRounds,
    music,
    intro:
      introSec > 0
        ? { text: bookends.intro!.text, fromSec: 0, durationSec: introSec }
        : null,
    outro:
      outroSec > 0
        ? { text: bookends.outro!.text, fromSec: cursor, durationSec: outroSec }
        : null,
  };
}
