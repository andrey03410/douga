import type { Diagnostic } from "./types";
/** Technical allocation/timeline budgets, independent of top/card/round product counts. */
export const videoResourceLimits = Object.freeze({
  maxDepth: 32,
  maxAuthoredValues: 2_000_000,
  maxExpandedScenes: 2_000,
  maxExpandedNodes: 100_000,
  maxAudioCues: 20_000,
  maxAudioPolicyWindows: 200_000,
  maxDurationSeconds: 7_200,
});

/** Keep the stable error code while making every budget failure actionable. */
export function resourceBudgetDiagnostic(
  resource: string,
  used: number,
  limit: number,
  path: string,
): Diagnostic {
  return {
    severity: "error",
    code: "RESOURCE_BUDGET_EXCEEDED",
    path: path || "document",
    message: `resource=${resource}; used=${used}; limit=${limit}`,
  };
}

/** Factory allocation failures retain the legacy message prefix and structured detail. */
export class VideoResourceBudgetError extends Error {
  readonly code = "RESOURCE_BUDGET_EXCEEDED";
  readonly diagnostics: Diagnostic[];
  constructor(diagnostic: Diagnostic) {
    super(`RESOURCE_BUDGET_EXCEEDED: ${diagnostic.message}; path=${diagnostic.path}`);
    this.name = "VideoResourceBudgetError";
    this.diagnostics = [diagnostic];
  }
}

export interface VideoResourceEstimate {
  authoredValues: number;
  authoredDepth: number;
  nodeDepth: number;
  expandedScenes: number;
  expandedNodes: number;
  /** Authored audio.cues expansion; implicit block media and playlists need compilation. */
  audioCues: number;
  /** False means a guard stopped traversal; counters are lower bounds at that path. */
  complete: boolean;
  diagnostics: Diagnostic[];
  limits: typeof videoResourceLimits;
}

function* entries(value: object): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield [String(i), value[i]];
  } else {
    for (const key of Object.keys(value))
      yield [key, (value as Record<string, unknown>)[key]];
  }
}
const childPath = (path: string, key: string | number) => path ? `${path}.${key}` : String(key);

/** Pure conservative authoring/expansion estimate, without schema parsing or media I/O.
 * Playlist lengths, timeline duration and retained audio policies need resolved media;
 * their existing compiler guards remain authoritative. No expanded nodes are allocated.
 */
