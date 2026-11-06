import { z } from "zod";
import {
  backdropNames,
  choreographyNames,
  motionNames,
  transitionNames,
} from "./motion-types";
// Kept independent of schema.ts to avoid a recursive runtime import.
const time = z.union([
  z.object({ sec: z.number().finite().min(0).max(7200) }).strict(),
  z.object({ frame: z.number().int().min(0).max(864000) }).strict(),
]);
export const motionColorSchema = z
  .string()
  .regex(
    /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% +\/-]+\)|transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|navy|teal|cyan|magenta|currentColor)$/,
  );
export const motionDirectionSchema = z.enum([
  "up",
  "down",
  "left",
  "right",
  "in",
  "out",
]);
const intensity = z.enum(["subtle", "normal", "bold"]);
export const motionNameSchema = z.enum([...motionNames, "flip"]);
export const motionAnchorSchema = z.union([
  time,
  z
    .object({
      event: z.enum([
        "scene.start",
        "card.reveal",
        "timer.start",
        "answer.reveal",
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
      offset: time.optional(),
      cardId: z.string().min(1).max(200).optional(),
      actionId: z.string().min(1).max(200).optional(),
      slotId: z.string().min(1).max(200).optional(),
    })
    .strict(),
]);
export const motionSpecSchema = z.union([
  motionNameSchema,
  z
    .object({
      name: motionNameSchema,
      duration: time.optional(),
      delay: time.optional(),
      intensity: intensity.optional(),
      direction: motionDirectionSchema.optional(),
      at: motionAnchorSchema.optional(),
    })
    .strict(),
]);
export const motionSettingsSchema = z
  .object({
    duration: time.optional(),
    profile: z.enum(["smooth", "snappy", "bouncy", "cinematic"]).optional(),
    intensity: intensity.optional(),
    enter: motionSpecSchema.nullable().optional(),
    exit: motionSpecSchema.nullable().optional(),
    loop: motionSpecSchema.nullable().optional(),
    emphasis: motionSpecSchema.nullable().optional(),
    stagger: z
      .object({
        interval: time,
        order: z.enum(["forward", "reverse", "center", "rows"]).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    choreography: z.enum(choreographyNames).nullable().optional(),
  })
  .strict();
export const backdropSettingsSchema = z
  .object({
    preset: z.enum(backdropNames),
    source: z.enum(["current-card", "round", "asset"]).optional(),
    asset: z.string().min(1).max(200).optional(),
    colors: z.array(motionColorSchema).min(2).max(8).optional(),
    blur: z.number().finite().min(0).max(200).optional(),
    dim: z.number().finite().min(0).max(1).optional(),
    motion: z.boolean().optional(),
    intensity: intensity.optional(),
    particles: z.number().int().min(0).max(32).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.source === "asset" && !v.asset)
      c.addIssue({
        code: "custom",
        path: ["asset"],
        message: "Asset source requires an asset key",
      });
    if (v.asset && v.source && v.source !== "asset")
      c.addIssue({
        code: "custom",
        path: ["source"],
        message: "Explicit asset requires source asset or omitted source",
      });
  });
export const timerSettingsSchema = z
  .object({
    variant: z.enum(["digits", "ring", "segments", "bar"]).optional(),
    color: motionColorSchema.optional(),
    trackColor: motionColorSchema.optional(),
    strokeWidth: z.number().finite().positive().max(100).optional(),
    showValue: z.boolean().optional(),
    warningSec: z.number().finite().min(0).max(7200).optional(),
  })
  .strict();
export const versusSettingsSchema = z
  .object({
    variant: z.enum(["clean", "neon", "slash", "impact"]).optional(),
    color: motionColorSchema.optional(),
  })
  .strict();
export const badgeSettingsSchema = z
  .object({
    kind: z.enum(["rank", "round", "winner", "label"]),
    color: motionColorSchema.optional(),
  })
  .strict();
export const progressSettingsSchema = z
  .object({
    scope: z.enum(["scene", "video"]).optional(),
    color: motionColorSchema.optional(),
    trackColor: motionColorSchema.optional(),
    strokeWidth: z.number().finite().positive().max(100).optional(),
  })
  .strict();
export const transitionSchema = z
  .object({
    type: z.enum(transitionNames),
    duration: time,
    direction: motionDirectionSchema.optional(),
    color: motionColorSchema.optional(),
  })
  .strict();
