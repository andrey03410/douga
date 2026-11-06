import type {
  Settings,
  VideoDocument,
  VideoFormat,
  VideoNode,
  VideoPreset,
  VideoScene,
} from "./types";
import { parseVideoDocument, videoPresetSchema } from "./schema";
import { getBoardPresets, extractBoardDesign } from "./board-presets";
import { resolveBoard } from "./board-state";
import { mergeSettings } from "./settings";
const families = {
  top: ["classic", "minimal", "cinematic"],
  picker: [
    "classic",
    "portrait",
    "memory",
    "arc",
    "two-groups",
    "three-groups",
    "separate-answer",
  ],
} as const;
export function getBuiltinPresets(): VideoPreset[] {
  const presets: VideoPreset[] = [];
  for (const kind of ["top", "picker"] as const)
    for (const family of families[kind])
      for (const format of ["wide", "vertical", "square"] as const) {
        const settings: Settings = {
          background: family === "cinematic" ? "#08090d" : "#101522",
          card: {
            borderRadius: family === "minimal" ? 0 : 18,
            orientation: family === "portrait" ? "portrait" : "landscape",
          },
          layout: { type: family === "arc" ? "arc" : "grid" },
        };
        if (kind === "top")
          settings.top = {
            order: "descending",
            durationSec: family === "cinematic" ? 8 : 5,
          };
        else
          settings.picker = {
            hideAfterReveal: family === "memory",
            answerMode: family === "separate-answer" ? "separate" : "inline",
            revealSec: 2,
            timerSec: 5,
          };
        presets.push({
          schemaVersion: 1,
          id: `${kind}.${family}.${format}`,
          version: 1,
          name: `${kind} ${family} (${format})`,
          kind,
          output: { format, fps: 30 },
          settings,
          scenes: [
            {
              id: "main",
              block: kind,
              repeat: kind === "top" ? "participants" : "rounds",
              nodes: [],
              ...(family === "cinematic"
                ? {
                    transition: {
                      type: "fade" as const,
                      duration: { sec: 0.6 },
                    },
                  }
                : {}),
            },
          ],
          skeleton: {
            roundCount: kind === "picker" ? 30 : 0,
            cardsPerRound: 4,
            groupCount:
              family === "two-groups" ? 2 : family === "three-groups" ? 3 : 0,
          },
        });
      }
  return [...presets, ...getBoardPresets()];
}
export function getBuiltinPreset(id: string): VideoPreset | undefined {
  const canonical = id.startsWith("board.") && id.split(".").length === 2 ? `${id}.wide` : id;
  return getBuiltinPresets().find((p) => p.id === canonical);
}
export class PresetIncompatibleError extends Error {
  constructor(public path: string) {
    super(
      `PRESET_INCOMPATIBLE: Cannot transfer assigned content at ${path}. Retain its scene/node structure and context, or explicitly remove/reassign that content before applying this preset.`,
    );
    this.name = "PresetIncompatibleError";
  }
}

/** Correspondence is structural, never a search for a nearby same-kind asset.
 * IDs may be unchanged or the exact canonical IDs produced by extraction.
 * Keep project keys on matched nodes, so a slot alias cannot overwrite media
 * used by a participant or another scene in the destination document.
 */
