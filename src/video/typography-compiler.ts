import type { MotionSettings } from "./motion-types";
import type {
  CardStyle,
  CompiledNode,
  CompiledScene,
  CompiledVideo,
  Settings,
  VideoFormat,
} from "./types";
import type { CompileContext } from "./context";
import { diagnostic } from "./context";
import { getTypographySettingLayers } from "./settings";
import { getFontFace, supportsFontFace } from "./font-manifest";
import {
  getTypographyStyle,
  getTypographyTheme,
  typographyReadableMinima,
} from "./typography-catalog";
import {
  layoutTypographyText,
  normalizeTextPadding,
} from "./typography-layout";
import { graphemes } from "./typography-schema";
import type {
  MeasureText,
  ResolvedTextRun,
  ResolvedTypography,
  TextTypography,
  TypographyRole,
} from "./typography-types";

export const DEFAULT_TYPOGRAPHY: ResolvedTypography = {
  role: "title",
  font: "arimo",
  weight: 700,
  italic: false,
  fontSize: 48,
  minFontSize: 18,
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "center",
  verticalAlign: "middle",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  maxLines: 2,
  wrap: "word",
  fit: "shrink",
  overflow: "error",
  balance: false,
  language: "auto",
  fill: "#ffffff",
  gradient: null,
  outlines: [],
  shadows: [],
  plate: null,
  decoration: "none",
};
interface AuthoredTypography {
  settings: Settings;
  own?: TextTypography | null;
  legacy?: CardStyle;
  role?: TypographyRole;
  runs?: ResolvedTextRun[];
  motion?: MotionSettings;
}
const authored = new WeakMap<CompiledNode, AuthoredTypography>();
export function setNodeTypography(
  node: CompiledNode,
  settings: Settings,
  own?: TextTypography | null,
  role?: TypographyRole,
  legacy?: CardStyle,
  runs?: ResolvedTextRun[],
  motion?: MotionSettings,
): void {
  authored.set(node, { settings, own, role, legacy, runs, motion });
}
export function copyNodeTypography(from: CompiledNode, to: CompiledNode): void {
  const source = authored.get(from);
  if (source) authored.set(to, source);
}
export function semanticTypographyRole(node: CompiledNode): TypographyRole {
  if (node.type === "card" || node.type === "group") return "label";
  if (node.type === "timer") return "timer";
  if (node.type === "versus") return "badge";
  if (node.type === "badge")
    return node.badge?.kind === "rank" ? "rank" : "badge";
  if (node.type === "progress") return "caption";
  if (/(?:^|\/)prompt(?:\/|$)/.test(node.id)) return "prompt";
  if (/(?:^|\/)title(?:\/|$)/.test(node.id)) return "title";
  if (/(?:comment|axis)/.test(node.id)) return "caption";
  if (/slot-label/.test(node.id)) return "label";
  if (/budget/.test(node.id)) return "rank";
  return "title";
}
function applyTextStyle(
  base: ResolvedTypography,
  patch: TextTypography | undefined | null,
): ResolvedTypography {
  if (!patch) return base;
  const preset = patch.preset
    ? getTypographyStyle(patch.preset)?.style
    : undefined;
  const expanded: TextTypography = preset
    ? {
        gradient: null,
        outlines: null,
        shadows: null,
        plate: null,
        ...preset,
        ...patch,
      }
    : patch;
  const {
    preset: _preset,
    padding,
    outlines,
    shadows,
    ...properties
  } = expanded;
  return {
    ...base,
    ...properties,
    padding:
      padding === undefined
        ? base.padding
        : typeof padding === "number"
          ? normalizeTextPadding(padding)
          : { ...base.padding, ...padding },
    outlines: outlines === undefined ? base.outlines : (outlines ?? []),
    shadows: shadows === undefined ? base.shadows : (shadows ?? []),
  };
}
/** Resolves each authored scope in order; implicit DEFAULT_SETTINGS never become overrides. */
export function resolveTypography(
  settings: Settings,
  role: TypographyRole,
  own?: TextTypography | null,
  legacy?: CardStyle,
  rich = false,
  format: VideoFormat = "wide",
): ResolvedTypography | undefined {
  const initial = () => ({
    ...DEFAULT_TYPOGRAPHY,
    role,
    minFontSize: typographyReadableMinima[format][role] as number,
    padding: { ...DEFAULT_TYPOGRAPHY.padding },
  });
  let style = initial(),
    enabled = false;
  let savedLegacy: CardStyle = {};
  let explicitMinimum = own?.minFontSize !== undefined;
  for (const layer of getTypographySettingLayers(settings)) {
    if (layer.card?.fontSize !== undefined)
      savedLegacy.fontSize = layer.card.fontSize;
    if (layer.card?.color !== undefined) savedLegacy.color = layer.card.color;
    const t = layer.typography;
    if (t === null) {
      enabled = false;
      style = initial();
      continue;
    }
    if (t) {
      explicitMinimum ||=
        t.defaults?.minFontSize !== undefined ||
        t.roles?.[role]?.minFontSize !== undefined;
      const activating = !enabled;
      enabled = true;
      if (t.theme)
        style = applyTextStyle(style, getTypographyTheme(t.theme)?.roles[role]);
      if (
        activating
          ? savedLegacy.fontSize !== undefined
          : layer.card?.fontSize !== undefined
      )
        style.fontSize = (activating ? savedLegacy : layer.card)!.fontSize!;
      if (
        activating
          ? savedLegacy.color !== undefined
          : layer.card?.color !== undefined
      )
        style.fill = (activating ? savedLegacy : layer.card)!.color!;
      if (t.defaults === null) {
        enabled = false;
        continue;
      }
      style = applyTextStyle(style, t.defaults);
      const r = t.roles?.[role];
      if (r === null) {
        enabled = false;
        continue;
      }
      style = applyTextStyle(style, r);
    } else if (enabled) {
      // Only fields authored at this deeper scope should override inherited typography.
      if (layer.card?.fontSize !== undefined)
        style.fontSize = layer.card.fontSize;
      if (layer.card?.color !== undefined) style.fill = layer.card.color;
    }
  }
  if (own === null) return;
  if (own !== undefined || rich) {
    if (!enabled) {
      if (savedLegacy.fontSize !== undefined)
        style.fontSize = savedLegacy.fontSize;
      if (savedLegacy.color !== undefined) style.fill = savedLegacy.color;
    }
    enabled = true;
  }
  if (legacy?.fontSize !== undefined) style.fontSize = legacy.fontSize;
  if (legacy?.color !== undefined) style.fill = legacy.color;
  style = applyTextStyle(style, own);
  if (!enabled) return;
  if (!explicitMinimum)
    style.minFontSize = Math.min(style.minFontSize, style.fontSize);
  return style;
}
function textOf(node: CompiledNode): string | undefined {
  if (node.type === "card")
    return `${node.showRank && node.rank !== undefined ? `#${node.rank} ` : ""}${node.label ?? ""}`;
  if (node.type === "group") return node.label ?? node.text ?? "";
  if (node.type === "versus") return "VS";
  if (node.type === "timer") return "0";
  if (node.type === "progress") return "100%";
  return node.text;
}
function textBox(node: CompiledNode): CompiledNode["rect"] {
  if (node.type === "card")
    return {
      x: 10,
      y: node.rect.height * 0.5,
      width: Math.max(0, node.rect.width - 20),
      height: Math.max(0, node.rect.height * 0.5 - 10),
    };
  if (node.type === "group")
    return {
      x: 12,
      y: 12,
      width: Math.max(0, node.rect.width - 24),
      height: Math.max(0, node.rect.height * 0.14 - 12),
    };
  return { x: 0, y: 0, width: node.rect.width, height: node.rect.height };
}
function reserveDynamic(
  node: CompiledNode,
  style: ResolvedTypography,
  measure: MeasureText,
  fps: number,
): string | undefined {
  const metadata = authored.get(node),
    motions = { ...metadata?.settings.motion, ...metadata?.motion };
  const counter = Object.values(motions).some(
    (v) =>
      v === "text-counter" ||
      (v && typeof v === "object" && "name" in v && v.name === "text-counter"),
  );
  if (
    counter &&
    ["text", "badge"].includes(node.type) &&
    /^\s*[-+]?\d+\s*$/.test(node.text ?? "")
  ) {
    const target = Number(node.text),
      max = Math.abs(target);
    let text = "0",
      width = -1;
    if (max <= 10000) {
      for (let i = 0; i <= max; i++) {
        const candidate = String(target < 0 ? -i : i),
          value = measure(candidate, style).width;
        if (value > width) {
          text = candidate;
          width = value;
        }
      }
    } else {
      let digit = "0";
      for (let i = 0; i < 10; i++)
        if (measure(String(i), style).width > measure(digit, style).width)
          digit = String(i);
      text = (target < 0 ? "-" : "") + digit.repeat(String(max).length);
    }
    return text;
  }
  if (counter && ["text", "badge"].includes(node.type)) {
    let digit = "0";
    for (let i = 0; i < 10; i++)
      if (measure(String(i), style).width > measure(digit, style).width)
        digit = String(i);
    return (node.text ?? "").replace(/\d/g, digit);
  }
  if (node.type !== "timer" && node.type !== "progress") return;
  const max =
    node.type === "timer"
      ? Math.max(
          0,
          Math.ceil((node.timerFrames ?? node.durationInFrames) / fps),
        )
      : 100;
  let text = "0",
    width = -1;
  if (max <= 10000) {
    for (let i = 0; i <= max; i++) {
      const candidate = `${i}${node.type === "progress" ? "%" : ""}`,
        value = measure(candidate, style).width;
      if (value > width) {
        text = candidate;
        width = value;
      }
    }
  } else {
    let digit = "0";
    for (let i = 0; i < 10; i++)
      if (measure(String(i), style).width > measure(digit, style).width)
        digit = String(i);
    text = digit.repeat(String(max).length);
  }
  return text;
}
function groupSignature(s: ResolvedTypography): string {
  return JSON.stringify([
    s.font,
    s.weight,
    s.italic,
    s.minFontSize,
    s.lineHeight,
    s.letterSpacing,
    s.wrap,
    s.fit,
    s.maxLines,
    s.padding,
    s.outlines,
    s.shadows,
    s.plate,
  ]);
}
/** Called after semantic nodes and motion widgets exist, before serializing IR. */
export function applySceneTypography(
  ctx: CompileContext,
  scene: CompiledScene,
  settings: Settings,
): void {
  const groups = new Map<string, CompiledNode[]>(),
    dynamic = new Map<CompiledNode, string>(),
    boxes = new Map<CompiledNode, ReturnType<typeof textBox>>();
  for (const node of scene.nodes) {
    if (
      ![
        "text",
        "card",
        "group",
        "timer",
        "badge",
        "versus",
        "progress",
      ].includes(node.type)
    )
      continue;
    const metadata = authored.get(node),
      role =
        metadata?.own?.role ?? metadata?.role ?? semanticTypographyRole(node);
    const style = resolveTypography(
      metadata?.settings ?? settings,
      role,
      metadata?.own,
      metadata?.legacy,
      !!metadata?.runs,
      ctx.document.output.format,
    );
    if (!style) continue;
    node.typography = style;
    const runs = metadata?.runs
      ? node.type === "card" && node.showRank && node.rank !== undefined
        ? [{ text: `#${node.rank} ` }, ...metadata.runs]
        : metadata.runs
      : [{ text: textOf(node) ?? "" }];
    node.textRuns = runs;
    const path = `nodes.${node.id}.typography`;
    if (style.minFontSize > style.fontSize) {
      diagnostic(
        ctx,
        "TEXT_SIZE_RANGE_INVALID",
        "minFontSize must not exceed fontSize.",
        path,
        node.id,
      );
      continue;
    }
    if (
      graphemes(runs.map((r) => r.text).join("")).length > 10000 ||
      runs.length > 100
    ) {
      diagnostic(
        ctx,
        "TEXT_BUDGET_EXCEEDED",
        "Text exceeds 10000 graphemes or 100 runs.",
        path,
        node.id,
      );
      continue;
    }
    const invalid = [
      style,
      ...runs.map((r) => ({
        ...style,
        weight: r.weight ?? style.weight,
        italic: r.italic ?? style.italic,
      })),
    ].some((s) => !supportsFontFace(s.font, s.weight, s.italic));
    if (invalid) {
      diagnostic(
        ctx,
        "FONT_FACE_UNSUPPORTED",
        "The packaged font does not provide this weight/italic face.",
        path,
        node.id,
      );
      continue;
    }
    const measure = ctx.measureText;
    if (!measure) {
      diagnostic(
        ctx,
        "TEXT_LAYOUT_REQUIRED",
        "Typography requires the real text measurement provider.",
        path,
        node.id,
      );
      continue;
    }
    try {
      const reserve = reserveDynamic(node, style, measure, ctx.fps);
      const measuringRuns = reserve ? [{ text: reserve }] : runs;
      if (reserve) dynamic.set(node, reserve);
      const box = textBox(node);
      boxes.set(node, box);
      node.textLayout = layoutTypographyText(
        measuringRuns,
        style,
        box,
        measure,
      );
      node.textLayout.rect.x += box.x;
      node.textLayout.rect.y += box.y;
      if (reserve) node.textLayout.reservedText = reserve;
      let key: string | undefined;
      if (
        style.fitGroup === undefined &&
        node.type === "card" &&
        (scene.kind === "picker" || scene.kind === "answer")
      )
        key = `auto:${groupSignature(style)}`;
      if (key) {
        const members = groups.get(key) ?? [];
        members.push(node);
        groups.set(key, members);
      }
    } catch (error) {
      diagnostic(
        ctx,
        "TEXT_MEASUREMENT_FAILED",
        error instanceof Error ? error.message : "Text measurement failed.",
        path,
        node.id,
      );
    }
  }
  for (const members of groups.values()) {
    if (
      new Set(members.map((n) => groupSignature(n.typography!))).size > 1 ||
      members.some((n) => n.typography?.fit !== "shrink")
    ) {
      diagnostic(
        ctx,
        "TEXT_FIT_GROUP_INCOMPATIBLE",
        "Fit groups require compatible font, metrics, effects and shrink policies.",
        `nodes.${members[0].id}.typography.fitGroup`,
        members[0].id,
      );
      continue;
    }
    const size = Math.min(...members.map((n) => n.textLayout!.fontSize));
    for (const node of members) {
      const box = boxes.get(node)!;
      node.textLayout = layoutTypographyText(
        dynamic.has(node) ? [{ text: dynamic.get(node)! }] : node.textRuns!,
        node.typography!,
        box,
        ctx.measureText!,
        size,
      );
      node.textLayout.rect.x += box.x;
      node.textLayout.rect.y += box.y;
      if (dynamic.has(node)) node.textLayout.reservedText = dynamic.get(node);
    }
  }
  for (const node of scene.nodes) {
    if (!node.textLayout) continue;
    node.typography!.fontSize = node.textLayout.fontSize;
    if (node.textLayout.overflow && node.typography!.overflow === "error")
      diagnostic(
        ctx,
        "TEXT_OVERFLOW",
        "Text does not fit at the readable minimum. Enlarge its box or explicitly choose ellipsis/clip.",
        `nodes.${node.id}.typography`,
        node.id,
      );
    if (node.textLayout.overflow && node.typography!.overflow !== "error")
      diagnostic(
        ctx,
        node.typography!.overflow === "ellipsis"
          ? "TEXT_TRUNCATED"
          : "TEXT_CLIPPED",
        "The explicit overflow policy permits text truncation or clipping.",
        `nodes.${node.id}.typography`,
        node.id,
        "warning",
      );
    if (node.textLayout.missing.length)
      diagnostic(
        ctx,
        "FONT_GLYPH_MISSING",
        `No packaged font covers: ${node.textLayout.missing.slice(0, 20).join(" ")}`,
        `nodes.${node.id}.text`,
        node.id,
      );
  }
}
/** Explicit names join comparable boxes in one compiled segment, across scenes.
 * Automatic picker groups remain round-local. */
