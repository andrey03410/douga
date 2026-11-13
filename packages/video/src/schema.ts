import {
  textTypographySchema,
  typographySettingsSchema,
  boundedTextSchema,
  typographyColorSchema,
  graphemes,
} from "./typography-schema";
import {
  motionSettingsSchema,
  backdropSettingsSchema,
  timerSettingsSchema,
  versusSettingsSchema,
  badgeSettingsSchema,
  progressSettingsSchema,
  transitionSchema,
} from "./motion-schema";
import { preflightVideoResources } from "./resource-limits";
import { interactiveLayerSchema } from "./interactive-schema";
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
    blur: opt(nonnegative.max(200)),
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
    typography: opt(typographySettingsSchema.nullable()),
    background: opt(color),
    motion: opt(motionSettingsSchema),
    backdrop: opt(backdropSettingsSchema.nullable()),
    timer: opt(timerSettingsSchema),
    versus: opt(versusSettingsSchema),
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
    comment: opt(str),
    album: opt(str),
    score: opt(n),
    bestMomentSec: opt(nonnegative),
    rank: opt(positive.int()),
    subtitle: opt(str),
    tier: opt(str),
    link: opt(str),
    kind: opt(z.enum(["audio", "video", "image"])),
    votes: opt(n.min(0)),
    pickedBy: opt(z.array(z.string().max(120)).max(16)),
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
const plainText = z.union([
  boundedTextSchema,
  z
    .object({
      bind: z.enum([
        "document.title",
        "participant.label",
        "participant.displayLabel",
        "participant.rank",
        "participant.comment",
        "participant.album",
        "participant.score",
        "participant.subtitle",
        "participant.tier",
        "segment.title",
        "segment.subtitle",
        "segment.number",
        "segment.count",
        "round.prompt",
        "group.label",
        "participant.votes",
        "participant.pickedBy",
        "match.text",
      ]),
      groupId: opt(id),
      key: opt(id),
      prefix: opt(boundedTextSchema),
      suffix: opt(boundedTextSchema),
    })
    .strict(),
]);
export const textValueSchema = z.union([
  plainText,
  z
    .object({
      runs: z
        .array(
          z
            .object({
              text: plainText,
              color: opt(typographyColorSchema),
              weight: opt(z.union([z.literal(400), z.literal(700)])),
              italic: opt(z.boolean()),
              decoration: opt(z.enum(["none", "underline", "line-through"])),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .refine(
      (value) =>
        value.runs.reduce(
          (sum, run) =>
            sum +
            graphemes(
              typeof run.text === "string"
                ? run.text
                : `${run.text.prefix ?? ""}${run.text.suffix ?? ""}`,
            ).length,
          0,
        ) <= 10000,
      "Text exceeds 10000 graphemes",
    ),
]);
const text = textValueSchema;
const animation = z
  .object({
    property: z.enum(["opacity", "x", "y", "scale", "rotate"]),
    easing: opt(z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"])),
    keyframes: z.array(z.object({ at: timeSchema, value: n }).strict()).min(1),
  })
  .strict();
const base = {
  typography: opt(textTypographySchema.nullable()),
  motion: opt(motionSettingsSchema),
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
        repeat: opt(z.literal("participants")),
        selection: opt(z.enum(["segment", "document", "revealed"])),
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
      .object({
        ...base,
        ...timerSettingsSchema.shape,
        type: z.literal("timer"),
        duration: opt(timeSchema),
      })
      .strict(),
    z
      .object({
        ...base,
        ...versusSettingsSchema.shape,
        type: z.literal("versus"),
      })
      .strict(),
    z
      .object({
        ...base,
        ...badgeSettingsSchema.shape,
        type: z.literal("badge"),
        text: opt(text),
      })
      .strict(),
    z
      .object({
        ...base,
        ...progressSettingsSchema.shape,
        type: z.literal("progress"),
      })
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
export const boardSlotSchema = z
  .object({
    typography: opt(textTypographySchema.nullable()),
    id,
    label: str,
    capacity: opt(positive.int()),
    color: opt(color),
    background: opt(color),
    image: opt(id),
    backgroundAsset: opt(id),
    sound: opt(id),
    rect: opt(rectSchema),
    style: opt(cardStyleSchema),
  })
  .strict();
const boardCardSchema = z
  .object({ id, participantId: id, cost: opt(nonnegative) })
  .strict();
const actionBase = { id, comment: opt(str), sound: opt(id), cardId: id };
export const boardActionSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("place"), slotId: id }).strict(),
  z.object({ ...actionBase, type: z.literal("move"), slotId: id }).strict(),
  z
    .object({
      ...actionBase,
      type: z.literal("replace"),
      slotId: id,
      replaceCardId: id,
    })
    .strict(),
  z
    .object({ ...actionBase, type: z.literal("swap"), otherCardId: id })
    .strict(),
  z.object({ ...actionBase, type: z.literal("remove") }).strict(),
  z.object({ ...actionBase, type: z.literal("lock") }).strict(),
  z.object({ ...actionBase, type: z.literal("unlock") }).strict(),
]);
export const boardRoundSchema = z
  .object({
    id,
    prompt: opt(str),
    cards: z.array(boardCardSchema),
    actions: z.array(boardActionSchema),
    clearSlotIds: opt(z.array(id)),
  })
  .strict();
export const boardDefinitionSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["accumulate", "rounds"]),
    slots: z.array(boardSlotSchema).min(1),
    rounds: z.array(boardRoundSchema),
    carry: opt(z.boolean()),
    budget: opt(nonnegative),
    allowMoves: opt(z.boolean()),
    allowReplacements: opt(z.boolean()),
    lockOnPlace: opt(z.boolean()),
    allowRepeatParticipants: opt(z.boolean()),
    requireAllAssigned: opt(z.boolean()),
    layout: opt(z.enum(["rows", "grid", "free"])),
    columns: opt(positive.int()),
    xLabel: opt(str),
    yLabel: opt(str),
    presentation: opt(
      z
        .object({
          reveal: opt(z.enum(["together", "sequential"])),
          answerReveal: opt(z.enum(["round", "end"])),
          hideLabelsUntilPlaced: opt(z.boolean()),
          hideVisualsUntilPlaced: opt(z.boolean()),
          shuffleCandidates: opt(z.boolean()),
          focusActive: opt(z.boolean()),
          leadSec: opt(nonnegative),
          revealSec: opt(positive),
          thinkSec: opt(nonnegative),
          moveSec: opt(positive),
          holdSec: opt(nonnegative),
          finalSec: opt(positive),
          rowFocusSec: opt(nonnegative),
        })
        .strict(),
    ),
  })
  .strict();
