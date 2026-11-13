import { parseVideoDocument, videoPresetSchema } from "./schema";
import { mergeSettings } from "./settings";
import type {
  CardStyle,
  Settings,
  VideoDocument,
  VideoNode,
  VideoPreset,
  VideoScene,
} from "./types";

export interface ApplyVideoRecipeOptions {
  mode?: "preserve" | "replace";
  basePreset?: VideoPreset;
}
export class RecipeApplyError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "RecipeApplyError";
  }
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => same(value, b[index]))
    );
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined),
    other = Object.keys(b).filter((key) => b[key] !== undefined);
  return (
    keys.length === other.length && keys.every((key) => same(a[key], b[key]))
  );
}
/** Missing provenance is not evidence that an authored setting was inherited. */
function differences(current: unknown, base: unknown): unknown {
  if (same(current, base)) return undefined;
  if (!object(current) || !object(base)) return structuredClone(current);
  const result: ObjectValue = {};
  for (const [key, value] of Object.entries(current)) {
    const difference = differences(value, base[key]);
    if (difference !== undefined) result[key] = difference;
  }
  return Object.keys(result).length ? result : undefined;
}
function merge(base: unknown, value: unknown): unknown {
  if (value === undefined) return structuredClone(base);
  if (!object(base) || !object(value)) return structuredClone(value);
  const result = structuredClone(base);
  for (const [key, item] of Object.entries(value))
    result[key] = merge(result[key], item);
  return result;
}
function keepFields(
  result: ObjectValue,
  current: ObjectValue | undefined,
  keys: readonly string[],
) {
  for (const key of keys) {
    if (current?.[key] !== undefined)
      result[key] = structuredClone(current[key]);
    else delete result[key];
  }
}
const cardSemantics = [
  "fit",
  "crop",
  "orientation",
  "offsetSec",
  "loop",
  "playSound",
  "volume",
] as const;
function cardStyle(
  current: CardStyle | undefined,
  target: CardStyle | undefined,
  base: CardStyle | undefined,
  preserve: boolean,
): CardStyle | undefined {
  const result = (merge(
    target ?? {},
    preserve ? differences(current, base) : undefined,
  ) ?? {}) as ObjectValue;
  keepFields(result, current as ObjectValue | undefined, cardSemantics);
  return Object.keys(result).length ? (result as CardStyle) : undefined;
}
/** Timing, selection, layout and media controls never come from an appearance recipe. */
function settings(
  current: Settings | undefined,
  target: Settings | undefined,
  base: Settings | undefined,
  preserve: boolean,
): Settings | undefined {
  const result = (merge(
    target ?? {},
    preserve ? differences(current, base) : undefined,
  ) ?? {}) as Settings;
  keepFields(result as ObjectValue, current as ObjectValue | undefined, [
    "top",
    "picker",
    "labels",
    "layout",
  ]);
  result.card = cardStyle(current?.card, result.card, undefined, false);
  if (!result.card) delete result.card;
  for (const [key, fields] of [
    ["backdrop", ["asset", "source"]],
    ["timer", ["warningSec", "showValue"]],
  ] as const) {
    const value = result[key];
    const authored = current?.[key];
    if (object(value) || object(authored)) {
      const copy: ObjectValue = { ...(object(value) ? value : {}) };
      keepFields(copy, object(authored) ? authored : undefined, fields);
      if (Object.keys(copy).length) (result as ObjectValue)[key] = copy;
      else delete result[key];
    }
  }
  return Object.keys(result).length ? result : undefined;
}
function typography<T extends { role?: unknown }>(
  current: T | null | undefined,
  target: T | null | undefined,
  base: T | null | undefined,
  preserve: boolean,
): T | null | undefined {
  const result = merge(
    target,
    preserve ? differences(current, base) : undefined,
  ) as T | null | undefined;
  if (current?.role !== undefined)
    return { ...(result ?? {}), role: current.role } as T;
  return result;
}
function nodes(
  items: VideoNode[],
  targets: VideoNode[],
  bases: VideoNode[],
  preserve: boolean,
) {
  for (const node of items) {
    const target = targets.find(
      (other) => other.id === node.id && other.type === node.type,
    );
    const base = bases.find(
      (other) => other.id === node.id && other.type === node.type,
    );
    const style = cardStyle(node.style, target?.style, base?.style, preserve);
    if (style) node.style = style;
    else delete node.style;
    const type = typography(
      node.typography,
      target?.typography,
      base?.typography,
      preserve,
    );
    if (type !== undefined) node.typography = type;
    else delete node.typography;
    const motion = merge(
      target?.motion,
      preserve ? differences(node.motion, base?.motion) : undefined,
    ) as VideoNode["motion"];
    if (motion !== undefined) node.motion = motion;
    else delete node.motion;
    if (node.type === "container")
      nodes(
        node.children,
        target?.type === "container" ? target.children : [],
        base?.type === "container" ? base.children : [],
        preserve,
      );
  }
}
function matchingScene(
  scene: VideoScene,
  preset: VideoPreset | undefined,
  segmentId?: string,
): VideoScene | undefined {
  return preset?.scenes.find(
    (template) =>
      template.id === scene.id ||
      (segmentId !== undefined &&
        scene.id === `segment:${segmentId}:${template.id}`),
  );
}
/** Apply design to an existing authoring graph. The graph itself is never replaced. */
export function applyVideoRecipe(
  document: VideoDocument,
  preset: VideoPreset,
  options: ApplyVideoRecipeOptions = {},
): VideoDocument {
  const doc = structuredClone(parseVideoDocument(document)),
    target = videoPresetSchema.parse(preset);
  if (!target.id.startsWith("recipe."))
    throw new RecipeApplyError("RECIPE_REQUIRED");
  if (target.kind !== doc.kind)
    throw new RecipeApplyError("PRESET_KIND_MISMATCH");
  const preserve = options.mode !== "replace";
  if (
    options.mode !== undefined &&
    options.mode !== "preserve" &&
    options.mode !== "replace"
  )
    throw new RecipeApplyError("PRESET_MODE_UNSUPPORTED");
  const suppliedBase = options.basePreset;
  const base =
    suppliedBase &&
    doc.preset?.id === suppliedBase.id &&
    doc.preset.version === suppliedBase.version &&
    suppliedBase.kind === doc.kind
      ? videoPresetSchema.parse(suppliedBase)
      : undefined;
  const oldSettings = structuredClone(doc.settings);
  doc.settings =
    settings(doc.settings, target.settings, base?.settings, preserve) ?? {};
  const formatSettings: NonNullable<VideoDocument["formatSettings"]> = {};
  for (const format of ["wide", "vertical", "square"] as const) {
    const value = settings(
      doc.formatSettings?.[format],
      target.formatSettings?.[format],
      base?.formatSettings?.[format],
      preserve,
    );
    if (value) formatSettings[format] = value;
  }
  if (Object.keys(formatSettings).length) doc.formatSettings = formatSettings;
  else delete doc.formatSettings;
  function applyScenes(
    items: VideoScene[],
    segmentId?: string,
    segmentSettings?: Settings,
  ) {
    for (const scene of items) {
      const to = matchingScene(scene, target, segmentId),
        from = matchingScene(scene, base, segmentId);
      const oldSceneSettings = structuredClone(scene.settings);
      const value = settings(
        scene.settings,
        to?.settings,
        from?.settings,
        preserve,
      );
      if (value) scene.settings = value;
      else delete scene.settings;
      if (
        to?.transition &&
        (!preserve ||
          !scene.transition ||
          same(scene.transition, from?.transition))
      ) {
        const duration = scene.transition?.duration;
        scene.transition = structuredClone(to.transition);
        if (duration) scene.transition.duration = duration;
      }
      // A recipe's top/picker/board choreography must not be imposed on an
      // authored intro or a different block in a segmented composition.
      const choreography = doc.settings.motion?.choreography;
      const lacksBoardPlacement =
        choreography === "board-place" &&
        !scene.board?.rounds.some((round) =>
          round.actions.some((action) =>
            ["place", "move", "replace"].includes(action.type),
          ),
        );
      if (
        choreography &&
        (scene.block !== target.kind || lacksBoardPlacement)
      ) {
        const previous = mergeSettings(
          oldSettings,
          document.formatSettings?.[document.output.format],
          segmentSettings,
          oldSceneSettings,
        ).motion?.choreography;
        scene.settings ??= {};
        scene.settings.motion ??= {};
        scene.settings.motion.choreography = previous ?? null;
      }
      nodes(scene.nodes, to?.nodes ?? [], from?.nodes ?? [], preserve);
      if (scene.board)
        for (const slot of scene.board.slots) {
          const prior = from?.board?.slots.find(
              (other) => other.id === slot.id,
            ),
            next = to?.board?.slots.find((other) => other.id === slot.id);
          const style = cardStyle(
            slot.style,
            next?.style,
            prior?.style,
            preserve,
          );
          if (style) slot.style = style;
          else delete slot.style;
          const type = typography(
            slot.typography,
            next?.typography,
            prior?.typography,
            preserve,
          );
          if (type !== undefined) slot.typography = type;
          else delete slot.typography;
        }
    }
  }
  applyScenes(doc.scenes);
  for (const segment of doc.segments ?? []) {
    const old = structuredClone(segment.settings),
      value = settings(segment.settings, undefined, undefined, preserve);
    if (value) segment.settings = value;
    else delete segment.settings;
    applyScenes(segment.scenes, segment.id, old);
  }
  for (const participant of doc.source.participants) {
    const value = settings(
      participant.settings,
      undefined,
      undefined,
      preserve,
    );
    if (value) participant.settings = value;
    else delete participant.settings;
  }
  for (const round of doc.source.rounds) {
    const value = settings(round.settings, undefined, undefined, preserve);
    if (value) round.settings = value;
    else delete round.settings;
    for (const item of [...round.cards, ...(round.groups ?? [])]) {
      const value = settings(item.settings, undefined, undefined, preserve);
      if (value) item.settings = value;
      else delete item.settings;
    }
  }
  doc.output = { format: target.output.format, fps: doc.output.fps };
  doc.preset = { id: target.id, version: target.version };
  return parseVideoDocument(doc);
}
