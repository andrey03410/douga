import type {
  TextTypography,
  TypographyRole,
  TypographyStyleId,
  TypographyThemeId,
} from "./typography-types";
export const typographyCatalogVersion = 1;
export interface TypographyStyleEntry {
  id: TypographyStyleId;
  name: string;
  description: string;
  style: TextTypography;
}
export const typographyStyles: TypographyStyleEntry[] = [
  {
    id: "clean-title",
    name: "Чистый заголовок",
    description: "Крупный Manrope с ясной иерархией",
    style: {
      font: "manrope",
      weight: 700,
      fontSize: 72,
      lineHeight: 1.15,
      letterSpacing: 0.2,
      balance: true,
    },
  },
  {
    id: "compact-label",
    name: "Компактная подпись",
    description: "Плотный Oswald для длинных имён",
    style: {
      font: "oswald",
      weight: 700,
      fontSize: 36,
      lineHeight: 1.12,
      maxLines: 2,
    },
  },
  {
    id: "anime-outline",
    name: "Аниме-контур",
    description: "Rubik с контрастной обводкой и короткой тенью",
    style: {
      font: "rubik",
      weight: 700,
      fontSize: 48,
      fill: "#ffffff",
      outlines: [{ color: "#121528", width: 3 }],
      shadows: [{ color: "#121528", x: 3, y: 4, blur: 0 }],
    },
  },
  {
    id: "manga-impact",
    name: "Манга-акцент",
    description: "Двойная обводка и жёсткая тень",
    style: {
      font: "oswald",
      weight: 700,
      fontSize: 64,
      fill: "#ffffff",
      outlines: [
        { color: "#ffffff", width: 5 },
        { color: "#111111", width: 2 },
      ],
      shadows: [{ color: "#111111", x: 5, y: 5, blur: 0 }],
    },
  },
  {
    id: "neon-glow",
    name: "Неоновое свечение",
    description: "Яркая надпись с двумя ограниченными тенями",
    style: {
      font: "rubik",
      weight: 700,
      fontSize: 56,
      fill: "#e5fffe",
      shadows: [
        { color: "#46e9e2", blur: 6 },
        { color: "#a855f7", blur: 12 },
      ],
    },
  },
  {
    id: "cinematic-title",
    name: "Кинотитр",
    description: "Выразительный японский сериф",
    style: {
      font: "noto-serif-jp",
      weight: 700,
      fontSize: 64,
      lineHeight: 1.35,
      letterSpacing: 1.2,
      balance: true,
      fill: "#fff1d6",
    },
  },
  {
    id: "jp-title",
    name: "Японский заголовок",
    description: "Noto Sans JP с полными японскими метриками",
    style: {
      font: "noto-sans-jp",
      weight: 700,
      fontSize: 58,
      lineHeight: 1.35,
      language: "ja",
      wrap: "char",
      balance: true,
    },
  },
  {
    id: "soft-caption",
    name: "Мягкая подпись",
    description: "Спокойный Arimo и ненавязчивая тень",
    style: {
      font: "arimo",
      weight: 400,
      fontSize: 30,
      lineHeight: 1.25,
      fill: "#f0ecfa",
      shadows: [{ color: "#18122588", x: 0, y: 2, blur: 3 }],
    },
  },
  {
    id: "subtitle-safe",
    name: "Читаемый субтитр",
    description: "Светлый текст на ограниченной плашке",
    style: {
      font: "arimo",
      weight: 700,
      fontSize: 32,
      lineHeight: 1.25,
      plate: { color: "#111827dc", padding: 8, borderRadius: 6 },
      padding: 10,
      maxLines: 3,
    },
  },
  {
    id: "rank-display",
    name: "Место в топе",
    description: "Крупные устойчивые цифры",
    style: {
      font: "roboto-mono",
      weight: 700,
      fontSize: 80,
      lineHeight: 1.1,
      wrap: "none",
      maxLines: 1,
      fill: "#ffd166",
    },
  },
  {
    id: "timer-digits",
    name: "Цифры таймера",
    description: "Моноширинный отсчёт с фиксированной геометрией",
    style: {
      font: "roboto-mono",
      weight: 700,
      fontSize: 56,
      lineHeight: 1.1,
      wrap: "none",
      maxLines: 1,
    },
  },
  {
    id: "badge-label",
    name: "Акцентная плашка",
    description: "Компактный Rubik на цветной плашке",
    style: {
      font: "rubik",
      weight: 700,
      fontSize: 28,
      lineHeight: 1.1,
      maxLines: 1,
      plate: { color: "#e44a79", padding: 6, borderRadius: 8 },
      padding: 8,
    },
  },
];
export interface TypographyThemeEntry {
  id: TypographyThemeId;
  name: string;
  description: string;
  roles: Record<TypographyRole, TextTypography>;
}
const roles = (
  title: TypographyStyleId,
  label: TypographyStyleId,
  caption: TypographyStyleId,
  extra: Partial<Record<TypographyRole, TextTypography>> = {},
): Record<TypographyRole, TextTypography> => ({
  title: { preset: title },
  subtitle: { preset: caption, fontSize: 36 },
  label: { preset: label, fontSize: 36 },
  prompt: { preset: title, fontSize: 44, maxLines: 2 },
  rank: { preset: "rank-display" },
  timer: { preset: "timer-digits" },
  badge: { preset: "badge-label" },
  caption: { preset: caption },
  ...extra,
});
export const typographyThemes: TypographyThemeEntry[] = [
  {
    id: "clean",
    name: "Чистая",
    description: "Современные титры и спокойные подписи",
    roles: roles("clean-title", "compact-label", "soft-caption"),
  },
  {
    id: "anime-impact",
    name: "Аниме-акцент",
    description: "Плотные имена, контур и контрастные цифры",
    roles: roles("anime-outline", "anime-outline", "subtitle-safe", {
      title: { preset: "anime-outline", fontSize: 72 },
      prompt: { preset: "anime-outline", fontSize: 44 },
      label: { preset: "anime-outline", fontSize: 38 },
    }),
  },
  {
    id: "cinematic",
    name: "Кино",
    description: "Выразительные смешанные японские титры",
    roles: roles("cinematic-title", "compact-label", "soft-caption", {
      subtitle: { preset: "cinematic-title", fontSize: 32 },
      caption: { preset: "soft-caption", fill: "#e9ddc7" },
    }),
  },
  {
    id: "neon",
    name: "Неон",
    description: "Светящиеся акценты на тёмном фоне",
    roles: roles("neon-glow", "neon-glow", "soft-caption", {
      label: { preset: "neon-glow", fontSize: 34 },
      timer: { preset: "timer-digits", fill: "#65f7e9" },
    }),
  },
  {
    id: "manga",
    name: "Манга",
    description: "Жёсткий контраст и двойной контур",
    roles: roles("manga-impact", "manga-impact", "subtitle-safe", {
      label: { preset: "manga-impact", fontSize: 36 },
      prompt: { preset: "manga-impact", fontSize: 44 },
    }),
  },
  {
    id: "soft",
    name: "Мягкая",
    description: "Спокойное оформление с мягкими подписями",
    roles: roles("clean-title", "soft-caption", "soft-caption", {
      title: { preset: "clean-title", fill: "#eee6ff", fontSize: 64 },
      label: { preset: "soft-caption", fontSize: 34 },
      badge: {
        preset: "badge-label",
        plate: { color: "#746398", padding: 6, borderRadius: 10 },
      },
    }),
  },
];
export const getTypographyStyle = (id: string) =>
  typographyStyles.find((entry) => entry.id === id);
