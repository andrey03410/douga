import { z } from "zod";
import { settingsSchema } from "@douga/video/schema";
import { compositionSettingsSchema } from "@douga/video/composition-settings";
import { videoKinds } from "@douga/video/authoring";
import { videoResourceLimits } from "@douga/video/resource-limits";
export const videoDesignSchema = settingsSchema.pick({ typography: true, motion: true, backdrop: true })
  .extend(compositionSettingsSchema.pick({ accent: true, palette: true }).shape).strict();
export const createStudioProjectFromIntentSchema = z.object({
  kind: z.enum(videoKinds), subject: z.enum(["characters", "anime", "music"]).optional(),
  format: z.enum(["wide", "vertical", "square"]).default("wide"),
  title: z.string().max(200).optional(), sourceId: z.string().min(1).max(200).optional(),
  roundCount: z.number().int().min(0).max(videoResourceLimits.maxExpandedScenes).optional(),
  cardsPerRound: z.number().int().min(1).max(videoResourceLimits.maxExpandedNodes).optional(),
  design: videoDesignSchema.optional(), idempotencyKey: z.string().min(1).max(200).optional(),
}).strict().refine(v => !v.sourceId || v.kind === "top", { message: "A tournament source requires kind top", path: ["sourceId"] });
export type CreateStudioProjectFromIntentInput = z.input<typeof createStudioProjectFromIntentSchema>;
