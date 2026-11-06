import { z } from "zod";
import {
  fontIds,
  typographyRoles,
  typographyStyleIds,
  typographyThemeIds,
} from "./typography-types";
export const typographyColorSchema = z
  .string()
  .regex(
    /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% +\/-]+\)|transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|navy|teal|cyan|magenta|currentColor)$/,
    "Use a safe color, never CSS or a URL",
  );
const num = z.number().finite();
const color = typographyColorSchema;
const padding = num.min(0).max(256);
const stops = z
  .array(z.object({ color, at: num.min(0).max(1) }).strict())
  .min(2)
  .max(12)
  .refine(
    (s) => s.every((v, i) => !i || v.at >= s[i - 1].at),
    "Order gradient stops",
  );
const gradient = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("linear"),
      angle: num.min(-360).max(360).optional(),
      stops,
    })
    .strict(),
  z
    .object({
      type: z.literal("radial"),
      center: z
        .object({ x: num.min(0).max(1), y: num.min(0).max(1) })
        .strict()
        .optional(),
      stops,
    })
    .strict(),
]);
export const textTypographySchema = z
  .object({
    role: z.enum(typographyRoles).optional(),
    preset: z.enum(typographyStyleIds).optional(),
    font: z.enum(fontIds).optional(),
    weight: z.union([z.literal(400), z.literal(700)]).optional(),
    italic: z.boolean().optional(),
    fontSize: num.min(12).max(400).optional(),
    minFontSize: num.min(12).max(400).optional(),
    lineHeight: num.min(0.8).max(3).optional(),
    letterSpacing: num.min(-8).max(40).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    padding: z
      .union([
        padding,
        z
          .object({
            top: padding.optional(),
            right: padding.optional(),
            bottom: padding.optional(),
            left: padding.optional(),
          })
          .strict(),
      ])
      .optional(),
    maxLines: num.int().min(1).max(12).optional(),
    wrap: z.enum(["word", "char", "none"]).optional(),
    fit: z.enum(["shrink", "fixed"]).optional(),
    overflow: z.enum(["error", "ellipsis", "clip"]).optional(),
    balance: z.boolean().optional(),
    fitGroup: z.string().min(1).max(120).nullable().optional(),
    language: z.enum(["auto", "ru", "en", "ja"]).optional(),
    fill: color.optional(),
    gradient: gradient.nullable().optional(),
    outlines: z
      .array(z.object({ color, width: num.min(0).max(32) }).strict())
      .max(2)
      .nullable()
      .optional(),
    shadows: z
      .array(
        z
          .object({
            color,
            x: num.min(-80).max(80).optional(),
            y: num.min(-80).max(80).optional(),
            blur: num.min(0).max(80).optional(),
          })
          .strict(),
      )
      .max(2)
      .nullable()
      .optional(),
    plate: z
      .object({
        color,
        padding: padding.optional(),
        borderRadius: num.min(0).max(200).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    decoration: z.enum(["none", "underline", "line-through"]).optional(),
  })
  .strict();
export const typographySettingsSchema = z
  .object({
    version: z.literal(1).optional(),
    theme: z.enum(typographyThemeIds).optional(),
    defaults: textTypographySchema.nullable().optional(),
    roles: z
      .object(
        Object.fromEntries(
          typographyRoles.map((role) => [
            role,
            textTypographySchema.nullable().optional(),
          ]),
        ) as Record<
          (typeof typographyRoles)[number],
          z.ZodOptional<z.ZodNullable<typeof textTypographySchema>>
        >,
      )
      .strict()
      .optional(),
  })
  .strict();
export function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
}
export const boundedTextSchema = z
  .string()
  .max(200000)
  .refine((s) => graphemes(s).length <= 10000, "Text exceeds 10000 graphemes");