export const getTypographyTheme = (id: string) =>
  typographyThemes.find((entry) => entry.id === id);

import type {
  Settings,
  VideoDocument,
  VideoNode,
  VideoScene,
  VideoSegment,
} from "./types";
export type TypographyScope =
  | { type: "document" }
  | { type: "segment" | "scene" | "node"; id: string };
export interface ApplyTypographyOptions {
  scope?: TypographyScope;
  mode?: "preserve" | "replace";
}
function clearLegacy(
  style: { color?: string; fontSize?: number } | undefined,
): void {
  if (style) {
    delete style.color;
    delete style.fontSize;
  }
}
function clearTypographyScope(scope: unknown): void {
  if (!scope || typeof scope !== "object") return;
  if (Array.isArray(scope)) {
    scope.forEach(clearTypographyScope);
    return;
  }
  const value = scope as Record<string, unknown>;
  delete value.typography;
  if (
    value.card &&
    typeof value.card === "object" &&
    !Array.isArray(value.card)
  )
    clearLegacy(value.card);
  if (value.style && typeof value.style === "object") clearLegacy(value.style);
  for (const [key, child] of Object.entries(value))
    if (key !== "bindings" && key !== "style" && key !== "card")
      clearTypographyScope(child);
}
function findNode(nodes: VideoNode[], id: string): VideoNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "container") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
}
function findScope(
  document: VideoDocument,
  scope: TypographyScope,
): VideoDocument | VideoSegment | VideoScene | VideoNode {
  if (scope.type === "document") return document;
  if (scope.type === "segment") {
    const segment = document.segments?.find((s) => s.id === scope.id);
    if (segment) return segment;
  }
  const scenes = [
    ...document.scenes,
    ...(document.segments ?? []).flatMap((s) => s.scenes),
  ];
  if (scope.type === "scene") {
    const scene = scenes.find((s) => s.id === scope.id);
    if (scene) return scene;
  }
  if (scope.type === "node")
    for (const scene of scenes) {
      const node = findNode(scene.nodes, scope.id);
      if (node) return node;
    }
  throw new Error(`Typography ${scope.type} ${scope.id} not found`);
}
function nodeRole(node: VideoNode): TypographyRole {
  return (
    node.typography?.role ??
    (node.type === "card"
      ? "label"
      : node.type === "timer"
        ? "timer"
        : node.type === "badge" && node.kind === "rank"
          ? "rank"
          : ["versus", "badge"].includes(node.type)
            ? "badge"
            : node.type === "progress"
              ? "caption"
              : "title")
  );
}
/** Keeps source/timing/media intact. Replacement removes only typography overrides
 * contained in the selected scope, including saved legacy color/fontSize values. */
