import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) => !["__proto__", "prototype", "constructor"].includes(v),
    "Reserved identifier",
  );
const text = z.string().max(500);
const count = z.number().finite().min(0).max(1e9);
const time = z.union([
  z.object({ sec: z.number().finite().min(0).max(7200) }).strict(),
  z.object({ frame: z.number().int().min(0).max(7200 * 60) }).strict(),
]);

export const interactiveEventSchema = z.enum([
  "scene.start",
  "card.reveal",
  "timer.start",
  "answer.reveal",
  "scene.end",
  "board.reveal",
  "board.place",
  "board.move",
  "board.replace",
  "board.swap",
  "board.remove",
  "board.lock",
  "board.unlock",
  "board.summary",
]);

const anchorSchema = z.union([
  z.object({ event: interactiveEventSchema, cardId: id.optional() }).strict(),
  z.object({ time }).strict(),
]);

export const matchDataSchema = z
  .object({
    players: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(120),
            score: count.optional(),
            rank: z.number().int().positive().max(1000).optional(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    participants: z
      .record(
        id,
        z
          .object({
            votes: count.optional(),
            score: z.number().finite().min(-1e9).max(1e9).optional(),
            rank: z.number().int().positive().max(100000).optional(),
            pickedBy: z.array(id).max(16).optional(),
            comment: text.optional(),
          })
          .strict(),
      )
      .optional(),
    rounds: z
      .record(
        id,
        z
          .object({
            answer: z
              .object({
                cardIds: z.array(id).max(100).optional(),
                groupIds: z.array(id).max(100).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .optional(),
    texts: z
      .record(id, text)
      .refine((t) => Object.keys(t).length <= 32, "At most 32 texts")
      .optional(),
  })
  .strict()
  .refine((d) => JSON.stringify(d).length <= 256 * 1024, "Match data is limited to 256 KiB");

export const interactiveLayerSchema = z
  .object({
    version: z.literal(1),
    moments: z
      .array(z.object({ id, sceneId: id, at: anchorSchema }).strict())
      .max(200),
    choices: z
      .array(
        z
          .object({
            id,
            sceneId: id,
            cards: z.union([z.literal("all"), z.array(id).min(1).max(100)]),
          })
          .strict(),
      )
      .max(200),
    templates: z
      .array(
        z
          .object({
            segmentId: id.optional(),
            sceneId: id.optional(),
            uses: z
              .array(z.enum(["players", "votes", "rank", "score", "pickedBy", "answer", "texts"]))
              .min(1),
            order: z.literal("rank").optional(),
            participants: z.literal("players").optional(),
          })
          .strict()
          .refine((t) => Boolean(t.segmentId) !== Boolean(t.sceneId), "Set exactly one of segmentId or sceneId")
          .refine((t) => !t.participants || Boolean(t.segmentId), "participants:players needs a segmentId"),
      )
      .max(100),
    sample: matchDataSchema,
    current: matchDataSchema.optional(),
  })
  .strict()
  .superRefine((layer, ctx) => {
    for (const key of ["moments", "choices"] as const) {
      const seen = new Set<string>();
      layer[key].forEach((item, i) => {
        if (seen.has(item.id))
          ctx.addIssue({ code: "custom", message: `Duplicate ${key} id: ${item.id}`, path: [key, i, "id"] });
        seen.add(item.id);
      });
    }
  });
