import { z } from "zod";
import { boardRoundSchema, parseVideoDocument } from "./schema";
import { resolveBoard } from "./board-state";
import { interactiveLayerSchema } from "./interactive-schema";
import type { InteractiveLayer } from "./interactive-types";
import type {
  Participant,
  BoardDefinition,
  BoardSlot,
  PickerRound,
  VideoDocument,
  VideoScene,
} from "./types";

const id = z.string().min(1).max(200);
const text = z.string().max(10000);
const participant = z
  .object({
    id,
    label: text.optional(),
    caption: text.nullable().optional(),
    comment: text.nullable().optional(),
    album: text.nullable().optional(),
    subtitle: text.nullable().optional(),
    tier: text.nullable().optional(),
    kind: z.enum(["audio", "video", "image"]).nullable().optional(),
    rank: z.number().int().positive().optional(),
    visualAssetId: id.nullable().optional(),
    audioAssetId: id.nullable().optional(),
    bestMomentSec: z.number().finite().nonnegative().optional(),
  })
  .strict();
const card = z
  .object({ id: id.optional(), participantId: id, label: text.optional() })
  .strict();
const round = z
  .object({
    id,
    prompt: text.optional(),
    cards: z.array(card).max(20000).optional(),
    groups: z
      .array(
        z
          .object({
            id,
            label: text.optional(),
            cardIds: z.array(id).max(20000).optional(),
          })
          .strict(),
      )
      .max(20000)
      .nullable()
      .optional(),
    answerParticipantIds: z.array(id).max(20000).nullable().optional(),
    answerGroupIds: z.array(id).max(20000).nullable().optional(),
    musicAssetId: id.nullable().optional(),
    backgroundAssetId: id.nullable().optional(),
  })
  .strict();
/**
 * Task 34: the interactive layer in short form. Merge updates moments and choices by id
 * and templates by segment or scene; replace sets the whole layer; null removes it.
 */
const interactivePart = z
  .object({
    moments: interactiveLayerSchema.innerType().shape.moments.optional(),
    choices: interactiveLayerSchema.innerType().shape.choices.optional(),
    templates: interactiveLayerSchema.innerType().shape.templates.optional(),
    sample: interactiveLayerSchema.innerType().shape.sample.optional(),
  })
  .strict();
