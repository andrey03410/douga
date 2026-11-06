import type {
  CompiledNode,
  CompiledScene,
  CompiledVideo,
  Window,
} from "./types";

export interface StoryboardOptions {
  mode?: "overview" | "scene";
  sceneId?: string;
  segmentId?: string;
  /** Zero-based page. */
  page?: number;
  /** 1..24, default 12. */
  pageSize?: number;
}
export interface StoryboardTile {
  id: string;
  sceneId: string;
  segmentId?: string;
  label: string;
  state: string;
  frame: number;
  localFrame: number;
  timeSec: number;
  analysis: { method: "semantic" | "heuristic"; limitations: string[] };
}
export interface StoryboardSelection {
  tiles: StoryboardTile[];
  /** Counts respect scene/segment filters; coverage describes this page only. */
  totalScenes: number;
  scenesCovered: number;
  remainingScenes: number;
  totalTiles: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface StoryboardPair {
  id: string;
  before: StoryboardTile | null;
  after: StoryboardTile | null;
}
export interface StoryboardMatch {
  pairs: StoryboardPair[];
  totalPairs: number;
  totalScenes: number;
  scenesCovered: number;
  remainingScenes: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
const sceneKey = (s: { segmentId?: string; sceneId: string }) =>
  JSON.stringify([s.segmentId ?? null, s.sceneId]);
const tileKey = (s: { segmentId?: string; sceneId: string; state: string }) =>
  JSON.stringify([s.segmentId ?? null, s.sceneId, s.state]);
function paging(options: StoryboardOptions) {
  const page = options.page ?? 0,
    pageSize = options.pageSize ?? 12;
  if (!Number.isSafeInteger(page) || page < 0)
    throw new Error("Storyboard page must be a nonnegative integer");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 24)
    throw new Error("Storyboard pageSize must be an integer from 1 to 24");
  if (
    options.mode !== undefined &&
    !["overview", "scene"].includes(options.mode)
  )
    throw new Error("Unknown storyboard mode");
  return { page, pageSize };
}
function scenesFor(plan: CompiledVideo, options: StoryboardOptions) {
  return plan.scenes.filter(
    (s) =>
      (options.sceneId === undefined || s.id === options.sceneId) &&
      (options.segmentId === undefined || s.segmentId === options.segmentId),
  );
}
const inside = (w: Window, frame: number) => w.from <= frame && frame < w.to;
function visible(
  node: CompiledNode,
  frame: number,
  scene: CompiledScene,
  visited = new Set<string>(),
): boolean {
  if (
    visited.has(node.id) ||
    node.opacity <= 0 ||
    frame < node.from ||
    frame >= node.from + node.durationInFrames ||
    !node.visible.some((w) => inside(w, frame))
  )
    return false;
  if (!node.parentId) return true;
  visited.add(node.id);
  const parent = scene.nodes.find((n) => n.id === node.parentId);
  return !!parent && visible(parent, frame, scene, visited);
}
function movement(
  node: CompiledNode,
): { id: string; from: number; to: number }[] {
  return [
    ...(node.motion ?? []).map((m, i) => ({
      id: `motion:${node.id}:${m.channel}:${i}`,
      from: Math.max(m.from, m.window.from),
      to:
        m.channel === "loop"
          ? m.window.to
          : Math.min(m.from + m.durationInFrames, m.window.to),
    })),
    ...node.animation
      .filter(
        (a) =>
          a.keyframes.length > 1 &&
          a.keyframes.some((k) => k.value !== a.keyframes[0].value),
      )
      .map((a) => ({
        id: `motion:${node.id}:animation:${a.property}`,
        from: node.from + a.keyframes[0].frame,
        to: node.from + a.keyframes[a.keyframes.length - 1].frame,
      })),
  ].filter((w) => w.from < w.to);
}
function transitionWindows(s: CompiledScene): Window[] {
  const legacy = ["fade", "slide"].includes(s.transition.type);
  const length = Math.min(
    s.transition.durationInFrames,
    legacy ? s.durationInFrames / 2 : s.durationInFrames,
  );
  if (s.transition.type === "none" || length <= 0) return [];
  return [
    { from: 0, to: length },
    ...(["fade", "slide"].includes(s.transition.type)
      ? [{ from: s.durationInFrames - length, to: s.durationInFrames }]
      : []),
  ];
}
/** Finite visibility/motion boundaries partition the scene, so no per-frame scan is needed. */
function representative(s: CompiledScene): { frame: number; stable: boolean } {
  const end =
    s.kind === "picker"
      ? Math.min(
          s.durationInFrames,
          s.phases.answerStartFrame ?? s.durationInFrames,
        )
      : s.durationInFrames;
  const transition = transitionWindows(s),
    moves = s.nodes.flatMap(movement);
  const boundaries = new Set([0, end]);
  for (const n of s.nodes) {
    [
      n.from,
      n.from + n.durationInFrames,
      ...n.visible.flatMap((w) => [w.from, w.to]),
      ...(n.labelWindows ?? []).flatMap((w) => [w.from, w.to]),
    ].forEach((f) => boundaries.add(f));
  }
  [...transition, ...moves].forEach((w) => {
    boundaries.add(w.from);
    boundaries.add(w.to);
  });
  Object.values(s.phases).forEach((f) => {
    if (f !== undefined) boundaries.add(f);
  });
  const points = [...boundaries]
    .filter((f) => Number.isFinite(f) && f >= 0 && f <= end)
    .map(Math.ceil)
    .sort((a, b) => a - b);
  const unique = [...new Set(points)];
  const cards = s.nodes.filter((n) => n.type === "card" && n.opacity > 0);
  const intervals: {
    frame: number;
    score: number;
    length: number;
    stable: boolean;
  }[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const from = unique[i],
      to = unique[i + 1];
    if (to <= from) continue;
    const frame = Math.floor((from + to - 1) / 2);
    const active = s.nodes.filter((n) => visible(n, frame, s));
    const stable =
      !transition.some((w) => inside(w, frame)) &&
      !s.nodes.some(
        (n) =>
          visible(n, frame, s) && movement(n).some((w) => inside(w, frame)),
      );
    const allChoices =
      s.kind !== "picker" || cards.every((n) => visible(n, frame, s));
    const textCount = active.filter(
      (n) =>
        (n.text || n.label) &&
        (n.type !== "card" ||
          (n.labelWindows ?? []).some((w) => inside(w, frame))),
    ).length;
    const score =
      (stable ? 1000000 : 0) +
      (allChoices ? 100000 : 0) +
      active.filter((n) => n.type === "card").length * 1000 +
      textCount * 100 +
      (s.kind === "picker" && frame >= (s.phases.timerStartFrame ?? 0)
        ? 10
        : 0);
    intervals.push({
      frame,
      score,
      length: to - from,
      stable: stable && allChoices,
    });
  }
  intervals.sort(
    (a, b) => b.score - a.score || b.length - a.length || a.frame - b.frame,
  );
  const best = intervals[0];
  return best
    ? { frame: best.frame, stable: best.stable }
    : { frame: 0, stable: false };
}
function sceneTiles(
  s: CompiledScene,
  plan: CompiledVideo,
  detail: boolean,
): StoryboardTile[] {
  if (s.durationInFrames < 1) return [];
  const result: StoryboardTile[] = [],
    seen = new Set<string>();
  const best = representative(s);
  const limitations = [
    ...(s.kind === "custom" ? ["custom-semantics-not-inferred"] : []),
    ...(!best.stable ? ["no-stable-window"] : []),
  ];
  const add = (state: string, frame: number, label: string) => {
    if (seen.has(state) || !Number.isFinite(frame)) return;
    seen.add(state);
    const localFrame = Math.max(
      0,
      Math.min(s.durationInFrames - 1, Math.floor(frame)),
    );
    const absolute = s.from + localFrame;
    result.push({
      id: tileKey({ segmentId: s.segmentId, sceneId: s.id, state }),
      sceneId: s.id,
      ...(s.segmentId !== undefined ? { segmentId: s.segmentId } : {}),
      label,
      state,
      frame: absolute,
      localFrame,
      timeSec: absolute / plan.fps,
      analysis: {
        method: s.kind === "custom" ? "heuristic" : "semantic",
        limitations: [...limitations],
      },
    });
  };
  const state = (
    {
      top: "revealed",
      picker: "choice",
      answer: "answer",
      board: "board-state",
      custom: "composition",
    } as const
  )[s.kind];
  add(
    state,
    best.frame,
    s.segmentTitle ??
      (s.roundId
        ? `Раунд ${s.roundId}`
        : s.participantId
          ? `Участник ${s.participantId}`
          : s.kind === "custom"
            ? "Композиция"
            : s.kind === "board"
              ? "Состояние доски"
              : "Сцена"),
  );
  if (!detail) return result;
  add("start", 0, "Начало");
  add("end", s.durationInFrames - 1, "Конец");
  if (s.phases.revealStartFrame !== undefined)
    add("reveal", s.phases.revealStartFrame, "Раскрытие");
  if (
    s.phases.timerStartFrame !== undefined &&
    s.phases.timerStartFrame < s.durationInFrames
  )
    add("timer", s.phases.timerStartFrame, "Выбор / таймер");
  if (
    s.phases.answerStartFrame !== undefined &&
    s.phases.answerStartFrame < s.durationInFrames
  )
    add("answer", s.phases.answerStartFrame, "Ответ");
  for (const [i, e] of (s.boardEvents ?? []).entries()) {
    const id = `${e.event}:${e.actionId ?? e.cardId ?? e.slotId ?? i}`;
    const end = Math.max(
      e.frame + 1,
      ...s.nodes
        .flatMap(movement)
        .filter((m) => m.from <= e.frame)
        .map((m) => m.to),
    );
    add(`${id}:before`, e.frame - 1, "До события доски");
    add(`${id}:during`, (e.frame + end) / 2, "Событие доски");
    add(`${id}:after`, end, "После события доски");
  }
  for (const n of s.nodes) {
    for (const m of movement(n)) {
      add(`${m.id}:before`, m.from - 1, "До движения");
      add(`${m.id}:during`, (m.from + m.to) / 2, "Движение");
      add(`${m.id}:after`, m.to, "После движения");
    }
    for (const [i, w] of n.visible.entries()) {
      if (w.to <= w.from) continue;
      add(`visible:${n.id}:${i}`, w.from, "Появление элемента");
    }
  }
  for (const [i, w] of transitionWindows(s).entries()) {
    const prefix = i === 0 ? "transition" : "transition-exit";
    add(`${prefix}:before`, w.from - 1, "До перехода");
    add(`${prefix}:during`, (w.from + w.to) / 2, "Переход");
    add(`${prefix}:after`, w.to, "После перехода");
  }
  return result.sort(
    (a, b) => a.localFrame - b.localFrame || a.state.localeCompare(b.state),
  );
}
function allTiles(plan: CompiledVideo, options: StoryboardOptions) {
  const scenes = scenesFor(plan, options);
  return {
    scenes,
    tiles: scenes.flatMap((s) => sceneTiles(s, plan, options.mode === "scene")),
  };
}
/** Pure semantic selection; all frames stay in the owning scene's half-open interval. */
export function selectStoryboard(
  plan: CompiledVideo,
  options: StoryboardOptions = {},
): StoryboardSelection {
  const { page, pageSize } = paging(options),
    { scenes, tiles } = allTiles(plan, options);
  const selected = tiles.slice(page * pageSize, (page + 1) * pageSize),
    scenesCovered = new Set(selected.map(sceneKey)).size;
  return {
    tiles: selected,
    totalScenes: scenes.length,
    scenesCovered,
    remainingScenes: scenes.length - scenesCovered,
    totalTiles: tiles.length,
    page,
    pageSize,
    totalPages: Math.ceil(tiles.length / pageSize),
  };
}
/** Join semantic identities before paging: duration changes never misalign pages. */
export function matchStoryboard(
  before: CompiledVideo,
  after: CompiledVideo,
  options: StoryboardOptions = {},
): StoryboardMatch {
  const { page, pageSize } = paging(options),
    old = allTiles(before, options),
    next = allTiles(after, options);
  const remaining = new Map(next.tiles.map((t) => [t.id, t]));
  const pairs: StoryboardPair[] = old.tiles.map((t) => {
    const after = remaining.get(t.id) ?? null;
    remaining.delete(t.id);
    return { id: t.id, before: t, after };
  });
  remaining.forEach((t) => pairs.push({ id: t.id, before: null, after: t }));
  const selected = pairs.slice(page * pageSize, (page + 1) * pageSize);
  const totalScenes = new Set(
    [...old.scenes, ...next.scenes].map((s) =>
      sceneKey({ sceneId: s.id, segmentId: s.segmentId }),
    ),
  ).size;
  const scenesCovered = new Set(
    selected.map((p) => sceneKey((p.after ?? p.before)!)),
  ).size;
  return {
    pairs: selected,
    totalPairs: pairs.length,
    totalScenes,
    scenesCovered,
    remainingScenes: totalScenes - scenesCovered,
    page,
    pageSize,
    totalPages: Math.ceil(pairs.length / pageSize),
  };
}