export function estimateVideoResources(input: unknown): VideoResourceEstimate {
  const result: VideoResourceEstimate = {
    authoredValues: 0, authoredDepth: 0, nodeDepth: 0,
    expandedScenes: 0, expandedNodes: 0, audioCues: 0,
    complete: true, diagnostics: [], limits: videoResourceLimits,
  };
  const fail = (resource: string, used: number, limit: number, path: string) => {
    result.complete = false;
    result.diagnostics.push(resourceBudgetDiagnostic(resource, used, limit, path));
    return result;
  };
  // Only the ancestors and one iterator per level are retained, including for wide arrays.
  const ancestors = new WeakSet<object>();
  const stack: { value: object; iterator: Generator<[string, unknown]>; depth: number; path: string }[] = [];
  let current: { value: unknown; depth: number; path: string; key: string } | undefined = {
    value: input, depth: 0, path: "", key: "",
  };
  while (current || stack.length) {
    if (!current) {
      const parent = stack[stack.length - 1];
      const next = parent.iterator.next();
      if (next.done) {
        ancestors.delete(parent.value);
        stack.pop();
        continue;
      }
      const [key, value] = next.value;
      current = { value, key, depth: parent.depth + 1, path: childPath(parent.path, key) };
    }
    const { value, depth, path, key } = current;
    current = undefined;
    result.authoredValues++;
    result.authoredDepth = Math.max(result.authoredDepth, depth);
    if (result.authoredValues > videoResourceLimits.maxAuthoredValues)
      return fail("authoredValues", result.authoredValues, videoResourceLimits.maxAuthoredValues, path);
    // Three JSON nesting levels per authored node preserves the prior structural guard.
    if (depth > videoResourceLimits.maxDepth * 3)
      return fail("authoredDepth", depth, videoResourceLimits.maxDepth * 3, path);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return fail("finiteNumbers", value, Number.MAX_VALUE, path);
      if ((key === "sec" || /Sec$/.test(key)) && value > videoResourceLimits.maxDurationSeconds)
        return fail("durationSeconds", value, videoResourceLimits.maxDurationSeconds, path);
      if (key === "frame" && value > 864000) return fail("frame", value, 864000, path);
    }
    if (value && typeof value === "object") {
      if (ancestors.has(value)) return fail("cycles", 1, 0, path);
      ancestors.add(value);
      stack.push({ value, iterator: entries(value), depth, path });
    }
  }
  type SceneInput = {
    id?: string; repeat?: string; nodes?: unknown[]; block?: string;
    board?: { slots?: unknown[]; rounds?: { cards?: unknown[]; actions?: unknown[] }[]; presentation?: { rowFocusSec?: number } };
  };
  type AudioInput = { cues?: { anchor?: { sceneId?: string; event?: string } }[] };
  const doc = input as {
    source?: {
      segments?: { id?: string; participantIds?: string[] }[];
      participants?: unknown[];
      rounds?: { cards?: unknown[]; groups?: { cardIds?: unknown[] }[] }[];
    };
    segments?: {
      enabled?: boolean; participantIds?: string[]; sourceSegmentId?: string;
      roundIds?: string[]; scenes?: SceneInput[]; audio?: AudioInput;
    }[];
    scenes?: SceneInput[]; audio?: AudioInput;
  };
  if (!doc) return result;
  const sourceSegments = Array.isArray(doc.source?.segments) ? doc.source.segments : [];
  const scopes = [
    ...(Array.isArray(doc.scenes) ? [{
      scenes: doc.scenes, path: "scenes", audioPath: "audio",
      participantCount: doc.source?.participants?.length ?? 0,
      roundCount: doc.source?.rounds?.length ?? 0, audio: doc.audio,
    }] : []),
    ...(Array.isArray(doc.segments) ? doc.segments.flatMap((segment, index) =>
      segment && segment.enabled !== false ? [{
        scenes: Array.isArray(segment.scenes) ? segment.scenes : [],
        path: `segments.${index}.scenes`, audioPath: `segments.${index}.audio`,
        participantCount: segment.participantIds?.length ??
          sourceSegments.find((source) => source && source.id === segment.sourceSegmentId)?.participantIds?.length ??
          doc.source?.participants?.length ?? 0,
        roundCount: segment.roundIds?.length ?? doc.source?.rounds?.length ?? 0,
        audio: segment.audio,
      }] : []) : []),
  ];
  const rounds = Array.isArray(doc.source?.rounds) ? doc.source.rounds : [];
  let maxCards = 0;
  for (const round of rounds) {
    if (!round || typeof round !== "object") continue;
    const cards = (Array.isArray(round.cards) ? round.cards.length : 0) +
      (Array.isArray(round.groups) ? round.groups.reduce((n, group) =>
        n + (group && Array.isArray(group.cardIds) ? group.cardIds.length : 0), 0) : 0);
    maxCards = Math.max(maxCards, cards);
  }
  const sceneCopies = new Map<string, number>();
  for (const scope of scopes) {
    for (const [sceneIndex, scene] of scope.scenes.entries()) {
      if (!scene || typeof scene !== "object") continue;
      const path = childPath(scope.path, sceneIndex);
      const count = scene.repeat === "participants" ? scope.participantCount : scene.repeat === "rounds" ? scope.roundCount : 1;
      let authored = 0;
      const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
      const todo: { values: unknown[]; index: number; depth: number; multiplier: number; path: string }[] = [
        { values: nodes, index: 0, depth: 1, multiplier: 1, path: `${path}.nodes` },
      ];
      while (todo.length) {
        const cursor = todo[todo.length - 1];
        if (cursor.index >= cursor.values.length) { todo.pop(); continue; }
        const value = cursor.values[cursor.index];
        const nodePath = childPath(cursor.path, cursor.index++);
        const { depth, multiplier } = cursor;
        result.nodeDepth = Math.max(result.nodeDepth, depth);
        if (depth > videoResourceLimits.maxDepth)
          return fail("nodeDepth", depth, videoResourceLimits.maxDepth, nodePath);
        authored += multiplier;
        const expanded = result.expandedNodes + authored * Math.max(1, count);
        if (expanded > videoResourceLimits.maxExpandedNodes) {
          result.expandedNodes = expanded;
          return fail("expandedNodes", expanded, videoResourceLimits.maxExpandedNodes, nodePath);
        }
        if (value && typeof value === "object" && Array.isArray((value as { children?: unknown[] }).children)) {
          const node = value as { children: unknown[]; repeat?: string; selection?: string };
          todo.push({ values: node.children, index: 0, depth: depth + 1,
            multiplier: multiplier * (node.repeat === "participants" ? node.selection === "document" ?
              (doc.source?.participants?.length ?? 0) : scope.participantCount : 1), path: `${nodePath}.children` });
        }
      }
      if (scene.block === "board" && scene.board) {
        const board = scene.board;
        const rounds = Array.isArray(board.rounds) ? board.rounds : [];
        const slots = Array.isArray(board.slots) ? board.slots.length : 0;
        let candidates = 0, phases = 2 + ((board.presentation?.rowFocusSec ?? 0) > 0 ? slots + 1 : 0);
        for (const round of rounds) {
          const cards = Array.isArray(round?.cards) ? round.cards.length : 0;
          candidates += cards;
          phases += 3 + cards + (Array.isArray(round?.actions) ? round.actions.length : 0);
        }
        result.expandedScenes += phases;
        result.expandedNodes += phases * (12 + slots * 4 + candidates * 2 + authored);
        if (typeof scene.id === "string") sceneCopies.set(scene.id, phases);
      } else {
        const copies = count * (scene.block === "picker" ? 2 : 1);
        if (typeof scene.id === "string") sceneCopies.set(scene.id, copies);
        result.expandedScenes += copies;
        result.expandedNodes += count * (authored + (scene.block === "picker" ? 10 + maxCards * 8 : 10));
      }
      if (result.expandedScenes > videoResourceLimits.maxExpandedScenes)
        return fail("expandedScenes", result.expandedScenes, videoResourceLimits.maxExpandedScenes, path);
      if (result.expandedNodes > videoResourceLimits.maxExpandedNodes)
        return fail("expandedNodes", result.expandedNodes, videoResourceLimits.maxExpandedNodes, path);
    }
  }
  // Bound repeated-scene rule expansion before media probing/PCM analysis.
  // Count conservatively even when selectors narrow the resolver's routing.
  for (const scope of scopes) {
    const cues = Array.isArray(scope.audio?.cues) ? scope.audio.cues : [];
    for (const [index, cue] of cues.entries()) {
      if (!cue || typeof cue !== "object") continue;
      const anchor = cue.anchor;
      const copies = anchor ? typeof anchor.sceneId === "string" ?
        (sceneCopies.get(anchor.sceneId) ?? 1) : result.expandedScenes : 1;
      result.audioCues += copies * (anchor?.event === "card.reveal" ? Math.max(1, maxCards) : 1);
      if (result.audioCues > videoResourceLimits.maxAudioCues)
        return fail("audioCues", result.audioCues, videoResourceLimits.maxAudioCues, `${scope.audioPath}.cues.${index}`);
    }
  }
  return result;
}

export function preflightVideoResources(input: unknown): Diagnostic[] {
  return estimateVideoResources(input).diagnostics;
}