export function fitSegmentTypographyGroups(
  ctx: CompileContext,
  scenes: CompiledScene[],
): void {
  const groups = new Map<string, CompiledNode[]>();
  for (const scene of scenes)
    for (const node of scene.nodes) {
      if (!node.typography?.fitGroup || !node.textLayout) continue;
      const key = node.typography.fitGroup,
        members = groups.get(key) ?? [];
      members.push(node);
      groups.set(key, members);
    }
  for (const members of groups.values()) {
    if (
      new Set(members.map((n) => groupSignature(n.typography!))).size > 1 ||
      members.some((n) => n.typography?.fit !== "shrink")
    ) {
      diagnostic(
        ctx,
        "TEXT_FIT_GROUP_INCOMPATIBLE",
        "Fit groups require compatible font, metrics, effects and shrink policies.",
        `nodes.${members[0].id}.typography.fitGroup`,
        members[0].id,
      );
      continue;
    }
    const size = Math.min(...members.map((n) => n.textLayout!.fontSize));
    for (const node of members) {
      const box = textBox(node),
        reserve = node.textLayout!.reservedText;
      node.textLayout = layoutTypographyText(
        reserve ? [{ text: reserve }] : node.textRuns!,
        node.typography!,
        box,
        ctx.measureText!,
        size,
      );
      node.textLayout.rect.x += box.x;
      node.textLayout.rect.y += box.y;
      if (reserve) node.textLayout.reservedText = reserve;
      node.typography!.fontSize = size;
      for (const motion of node.motion ?? [])
        if (motion.name === "text-lines")
          motion.fragments = node.textLayout.lines.length;
    }
  }
}
export function collectTypographyFonts(plan: CompiledVideo): void {
  const ids = [
    ...new Set(
      plan.scenes.flatMap((s) =>
        s.nodes.flatMap((n) => n.textLayout?.fonts ?? []),
      ),
    ),
  ].sort();
  if (ids.length)
    plan.fonts = ids
      .map((id) => {
        const face = getFontFace(id);
        return face ? { ...face } : undefined;
      })
      .filter((face): face is NonNullable<typeof face> => !!face);
}
