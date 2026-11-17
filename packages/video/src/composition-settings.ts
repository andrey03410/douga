import { z } from "zod";
import { typographyColorSchema } from "./typography-schema";

export const compositionVariants = ["portrait-top", "music-top", "picker", "tier-list"] as const;
export const compositionSettingsSchema = z.object({
  version: z.literal(1),
  variant: z.enum(compositionVariants),
  accent: typographyColorSchema.optional(),
  palette: z.array(typographyColorSchema).min(1).max(8).optional(),
}).strict();
export type CompositionSettings = z.infer<typeof compositionSettingsSchema>;
