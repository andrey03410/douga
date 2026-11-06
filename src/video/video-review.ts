import type {
  CompiledNode,
  CompiledScene,
  CompiledVideo,
  Diagnostic,
  PatchOperation,
  PatchTarget,
  Rect,
  Settings,
  VideoDocument,
  VideoNode,
  VideoScene,
  Window,
} from "./types";
import type { TextTypography } from "./typography-types";
import { patchVideoDocument } from "./patches";
import { mergeSettings } from "./settings";
import { selectStoryboard } from "./storyboard";
import { getTypographyTheme } from "./typography-catalog";
import { supportsFontFace } from "./font-manifest";

export type VideoPatchOperation = PatchOperation;
export interface VideoReviewProfile {
  /** Explicit output-specific pixel rectangle; there is no universal social safe area. */
  safeArea?: Rect;
  minReadableSec?: number;
  charactersPerSecond?: number;
}
export type VideoReviewSeverity = "error" | "warning" | "info";
export interface VideoReviewIssue {
  id: string;
  code: string;
  severity: VideoReviewSeverity;
  sceneId?: string;
  segmentId?: string;
  nodeId?: string;
  frame?: number;
  message: string;
  evidence: { rule: string; limitation?: string; [key: string]: unknown };
  suggestionIds?: string[];
  nextAction?: {
    type: "text_inspect" | "clip";
    sceneId?: string;
    nodeId?: string;
    frame?: number;
    reason: string;
  };
}
export interface VideoReviewCheck {
  id:
    | "layout"
    | "textSafeArea"
    | "readableWindow"
    | "motion"
    | "audio"
    | "contrast";
  code:
    | "layout"
    | "textSafeArea"
    | "readableWindow"
    | "motion"
    | "audio"
    | "contrast";
  status: "passed" | "warning" | "error" | "notChecked" | "notApplicable";
  mode: "static-plan";
  examinedScenes: string[];
  /** Representative frames only; this does not claim a rendered-frame examination. */
  examinedFrames: number[];
  reason?: string;
}
export interface VideoReviewSuggestion {
  id: string;
  kind: "compact-label" | "subtitle-plate" | "return-label-theme";
  title: string;
  risk: "low";
  issueIds: string[];
  operations: VideoPatchOperation[];
  affectedScenes: string[];
  overrides: string[];
  requiresRecheck: true;
}
export interface VideoReviewReport {
  issues: VideoReviewIssue[];
  checks: VideoReviewCheck[];
  coverage: {
    mode: "static-plan";
    totalScenes: number;
    examinedScenes: number;
    examinedFrames: number[];
    measuredTextNodes: number;
    unmeasuredTextNodes: number;
    complete: false;
  };
  suggestions: VideoReviewSuggestion[];
}
const inWindow = (w: Window, f: number) => w.from <= f && f < w.to;
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
const textOf = (n: CompiledNode) =>
  n.textRuns?.map((r) => r.text).join("") ?? n.text ?? n.label ?? "";
const hasText = (n: CompiledNode) =>
  !!textOf(n).trim() && !["timer", "progress", "versus"].includes(n.type);
