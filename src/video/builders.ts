import type {
  Participant,
  PickerRound,
  Time,
  VideoDocument,
  VideoFormat,
  VideoNode,
  VideoScene,
  VideoPreset,
} from "./types";
import {
  parseVideoDocument,
  sceneSchema,
  videoNodeSchema,
  videoPresetSchema,
} from "./schema";
import { getBuiltinPreset, applyVideoPreset } from "./presets";
import { videoResourceLimits } from "./resource-limits";
export interface CreateVideoOptions {
  kind: "top" | "picker";
  id?: string;
  title?: string;
  format?: VideoFormat;
  fps?: number;
  seed?: number;
  presetId?: string;
  /** A canonical media-free preset, including an owned personal template. */
  preset?: VideoPreset;
  participants?: Participant[];
  rounds?: PickerRound[];
  roundCount?: number;
  cardsPerRound?: number;
}
export function createVideoDocument(
  options: CreateVideoOptions,
): VideoDocument {
  if (options.preset && options.presetId)
    throw new Error("Supply preset or presetId, not both");
  const preset = options.preset
    ? videoPresetSchema.parse(options.preset)
    : getBuiltinPreset(
        options.presetId ??
          `${options.kind}.classic.${options.format ?? "wide"}`,
      );
  if (!preset) throw new Error(`Unknown preset: ${options.presetId}`);
  if (preset.kind !== options.kind)
    throw new Error("Preset kind does not match requested kind");
  const participants: Participant[] = structuredClone(
    options.participants ??
      (options.kind === "top"
        ? Array.from({ length: 4 }, (_, i) => ({
            id: `participant-${i + 1}`,
            label: `Item ${i + 1}`,
            rank: i + 1,
          }))
        : []),
  );
  let rounds = structuredClone(options.rounds ?? []);
  if (options.kind === "picker" && !options.rounds) {
    const count = options.roundCount ?? preset.skeleton.roundCount;
    const perRound = options.cardsPerRound ?? preset.skeleton.cardsPerRound;
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      !Number.isInteger(perRound) ||
      perRound < 1
    )
      throw new Error(
        "Round and card counts must be nonnegative/positive integers",
      );
    if (
      count > videoResourceLimits.maxExpandedScenes ||
      count * perRound > videoResourceLimits.maxExpandedNodes
    )
      throw new Error("RESOURCE_BUDGET_EXCEEDED");
    rounds = Array.from({ length: count }, (_, ri) => {
      const cards = Array.from({ length: perRound }, (_, ci) => {
        const pid = `participant-${ri + 1}-${ci + 1}`;
        participants.push({ id: pid, label: `Card ${ci + 1}` });
        return { id: `card-${ri + 1}-${ci + 1}`, participantId: pid };
      });
      return {
        id: `round-${ri + 1}`,
        cards,
        ...(preset.skeleton.groupCount
          ? {
              groups: Array.from(
                { length: Math.min(perRound, preset.skeleton.groupCount) },
                (_, gi) => ({
                  id: `group-${ri + 1}-${gi + 1}`,
                  label: `Group ${gi + 1}`,
                  cardIds: cards
                    .filter((_, ci) => ci % preset.skeleton.groupCount === gi)
                    .map((c) => c.id),
                }),
              ),
            }
          : {}),
      };
    });
  }
  const document = applyVideoPreset(
    parseVideoDocument({
      schemaVersion: 1,
      id: options.id ?? "video",
      title: options.title ?? "Untitled video",
      kind: options.kind,
      seed: options.seed ?? 1,
      output: {
        format: options.format ?? preset.output.format,
        fps: options.fps ?? preset.output.fps,
      },
      source: { kind: "manual", participants, rounds },
      bindings: {},
      settings: preset.settings,
      ...(preset.formatSettings
        ? { formatSettings: preset.formatSettings }
        : {}),
      scenes: preset.scenes,
      ...(preset.audio?.cues ? { audio: { cues: preset.audio.cues } } : {}),
      preset: { id: preset.id, version: preset.version },
    }),
    preset,
  );
  document.output = {
    format: options.format ?? preset.output.format,
    fps: options.fps ?? preset.output.fps,
  };
  return parseVideoDocument(document);
}
export function time(sec: number): Time {
  if (!Number.isFinite(sec) || sec < 0)
    throw new Error("Time must be finite and nonnegative");
  return { sec };
}
export function frame(frame: number): Time {
  if (!Number.isInteger(frame) || frame < 0)
    throw new Error("Frame must be a nonnegative integer");
  return { frame };
}
export function scene(
  options: Omit<VideoScene, "block" | "nodes"> & {
    block?: VideoScene["block"];
    nodes?: VideoNode[];
  },
): VideoScene {
  return sceneSchema.parse({ block: "custom", nodes: [], ...options });
}
export function node(options: VideoNode): VideoNode {
  return videoNodeSchema.parse(options);
}
export function textNode(
  options: Omit<Extract<VideoNode, { type: "text" }>, "type">,
): Extract<VideoNode, { type: "text" }> {
  return videoNodeSchema.parse({ type: "text", ...options }) as Extract<
    VideoNode,
    { type: "text" }
  >;
}
export function containerNode(
  options: Omit<Extract<VideoNode, { type: "container" }>, "type">,
): Extract<VideoNode, { type: "container" }> {
  return videoNodeSchema.parse({ type: "container", ...options }) as Extract<
    VideoNode,
    { type: "container" }
  >;
}