function transferCustomContent(doc: VideoDocument, preset: VideoPreset): void {
  let index = 0;
  let boardSlotIndex = 0;
  const slots = new Map<string, string>();
  const assigned = (nodes: VideoNode[]): boolean =>
    nodes.some((n) =>
      n.type === "container"
        ? assigned(n.children)
        : (n.type === "image" || n.type === "video" || n.type === "audio") &&
          Boolean(doc.bindings[n.asset]),
    );
  const match = (nodes: VideoNode[], targets: VideoNode[]): boolean => {
    let compatible = nodes.length === targets.length;
    nodes.forEach((node, i) => {
      const canonicalId = `node-${++index}`;
      const target = targets[i];
      if (
        !target ||
        target.type !== node.type ||
        (target.id !== node.id && target.id !== canonicalId)
      )
        compatible = false;
      if (node.type === "container") {
        if (
          !match(
            node.children,
            target?.type === "container" ? target.children : [],
          )
        )
          compatible = false;
      }
    });
    return compatible;
  };
  const transfer = (nodes: VideoNode[], targets: VideoNode[], path: string) => {
    nodes.forEach((node, i) => {
      const target = targets[i];
      const at = `${path}.${i}`;
      if (node.type === "container" && target.type === "container")
        transfer(node.children, target.children, `${at}.children`);
      if (node.type === "text" && target.type === "text")
        target.text = structuredClone(node.text);
      if (node.type === "card" && target.type === "card") {
        target.participantId = node.participantId;
        target.label =
          node.label === undefined ? undefined : structuredClone(node.label);
      }
      if (
        (node.type === "image" ||
          node.type === "video" ||
          node.type === "audio") &&
        (target.type === "image" ||
          target.type === "video" ||
          target.type === "audio")
      ) {
        const binding = doc.bindings[node.asset];
        if (!binding) return;
        // Sharing one abstract slot explicitly declares one assignment. Refuse
        // conflicting destination content instead of picking the first item.
        const identity = JSON.stringify(binding);
        if (slots.has(target.asset) && slots.get(target.asset) !== identity)
          throw new PresetIncompatibleError(`${at}.asset`);
        slots.set(target.asset, identity);
        target.asset = node.asset;
      }
    });
  };
  doc.scenes.forEach((scene, i) => {
    const target = preset.scenes[i];
    if (scene.board) {
      if (!target?.board || scene.board.slots.length !== target.board.slots.length)
        throw new PresetIncompatibleError(`scenes.${i}.board.slots`);
      const remap = new Map<string, string>();
      scene.board.slots.forEach((slot, j) => {
        const to = target.board!.slots[j];
        const canonicalSlotId = `board-slot-${++boardSlotIndex}`;
        if (to.id !== slot.id && to.id !== canonicalSlotId && !slot.id.endsWith(`:${to.id}`))
          throw new PresetIncompatibleError(`scenes.${i}.board.slots.${j}`);
        to.id = slot.id;
        remap.set(slot.id, slot.id);
        for (const field of ["image", "backgroundAsset", "sound"] as const) {
          if (slot[field] && doc.bindings[slot[field]!]) to[field] = slot[field];
        }
      });
      const rounds = structuredClone(scene.board.rounds);
      rounds.forEach((r) => {
        r.clearSlotIds = r.clearSlotIds?.map((id) => remap.get(id)!);
        r.actions.forEach((a) => { if ("slotId" in a) { const id = remap.get(a.slotId); if (!id) throw new PresetIncompatibleError(`scenes.${i}.board.actions`); a.slotId = id; } });
      });
      target.board.rounds = rounds;
      if (resolveBoard(target.board, doc.source.participants).diagnostics.length)
        throw new PresetIncompatibleError(`scenes.${i}.board.rules`);
    }
    const structureMatches = match(scene.nodes, target?.nodes ?? []);
    const extractedRepeat =
      scene.repeat ??
      (scene.participantId || scene.block === "top"
        ? "participants"
        : scene.roundId || scene.block === "picker"
          ? "rounds"
          : undefined);
    const contextMatches =
      target &&
      target.block === scene.block &&
      (target.id === scene.id || target.id === `scene-${i + 1}`) &&
      (target.repeat === scene.repeat || target.repeat === extractedRepeat);
    if (!structureMatches || !contextMatches) {
      if (assigned(scene.nodes))
        throw new PresetIncompatibleError(`scenes.${i}.nodes`);
      return;
    }
    transfer(scene.nodes, target.nodes, `scenes.${i}.nodes`);
    // Extraction makes reusable repetitions; applying design to existing content
    // must retain its concrete participant/round scope.
    target.repeat = scene.repeat;
    target.participantId = scene.participantId;
    target.roundId = scene.roundId;
  });
}
function safeSettings(
  s: Settings | undefined,
  slots: Map<string, string>,
): Settings | undefined {
  if (!s) return;
  const out = structuredClone(s);
  if (out.picker?.tick) {
    const key = out.picker.tick;
    if (!slots.has(key)) slots.set(key, `slot:tick:${slots.size}`);
    out.picker.tick = slots.get(key)!;
  }
  return out;
}
/** Explicit extraction: never serialize source, bindings, literal content or project identifiers. */
export function extractVideoPreset(
  document: VideoDocument,
  metadata: { id: string; name: string; version?: number },
): VideoPreset {
  const doc = parseVideoDocument(document);
  if (doc.schemaVersion === 2) {
    const segment = doc.segments?.find(
      (s) => s.kind === doc.kind && s.enabled !== false,
    );
    if (!segment)
      throw new Error(
        "A reusable preset needs a segment matching the document kind",
      );
    return extractVideoPreset(
      {
        ...doc,
        schemaVersion: 1,
        segments: undefined,
        scenes: segment.scenes,
        settings: mergeSettings(doc.settings, segment.settings),
        audio: segment.audio ?? doc.audio,
      },
      metadata,
    );
  }
  let nodeIndex = 0;
  const soundSlots = new Map<string, string>();
  const node = (n: VideoNode): VideoNode => {
    const { id: _id, ...rest } = n;
    const base = {
      ...structuredClone(rest),
      id: `node-${++nodeIndex}`,
    } as VideoNode;
    if (base.type === "container") base.children = base.children.map(node);
    if (base.type === "text")
      base.text =
        typeof base.text === "string" ? "Text" : { bind: base.text.bind };
    if (base.type === "card") {
      base.participantId = "$participant";
      if (base.label) base.label = { bind: "participant.label" };
    }
    if (
      (base.type === "audio" ||
        base.type === "image" ||
        base.type === "video") &&
      !base.asset.startsWith("$")
    )
      base.asset = `slot:${base.type}:${nodeIndex}`;
    return base;
  };
  const boardIndexes = { slot: 0, media: 0 };
  const scenes: VideoScene[] = doc.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    block: s.block,
    ...(s.board ? { board: extractBoardDesign(s.board, boardIndexes) } : {}),
    ...(s.repeat
      ? { repeat: s.repeat }
      : s.participantId || s.block === "top"
        ? { repeat: "participants" as const }
        : s.roundId || s.block === "picker"
          ? { repeat: "rounds" as const }
          : {}),
    ...(s.duration ? { duration: s.duration } : {}),
    ...(s.transition ? { transition: s.transition } : {}),
    ...(s.settings ? { settings: safeSettings(s.settings, soundSlots) } : {}),
    nodes: s.nodes.map(node),
  }));
  const first = doc.source.rounds[0];
  const boards = doc.scenes.flatMap((s, i) => s.board ? [{ sceneId: `scene-${i + 1}`, roundCount: Math.max(1, s.board.rounds.length), cardsPerRound: Math.max(1, ...s.board.rounds.map((r) => r.cards.length)) }] : []);
  const playlist = doc.audio?.playlist;
  const formatSettings = doc.formatSettings
    ? Object.fromEntries(
        Object.entries(doc.formatSettings).map(([k, v]) => [
          k,
          safeSettings(v, soundSlots),
        ]),
      )
    : undefined;
  return videoPresetSchema.parse({
    schemaVersion: 1,
    ...metadata,
    version: metadata.version ?? 1,
    kind: doc.kind,
    output: doc.output,
    settings: safeSettings(doc.settings, soundSlots),
    ...(formatSettings ? { formatSettings } : {}),
    scenes,
    skeleton: {
      roundCount: doc.kind === "board" ? boards[0]?.roundCount ?? 1 : doc.source.rounds.length,
      cardsPerRound: doc.kind === "board" ? boards[0]?.cardsPerRound ?? 1 : Math.max(1, first?.cards.length ?? 4),
      groupCount: first?.groups?.length ?? 0,
      ...(boards.length ? { boards } : {}),
    },
    ...(playlist || doc.audio?.cues?.length
      ? {
          audio: {
            crossfadeSec: playlist?.crossfadeSec,
            loop: playlist?.loop,
            volume: playlist?.volume,
            duckVolume: playlist?.duckVolume,
            cues: doc.audio?.cues?.map((cue, i) => ({
              ...cue,
              id: `cue-${i + 1}`,
              asset: `slot:sound:${i + 1}`,
              anchor: cue.anchor
                ? {
                    event: cue.anchor.event,
                    ...(cue.anchor.sceneId
                      ? {
                          sceneId: `scene-${doc.scenes.findIndex((s) => s.id === cue.anchor!.sceneId) + 1}`,
                        }
                      : {}),
                  }
                : undefined,
            })),
          },
        }
      : {}),
  });
}
/** Each v2 application owns its abstract slots. A project's existing slot-shaped
 * keys may still be referenced by custom content, so never reuse or overwrite them. */