const common = {
  mode: z.enum(["merge", "replace"]),
  interactive: interactivePart.nullable().optional(),
  title: text.optional(),
  participants: z.array(participant).max(20000).optional(),
  deleteParticipantIds: z.array(id).max(20000).optional(),
};
/** Authoring input only: never contains rendering coordinates, settings or executable code. */
export const videoContentInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("top") }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("picker"),
      rounds: z.array(round).max(20000).optional(),
      deleteRoundIds: z.array(id).max(20000).optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("board"),
      tiers: z
        .array(
          z
            .object({
              id,
              label: text.optional(),
              participantIds: z.array(id).max(20000).optional(),
              color: text.optional(),
              background: text.optional(),
            })
            .strict(),
        )
        .max(2000)
        .optional(),
      boards: z
        .array(
          z
            .object({
              sceneId: id,
              rounds: z.array(boardRoundSchema).max(20000),
            })
            .strict(),
        )
        .max(2000)
        .optional(),
    })
    .strict(),
]);
export type VideoContentInput = z.input<typeof videoContentInputSchema>;
export class VideoContentError extends Error {
  constructor(
    public code: string,
    public path: string,
  ) {
    super(`${code}: ${path}`);
    this.name = "VideoContentError";
  }
}
function fail(code: string, path: string): never {
  throw new VideoContentError(code, path);
}
function unique(items: { id: string }[], path: string) {
  if (new Set(items.map((i) => i.id)).size !== items.length)
    fail("CONTENT_DUPLICATE_ID", path);
}
/** Preserve familiar short IDs; long authored identities still fit the SDK's 200-character budget. */
function boundedContentId(readable: string, identity: unknown): string {
  if (readable.length <= 200) return readable;
  let digest = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(JSON.stringify(identity)))
    digest = BigInt.asUintN(64, (digest ^ BigInt(byte)) * 0x100000001b3n);
  return `content-generated:${digest.toString(16).padStart(16, "0")}`;
}
function contentBinding(
  doc: VideoDocument,
  assetId: string,
  base: string,
  identity: unknown,
  previousKey?: string,
): string {
  const matches = (key: string) =>
    doc.bindings[key]?.kind === "pool" &&
    (doc.bindings[key] as { assetId: string }).assetId === assetId;
  if (previousKey && matches(previousKey)) return previousKey;
  let key = boundedContentId(base, identity),
    suffix = 0;
  while (doc.bindings[key] && !matches(key))
    key = boundedContentId(`${base}:${++suffix}`, [identity, suffix]);
  doc.bindings[key] = { kind: "pool", assetId };
  return key;
}
function uniqueContentId(
  base: string,
  identity: unknown,
  occupied: Set<string>,
): string {
  let result = boundedContentId(base, identity),
    suffix = 0;
  while (occupied.has(result))
    result = boundedContentId(`${base}:${++suffix}`, [identity, suffix]);
  occupied.add(result);
  return result;
}
function mergeById<T extends { id: string }>(
  old: T[],
  updates: T[],
  mode: "merge" | "replace",
  removed: string[] = [],
): T[] {
  for (const id of removed) {
    if (!old.some((item) => item.id === id)) fail("CONTENT_ID_UNKNOWN", id);
    if (updates.some((item) => item.id === id))
      fail("CONTENT_DELETE_UPDATE_CONFLICT", id);
  }
  if (new Set(removed).size !== removed.length)
    fail("CONTENT_DUPLICATE_ID", "deletions");
  const result =
    mode === "replace" ? [] : old.filter((p) => !removed.includes(p.id));
  for (const update of updates) {
    const i = result.findIndex((p) => p.id === update.id);
    if (i < 0) result.push(update);
    else result[i] = update;
  }
  return result;
}
function authoredScenes(doc: VideoDocument): VideoScene[] {
  if (doc.schemaVersion === 2) {
    if (
      doc.segments?.length !== 1 ||
      doc.segments[0].kind !== doc.kind ||
      doc.segments[0].sourceSegmentId
    )
      fail("CONTENT_UNSUPPORTED_MAPPING", "segments");
    return doc.segments![0].scenes;
  }
  return doc.scenes;
}
/** Changes only declared content; preserves scene IDs, styles and all unrelated bindings. */
export function buildVideoContent(
  document: VideoDocument,
  raw: VideoContentInput,
): VideoDocument {
  const input = videoContentInputSchema.parse(raw);
  const doc = structuredClone(parseVideoDocument(document));
  if (doc.kind !== input.kind) fail("CONTENT_KIND_MISMATCH", "kind");
  const scenes = authoredScenes(doc);
  if (!scenes.length || scenes.some((s) => s.block !== doc.kind))
    fail("CONTENT_UNSUPPORTED_MAPPING", "scenes");
  if (
    doc.source.kind === "tournament" &&
    (input.mode === "replace" ||
      input.participants !== undefined ||
      input.deleteParticipantIds !== undefined ||
      (input.kind === "picker" &&
        (input.rounds !== undefined || input.deleteRoundIds !== undefined)) ||
      (input.kind === "board" &&
        (input.boards !== undefined || input.tiers !== undefined)))
  )
    fail("CONTENT_TOURNAMENT_READONLY", "source");
  if (input.mode === "replace" && input.participants === undefined)
    fail("CONTENT_REPLACEMENT_REQUIRED", "participants");
  if (input.title !== undefined) doc.title = input.title;
  unique(input.participants ?? [], "participants");
  const updates = (input.participants ?? []).map((update) => {
    const old = doc.source.participants.find((p) => p.id === update.id);
    const { visualAssetId, audioAssetId, ...fields } = update;
    const p = {
      ...(input.mode === "merge"
        ? old
        : old?.settings
          ? { settings: old.settings }
          : {}),
      ...fields,
    } as Participant;
    for (const field of [
      "caption",
      "comment",
      "album",
      "subtitle",
      "tier",
      "kind",
    ] as const)
      if (p[field] === null) delete p[field];
    if (p.label === undefined)
      fail("CONTENT_LABEL_REQUIRED", `participants.${p.id}.label`);
    if (doc.kind === "top" && p.rank === undefined)
      fail("CONTENT_RANK_REQUIRED", `participants.${p.id}.rank`);
    for (const [channel, assetId] of [
      ["visual", visualAssetId],
      ["audio", audioAssetId],
    ] as const) {
      if (assetId === undefined) continue;
      p.media = { ...p.media };
      if (assetId === null) {
        delete p.media[channel];
        continue;
      }
      // Content-owned keys are allocated independently. Never overwrite a shared
      // binding used by scene media, another participant or a user-authored node.
      p.media[channel] = contentBinding(
        doc,
        assetId,
        `content:${p.id}:${channel}`,
        ["binding", p.id, channel],
        old?.media?.[channel],
      );
    }
    return p;
  });
  doc.source.participants = mergeById(
    doc.source.participants,
    updates,
    input.mode,
    input.deleteParticipantIds,
  );
  if (input.kind === "picker") {
    if (input.mode === "replace" && input.rounds === undefined)
      fail("CONTENT_REPLACEMENT_REQUIRED", "rounds");
    unique(input.rounds ?? [], "rounds");
    const rounds = (input.rounds ?? []).map((update) => {
      const old = doc.source.rounds.find((r) => r.id === update.id);
      if (input.mode === "replace" && update.cards === undefined)
        fail("CONTENT_REPLACEMENT_REQUIRED", `rounds.${update.id}.cards`);
      const result: PickerRound = {
        ...(input.mode === "merge"
          ? old
          : old?.settings
            ? { settings: old.settings }
            : {}),
        id: update.id,
        cards: input.mode === "merge" ? (old?.cards ?? []) : [],
      };
      if (update.prompt !== undefined) result.prompt = update.prompt;
      if (update.cards !== undefined)
        result.cards = update.cards.map((c) => {
          const previous = c.id
            ? old?.cards.find((o) => o.id === c.id)
            : old?.cards.find((o) => o.participantId === c.participantId);
          return {
            ...(input.mode === "merge"
              ? previous
              : previous?.settings
                ? { settings: previous.settings }
                : {}),
            ...c,
            id:
              c.id ??
              previous?.id ??
              boundedContentId(`${update.id}:card:${c.participantId}`, [
                "card",
                update.id,
                c.participantId,
              ]),
          };
        });
      unique(result.cards, `rounds.${result.id}.cards`);
      if (update.groups === null) delete result.groups;
      else if (update.groups !== undefined) {
        unique(update.groups, `rounds.${result.id}.groups`);
        const groups = update.groups.map((group) => {
          const previous = old?.groups?.find((g) => g.id === group.id);
          const merged = {
            ...(input.mode === "merge"
              ? previous
              : previous?.settings
                ? { settings: previous.settings }
                : {}),
            ...group,
          };
          if (merged.cardIds === undefined)
            fail(
              "CONTENT_GROUP_CARDS_REQUIRED",
              `rounds.${result.id}.groups.${group.id}.cardIds`,
            );
          return { ...merged, cardIds: merged.cardIds! };
        });
        result.groups = mergeById(
          input.mode === "merge" ? (old?.groups ?? []) : [],
          groups,
          input.mode,
        );
      }
      for (const [channel, assetId] of [
        ["music", update.musicAssetId],
        ["background", update.backgroundAssetId],
      ] as const) {
        if (assetId === undefined) continue;
        if (assetId === null) {
          if (channel === "music") result.music = null;
          else delete result.background;
        } else
          result[channel] = contentBinding(
            doc,
            assetId,
            `content:round:${result.id}:${channel}`,
            ["round-binding", result.id, channel],
            old?.[channel] ?? undefined,
          );
      }
      // Answer channels are independently authored: clearing a group answer keeps
      // an existing card answer, and a favourite-group picker invents neither.
      if (result.answer) result.answer = { ...result.answer };
      if (update.answerParticipantIds === null && result.answer)
        delete result.answer.cardIds;
      else if (
        update.answerParticipantIds !== undefined &&
        update.answerParticipantIds !== null
      ) {
        const ids = update.answerParticipantIds.map((pid) => {
          const candidates = result.cards.filter(
            (c) => c.participantId === pid,
          );
          if (candidates.length !== 1)
            fail(
              "CONTENT_ANSWER_INVALID",
              `rounds.${result.id}.answerParticipantIds`,
            );
          return candidates[0].id;
        });
        if (new Set(ids).size !== ids.length)
          fail(
            "CONTENT_ANSWER_INVALID",
            `rounds.${result.id}.answerParticipantIds`,
          );
        result.answer = { ...result.answer, cardIds: ids };
      }
      if (update.answerGroupIds === null && result.answer)
        delete result.answer.groupIds;
      else if (
        update.answerGroupIds !== undefined &&
        update.answerGroupIds !== null
      ) {
        if (
          new Set(update.answerGroupIds).size !==
            update.answerGroupIds.length ||
          update.answerGroupIds.some(
            (id) => !result.groups?.some((g) => g.id === id),
          )
        )
          fail(
            "CONTENT_ANSWER_GROUP_INVALID",
            `rounds.${result.id}.answerGroupIds`,
          );
        result.answer = { ...result.answer, groupIds: update.answerGroupIds };
      }
      if (result.answer && !Object.keys(result.answer).length)
        delete result.answer;
      return result;
    });
    doc.source.rounds = mergeById(
      doc.source.rounds,
      rounds,
      input.mode,
      input.deleteRoundIds,
    );
  }
  if (input.kind === "board") {
    if (input.tiers !== undefined && input.boards !== undefined)
      fail("CONTENT_TIERS_BOARDS_CONFLICT", "tiers");
    if (input.tiers !== undefined) {
      const boardScenes = scenes.filter((scene) => scene.board);
      if (boardScenes.length !== 1)
        fail("CONTENT_TIERS_SCENE_AMBIGUOUS", "tiers");
      const board = boardScenes[0].board!;
      if (
        board.mode !== "accumulate" ||
        board.carry ||
        board.budget !== undefined
      )
        fail("CONTENT_TIERS_BOARD_UNSUPPORTED", "tiers");
      applyTiers(board, input.tiers, doc.source.participants, input.mode);
    }
    unique(
      (input.boards ?? []).map((b) => ({ id: b.sceneId })),
      "boards",
    );
    if (
      input.mode === "replace" &&
      input.tiers === undefined &&
      scenes.some((s) => !input.boards?.some((b) => b.sceneId === s.id))
    )
      fail("CONTENT_REPLACEMENT_REQUIRED", "boards");
    for (const update of input.boards ?? []) {
      const scene = scenes.find((s) => s.id === update.sceneId);
      if (!scene?.board)
        fail("CONTENT_BOARD_SCENE_UNKNOWN", `boards.${update.sceneId}`);
      unique(update.rounds, `boards.${update.sceneId}.rounds`);
      scene.board.rounds = mergeById(
        scene.board.rounds,
        update.rounds,
        input.mode,
      );
    }
    for (const scene of scenes)
      if (scene.board) {
        const errors = resolveBoard(
          scene.board,
          doc.source.participants,
        ).diagnostics.filter((d) => d.severity === "error");
        if (errors.length)
          fail(
            "CONTENT_BOARD_INVALID",
            `${scene.id}: ${errors.map((d) => d.code).join(",")}`,
          );
      }
  }
  const participants = new Set(doc.source.participants.map((p) => p.id));
  for (const r of doc.source.rounds) {
    if (r.cards.some((c) => !participants.has(c.participantId)))
      fail("CONTENT_REFERENCE_INVALID", `rounds.${r.id}.cards`);
    const grouped = new Set<string>();
    for (const group of r.groups ?? [])
      for (const cardId of group.cardIds) {
        if (!r.cards.some((card) => card.id === cardId) || grouped.has(cardId))
          fail(
            "CONTENT_GROUP_REFERENCE_INVALID",
            `rounds.${r.id}.groups.${group.id}.cardIds`,
          );
        grouped.add(cardId);
      }
    if (
      r.answer?.cardIds?.some((id) => !r.cards.some((c) => c.id === id)) ||
      r.answer?.groupIds?.some((id) => !r.groups?.some((g) => g.id === id)) ||
      r.groups?.some((g) =>
        g.cardIds.some((id) => !r.cards.some((c) => c.id === id)),
      )
    )
      fail("CONTENT_ANSWER_REFERENCE_INVALID", `rounds.${r.id}.answer`);
  }
  if (input.interactive === null) delete doc.interactive;
  else if (input.interactive)
    doc.interactive = mergeInteractive(
      doc.interactive,
      input.interactive,
      input.mode,
    );
  // Existing concrete scene/segment scopes cannot be silently pruned on deletion.
  for (const s of scenes)
    if (s.participantId && !participants.has(s.participantId))
      fail("CONTENT_REFERENCE_INVALID", `scenes.${s.id}.participantId`);
  return parseVideoDocument(doc);
}
type TierContent = NonNullable<
  Extract<VideoContentInput, { kind: "board" }>["tiers"]