export const sceneSchema = z
  .object({
    id,
    block: z.enum(["custom", "top", "picker", "board"]),
    board: opt(boardDefinitionSchema),
    repeat: opt(z.enum(["participants", "rounds"])),
    participantId: opt(id),
    roundId: opt(id),
    duration: opt(timeSchema),
    settings: opt(settingsSchema),
    nodes: z.array(videoNodeSchema),
    transition: opt(transitionSchema),
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
      media: opt(z.literal("cover")),
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
            "board.reveal",
            "board.place",
            "board.move",
            "board.replace",
            "board.swap",
            "board.remove",
            "board.lock",
            "board.unlock",
            "board.summary",
          ]),
          sceneId: opt(id),
          participantId: opt(id),
          roundId: opt(id),
          cardId: opt(id),
          slotId: opt(id),
          actionId: opt(id),
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
const videoAudioSchema = z
  .object({
    playlist: opt(
      z.object({ tracks: z.array(id), ...playlistOptions }).strict(),
    ),
    cues: opt(z.array(audioCueSchema)),
  })
  .strict();
export const videoSegmentSchema = z
  .object({
    id,
    kind: z.enum(["top", "picker", "custom", "board"]),
    title: str,
    subtitle: opt(str),
    poster: opt(id),
    sourceSegmentId: opt(id),
    enabled: opt(z.boolean()),
    participantIds: opt(z.array(id)),
    roundIds: opt(z.array(id)),
    scenes: z.array(sceneSchema),
    settings: opt(settingsSchema),
    audio: opt(videoAudioSchema),
  })
  .strict();