function namespacePresetSlots(
  preset: VideoPreset,
  used: Set<string>,
  scope: "document" | "segment",
): VideoPreset {
  const result = structuredClone(preset);
  const slots = new Map<string, string>();
  let index = 0;
  const allocate = (): string => {
    let next: string;
    do next = `slot:${scope}:${index++}`;
    while (used.has(next));
    used.add(next);
    return next;
  };
  const key = (value: string): string => {
    if (!value.startsWith("slot:")) return value;
    if (!slots.has(value)) slots.set(value, allocate());
    return slots.get(value)!;
  };
  const settings = (value: Settings | undefined) => {
    // A scene's authored override is independent of the document/format default,
    // even when extraction used the same abstract slot for their old sound.
    if (value?.picker?.tick?.startsWith("slot:"))
      value.picker.tick = allocate();
  };
  const nodes = (items: VideoNode[]) => {
    for (const node of items) {
      if (node.type === "container") nodes(node.children);
      if (
        node.type === "image" ||
        node.type === "video" ||
        node.type === "audio"
      )
        node.asset = key(node.asset);
    }
  };
  settings(result.settings);
  Object.values(result.formatSettings ?? {}).forEach(settings);
  result.scenes.forEach((scene) => {
    settings(scene.settings);
    scene.board?.slots.forEach((slot) => { for (const field of ["image", "backgroundAsset", "sound"] as const) if (slot[field]) slot[field] = key(slot[field]!); });
    nodes(scene.nodes);
  });
  result.audio?.cues?.forEach((cue) => {
    cue.asset = key(cue.asset);
  });
  return result;
}

