import { preflightVideoResources } from "./resource-limits";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { VideoDocument, VideoNode, VideoPreset } from "./types";
const n = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER / 120)
  .max(Number.MAX_SAFE_INTEGER / 120);
const positive = n.positive();
const nonnegative = n.nonnegative();
const id = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) => !["__proto__", "prototype", "constructor"].includes(v),
    "Reserved identifier",
  );
const str = z.string();
const color = z
  .string()
  .regex(
    /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% +\/-]+\)|transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|navy|teal|cyan|magenta|currentColor)$/,
    "Use a CSS color, never a URL or arbitrary CSS",
  );
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional();
const gradientStops = z
  .array(z.object({ color, at: n.min(0).max(1) }).strict())
  .min(2)
  .max(12)
  .refine(
    (stops) => stops.every((stop, i) => i === 0 || stop.at >= stops[i - 1].at),
    "Gradient stops must be ordered by position",
  );
export const backgroundGradientSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("linear"),
      angle: opt(n.min(-360).max(360)),
      stops: gradientStops,
    })
    .strict(),
  z
    .object({
      type: z.literal("radial"),
      center: opt(
        z.object({ x: n.min(0).max(1), y: n.min(0).max(1) }).strict(),
      ),
      stops: gradientStops,
    })
    .strict(),
]);
export const shadowStyleSchema = z
  .object({
    color,
    x: opt(n.min(-500).max(500)),
    y: opt(n.min(-500).max(500)),
    blur: opt(n.min(0).max(200)),
    spread: opt(n.min(-200).max(200)),
  })
  .strict();
export const timeSchema = z.union([
  z.object({ sec: nonnegative }).strict(),
  z.object({ frame: nonnegative.int() }).strict(),
]);
export const rectSchema = z
  .object({ x: n, y: n, width: positive, height: positive })
  .strict();
