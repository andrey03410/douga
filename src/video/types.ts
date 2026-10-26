/** Public, browser-safe SDK v1. All times become integer frames at compilation. */
export type VideoFormat = "wide" | "vertical" | "square";
export type Time = { sec: number } | { frame: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Window = { from: number; to: number };
export type Crop = Rect;
export type TextValue =
  | string
  | {
      bind:
        | "document.title"
        | "participant.label"
        | "participant.rank"
        | "round.prompt"
        | "group.label";
      groupId?: string;
      prefix?: string;
      suffix?: string;
    };
export interface CardStyle {
  fit?: "cover" | "contain" | "fill";
  crop?: Crop;
  offsetSec?: number;
  loop?: boolean;
  playSound?: boolean;
  volume?: number;
  borderRadius?: number;
  background?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  orientation?: "landscape" | "portrait";
}
export interface Settings {
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
  rank?: number;
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
export interface Source {
  kind: "manual" | "tournament";
  tournamentId?: string;
  version?: string;
  participants: Participant[];
  rounds: PickerRound[];
}
export type AssetBinding =
  | { kind: "pool"; assetId: string; hash?: string }
  | { kind: "track"; tournamentId: string; trackId: string; hash?: string }
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
    | { type: "timer"; duration?: Time }
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
export interface VideoScene {
  id: string;
  block: "custom" | "top" | "picker";
  repeat?: "participants" | "rounds";
  participantId?: string;
  roundId?: string;
  duration?: Time;
  settings?: Settings;
  nodes: VideoNode[];
  transition?: { type: "none" | "fade" | "slide"; duration: Time };
  background?: string;
}
export interface AudioAnchor {
  event:
    | "scene.start"
    | "card.reveal"
    | "timer.start"
    | "answer.start"
    | "transition.start";
  sceneId?: string;
  participantId?: string;
  roundId?: string;
  cardId?: string;
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
export interface VideoDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: "top" | "picker";
  seed: number;
  output: { format: VideoFormat; fps: number };
  source: Source;
  bindings: Record<string, AssetBinding>;
  settings: Settings;
  formatSettings?: Partial<Record<VideoFormat, Settings>>;
  scenes: VideoScene[];
  audio?: { playlist?: Playlist; cues?: AudioCue[] };
  preset?: { id: string; version: number };
}
export interface VideoPreset {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  kind: "top" | "picker";
  output: VideoDocument["output"];
  settings: Settings;
  formatSettings?: VideoDocument["formatSettings"];
  scenes: VideoScene[];
  skeleton: { roundCount: number; cardsPerRound: number; groupCount: number };
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
  id: string;
  type:
    | "container"
    | "text"
    | "shape"
    | "image"
    | "video"
    | "card"
    | "timer"
    | "group";
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
  id: string;
  kind: "custom" | "top" | "picker" | "answer";
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
  transition: { type: "none" | "fade" | "slide"; durationInFrames: number };
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
  schemaVersion: 1;
  compilerVersion: "1.0.0";
  seed: number;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  scenes: CompiledScene[];
  audio: CompiledAudio[];
}
export interface CompileResult {
  plan: CompiledVideo;
  diagnostics: Diagnostic[];
  ready: boolean;
}
export type PatchTarget =
  | { type: "document" }
  | {
      type: "participant" | "round" | "card" | "group" | "scene" | "node";
      id: string;
    };
export type PatchOperation =
  | { op: "set"; target: PatchTarget; path: string[]; value: unknown }
  | { op: "unset"; target: PatchTarget; path: string[] };