export function applyVideoPreset(
  document: VideoDocument,
  preset: VideoPreset,
): VideoDocument {
  const doc = parseVideoDocument(document);
  const p = videoPresetSchema.parse(preset);
  if (doc.schemaVersion === 2) {
    const slots = new Set(Object.keys(doc.bindings));
    // Common defaults bind independently of any one segment's authored media.
    const common = applyVideoPreset(
      {
        ...doc,
        schemaVersion: 1,
        segments: undefined,
        kind: p.kind,
        scenes: [],
      },
      namespacePresetSlots(p, slots, "document"),
    );
    const bindings = structuredClone(common.bindings);
    const segments = doc.segments?.map((segment) => {
      if (segment.kind === "custom" || segment.kind !== p.kind) return segment;
      const local = applyVideoPreset(
        {
          ...doc,
          schemaVersion: 1,
          segments: undefined,
          kind: segment.kind,
          bindings: doc.bindings,
          settings: mergeSettings(doc.settings, segment.settings),
          scenes: segment.scenes,
          audio: segment.audio,
        },
        namespacePresetSlots(p, slots, "segment"),
      );
      Object.assign(bindings, local.bindings);
      const prefix = `segment:${segment.id}:`;
      const renameNode = (node: VideoNode): VideoNode =>
        node.type === "container"
          ? {
              ...node,
              id: `${prefix}${node.id}`,
              children: node.children.map(renameNode),
            }
          : { ...node, id: `${prefix}${node.id}` };
      const scenes = local.scenes.map((scene) => ({
        ...scene,
        id: `${prefix}${scene.id}`,
        nodes: scene.nodes.map(renameNode),

      }));
      const audio = structuredClone(segment.audio ?? local.audio);
      for (const cue of audio?.cues ?? []) {
        if (!cue.anchor?.sceneId) continue;
        const index = segment.scenes.findIndex(
          (scene) => scene.id === cue.anchor!.sceneId,
        );
        const presetIndex = local.scenes.findIndex(
          (scene) => scene.id === cue.anchor!.sceneId,
        );
        const target = scenes[index >= 0 ? index : presetIndex];
        if (target) cue.anchor.sceneId = target.id;
      }
      return { ...segment, scenes, ...(audio ? { audio } : {}) };
    });
    return parseVideoDocument({
      ...doc,
      bindings,
      segments,
      output: p.output,
      settings: common.settings,
      formatSettings: common.formatSettings,
      preset: { id: p.id, version: p.version },
    });
  }
  if (doc.kind !== p.kind)
    throw new Error("Preset kind must match document kind");
  transferCustomContent(doc, p);
  // Slot assignments belong to the destination project, never to the preset.
  const bindings = structuredClone(doc.bindings);
  const bind = (slot: string | undefined, current: string | undefined) => {
    if (slot && current && !bindings[slot] && doc.bindings[current])
      bindings[slot] = structuredClone(doc.bindings[current]);
  };
  bind(p.settings.picker?.tick, doc.settings.picker?.tick);
  for (const format of ["wide", "vertical", "square"] as const)
    bind(
      p.formatSettings?.[format]?.picker?.tick,
      doc.formatSettings?.[format]?.picker?.tick,
    );
  p.scenes.forEach((scene, i) =>
    bind(scene.settings?.picker?.tick, doc.scenes[i]?.settings?.picker?.tick),
  );
  p.audio?.cues?.forEach((cue, i) =>
    bind(cue.asset, doc.audio?.cues?.[i]?.asset),
  );
  return parseVideoDocument({
    ...doc,
    bindings,
    output: p.output,
    settings: p.settings,
    formatSettings: p.formatSettings,
    scenes: p.scenes,
    preset: { id: p.id, version: p.version },
    ...(p.audio
      ? {
          audio: {
            ...doc.audio,
            ...(p.audio.cues ? { cues: p.audio.cues } : {}),
            ...(doc.audio?.playlist ||
            Object.keys(p.audio).some((key) => key !== "cues")
              ? {
                  playlist: {
                    tracks: [],
                    ...doc.audio?.playlist,
                    ...Object.fromEntries(
                      Object.entries(p.audio).filter(([key]) => key !== "cues"),
                    ),
                  },
                }
              : {}),
          },
        }
      : {}),
  });
}