const crop = rectSchema.refine(
  (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 && r.y + r.height <= 1,
  "Crop must be contained in normalized media bounds",
);
export const cardStyleSchema = z
  .object({
    fit: opt(z.enum(["cover", "contain", "fill"])),
    crop: opt(crop),
    offsetSec: opt(nonnegative),
    loop: opt(z.boolean()),
    playSound: opt(z.boolean()),
    volume: opt(nonnegative.max(4)),
    borderRadius: opt(nonnegative),
    background: opt(color),
    gradient: opt(backgroundGradientSchema.nullable()),
    shadow: opt(shadowStyleSchema.nullable()),
    color: opt(color),
    borderColor: opt(color),
    borderWidth: opt(nonnegative),
    fontSize: opt(positive),
    orientation: opt(z.enum(["landscape", "portrait"])),
  })
  .strict();
export const layoutSchema = z
  .object({
    type: z.enum(["grid", "arc", "free"]),
    gap: opt(nonnegative),
    padding: opt(nonnegative),
    columns: opt(positive.int()),
    positions: opt(z.array(rectSchema)),
  })
  .strict();
export const settingsSchema = z
  .object({
    background: opt(color),
    card: opt(cardStyleSchema),
    labels: opt(
      z
        .object({
          mode: opt(z.enum(["always", "finale", "never", "active", "answer"])),
          showRank: opt(z.boolean()),
          delaySec: opt(nonnegative),
          holdSec: opt(nonnegative),
        })
        .strict(),
    ),
    layout: opt(layoutSchema),
    top: opt(
      z
        .object({
          order: opt(z.enum(["source", "ascending", "descending"])),
          durationSec: opt(positive),
          snippet: opt(
            z
              .object({
                mode: z.enum(["manual", "full", "active"]),
                startSec: opt(nonnegative),
                durationSec: opt(positive),
                activeStartSec: opt(nonnegative),
                activeEndSec: opt(positive),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    picker: opt(
      z
        .object({
          leadSec: opt(nonnegative),
          revealSec: opt(positive),
          timerSec: opt(nonnegative),
          answerSec: opt(positive),
          hideAfterReveal: opt(z.boolean()),
          answerMode: opt(z.enum(["inline", "separate"])),
          staggerSec: opt(nonnegative),
          tick: opt(id),
          timerRect: opt(rectSchema),
          showPrompt: opt(z.boolean()),
        })
        .strict(),
    ),
  })
  .strict();
export const participantSchema = z
  .object({
    id,
    label: str,
    caption: opt(str),
    rank: opt(positive.int()),
    media: opt(z.object({ visual: opt(id), audio: opt(id) }).strict()),
    settings: opt(settingsSchema),
  })
  .strict();
const card = z
  .object({
    id,
    participantId: id,
    label: opt(str),
    settings: opt(settingsSchema),
  })
  .strict();
const group = z
  .object({
    id,
    label: opt(str),
    cardIds: z.array(id),
    settings: opt(settingsSchema),
  })
  .strict();
export const roundSchema = z
  .object({
    id,
    prompt: opt(str),
    cards: z.array(card),
    groups: opt(z.array(group)),
    answer: opt(
      z
        .object({ cardIds: opt(z.array(id)), groupIds: opt(z.array(id)) })
        .strict(),
    ),
    settings: opt(settingsSchema),
    music: opt(id.nullable()),
    background: opt(id),
  })
  .strict();
const text = z.union([
  str,
  z
    .object({
      bind: z.enum([
        "document.title",
        "participant.label",
        "participant.rank",
        "round.prompt",
        "group.label",
      ]),
      groupId: opt(id),
      prefix: opt(str),
      suffix: opt(str),
    })
    .strict(),
]);
const animation = z
  .object({
    property: z.enum(["opacity", "x", "y", "scale", "rotate"]),
    easing: opt(z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"])),
    keyframes: z.array(z.object({ at: timeSchema, value: n }).strict()).min(1),
  })
  .strict();
const base = {
  id,
  rect: opt(rectSchema),
  units: opt(z.enum(["relative", "px"])),
  anchor: opt(z.enum(["topLeft", "center", "bottomRight"])),
  layer: opt(n.int()),
  timing: opt(
    z.object({ at: opt(timeSchema), duration: opt(timeSchema) }).strict(),
  ),
  style: opt(cardStyleSchema),
  animation: opt(z.array(animation)),
  opacity: opt(nonnegative.max(1)),
  rotate: opt(n),
  scale: opt(positive),
};
export const videoNodeSchema: z.ZodType<VideoNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        ...base,
        type: z.literal("container"),
        children: z.array(videoNodeSchema),
        flow: opt(z.enum(["parallel", "sequence"])),
        layout: opt(layoutSchema),
      })
      .strict(),
    z.object({ ...base, type: z.literal("text"), text }).strict(),
    z
      .object({
        ...base,
        type: z.literal("shape"),
        shape: z.enum(["rect", "ellipse", "path"]),
        path: opt(str),
        fill: opt(color),
        stroke: opt(color),
        strokeWidth: opt(nonnegative),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("image"),
        asset: id,
        required: opt(
          z
            .boolean()
            .describe(
              "Defaults to true, including preset slots. Set false to permit an unfilled visual placeholder.",
            ),
        ),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("video"),
        asset: id,
        required: opt(
          z
            .boolean()
            .describe(
              "Defaults to true, including preset slots. Set false to permit an unfilled visual placeholder.",
            ),
        ),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("card"),
        participantId: id,
        label: opt(text),
      })
      .strict(),
    z
      .object({ ...base, type: z.literal("timer"), duration: opt(timeSchema) })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("audio"),
        asset: id,
        role: z.enum(["primary", "music", "sfx", "voice"]),
        volume: opt(nonnegative.max(4)),
        offsetSec: opt(nonnegative),
        loop: opt(z.boolean()),
        fadeInSec: opt(nonnegative),
        fadeOutSec: opt(nonnegative),
      })
      .strict(),
  ]),
);
export const sceneSchema = z
  .object({
    id,
    block: z.enum(["custom", "top", "picker"]),
    repeat: opt(z.enum(["participants", "rounds"])),
    participantId: opt(id),
    roundId: opt(id),
    duration: opt(timeSchema),
    settings: opt(settingsSchema),
    nodes: z.array(videoNodeSchema),
    transition: opt(
      z
        .object({
          type: z.enum(["none", "fade", "slide"]),
          duration: timeSchema,
        })
        .strict(),
    ),
    background: opt(id),
  })
  .strict();
export const assetBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pool"), assetId: id, hash: opt(str) }).strict(),
  z
    .object({
      kind: z.literal("track"),
      tournamentId: id,
      trackId: id,
      hash: opt(str),
    })
    .strict(),
  z
    .object({
      kind: z.literal("builtin"),
      name: z.enum(["tick", "reveal", "answer"]),
    })
    .strict(),
]);
export const resolvedAssetSchema = z
  .object({
    id,
    kind: z.enum(["image", "video", "audio"]),
    src: str.min(1),
    durationSec: opt(positive),
    hasAudio: opt(z.boolean()),
    posterSrc: opt(str),
    width: opt(positive),
    height: opt(positive),
    hash: opt(str),
  })
  .strict();
