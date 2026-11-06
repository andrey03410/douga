import type { BackgroundGradient, Rect } from "./types";

export const fontIds = [
  "arimo",
  "manrope",
  "oswald",
  "rubik",
  "roboto-mono",
  "noto-sans-jp",
  "noto-serif-jp",
] as const;
export type FontId = (typeof fontIds)[number];
export const typographyStyleIds = [
  "clean-title",
  "compact-label",
  "anime-outline",
  "manga-impact",
  "neon-glow",
  "cinematic-title",
  "jp-title",
  "soft-caption",
  "subtitle-safe",
  "rank-display",
  "timer-digits",
  "badge-label",
] as const;
export type TypographyStyleId = (typeof typographyStyleIds)[number];
export const typographyThemeIds = [
  "clean",
  "anime-impact",
  "cinematic",
  "neon",
  "manga",
  "soft",
] as const;
export type TypographyThemeId = (typeof typographyThemeIds)[number];
export const typographyRoles = [
  "title",
  "subtitle",
  "label",
  "prompt",
  "rank",
  "timer",
  "badge",
  "caption",
] as const;
export type TypographyRole = (typeof typographyRoles)[number];
export type TextDecoration = "none" | "underline" | "line-through";
export interface TextOutline {
  color: string;
  width: number;
}
export interface TextShadow {
  color: string;
  x?: number;
  y?: number;
  blur?: number;
}
export interface TextPlate {
  color: string;
  padding?: number;
  borderRadius?: number;
}
export interface TextPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
/** Declarative values only. A null effect removes an inherited effect. */
export interface TextTypography {
  role?: TypographyRole;
  preset?: TypographyStyleId;
  font?: FontId;
  weight?: 400 | 700;
  italic?: boolean;
  fontSize?: number;
  minFontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  padding?: number | Partial<TextPadding>;
  maxLines?: number;
  wrap?: "word" | "char" | "none";
  fit?: "shrink" | "fixed";
  overflow?: "error" | "ellipsis" | "clip";
  balance?: boolean;
  fitGroup?: string | null;
  language?: "auto" | "ru" | "en" | "ja";
  fill?: string;
  gradient?: BackgroundGradient | null;
  outlines?: TextOutline[] | null;
  shadows?: TextShadow[] | null;
  plate?: TextPlate | null;
  decoration?: TextDecoration;
}
export interface TypographySettings {
  version?: 1;
  theme?: TypographyThemeId;
  defaults?: TextTypography | null;
  roles?: Partial<Record<TypographyRole, TextTypography | null>>;
}
export interface ResolvedTypography {
  role: TypographyRole;
  font: FontId;
  weight: 400 | 700;
  italic: boolean;
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  padding: TextPadding;
  maxLines: number;
  wrap: "word" | "char" | "none";
  fit: "shrink" | "fixed";
  overflow: "error" | "ellipsis" | "clip";
  balance: boolean;
  fitGroup?: string | null;
  language: "auto" | "ru" | "en" | "ja";
  fill: string;
  gradient: BackgroundGradient | null;
  outlines: TextOutline[];
  shadows: TextShadow[];
  plate: TextPlate | null;
  decoration: TextDecoration;
}
export interface ResolvedTextRun {
  text: string;
  color?: string;
  weight?: 400 | 700;
  italic?: boolean;
  decoration?: TextDecoration;
}
export interface TextMeasurement {
  width: number;
  fonts: string[];
  missing: string[];
}
export type MeasureText = (
  text: string,
  style: ResolvedTypography,
) => TextMeasurement;
export interface TypographyCompileOptions {
  measureText?: MeasureText;
}
export interface CompiledTextRun extends ResolvedTextRun {
  width: number;
  x: number;
  fonts: string[];
}
export interface CompiledTextLine {
  text: string;
  width: number;
  x: number;
  y: number;
  runs: CompiledTextRun[];
}
export interface CompiledTextLayout {
  /** All geometry is in pixels relative to the owning node. lineHeight is pixels. */
  fontSize: number;
  lineHeight: number;
  rect: Rect;
  lines: CompiledTextLine[];
  overflow: boolean;
  truncated: boolean;
  fonts: string[];
  missing: string[];
  /** Dynamic digits are fitted once using the widest possible value. */
  reservedText?: string;
}
/** Name used by server adapters. */
export type TextMeasureProvider = MeasureText;
