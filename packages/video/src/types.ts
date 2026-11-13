import type { CompiledInteraction, InteractiveLayer } from "./interactive-types";
import type {
  TextTypography,
  TypographySettings,
  ResolvedTypography,
  ResolvedTextRun,
  CompiledTextLayout,
} from "./typography-types";
import type { TypographyFontAsset } from "./font-manifest";
import type {
  MotionSettings,
  CompiledMotion,
  BackdropSettings,
  CompiledBackdrop,
  TimerSettings,
  VersusSettings,
  BadgeSettings,
  ProgressSettings,
  TransitionName,
  MotionDirection,
} from "./motion-types";
/** Public, browser-safe SDK v1. All times become integer frames at compilation. */
export type VideoFormat = "wide" | "vertical" | "square";
export type Time = { sec: number } | { frame: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Window = { from: number; to: number };
export type Crop = Rect;
export type PlainTextValue =
  | string
  | {
      bind:
        | "document.title"
        | "participant.label"
        | "participant.displayLabel"
        | "participant.rank"
        | "participant.comment"
        | "participant.album"
        | "participant.score"
        | "participant.subtitle"
        | "participant.tier"
        | "segment.title"
        | "segment.subtitle"
        | "segment.number"
        | "segment.count"
        | "round.prompt"
        | "group.label"
        | "participant.votes"
        | "participant.pickedBy"
        | "match.text";
      groupId?: string;
      /** Key of `match.text`. */
      key?: string;
      prefix?: string;
      suffix?: string;
    };
export type TextValue =
  | PlainTextValue
  | {
      runs: {
        text: PlainTextValue;
        color?: string;
        weight?: 400 | 700;
        italic?: boolean;
        decoration?: "none" | "underline" | "line-through";
      }[];
    };
export type BackgroundGradient = {
  stops: { color: string; at: number }[];
} & (
  | { type: "linear"; angle?: number }
  | { type: "radial"; center?: { x: number; y: number } }
);
export interface ShadowStyle {
  color: string;
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
}
export interface CardStyle {
  blur?: number;
  fit?: "cover" | "contain" | "fill";
  crop?: Crop;
  offsetSec?: number;
  loop?: boolean;
  playSound?: boolean;
  volume?: number;
  borderRadius?: number;
  background?: string;
  /** null explicitly disables inherited paint. */
  gradient?: BackgroundGradient | null;
  shadow?: ShadowStyle | null;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  orientation?: "landscape" | "portrait";
}
export interface Settings {
  typography?: TypographySettings | null;
  motion?: MotionSettings;
  backdrop?: BackdropSettings | null;
  timer?: TimerSettings;
  versus?: VersusSettings;
  background?: string;
  card?: CardStyle;
  labels?: {
    mode?: "always" | "finale" | "never" | "active" | "answer";
    showRank?: boolean;
    delaySec?: number;
    holdSec?: number;
  };
  layout?: {
    type: "grid" | "arc" | "free";
    gap?: number;
    padding?: number;
    columns?: number;
    positions?: Rect[];
  };
  top?: {
    order?: "source" | "ascending" | "descending";
    durationSec?: number;
    snippet?: {
      mode: "manual" | "full" | "active";
      startSec?: number;
      durationSec?: number;
      activeStartSec?: number;
      activeEndSec?: number;
    };
  };
  picker?: {
    leadSec?: number;
    revealSec?: number;
    timerSec?: number;
    answerSec?: number;
    hideAfterReveal?: boolean;
    answerMode?: "inline" | "separate";
    staggerSec?: number;
    tick?: string;
    timerRect?: Rect;
    showPrompt?: boolean;
  };
}
export interface Participant {
  id: string;
  label: string;
  caption?: string;
  comment?: string;
  album?: string;
  score?: number;
  bestMomentSec?: number;
  rank?: number;
  /** Task 33: second caption line from the source (a character's anime, "year · studio"). */
  subtitle?: string;
  /** Task 33: tier name when the source segment is a tier list. */
  tier?: string;
  /** Task 33: the participant's page (Shikimori). */
  link?: string;
  /** Task 33: what the participant is; an image has no sound of its own. */
  kind?: "audio" | "video" | "image";
  /** Task 34: votes of a match, written by applyMatchData. */
  votes?: number;
  /** Task 34: names of the players who picked this participant. */
  pickedBy?: string[];
  media?: { visual?: string; audio?: string };
  settings?: Settings;
}
export interface PickerCard {
  id: string;
  participantId: string;
  label?: string;
  settings?: Settings;
}
export interface PickerGroup {
  id: string;
  label?: string;
  cardIds: string[];
  settings?: Settings;
}
export interface PickerRound {
  id: string;
  prompt?: string;
  cards: PickerCard[];
  groups?: PickerGroup[];
  answer?: { cardIds?: string[]; groupIds?: string[] };
  settings?: Settings;
  music?: string | null;
  background?: string;
}
export interface SourceSegment {
  id: string;
  title: string;
  subtitle?: string;
  poster?: string;
  participantIds: string[];
}
export interface Source {
  kind: "manual" | "tournament";
  tournamentId?: string;
  segmentId?: string;
  segments?: SourceSegment[];
  suppressedSegmentIds?: string[];
  dormantSegments?: {
    id: string;
    sourceSegmentId: string;
    enabled?: boolean;
  }[];
  version?: string;
  participants: Participant[];
  rounds: PickerRound[];
}
export type AssetBinding =
  | { kind: "pool"; assetId: string; hash?: string }
  | {
      kind: "track";
      tournamentId: string;
      trackId: string;
      media?: "cover";
      hash?: string;
    }
  | { kind: "builtin"; name: "tick" | "reveal" | "answer" };
export interface ResolvedAsset {
  id: string;
  kind: "image" | "video" | "audio";
  src: string;
  durationSec?: number;
  hasAudio?: boolean;
  posterSrc?: string;
  width?: number;
  height?: number;
  hash?: string;
}
export type AssetManifest = Record<string, ResolvedAsset>;
export interface Animation {
  property: "opacity" | "x" | "y" | "scale" | "rotate";
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring";
  keyframes: { at: Time; value: number }[];
}
export interface NodeBase {
  typography?: TextTypography | null;
  motion?: MotionSettings;
  id: string;
  rect?: Rect;
  units?: "relative" | "px";
  anchor?: "topLeft" | "center" | "bottomRight";
  layer?: number;
  timing?: { at?: Time; duration?: Time };
  style?: CardStyle;
  animation?: Animation[];
  opacity?: number;
  rotate?: number;
  scale?: number;
}
export type VideoNode = NodeBase &
  (
    | {
        type: "container";
        repeat?: "participants";
        selection?: "segment" | "document" | "revealed";
        children: VideoNode[];
        flow?: "parallel" | "sequence";
        layout?: Settings["layout"];
      }
    | { type: "text"; text: TextValue }
    | {
        type: "shape";
        shape: "rect" | "ellipse" | "path";
        path?: string;
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
      }
    | { type: "image" | "video"; asset: string; required?: boolean }
    | { type: "card"; participantId: string; label?: TextValue }
    | ({ type: "timer"; duration?: Time } & TimerSettings)
    | ({ type: "versus" } & VersusSettings)
    | ({ type: "badge"; text?: TextValue } & BadgeSettings)
    | ({ type: "progress" } & ProgressSettings)
    | {
        type: "audio";
        asset: string;
        role: "primary" | "music" | "sfx" | "voice";
        volume?: number;
        offsetSec?: number;
        loop?: boolean;
        fadeInSec?: number;
        fadeOutSec?: number;
      }
  );
/** Declarative board v1: authored choices, independent of playback and UI. */
export interface BoardSlot {
  typography?: TextTypography | null;
  id: string;
  label: string;
  capacity?: number;
  color?: string;
  background?: string;
  image?: string;
  backgroundAsset?: string;
  sound?: string;
  rect?: Rect;
  style?: CardStyle;
}
export interface BoardCard {
  id: string;
  participantId: string;
  cost?: number;
}
export type BoardAction = {
  id: string;
  comment?: string;
  sound?: string;
} & (
  | { type: "place" | "move"; cardId: string; slotId: string }
  | { type: "replace"; cardId: string; slotId: string; replaceCardId: string }
  | { type: "swap"; cardId: string; otherCardId: string }
  | { type: "remove" | "lock" | "unlock"; cardId: string }
);
export interface BoardRound {
  id: string;
  prompt?: string;
  cards: BoardCard[];
  actions: BoardAction[];
  clearSlotIds?: string[];
}
export interface BoardDefinition {
  version: 1;
  mode: "accumulate" | "rounds";
  slots: BoardSlot[];
  rounds: BoardRound[];
  carry?: boolean;
  budget?: number;
  allowMoves?: boolean;
  allowReplacements?: boolean;
  lockOnPlace?: boolean;
  allowRepeatParticipants?: boolean;
  requireAllAssigned?: boolean;
  layout?: "rows" | "grid" | "free";
  columns?: number;
  xLabel?: string;
  yLabel?: string;
  presentation?: {
    reveal?: "together" | "sequential";
    answerReveal?: "round" | "end";
    hideLabelsUntilPlaced?: boolean;
    hideVisualsUntilPlaced?: boolean;
    shuffleCandidates?: boolean;
    focusActive?: boolean;
    leadSec?: number;
    revealSec?: number;
    thinkSec?: number;
    moveSec?: number;
    holdSec?: number;
    finalSec?: number;
    rowFocusSec?: number;
  };
}
export interface BoardState {
  placements: Record<string, string>;
  lockedCardIds: string[];
  spent: number;
}
export interface BoardStep {
  action: BoardAction;
  before: BoardState;
  after: BoardState;
}
export interface ResolvedBoardRound {
  round: BoardRound;
  initial: BoardState;
  steps: BoardStep[];
  final: BoardState;
}
export interface BoardResolution {
  rounds: ResolvedBoardRound[];
  final: BoardState;
  diagnostics: Diagnostic[];
}
export interface BoardEvent {
  event:
    | "board.reveal"
    | "board.place"
    | "board.move"
    | "board.replace"
    | "board.swap"
    | "board.remove"
    | "board.lock"
    | "board.unlock"
    | "board.summary";
  frame: number;
  cardId?: string;
  participantId?: string;
  slotId?: string;
  actionId?: string;
}
export interface VideoScene {
  id: string;
  block: "custom" | "top" | "picker" | "board";
  board?: BoardDefinition;
  repeat?: "participants" | "rounds";
  participantId?: string;
  roundId?: string;
  duration?: Time;
  settings?: Settings;
  nodes: VideoNode[];
  transition?: {
    type: TransitionName;
    duration: Time;
    direction?: MotionDirection;
    color?: string;
  };
  background?: string;
}
export interface AudioAnchor {
  event:
    | "scene.start"
    | "card.reveal"
    | "timer.start"
    | "answer.start"
    | "transition.start"
    | BoardEvent["event"];
  sceneId?: string;
  participantId?: string;
  roundId?: string;
  cardId?: string;
  slotId?: string;
  actionId?: string;
}
export interface AudioCue {
  id: string;
  role: "primary" | "music" | "sfx" | "voice";
  asset: string;
  at: Time;
  anchor?: AudioAnchor;
  duration?: Time;
  offsetSec?: number;
  volume?: number;
  loop?: boolean;
  fadeInSec?: number;
  fadeOutSec?: number;
}
export interface Playlist {
  tracks: string[];
  crossfadeSec?: number;
  loop?: boolean;
  volume?: number;
  duckVolume?: number;
}
export interface VideoSegment {
  id: string;
  kind: "top" | "picker" | "custom" | "board";
  title: string;
  subtitle?: string;
  poster?: string;
  sourceSegmentId?: string;
  enabled?: boolean;
  participantIds?: string[];
  roundIds?: string[];
  scenes: VideoScene[];
  settings?: Settings;
  audio?: VideoAudio;
}
export interface VideoAudio {
  playlist?: Playlist;
  cues?: AudioCue[];
}
export interface VideoDocument {
  schemaVersion: 1 | 2;
  segments?: VideoSegment[];
  id: string;
  title: string;
  kind: "top" | "picker" | "board";
  seed: number;
  output: { format: VideoFormat; fps: number };
  source: Source;
  bindings: Record<string, AssetBinding>;
  settings: Settings;
  formatSettings?: Partial<Record<VideoFormat, Settings>>;
  scenes: VideoScene[];
  audio?: VideoAudio;
  preset?: { id: string; version: number };
  /** Task 34: interactive layer; the linear render plays it with sample data. */
  interactive?: InteractiveLayer;
}
export interface VideoPreset {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  kind: "top" | "picker" | "board";
  output: VideoDocument["output"];
  settings: Settings;
  formatSettings?: VideoDocument["formatSettings"];
  scenes: VideoScene[];
  skeleton: {
    roundCount: number;
    cardsPerRound: number;
    groupCount: number;
    boards?: { sceneId: string; roundCount: number; cardsPerRound: number }[];
  };
  audio?: {
    cues?: AudioCue[];
    crossfadeSec?: number;
    loop?: boolean;
    volume?: number;
    duckVolume?: number;
  };
}
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
  nodeId?: string;
}
export interface CompiledMedia {
  asset: ResolvedAsset;
  offsetFrames: number;
  loopFrames: number | null;
  fit: "cover" | "contain" | "fill";
  crop?: Crop;
  /** Freeze at this source frame after the active window, preventing black tails. */ freezeAtFrame?: number;
}
export interface CompiledAnimation {
  property: Animation["property"];
  easing: NonNullable<Animation["easing"]>;
  keyframes: { frame: number; value: number }[];
}
export interface CompiledNode {
  typography?: ResolvedTypography;
  textRuns?: ResolvedTextRun[];
  textLayout?: CompiledTextLayout;
  motion?: CompiledMotion[];
  timer?: Required<TimerSettings>;
  versus?: Required<VersusSettings>;
  badge?: BadgeSettings;
  /** Progress time is scene-local. Video scope uses from=-scene.from and final video duration. */
  progress?: Required<ProgressSettings> & {
    from: number;
    durationInFrames: number;
  };
  id: string;
  type:
    | "container"
    | "text"
    | "shape"
    | "image"
    | "video"
    | "card"
    | "timer"
    | "group"
    | "versus"
    | "badge"
    | "progress";
  parentId?: string;
  rect: Rect;
  layer: number;
  from: number;
  durationInFrames: number;
  visible: Window[];
  style: CardStyle;
  opacity: number;
  rotate: number;
  scale: number;
  animation: CompiledAnimation[];
  text?: string;
  label?: string;
  labelWindows?: Window[];
  cardId?: string;
  showRank?: boolean;
  participantId?: string;
  rank?: number;
  groupId?: string;
  answer?: boolean;
  answerFrom?: number;
  media?: CompiledMedia;
  activeWindow?: Window;
  shape?: "rect" | "ellipse" | "path";
  path?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  timerFrames?: number;
}
export interface CompiledScene {
  backdrop?: CompiledBackdrop;
  segmentId?: string;
  segmentTitle?: string;
  id: string;
  kind: "custom" | "top" | "picker" | "answer" | "board";
  boardEvents?: BoardEvent[];
  boardState?: BoardState;
  from: number;
  durationInFrames: number;
  background: string;
  participantId?: string;
  roundId?: string;
  nodes: CompiledNode[];
  phases: {
    revealStartFrame?: number;
    timerStartFrame?: number;
    answerStartFrame?: number;
  };
  transition: {
    type: TransitionName;
    durationInFrames: number;
    direction?: MotionDirection;
    color?: string;
  };
}
export interface CompiledAudio {
  id: string;
  asset: ResolvedAsset;
  role: AudioCue["role"];
  from: number;
  durationInFrames: number;
  offsetFrames: number;
  loopFrames: number | null;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  duckVolume: number;
  duckWindows: Window[];
  muteWindows: Window[];
}
export interface CompiledVideo {
  fonts?: TypographyFontAsset[];
  schemaVersion: 1;
  compilerVersion: "1.0.0";
  seed: number;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  segments?: {
    id: string;
    title: string;
    kind: VideoSegment["kind"];
    from: number;
    to: number;
  }[];
  scenes: CompiledScene[];
  audio: CompiledAudio[];
  /** Task 34: only plans of interactive documents carry it. */
  interaction?: CompiledInteraction;
}
export interface CompileResult {
  plan: CompiledVideo;
  diagnostics: Diagnostic[];
  ready: boolean;
}
export type PatchTarget =
  | { type: "document" }
  | {
      type:
        | "participant"
        | "round"
        | "card"
        | "group"
        | "scene"
        | "node"
        | "segment"
        | "boardSlot"
        | "boardRound"
        | "boardCard"
        | "boardAction";
      id: string;
    };
export type PatchOperation =
  | { op: "set"; target: PatchTarget; path: string[]; value: unknown }
  | { op: "unset"; target: PatchTarget; path: string[] };