export const assetManifestSchema = z.record(id, resolvedAssetSchema);
export const audioCueSchema = z
  .object({
    id,
    role: z.enum(["primary", "music", "sfx", "voice"]),
    asset: id,
    at: timeSchema,
    anchor: opt(
      z
        .object({
          event: z.enum([
            "scene.start",
            "card.reveal",
            "timer.start",
            "answer.start",
            "transition.start",
          ]),
          sceneId: opt(id),
          participantId: opt(id),
          roundId: opt(id),
          cardId: opt(id),
        })
        .strict(),
    ),
    duration: opt(timeSchema),
    offsetSec: opt(nonnegative),
    volume: opt(nonnegative.max(4)),
    loop: opt(z.boolean()),
    fadeInSec: opt(nonnegative),
    fadeOutSec: opt(nonnegative),
  })
  .strict();
const playlistOptions = {
  crossfadeSec: opt(nonnegative),
  loop: opt(z.boolean()),
  volume: opt(nonnegative.max(4)),
  duckVolume: opt(nonnegative.max(1)),
};
const output = z
  .object({
    format: z.enum(["wide", "vertical", "square"]),
    fps: z.union([
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(50),
      z.literal(60),
    ]),
  })
  .strict();
const formatSettings = z
  .object({
    wide: opt(settingsSchema),
    vertical: opt(settingsSchema),
    square: opt(settingsSchema),
  })
  .strict();
const documentObject = z
  .object({
    schemaVersion: z.literal(1),
    id,
    title: str,
    kind: z.enum(["top", "picker"]),
    seed: nonnegative.int(),
    output,
    source: z
      .object({
        kind: z.enum(["manual", "tournament"]),
        tournamentId: opt(id),
        version: opt(str),
        participants: z.array(participantSchema),
        rounds: z.array(roundSchema),
      })
      .strict(),
    bindings: z.record(id, assetBindingSchema),
    settings: settingsSchema,
    formatSettings: opt(formatSettings),
    scenes: z.array(sceneSchema),
    audio: opt(
      z
        .object({
          playlist: opt(
            z.object({ tracks: z.array(id), ...playlistOptions }).strict(),
          ),
          cues: opt(z.array(audioCueSchema)),
        })
        .strict(),
    ),
    preset: opt(z.object({ id, version: positive.int() }).strict()),
  })
  .strict();
export const videoDocumentSchema: z.ZodType<VideoDocument> = z
  .custom<VideoDocument>(
    (input) => preflightVideoResources(input).length === 0,
    { message: "RESOURCE_BUDGET_EXCEEDED" },
  )
  .pipe(
    documentObject.superRefine((d, ctx) => {
      const unique = (ids: string[], path: (string | number)[]) => {
        const seen = new Set<string>();
        ids.forEach((value, i) => {
          if (seen.has(value))
            ctx.addIssue({
              code: "custom",
              message: `Duplicate stable ID: ${value}`,
              path: [...path, i, "id"],
            });
          seen.add(value);
        });
      };
      unique(
        d.source.participants.map((p) => p.id),
        ["source", "participants"],
      );
      unique(
        d.source.rounds.map((r) => r.id),
        ["source", "rounds"],
      );
      unique(
        d.scenes.map((s) => s.id),
        ["scenes"],
      );
      unique(
        d.source.rounds.flatMap((r) => r.cards.map((c) => c.id)),
        ["source", "rounds"],
      );
      unique(
        d.source.rounds.flatMap((r) => (r.groups ?? []).map((g) => g.id)),
        ["source", "rounds"],
      );
      const ids: string[] = [];
      const walk = (nodes: VideoNode[]) =>
        nodes.forEach((node) => {
          ids.push(node.id);
          if (node.type === "container") walk(node.children);
        });
      d.scenes.forEach((s) => walk(s.nodes));
      unique(ids, ["scenes"]);
      if (d.source.kind === "tournament" && !d.source.tournamentId)
        ctx.addIssue({
          code: "custom",
          message: "Tournament source requires tournamentId",
          path: ["source", "tournamentId"],
        });
      d.scenes.forEach((s, i) => {
        if (s.repeat && (s.participantId || s.roundId)) {
          ctx.addIssue({
            code: "custom",
            message:
              "Scene repetition and explicit participant/round references are mutually exclusive",
            path: ["scenes", i, "repeat"],
          });
        }
        if (
          s.duration &&
          ("frame" in s.duration ? s.duration.frame : s.duration.sec) <= 0
        )
          ctx.addIssue({
            code: "custom",
            message: "Scene duration must be positive",
            path: ["scenes", i, "duration"],
          });
        if (
          (s.repeat === "participants" && s.block === "picker") ||
          (s.repeat === "rounds" && s.block === "top")
        )
          ctx.addIssue({
            code: "custom",
            message: "Repeat collection does not match block",
            path: ["scenes", i, "repeat"],
          });
      });
    }),
  );