>;
/** Semantic distribution uses the existing board state machine, never guesses a tier. */
function applyTiers(
  board: BoardDefinition,
  tiers: TierContent,
  participants: Participant[],
  mode: "merge" | "replace",
) {
  unique(tiers, "tiers");
  const oldCards = board.rounds.flatMap((round) => round.cards);
  const oldActions = board.rounds.flatMap((round) => round.actions);
  const cardIds = new Set(oldCards.map((card) => card.id)),
    actionIds = new Set(oldActions.map((action) => action.id));
  const resolution = resolveBoard(board, participants);
  if (mode === "merge" && resolution.diagnostics.length)
    fail("CONTENT_TIERS_BOARD_INVALID", "tiers");
  const oldCardByParticipant = new Map(
    oldCards.map((card) => [card.participantId, card]),
  );
  type Row = { slot: BoardSlot; participantIds: string[] };
  const previous: Row[] = board.slots.map((slot) => ({
    slot,
    participantIds: oldCards
      .filter((card) => resolution.final.placements[card.id] === slot.id)
      .map((card) => card.participantId),
  }));
  const rows: Row[] = mode === "merge" ? [...previous] : [];
  for (const tier of tiers) {
    const old = previous.find((row) => row.slot.id === tier.id);
    if (
      (mode === "replace" || !old) &&
      (tier.label === undefined || tier.participantIds === undefined)
    )
      fail("CONTENT_TIERS_REPLACEMENT_REQUIRED", `tiers.${tier.id}`);
    const slot: BoardSlot = {
      ...old?.slot,
      id: tier.id,
      label: tier.label ?? old!.slot.label,
    };
    if (tier.color !== undefined) slot.color = tier.color;
    if (tier.background !== undefined) slot.background = tier.background;
    const row = {
      slot,
      participantIds: tier.participantIds ?? old!.participantIds,
    };
    const index = rows.findIndex((row) => row.slot.id === tier.id);
    if (index < 0) rows.push(row);
    else rows[index] = row;
  }
  if (!rows.length) fail("CONTENT_TIERS_REQUIRED", "tiers");
  const known = new Set(participants.map((p) => p.id)),
    assigned = new Set<string>();
  for (const row of rows)
    for (const participantId of row.participantIds) {
      if (!known.has(participantId))
        fail(
          "CONTENT_TIER_PARTICIPANT_UNKNOWN",
          `tiers.${row.slot.id}.participantIds`,
        );
      if (assigned.has(participantId))
        fail(
          "CONTENT_TIER_PARTICIPANT_REPEATED",
          `tiers.${row.slot.id}.participantIds`,
        );
      assigned.add(participantId);
    }
  board.slots = rows.map((row) => row.slot);
  board.rounds = rows
    .filter((row) => row.participantIds.length)
    .map((row) => {
      const cards = row.participantIds.map((participantId) => ({
        ...oldCardByParticipant.get(participantId),
        id:
          oldCardByParticipant.get(participantId)?.id ??
          uniqueContentId(
            `tiers:card:${participantId}`,
            ["tier-card", participantId],
            cardIds,
          ),
        participantId,
      }));
      return {
        id: boundedContentId(`tiers:round:${row.slot.id}`, [
          "tier-round",
          row.slot.id,
        ]),
        cards,
        actions: cards.map((card) => ({
          id:
            oldActions.find(
              (action) => action.type === "place" && action.cardId === card.id,
            )?.id ??
            uniqueContentId(
              `tiers:place:${card.participantId}`,
              ["tier-place", card.participantId],
              actionIds,
            ),
          type: "place" as const,
          cardId: card.id,
          slotId: row.slot.id,
        })),
      };
    });
}
function mergeInteractive(
  old: InteractiveLayer | undefined,
  part: z.infer<typeof interactivePart>,
  mode: "merge" | "replace",
): InteractiveLayer {
  const base: InteractiveLayer =
    mode === "merge" && old
      ? structuredClone(old)
      : { version: 1, moments: [], choices: [], templates: [], sample: {} };
  const byKey = <T>(
    list: T[],
    updates: T[] | undefined,
    key: (item: T) => string,
  ) => {
    if (!updates) return list;
    unique(
      updates.map((u) => ({ id: key(u) })),
      "interactive",
    );
    if (mode === "replace") return updates;
    const next = list.filter(
      (item) => !updates.some((u) => key(u) === key(item)),
    );
    return [...next, ...updates];
  };
  base.moments = byKey(base.moments, part.moments, (m) => m.id);
  base.choices = byKey(base.choices, part.choices, (c) => c.id);
  base.templates = byKey(
    base.templates,
    part.templates,
    (t) => t.segmentId ?? `scene:${t.sceneId}`,
  );
  if (part.sample) base.sample = part.sample;
  return base;
}
export function getVideoContentMissingInputs(doc: VideoDocument): string[] {
  const missing: string[] = [];
  if (!doc.source.participants.length) missing.push("participants");
  for (const p of doc.source.participants) {
    if (!p.media?.visual || !doc.bindings[p.media.visual])
      missing.push(`participants.${p.id}.visualAssetId`);
    if (doc.kind === "top" && p.rank === undefined)
      missing.push(`participants.${p.id}.rank`);
    if (
      doc.settings?.top?.snippet?.mode === "active" &&
      (!p.media?.audio || !doc.bindings[p.media.audio])
    )
      missing.push(`participants.${p.id}.audioAssetId`);
  }
  if (doc.kind === "picker" && !doc.source.rounds.length)
    missing.push("rounds");
  for (const scene of [
    ...doc.scenes,
    ...(doc.segments ?? []).flatMap((s) => s.scenes),
  ])
    if (scene.board && !scene.board.rounds.length)
      missing.push(`boards.${scene.id}.rounds`);
  return missing;
}
