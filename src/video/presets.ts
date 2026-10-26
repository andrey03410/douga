import type {
  Settings,
  VideoDocument,
  VideoFormat,
  VideoNode,
  VideoPreset,
  VideoScene,
} from "./types";
import { parseVideoDocument, videoPresetSchema } from "./schema";
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
  return presets;
}
export function getBuiltinPreset(id: string): VideoPreset | undefined {
  return getBuiltinPresets().find((p) => p.id === id);
}
function safeSettings(s: Settings | undefined): Settings | undefined {
  if (!s) return;
  const out = structuredClone(s);
  if (out.picker) delete out.picker.tick;
  return out;
}
/** Explicit extraction: never serialize source, bindings, literal content or project identifiers. */
export function extractVideoPreset(
  document: VideoDocument,
  metadata: { id: string; name: string; version?: number },
): VideoPreset {
  const doc = parseVideoDocument(document);
  let nodeIndex = 0;
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
    if (base.type === "audio" || base.type === "image" || base.type === "video")
      base.asset = `slot:${base.type}:${nodeIndex}`;
    if (base.type === "shape" && base.shape === "path") delete base.path;
    return base;
  };
  const scenes: VideoScene[] = doc.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    block: s.block,
    ...(s.repeat
      ? { repeat: s.repeat }
      : s.participantId || s.block === "top"
        ? { repeat: "participants" as const }
        : s.roundId || s.block === "picker"
          ? { repeat: "rounds" as const }
          : {}),
    ...(s.duration ? { duration: s.duration } : {}),
    ...(s.transition ? { transition: s.transition } : {}),
    ...(s.settings ? { settings: safeSettings(s.settings) } : {}),
    nodes: s.nodes.map(node),
  }));
  const first = doc.source.rounds[0];
  const playlist = doc.audio?.playlist;
  const formatSettings = doc.formatSettings
    ? Object.fromEntries(
        Object.entries(doc.formatSettings).map(([k, v]) => [
          k,
          safeSettings(v),
        ]),
      )
    : undefined;
  return videoPresetSchema.parse({
    schemaVersion: 1,
    ...metadata,
    version: metadata.version ?? 1,
    kind: doc.kind,
    output: doc.output,
    settings: safeSettings(doc.settings),
    ...(formatSettings ? { formatSettings } : {}),
    scenes,
    skeleton: {
      roundCount: doc.source.rounds.length,
      cardsPerRound: Math.max(1, first?.cards.length ?? 4),
      groupCount: first?.groups?.length ?? 0,
    },
    ...(playlist
      ? {
          audio: {
            crossfadeSec: playlist.crossfadeSec,
            loop: playlist.loop,
            volume: playlist.volume,
            duckVolume: playlist.duckVolume,
          },
        }
      : {}),
  });
}
export function applyVideoPreset(
  document: VideoDocument,
  preset: VideoPreset,
): VideoDocument {
  const doc = parseVideoDocument(document);
  const p = videoPresetSchema.parse(preset);
  if (doc.kind !== p.kind)
    throw new Error("Preset kind must match document kind");
  return parseVideoDocument({
    ...doc,
    output: p.output,
    settings: p.settings,
    formatSettings: p.formatSettings,
    scenes: p.scenes,
    preset: { id: p.id, version: p.version },
    ...(p.audio && doc.audio?.playlist
      ? {
          audio: {
            ...doc.audio,
            playlist: { ...doc.audio.playlist, ...p.audio },
          },
        }
      : {}),
  });
}