function intersect(a: Window[], b: Window[]): Window[] {
  return a.flatMap((x) =>
    b
      .map((y) => ({
        from: Math.max(x.from, y.from),
        to: Math.min(x.to, y.to),
      }))
      .filter((w) => w.from < w.to),
  );
}
function subtract(windows: Window[], gap: Window): Window[] {
  return windows.flatMap((w) =>
    gap.to <= w.from || gap.from >= w.to
      ? [w]
      : [
          { from: w.from, to: Math.min(w.to, gap.from) },
          { from: Math.max(w.from, gap.to), to: w.to },
        ].filter((w) => w.from < w.to),
  );
}
function textWindows(
  n: CompiledNode,
  s: CompiledScene,
  ancestors = new Set<string>(),
): Window[] {
  if (n.opacity <= 0 || ancestors.has(n.id)) return [];
  let windows = intersect(n.visible, [
    {
      from: Math.max(0, n.from),
      to: Math.min(s.durationInFrames, n.from + n.durationInFrames),
    },
  ]);
  if (n.type === "card") windows = intersect(windows, n.labelWindows ?? []);
  if (n.parentId) {
    const parent = s.nodes.find((p) => p.id === n.parentId);
    if (!parent) return [];
    ancestors.add(n.id);
    windows = intersect(windows, textWindows(parent, s, ancestors));
  }
  return windows;
}
function stableTextWindows(n: CompiledNode, s: CompiledScene): Window[] {
  let windows = textWindows(n, s);
  const ancestors = [n],
    visited = new Set<string>([n.id]);
  for (let parentId = n.parentId; parentId; ) {
    const parent = s.nodes.find((p) => p.id === parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  for (const node of ancestors) {
    for (const m of node.motion ?? [])
      windows = subtract(windows, {
        from: Math.max(m.from, m.window.from),
        to:
          m.channel === "loop"
            ? m.window.to
            : Math.min(m.from + m.durationInFrames, m.window.to),
      });
    for (const a of node.animation)
      if (
        a.keyframes.length > 1 &&
        a.keyframes.some((k) => k.value !== a.keyframes[0].value)
      )
        windows = subtract(windows, {
          from: node.from + a.keyframes[0].frame,
          to: node.from + a.keyframes.at(-1)!.frame,
        });
  }
  const transition = Math.min(
    s.transition.durationInFrames,
    ["fade", "slide"].includes(s.transition.type)
      ? s.durationInFrames / 2
      : s.durationInFrames,
  );
  if (s.transition.type !== "none" && transition > 0) {
    windows = subtract(windows, { from: 0, to: transition });
    if (["fade", "slide"].includes(s.transition.type))
      windows = subtract(windows, {
        from: s.durationInFrames - transition,
        to: s.durationInFrames,
      });
  }
  return windows;
}
interface AuthoringTarget {
  target: PatchTarget;
  path: string[];
  own?: TextTypography | null;
  settings: Settings;
  legacy?: VideoNode["style"];
  parentTypography: boolean;
}
/** No decoding guesses: authored nodes must match the compiler's full generated suffix
 * in their own scene, occur once in the plan and have no repeating container ancestor. */
function authoringTargets(
  plan: CompiledVideo,
  document: VideoDocument,
): Map<CompiledNode, AuthoringTarget> {
  const result = new Map<CompiledNode, AuthoringTarget>();
  const all = plan.scenes.flatMap((s) => s.nodes.map((n) => ({ s, n })));
  const byNodeSuffix = new Map<string, typeof all>();
  const participantCards = new Map<string, number>();
  for (const entry of all) {
    const marker = entry.n.id.lastIndexOf("/node/");
    if (marker >= 0) {
      const suffix = entry.n.id.slice(marker + 6);
      const values = byNodeSuffix.get(suffix) ?? [];
      values.push(entry);
      byNodeSuffix.set(suffix, values);
    }
    if (entry.n.type === "card" && entry.n.participantId)
      participantCards.set(
        entry.n.participantId,
        (participantCards.get(entry.n.participantId) ?? 0) + 1,
      );
  }
  const visitScene = (
    authored: VideoScene,
    segmentId?: string,
    segmentSettings?: Settings,
  ) => {
    const base = encodeURIComponent(authored.id);
    const settings = mergeSettings(
      document.settings,
      document.formatSettings?.[document.output.format],
      segmentSettings,
      authored.settings,
    );
    const visit = (
      nodes: VideoNode[],
      repeated = false,
      parentTypography = false,
    ) =>
      nodes.forEach((node) => {
        const matches = (
          byNodeSuffix.get(encodeURIComponent(node.id)) ?? []
        ).filter(
          ({ s, n }) =>
            s.segmentId === segmentId &&
            (s.id === base || s.id.startsWith(`${base}/`)) &&
            n.id === `${s.id}/node/${encodeURIComponent(node.id)}`,
        );
        if (
          !repeated &&
          matches.length === 1 &&
          node.type !== "container" &&
          node.type !== "audio"
        )
          result.set(matches[0].n, {
            target: { type: "node", id: node.id },
            path: ["typography"],
            own: node.typography,
            settings,
            legacy: node.style,
            parentTypography,
          });
        if (node.type === "container")
          visit(
            node.children,
            repeated || node.repeat === "participants",
            parentTypography ||
              node.typography !== undefined ||
              node.style?.fontSize !== undefined ||
              node.style?.color !== undefined,
          );
      });
    visit(authored.nodes);
  };
  document.scenes.forEach((s) => visitScene(s));
  document.segments?.forEach((segment) =>
    segment.scenes.forEach((s) => visitScene(s, segment.id, segment.settings)),
  );
  for (const { s, n } of all) {
    if (
      s.kind !== "top" ||
      n.id !== `${s.id}/card` ||
      !n.participantId ||
      participantCards.get(n.participantId) !== 1
    )
      continue;
    const person = document.source.participants.find(
      (p) => p.id === n.participantId,
    );
    if (!person) continue;
    const segment = document.segments?.find((v) => v.id === s.segmentId);
    const template = (segment?.scenes ?? document.scenes).find(
      (t) =>
        `${encodeURIComponent(t.id)}/${encodeURIComponent(person.id)}` ===
          s.id && t.block === "top",
    );
    if (!template) continue;
    result.set(n, {
      target: { type: "participant", id: person.id },
      path: ["settings", "typography", "roles", "label"],
      own: person.settings?.typography?.roles?.label,
      settings: mergeSettings(
        document.settings,
        document.formatSettings?.[document.output.format],
        segment?.settings,
        template.settings,
        person.settings,
      ),
      legacy: person.settings?.card,
      parentTypography: false,
    });
  }
  return result;
}
function compatible(
  n: CompiledNode,
  value: TextTypography,
  target: AuthoringTarget,
): boolean {
  const current = n.typography;
  if (
    !current ||
    current.fitGroup ||
    target.parentTypography ||
    n.textLayout?.missing.length ||
    (n.textRuns ?? []).some(
      (r) =>
        r.italic !== undefined ||
        r.weight !== undefined ||
        r.color !== undefined,
    )
  )
    return false;
  return (
    supportsFontFace(
      value.font ?? current.font,
      value.weight ?? current.weight,
      value.italic ?? current.italic,
    ) &&
    !(
      value.font === "oswald" &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(textOf(n))
    )
  );
}
function validateProfile(profile: VideoReviewProfile): void {
  if (
    profile.minReadableSec !== undefined &&
    (!Number.isFinite(profile.minReadableSec) || profile.minReadableSec <= 0)
  )
    throw new Error("minReadableSec must be positive");
  if (
    profile.charactersPerSecond !== undefined &&
    (!Number.isFinite(profile.charactersPerSecond) ||
      profile.charactersPerSecond <= 0)
  )
    throw new Error("charactersPerSecond must be positive");
  if (
    profile.safeArea &&
    (!Object.values(profile.safeArea).every(Number.isFinite) ||
      profile.safeArea.width <= 0 ||
      profile.safeArea.height <= 0)
  )
    throw new Error("safeArea must be a finite positive rectangle");
}
/** Static evidence only: neither pixels, motion nor decoded audio are inspected here. */
export function reviewVideo(
  plan: CompiledVideo,
  diagnostics: Diagnostic[],
  document: VideoDocument,
  profile: VideoReviewProfile = {},
): VideoReviewReport {
  validateProfile(profile);
  const issues: VideoReviewIssue[] = [],
    suggestions: VideoReviewSuggestion[] = [];
  const targets = authoringTargets(plan, document);
  const positions = plan.scenes.flatMap((s) => s.nodes.map((n) => ({ s, n })));
  const frameFor = (s: CompiledScene, n?: CompiledNode) => {
    const windows = n ? stableTextWindows(n, s) : [];
    const w = windows.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    return (
      s.from +
      Math.max(
        0,
        Math.min(
          s.durationInFrames - 1,
          Math.floor(w ? (w.from + w.to - 1) / 2 : 0),
        ),
      )
    );
  };
  const add = (
    code: string,
    severity: VideoReviewSeverity,
    message: string,
    evidence: VideoReviewIssue["evidence"],
    s?: CompiledScene,
    n?: CompiledNode,
    rawNodeId?: string,
  ) => {
    const nodeId = n?.id ?? rawNodeId;
    const id = JSON.stringify([
      code,
      s?.segmentId ?? null,
      s?.id ?? null,
      nodeId ?? null,
      !s && !nodeId ? (evidence.path ?? null) : null,
    ]);
    const existing = issues.find((i) => i.id === id);
    if (existing) {
      existing.evidence = { ...existing.evidence, ...evidence };
      return existing;
    }
    const frame = s && s.durationInFrames > 0 ? frameFor(s, n) : undefined;
    const issue: VideoReviewIssue = {
      id,
      code,
      severity,
      ...(s
        ? {
            sceneId: s.id,
            ...(s.segmentId !== undefined ? { segmentId: s.segmentId } : {}),
          }
        : {}),
      ...(nodeId ? { nodeId } : {}),
      ...(frame !== undefined ? { frame } : {}),
      message,
      evidence,
      nextAction: {
        type: code === "TEXT_READABLE_WINDOW" ? "clip" : "text_inspect",
        ...(s ? { sceneId: s.id } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(frame !== undefined ? { frame } : {}),
        reason:
          "Проверить указанное место; автоматическая правка доступна только для однозначной авторской привязки.",
      },
    };
    issues.push(issue);
    return issue;
  };
  for (const d of diagnostics) {
    const matches = positions.filter(
      ({ n }) =>
        d.nodeId === n.id ||
        (d.nodeId && n.id.endsWith(`/node/${encodeURIComponent(d.nodeId)}`)),
    );
    if (matches.length)
      for (const { s, n } of matches)
        add(
          d.code,
          d.severity,
          d.message,
          { rule: "compiler-diagnostic", path: d.path, source: "compiler" },
          s,
          n,
        );
    else
      add(
        d.code,
        d.severity,
        d.message,
        { rule: "compiler-diagnostic", path: d.path, source: "compiler" },
        undefined,
        undefined,
        d.nodeId,
      );
  }
  const addSuggestion = (
    kind: VideoReviewSuggestion["kind"],
    title: string,
    issue: VideoReviewIssue,
    s: CompiledScene,
    n: CompiledNode,
    value: TextTypography,
  ) => {
    const target = targets.get(n);
    if (!target || !compatible(n, value, target)) return;
    const operations: VideoPatchOperation[] = [
      { op: "set", target: target.target, path: [...target.path], value },
    ];
    // Validating the actual canonical patch also rejects null/disabled parent scopes.
    try {
      patchVideoDocument(document, operations);
    } catch {
      return;
    }
    const id = JSON.stringify([kind, issue.id, target.target, target.path]);
    issue.suggestionIds = [...(issue.suggestionIds ?? []), id];
    suggestions.push({
      id,
      kind,
      title,
      risk: "low",
      issueIds: [issue.id],
      operations,
      affectedScenes: [s.id],
      overrides: Object.keys(target.own ?? {}).filter((k) => k !== "role"),
      requiresRecheck: true,
    });
  };
  let measured = 0,
    unmeasured = 0;
  const textScenes = new Set<string>(),
    layoutScenes = new Set<string>(),
    safeScenes = new Set<string>();
  for (const { s, n } of positions) {
    if (!hasText(n)) continue;
    textScenes.add(s.id);
    const layout = n.textLayout,
      style = n.typography,
      target = targets.get(n);
    if (layout) {
      measured++;
      layoutScenes.add(s.id);
      if (layout.overflow) {
        const policy = style?.overflow ?? "error",
          code =
            policy === "clip"
              ? "TEXT_CLIPPED"
              : policy === "ellipsis"
                ? "TEXT_TRUNCATED"
                : "TEXT_OVERFLOW";
        const issue = add(
          code,
          policy === "error" ? "error" : "warning",
          "Измеренный текст выходит за отведённую область.",
          {
            rule: "measured-layout-within-box",
            overflow: true,
            truncated: layout.truncated,
            fontSize: layout.fontSize,
            rect: layout.rect,
            limitation: "Явный clip/ellipsis считается предупреждением.",
          },
          s,
          n,
        );
        // Keep factual measured evidence even when compiler supplied the same issue.
        issue.evidence = {
          ...issue.evidence,
          overflow: true,
          rect: layout.rect,
          fontSize: layout.fontSize,
        };
        if (
          policy === "error" &&
          style &&
          ["label", "caption"].includes(style.role) &&
          style.minFontSize <= 36 &&
          style.fontSize >= style.minFontSize
        ) {
          const value: TextTypography = {
            ...(target?.own ?? {}),
            role: style.role,
            preset: "compact-label",
            font: "oswald",
            weight: 700,
            italic: false,
            fontSize: Math.min(style.fontSize, 36),
            minFontSize: style.minFontSize,
            lineHeight: 1.12,
            maxLines: 2,
            wrap: "word",
            fit: "shrink",
            overflow: "error",
          };
          addSuggestion(
            "compact-label",
            "Примерить компактную подпись в пределах текущего минимума",
            issue,
            s,
            n,
            value,
          );
        }
      }
      if (layout.missing.length)
        add(
          "FONT_GLYPH_MISSING",
          "error",
          "В используемых шрифтах отсутствуют глифы.",
          {
            rule: "measured-glyph-coverage",
            missing: layout.missing.slice(0, 20),
            missingCount: layout.missing.length,
          },
          s,
          n,
        );
    } else unmeasured++;
    const windows = textWindows(n, s);
    if (!windows.length) continue; // Intentional hidden labels are not failures.
    const stable = stableTextWindows(n, s);
    const availableSec =
      Math.max(0, ...stable.map((w) => w.to - w.from)) / plan.fps;
    const count = Array.from(textOf(n).replace(/\s/g, "")).length;
    const requiredSec = Math.max(
      profile.minReadableSec ?? 0.8,
      count / (profile.charactersPerSecond ?? 16),
    );
    if (availableSec < requiredSec)
      add(
        "TEXT_READABLE_WINDOW",
        "warning",
        "Устойчивое окно может быть слишком коротким для чтения.",
        {
          rule: "longest-continuous-stable-window",
          availableSec,
          requiredSec,
          characters: count,
          charactersPerSecond: profile.charactersPerSecond ?? 16,
          windows: stable.slice(0, 8),
          limitation:
            "Эвристика чтения; движение и фактическое восприятие не проверены.",
        },
        s,
        n,
      );
    if (profile.safeArea) {
      safeScenes.add(s.id);
      const local = layout?.rect ?? {
        x: 0,
        y: 0,
        width: n.rect.width,
        height: n.rect.height,
      };
      const rect = { ...local, x: n.rect.x + local.x, y: n.rect.y + local.y };
      const area = profile.safeArea;
      if (
        rect.x < area.x ||
        rect.y < area.y ||
        rect.x + rect.width > area.x + area.width ||
        rect.y + rect.height > area.y + area.height
      )
        add(
          "TEXT_SAFE_AREA",
          "warning",
          "Область подписи выходит за выбранную безопасную зону.",
          {
            rule: "text-box-inside-profile-safe-area",
            rect,
            safeArea: area,
            limitation:
              "Статическая геометрия; трансформации и реальные глифовые границы не проверены.",
          },
          s,
          n,
        );
    }
    if (
      style &&
      ["subtitle", "caption"].includes(style.role) &&
      !style.plate &&
      !style.outlines.length &&
      ["#ffffff", "#fff"].includes(style.fill.toLowerCase())
    ) {
      const underlay = s.nodes.find(
        (v) =>
          v.id !== n.id &&
          ["image", "video", "card"].includes(v.type) &&
          !!v.media &&
          v.layer < n.layer &&
          intersects(v.rect, n.rect) &&
          intersect(textWindows(v, s), windows).length,
      );
      if (underlay) {
        const issue = add(
          "TEXT_BACKGROUND_RISK",
          "warning",
          "Подпись без защиты расположена поверх изображения или видео.",
          {
            rule: "unprotected-subtitle-over-visual",
            underlayNodeId: underlay.id,
            limitation:
              "Контраст пикселей не измерялся; это риск, а не доказанный недостаток контраста.",
          },
          s,
          n,
        );
        if (layout && !layout.overflow)
          addSuggestion(
            "subtitle-plate",
            "Защитить подпись тёмной плашкой",
            issue,
            s,
            n,
            {
              ...(target?.own ?? {}),
              role: style.role,
              plate: { color: "#111111", padding: 0, borderRadius: 4 },
            },
          );
      }
    }
    const own = target?.own;
    const theme = target?.settings.typography?.theme;
    if (
      target &&
      own &&
      own.role === "label" &&
      Object.keys(own).some((k) => k !== "role") &&
      theme &&
      getTypographyTheme(theme) &&
      !target.parentTypography &&
      target.legacy?.fontSize === undefined &&
      target.legacy?.color === undefined
    ) {
      const issue = add(
        "LABEL_THEME_OVERRIDE",
        "info",
        "У подписи есть локальные переопределения выбранной темы.",
        {
          rule: "explicit-label-theme-override",
          theme,
          properties: Object.keys(own).filter((k) => k !== "role"),
          limitation:
            "Переопределение может быть намеренным; возврат к теме — отдельный выбор.",
        },
        s,
        n,
      );
      addSuggestion(
        "return-label-theme",
        "Вернуть подпись к выбранной теме",
        issue,
        s,
        n,
        { role: "label" },
      );
    }
  }
  const frames: number[] = [];
  for (let page = 0; page < Math.ceil(plan.scenes.length / 24); page++)
    frames.push(
      ...selectStoryboard(plan, { page, pageSize: 24 }).tiles.map(
        (t) => t.frame,
      ),
    );
  const check = (
    code: VideoReviewCheck["code"],
    sceneIds: Set<string>,
    relevant: (i: VideoReviewIssue) => boolean,
    fallback?: VideoReviewCheck["status"],
    reason?: string,
  ): VideoReviewCheck => {
    const found = issues.filter(relevant);
    const status =
      fallback ??
      (found.some((i) => i.severity === "error")
        ? "error"
        : found.some((i) => i.severity === "warning")
          ? "warning"
          : "passed");
    return {
      id: code,
      code,
      status,
      mode: "static-plan",
      examinedScenes: [...sceneIds],
      examinedFrames:
        status === "notChecked" || status === "notApplicable"
          ? []
          : plan.scenes
              .filter((s) => sceneIds.has(s.id) && s.durationInFrames > 0)
              .map((s) => frameFor(s)),
      ...(reason ? { reason } : {}),
    };
  };
  const checks: VideoReviewCheck[] = [
    check(
      "layout",
      layoutScenes,
      (i) =>
        /^(TEXT_|FONT_)/.test(i.code) &&
        ![
          "TEXT_READABLE_WINDOW",
          "TEXT_SAFE_AREA",
          "TEXT_BACKGROUND_RISK",
        ].includes(i.code),
      measured ? undefined : "notChecked",
      measured ? undefined : "Нет измеренного текстового layout.",
    ),
    check(
      "textSafeArea",
      safeScenes,
      (i) => i.code === "TEXT_SAFE_AREA",
      profile.safeArea
        ? safeScenes.size
          ? undefined
          : "notApplicable"
        : "notChecked",
      profile.safeArea ? undefined : "Профиль безопасной зоны не задан.",
    ),
    check(
      "readableWindow",
      textScenes,
      (i) => i.code === "TEXT_READABLE_WINDOW",
      textScenes.size ? undefined : "notApplicable",
    ),
    check(
      "motion",
      new Set(),
      () => false,
      "notChecked",
      "Нужен просмотр реального клипа; статический план движения не проверяет.",
    ),
    check(
      "audio",
      new Set(),
      () => false,
      "notChecked",
      "Нужно декодировать реальное аудио; отсутствие музыки само по себе допустимо.",
    ),
    check(
      "contrast",
      new Set(),
      () => false,
      "notChecked",
      "Пиксели фона и фактический контраст не исследовались.",
    ),
  ];
  return {
    issues,
    checks,
    coverage: {
      mode: "static-plan",
      totalScenes: plan.scenes.length,
      examinedScenes: plan.scenes.length,
      examinedFrames: [...new Set(frames)],
      measuredTextNodes: measured,
      unmeasuredTextNodes: unmeasured,
      complete: false,
    },
    suggestions,
  };
}
