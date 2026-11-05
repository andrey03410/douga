import type { Diagnostic } from "./types";
/** Technical allocation/timeline budgets, independent of top/card/round product counts. */
export const videoResourceLimits = Object.freeze({
  maxDepth: 32,
  maxAuthoredValues: 100_000,
  maxExpandedScenes: 2_000,
  maxExpandedNodes: 20_000,
  maxAudioCues: 20_000,
  maxAudioPolicyWindows: 200_000,
  maxDurationSeconds: 7_200,
});
const failure = (): Diagnostic[] => [
  {
    severity: "error",
    code: "RESOURCE_BUDGET_EXCEEDED",
    path: "document",
    message:
      "Document exceeds technical depth, expansion, or timeline resource budgets.",
  },
];
export function preflightVideoResources(input: unknown): Diagnostic[] {
  const stack: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (
      ++visited > videoResourceLimits.maxAuthoredValues ||
      depth > videoResourceLimits.maxDepth * 3
    )
      return failure();
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (
          typeof v === "number" &&
          (!Number.isFinite(v) ||
            ((key === "sec" || /Sec$/.test(key)) && v > 7200) ||
            (key === "frame" && v > 864000))
        )
          return failure();
        stack.push({ value: v, depth: depth + 1 });
      }
    }
  }
  type SceneInput = {
    id?: string;
    repeat?: string;
    nodes?: unknown[];
    block?: string;
  };
  const doc = input as {
    source?: {
      segments?: { id?: string; participantIds?: string[] }[];
      participants?: unknown[];
      rounds?: { cards?: unknown[]; groups?: { cardIds?: unknown[] }[] }[];
    };
    segments?: {
      enabled?: boolean;
      participantIds?: string[];
      sourceSegmentId?: string;
      roundIds?: string[];
      scenes?: SceneInput[];
      audio?: { cues?: { anchor?: { sceneId?: string; event?: string } }[] };
    }[];
    scenes?: {
      id?: string;
      repeat?: string;
      nodes?: unknown[];
      block?: string;
    }[];
    audio?: { cues?: { anchor?: { sceneId?: string; event?: string } }[] };
  };
  if (!doc) return [];
  const sourceSegments = Array.isArray(doc.source?.segments)
    ? doc.source.segments
    : [];
  const scopes = [
    ...(Array.isArray(doc.scenes)
      ? [
          {
            scenes: doc.scenes,
            participantCount: doc.source?.participants?.length ?? 0,
            roundCount: doc.source?.rounds?.length ?? 0,
            audio: doc.audio,
          },
        ]
      : []),
    ...(Array.isArray(doc.segments)
      ? doc.segments
          .filter((s) => s && s.enabled !== false)
          .map((s) => ({
            scenes: Array.isArray(s.scenes) ? s.scenes : [],
            participantCount:
              s.participantIds?.length ??
              sourceSegments.find(
                (source) => source && source.id === s.sourceSegmentId,
              )?.participantIds?.length ??
              doc.source?.participants?.length ??
              0,
            roundCount: s.roundIds?.length ?? doc.source?.rounds?.length ?? 0,
            audio: s.audio,
          }))
      : []),
  ];
  let scenes = 0,
    nodes = 0;
  const rounds = Array.isArray(doc.source?.rounds) ? doc.source.rounds : [];
  const maxCards = Math.max(
    0,
    ...rounds
      .filter((r) => r && typeof r === "object")
      .map(
        (r) =>
          (Array.isArray(r.cards) ? r.cards.length : 0) +
          (Array.isArray(r.groups)
            ? r.groups.reduce(
                (n, g) =>
                  n + (g && Array.isArray(g.cardIds) ? g.cardIds.length : 0),
                0,
              )
            : 0),
      ),
  );
  const sceneCopies = new Map<string, number>();
  for (const scope of scopes)
    for (const scene of scope.scenes) {
      if (!scene || typeof scene !== "object") continue;
      const count =
        scene.repeat === "participants"
          ? scope.participantCount
          : scene.repeat === "rounds"
            ? scope.roundCount
            : 1;
      let authored = 0;
      const todo = (Array.isArray(scene.nodes) ? scene.nodes : []).map(
        (value) => ({ value, depth: 1, multiplier: 1 }),
      );
      while (todo.length) {
        const { value, depth, multiplier } = todo.pop()!;
        if (depth > videoResourceLimits.maxDepth) return failure();
        authored += multiplier;
        if (
          authored * Math.max(1, count) >
          videoResourceLimits.maxExpandedNodes
        )
          return failure();
        if (
          value &&
          typeof value === "object" &&
          Array.isArray((value as { children?: unknown[] }).children)
        )
          todo.push(
            ...(value as { children: unknown[] }).children.map((child) => ({
              value: child,
              depth: depth + 1,
              multiplier:
                multiplier *
                ((value as { repeat?: string }).repeat === "participants"
                  ? (value as { selection?: string }).selection === "document"
                    ? (doc.source?.participants?.length ?? 0)
                    : scope.participantCount
                  : 1),
            })),
          );
      }
      const copies = count * (scene.block === "picker" ? 2 : 1);
      if (typeof scene.id === "string") sceneCopies.set(scene.id, copies);
      scenes += copies;
      nodes +=
        count *
        (authored + (scene.block === "picker" ? 10 + maxCards * 8 : 10));
      if (
        scenes > videoResourceLimits.maxExpandedScenes ||
        nodes > videoResourceLimits.maxExpandedNodes
      )
        return failure();
    }
  // Bound repeated-scene rule expansion before media probing/PCM analysis.
  // Count conservatively even when selectors narrow the resolver's routing.
  let soundRules = 0;
  for (const cue of scopes.flatMap((scope) =>
    Array.isArray(scope.audio?.cues) ? scope.audio.cues : [],
  )) {
    if (!cue || typeof cue !== "object") continue;
    const anchor = cue.anchor;
    const copies = anchor
      ? typeof anchor.sceneId === "string"
        ? (sceneCopies.get(anchor.sceneId) ?? 1)
        : scenes
      : 1;
    soundRules +=
      copies * (anchor?.event === "card.reveal" ? Math.max(1, maxCards) : 1);
    if (soundRules > videoResourceLimits.maxAudioCues) return failure();
  }
  return [];
}