export function applyTypographyTheme(
  document: VideoDocument,
  theme: TypographyThemeId,
  options: ApplyTypographyOptions = {},
): VideoDocument {
  const entry = getTypographyTheme(theme);
  if (!entry) throw new Error(`Unknown typography theme: ${theme}`);
  const result = structuredClone(document),
    scope = options.scope ?? { type: "document" },
    target = findScope(result, scope);
  const role =
    scope.type === "node" ? nodeRole(target as VideoNode) : undefined;
  if (options.mode === "replace") clearTypographyScope(target);
  if (scope.type === "node") {
    const node = target as VideoNode;
    node.typography = {
      ...entry.roles[role!],
      ...(node.typography ?? {}),
      role,
    };
  } else {
    const targetWithSettings = target as { settings?: Settings };
    targetWithSettings.settings ??= {};
    targetWithSettings.settings.typography = {
      ...(targetWithSettings.settings.typography ?? {}),
      version: 1,
      theme,
    };
  }
  return result;
}
export function applyTypographyStyle(
  document: VideoDocument,
  preset: TypographyStyleId,
  options: ApplyTypographyOptions = {},
): VideoDocument {
  if (!getTypographyStyle(preset))
    throw new Error(`Unknown typography style: ${preset}`);
  const result = structuredClone(document),
    scope = options.scope ?? { type: "document" },
    target = findScope(result, scope);
  if (options.mode === "replace") clearTypographyScope(target);
  if (scope.type === "node") {
    const node = target as VideoNode;
    node.typography = { ...(node.typography ?? {}), preset };
  } else {
    const t = target as { settings?: Settings };
    t.settings ??= {};
    t.settings.typography = {
      ...(t.settings.typography ?? {}),
      version: 1,
      defaults: { ...(t.settings.typography?.defaults ?? {}), preset },
    };
  }
  return result;
}

/** Readable factory minima in output pixels; authors may explicitly choose a lower
 * bounded value for a deliberately small annotation. */
export const typographyReadableMinima = {
  wide: {
    title: 24,
    subtitle: 22,
    label: 20,
    prompt: 24,
    rank: 28,
    timer: 24,
    badge: 18,
    caption: 18,
  },
  vertical: {
    title: 22,
    subtitle: 20,
    label: 18,
    prompt: 20,
    rank: 24,
    timer: 24,
    badge: 16,
    caption: 16,
  },
  square: {
    title: 22,
    subtitle: 20,
    label: 18,
    prompt: 20,
    rank: 24,
    timer: 22,
    badge: 16,
    caption: 16,
  },
} as const;