export const videoPresetSchema: z.ZodType<VideoPreset> = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version: positive.int(),
    name: str,
    kind: z.enum(["top", "picker"]),
    output,
    settings: settingsSchema,
    formatSettings: opt(formatSettings),
    scenes: z.array(sceneSchema),
    skeleton: z
      .object({
        roundCount: nonnegative.int(),
        cardsPerRound: positive.int(),
        groupCount: nonnegative.int(),
      })
      .strict(),
    audio: opt(
      z
        .object({ ...playlistOptions, cues: opt(z.array(audioCueSchema)) })
        .strict(),
    ),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[]) =>
      ctx.addIssue({
        code: "custom",
        message:
          "Presets may contain only generic slots, never participant identities or actual media bindings.",
        path,
      });
    const settings = (s: unknown, path: (string | number)[]) => {
      if (
        (s as { picker?: { tick?: string } } | undefined)?.picker?.tick &&
        !/^slot:[a-z]+:[0-9]+$/.test(
          (s as { picker?: { tick?: string } }).picker!.tick!,
        )
      )
        issue([...path, "picker", "tick"]);
    };
    const walk = (nodes: VideoNode[], path: (string | number)[]) =>
      nodes.forEach((n, i) => {
        const at = [...path, i];
        if (n.type === "container") walk(n.children, [...at, "children"]);
        if (
          (n.type === "video" || n.type === "image" || n.type === "audio") &&
          !/^slot:[a-z]+:[0-9]+$/.test(n.asset)
        )
          issue([...at, "asset"]);
        if (n.type === "card" && n.participantId !== "$participant")
          issue([...at, "participantId"]);
        const textValue =
          n.type === "text" ? n.text : n.type === "card" ? n.label : undefined;
        if (typeof textValue === "object" && textValue.groupId)
          issue([...at, n.type === "text" ? "text" : "label", "groupId"]);
      });
    p.audio?.cues?.forEach((cue, i) => {
      if (
        !/^slot:[a-z]+:[0-9]+$/.test(cue.asset) ||
        cue.anchor?.participantId ||
        cue.anchor?.roundId ||
        cue.anchor?.cardId
      )
        issue(["audio", "cues", i]);
    });
    settings(p.settings, ["settings"]);
    Object.entries(p.formatSettings ?? {}).forEach(([k, v]) =>
      settings(v, ["formatSettings", k]),
    );
    p.scenes.forEach((s, i) => {
      if (s.participantId || s.roundId || s.background) issue(["scenes", i]);
      settings(s.settings, ["scenes", i, "settings"]);
      walk(s.nodes, ["scenes", i, "nodes"]);
    });
  });
export function parseVideoDocument(input: unknown): VideoDocument {
  return videoDocumentSchema.parse(input);
}

/** Runtime refinements (identity, crop bounds, cross references) are documented separately. */
export function getVideoDocumentJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(documentObject, {
    definitions: { VideoNode: videoNodeSchema },
    $refStrategy: "root",
  });
}

const patchTargetSchema = z.union([
  z.object({ type: z.literal("document") }).strict(),
  z
    .object({
      type: z.enum(["participant", "round", "card", "group", "scene", "node"]),
      id: z.string().min(1),
    })
    .strict(),
]);
/** Stable-ID patches; protected path semantics are checked by patchVideoDocument. */
export const videoPatchOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set"),
      target: patchTargetSchema,
      path: z.array(z.string().min(1)).min(1),
      value: z
        .unknown()
        .refine((v) => v !== undefined, "Set requires a JSON value"),
    })
    .strict(),
  z
    .object({
      op: z.literal("unset"),
      target: patchTargetSchema,
      path: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);
