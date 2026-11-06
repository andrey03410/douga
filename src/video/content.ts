import { z } from "zod";
import { boardRoundSchema, parseVideoDocument } from "./schema";
import { resolveBoard } from "./board-state";
import type {
  Participant,
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
    answerParticipantIds: z.array(id).max(20000).nullable().optional(),
  })
  .strict();
const common = {
  mode: z.enum(["merge", "replace"]),
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
      (input.kind === "board" && input.boards !== undefined))
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
    for (const field of ["caption", "comment", "album"] as const)
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
      const oldKey = old?.media?.[channel];
      if (
        oldKey &&
        doc.bindings[oldKey]?.kind === "pool" &&
        (doc.bindings[oldKey] as { assetId: string }).assetId === assetId
      ) {
        p.media[channel] = oldKey;
        continue;
      }
      const base = `content:${p.id}:${channel}`;
      let key = base,
        suffix = 0;
      while (
        doc.bindings[key] &&
        !(
          doc.bindings[key].kind === "pool" &&
          (doc.bindings[key] as { assetId: string }).assetId === assetId
        )
      )
        key = `${base}:${++suffix}`;
      doc.bindings[key] = { kind: "pool", assetId };
      p.media[channel] = key;
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
            id: c.id ?? previous?.id ?? `${update.id}:card:${c.participantId}`,
          };
        });
      unique(result.cards, `rounds.${result.id}.cards`);
      if (update.answerParticipantIds === null) delete result.answer;
      else if (update.answerParticipantIds !== undefined) {
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
        result.answer = { cardIds: ids };
      }
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
    unique(
      (input.boards ?? []).map((b) => ({ id: b.sceneId })),
      "boards",
    );
    if (
      input.mode === "replace" &&
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
    if (
      r.answer?.cardIds?.some((id) => !r.cards.some((c) => c.id === id)) ||
      r.answer?.groupIds?.some((id) => !r.groups?.some((g) => g.id === id)) ||
      r.groups?.some((g) =>
        g.cardIds.some((id) => !r.cards.some((c) => c.id === id)),
      )
    )
      fail("CONTENT_ANSWER_REFERENCE_INVALID", `rounds.${r.id}.answer`);
  }
  // Existing concrete scene/segment scopes cannot be silently pruned on deletion.
  for (const s of scenes)
    if (s.participantId && !participants.has(s.participantId))
      fail("CONTENT_REFERENCE_INVALID", `scenes.${s.id}.participantId`);
  return parseVideoDocument(doc);
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