const sourceSegmentSchema = z
  .object({
    id,
    title: str,
    subtitle: opt(str),
    poster: opt(id),
    participantIds: z.array(id),
  })
  .strict();
const documentObject = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    segments: opt(z.array(videoSegmentSchema)),
    id,
    title: str,
    kind: z.enum(["top", "picker", "board"]),
    seed: nonnegative.int(),
    output,
    source: z
      .object({
        kind: z.enum(["manual", "tournament"]),
        tournamentId: opt(id),
        segmentId: opt(id),
        segments: opt(z.array(sourceSegmentSchema)),
        suppressedSegmentIds: opt(z.array(id)),
        dormantSegments: opt(
          z.array(
            z
              .object({
                id,
                sourceSegmentId: id,
                enabled: opt(z.boolean()),
              })
              .strict(),
          ),
        ),
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
    interactive: opt(interactiveLayerSchema),
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
      const scenes = [
        ...d.scenes,
        ...(d.segments ?? []).flatMap((s) => s.scenes),
      ];
      if (
        (d.schemaVersion === 1 && d.segments !== undefined) ||
        (d.schemaVersion === 2 && !d.segments)
      )
        ctx.addIssue({
          code: "custom",
          message: "v1 forbids segments; v2 requires segments",
          path: ["segments"],
        });
      if (d.schemaVersion === 2 && d.scenes.length)
        ctx.addIssue({
          code: "custom",
          message: "v2 scenes belong to segments",
          path: ["scenes"],
        });
      unique(
        (d.segments ?? []).map((s) => s.id),
        ["segments"],
      );
      unique(
        (d.source.segments ?? []).map((s) => s.id),
        ["source", "segments"],
      );
      const participantIds = new Set(d.source.participants.map((p) => p.id));
      const roundIds = new Set(d.source.rounds.map((r) => r.id));
      for (const [i, s] of (d.source.segments ?? []).entries()) {
        if (
          new Set(s.participantIds).size !== s.participantIds.length ||
          s.participantIds.some((id) => !participantIds.has(id))
        )
          ctx.addIssue({
            code: "custom",
            message: "Source segment participants must be unique existing IDs",
            path: ["source", "segments", i, "participantIds"],
          });
      }
      for (const [i, s] of (d.segments ?? []).entries()) {
        if (s.enabled === false) continue;
        if (
          s.participantIds?.some((id) => !participantIds.has(id)) ||
          (s.participantIds &&
            new Set(s.participantIds).size !== s.participantIds.length) ||
          s.roundIds?.some((id) => !roundIds.has(id)) ||
          (s.roundIds && new Set(s.roundIds).size !== s.roundIds.length)
        )
          ctx.addIssue({
            code: "custom",
            message: "Segment selections must contain unique existing IDs",
            path: ["segments", i],
          });
        if (
          s.sourceSegmentId &&
          !d.source.segments?.some((source) => source.id === s.sourceSegmentId)
        )
          ctx.addIssue({
            code: "custom",
            message: "Source segment does not exist",
            path: ["segments", i, "sourceSegmentId"],
          });
      }
      const boards = scenes.flatMap((scene) =>
        scene.board ? [scene.board] : [],
      );
      unique(
        boards.flatMap((b) => b.slots.map((v) => v.id)),
        ["board", "slots"],
      );
      unique(
        boards.flatMap((b) => b.rounds.map((v) => v.id)),
        ["board", "rounds"],
      );
      unique(
        boards.flatMap((b) =>
          b.rounds.flatMap((r) => r.cards.map((v) => v.id)),
        ),
        ["board", "cards"],
      );
      unique(
        boards.flatMap((b) =>
          b.rounds.flatMap((r) => r.actions.map((v) => v.id)),
        ),
        ["board", "actions"],
      );
      scenes.forEach((scene) => {
        if (
          (scene.block === "board") !== Boolean(scene.board) ||
          (scene.block === "board" &&
            (scene.repeat || scene.participantId || scene.roundId))
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Board block requires board data and cannot repeat a source collection",
            path: ["scenes", scene.id],
          });
        if (
          scene.board?.layout === "free" &&
          scene.board.slots.some((s) => !s.rect)
        )
          ctx.addIssue({
            code: "custom",
            message: "Free board layout requires each slot rect",
            path: ["scenes", scene.id, "board"],
          });
      });
      unique(
        scenes.map((s) => s.id),
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
          if (node.type === "container") {
            if (node.selection && !node.repeat)
              ctx.addIssue({
                code: "custom",
                message: "Participant selection requires repeat:participants",
                path: ["nodes", node.id, "selection"],
              });
            walk(node.children);
          }
        });
      scenes.forEach((s) => walk(s.nodes));
      unique(ids, ["scenes"]);
      if (d.source.kind === "tournament" && !d.source.tournamentId)
        ctx.addIssue({
          code: "custom",
          message: "Tournament source requires tournamentId",
          path: ["source", "tournamentId"],
        });
      scenes.forEach((s, i) => {
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
    kind: z.enum(["top", "picker", "board"]),
    output,
    settings: settingsSchema,
    formatSettings: opt(formatSettings),
    scenes: z.array(sceneSchema),
    skeleton: z
      .object({
        roundCount: nonnegative.int(),
        cardsPerRound: positive.int(),
        groupCount: nonnegative.int(),
        boards: opt(
          z.array(
            z
              .object({
                sceneId: id,
                roundCount: nonnegative.int(),
                cardsPerRound: positive.int(),
              })
              .strict(),
          ),
        ),
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
    const motion = (
      value: import("./motion-types").MotionSettings | undefined,
      path: (string | number)[],
    ) => {
      for (const channel of ["enter", "exit", "loop", "emphasis"] as const) {
        const spec = value?.[channel];
        if (
          spec &&
          typeof spec === "object" &&
          spec.at &&
          "event" in spec.at &&
          (spec.at.cardId || spec.at.actionId || spec.at.slotId)
        )
          issue([...path, channel, "at"]);
      }
    };
    const settings = (s: unknown, path: (string | number)[]) => {
      motion((s as import("./types").Settings | undefined)?.motion, [
        ...path,
        "motion",
      ]);
      const asset = (s as { backdrop?: { asset?: string } } | undefined)
        ?.backdrop?.asset;
      if (asset && !/^slot:[a-z]+:[0-9]+$/.test(asset))
        issue([...path, "backdrop", "asset"]);
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
        motion(n.motion, [...at, "motion"]);
        if (n.type === "container") walk(n.children, [...at, "children"]);
        if (
          (n.type === "video" || n.type === "image" || n.type === "audio") &&
          !/^slot:[a-z]+:[0-9]+$/.test(n.asset) &&
          ![
            "$participant.visual",
            "$participant.audio",
            "$segment.poster",
          ].includes(n.asset)
        )
          issue([...at, "asset"]);
        if (n.type === "card" && n.participantId !== "$participant")
          issue([...at, "participantId"]);
        const textValue =
          n.type === "text" || n.type === "badge"
            ? n.text
            : n.type === "card"
              ? n.label
              : undefined;
        if (typeof textValue === "object") {
          const key = n.type === "card" ? "label" : "text";
          if ("runs" in textValue)
            textValue.runs.forEach((run, index) => {
              if (typeof run.text === "object" && run.text.groupId)
                issue([...at, key, "runs", index, "text", "groupId"]);
            });
          else if (textValue.groupId) issue([...at, key, "groupId"]);
        }
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
      if (s.board) {
        if (s.board.rounds.length) issue(["scenes", i, "board", "rounds"]);
        s.board.slots.forEach((slot, j) => {
          for (const field of ["image", "backgroundAsset", "sound"] as const)
            if (slot[field] && !/^slot:[a-z]+:[0-9]+$/.test(slot[field]!))
              issue(["scenes", i, "board", "slots", j, field]);
        });
      }
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
      type: z.enum([
        "participant",
        "round",
        "card",
        "group",
        "scene",
        "node",
        "segment",
        "boardSlot",
        "boardRound",
        "boardCard",
        "boardAction",
      ]),
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
