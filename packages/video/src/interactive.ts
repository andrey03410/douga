import type {
  CompiledAudio,
  CompiledScene,
  CompiledVideo,
  Diagnostic,
  Participant,
  VideoDocument,
  VideoScene,
  Window,
} from "./types";
import type {
  CompiledChoice,
  CompiledInteraction,
  CompiledInteractiveScene,
  InteractiveAnchor,
  MatchData,
  MatchDataUse,
} from "./interactive-types";

/** Prefix of participant ids that stand for players in a scoreboard template. */
export const PLAYER_PARTICIPANT_PREFIX = "player:";

function allScenes(document: VideoDocument): { scene: VideoScene; segmentId?: string }[] {
  return [
    ...document.scenes.map((scene) => ({ scene })),
    ...(document.segments ?? []).flatMap((segment) =>
      segment.scenes.map((scene) => ({ scene, segmentId: segment.id })),
    ),
  ];
}

/** Authored scene id of a compiled scene: every compiled id starts with it, URI-encoded. */
export function sourceSceneId(compiledId: string): string {
  const head = compiledId.split("/")[0];
  try {
    return decodeURIComponent(head);
  } catch {
    return head;
  }
}

/**
 * Puts match data into the document before compilation, the way reconcileSource puts
 * tournament ratings: data lives in the source, the design stays bound to ids.
 * Without an interactive layer the same object is returned untouched.
 */
export function applyMatchData(document: VideoDocument, data: MatchData = {}): VideoDocument {
  if (!document.interactive) return document;
  const doc = structuredClone(document);
  const layer = doc.interactive!;
  layer.current = structuredClone(data);
  const names = new Map((data.players ?? []).map((p) => [p.id, p.name]));
  for (const participant of doc.source.participants) {
    const patch = data.participants?.[participant.id];
    if (!patch) continue;
    if (patch.votes !== undefined) participant.votes = patch.votes;
    if (patch.score !== undefined) participant.score = patch.score;
    if (patch.rank !== undefined) participant.rank = patch.rank;
    if (patch.comment !== undefined) participant.comment = patch.comment;
    if (patch.pickedBy)
      participant.pickedBy = patch.pickedBy.map((id) => names.get(id) ?? id);
  }
  for (const round of doc.source.rounds) {
    const answer = data.rounds?.[round.id]?.answer;
    if (answer) round.answer = structuredClone(answer);
  }
  const byRank = (ids: string[]) => {
    const rank = (id: string) =>
      doc.source.participants.find((p) => p.id === id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return ids
      .map((id, i) => ({ id, i }))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
      .map((x) => x.id);
  };
  for (const template of layer.templates) {
    if (!template.segmentId) continue;
    const segment = doc.segments?.find((s) => s.id === template.segmentId);
    if (!segment) continue;
    if (template.participants === "players") {
      const players: Participant[] = (data.players ?? []).map((p, i) => ({
        id: `${PLAYER_PARTICIPANT_PREFIX}${p.id}`,
        label: p.name,
        score: p.score,
        rank: p.rank ?? i + 1,
        kind: "image",
      }));
      doc.source.participants = [
        ...doc.source.participants.filter((p) => !p.id.startsWith(PLAYER_PARTICIPANT_PREFIX)),
        ...players,
      ];
      segment.participantIds = byRank(players.map((p) => p.id));
      segment.sourceSegmentId = undefined;
    } else if (template.order === "rank") {
      const source = doc.source.segments?.find((s) => s.id === segment.sourceSegmentId);
      const ids = segment.participantIds ?? source?.participantIds;
      if (ids) segment.participantIds = byRank(ids);
    }
  }
  return doc;
}

function anchorLocalFrame(scene: CompiledScene, anchor: InteractiveAnchor, fps: number): number | undefined {
  if ("time" in anchor) {
    const t = anchor.time;
    return "frame" in t ? t.frame : Math.round(t.sec * fps);
  }
  const cards = scene.nodes.filter((n) => n.type === "card");
  switch (anchor.event) {
    case "scene.start":
      return 0;
    case "scene.end":
      return Math.max(0, scene.durationInFrames - 1);
    case "card.reveal": {
      if (anchor.cardId) {
        const card = cards.find((n) => n.cardId === anchor.cardId || n.participantId === anchor.cardId);
        return card?.activeWindow?.from ?? card?.visible[0]?.from;
      }
      return scene.phases.revealStartFrame ?? cards[0]?.activeWindow?.from ?? cards[0]?.visible[0]?.from;
    }
    case "timer.start":
      return scene.phases.timerStartFrame;
    case "answer.reveal":
      return scene.phases.answerStartFrame ?? scene.nodes.find((n) => n.answerFrom !== undefined)?.answerFrom;
    default:
      return scene.boardEvents?.find(
        (e) => e.event === anchor.event && (!anchor.cardId || e.cardId === anchor.cardId),
      )?.frame;
  }
}

/** Moments, choices and data uses per compiled scene. Pure; frames are plan-absolute. */
export function compileInteraction(document: VideoDocument, plan: CompiledVideo): CompiledInteraction {
  const layer = document.interactive;
  const scenes: CompiledInteractiveScene[] = [];
  if (!layer) return { contract: 1, scenes };
  for (const scene of plan.scenes) {
    const sourceId = sourceSceneId(scene.id);
    const holds = layer.moments
      .filter((m) => m.sceneId === sourceId)
      .flatMap((m) => {
        const local = anchorLocalFrame(scene, m.at, plan.fps);
        if (local === undefined || local < 0 || local >= scene.durationInFrames) return [];
        return [{ momentId: m.id, frame: scene.from + local }];
      })
      .sort((a, b) => a.frame - b.frame);
    const choices: CompiledChoice[] = [];
    for (const choice of layer.choices.filter((c) => c.sceneId === sourceId)) {
      for (const node of scene.nodes) {
        if (node.type !== "card") continue;
        const matches =
          choice.cards === "all" ||
          (node.cardId !== undefined && choice.cards.includes(node.cardId)) ||
          (node.participantId !== undefined && choice.cards.includes(node.participantId));
        if (!matches) continue;
        choices.push({
          choiceId: choice.id,
          nodeId: node.id,
          ...(node.cardId ? { cardId: node.cardId } : {}),
          ...(node.participantId ? { participantId: node.participantId } : {}),
          ...(node.label ? { label: node.label } : {}),
        });
      }
    }
    const uses = new Set<MatchDataUse>();
    for (const t of layer.templates)
      if ((t.sceneId && t.sceneId === sourceId) || (t.segmentId && t.segmentId === scene.segmentId))
        t.uses.forEach((u) => uses.add(u));
    scenes.push({
      id: scene.id,
      sourceSceneId: sourceId,
      ...(scene.segmentId ? { segmentId: scene.segmentId } : {}),
      ...(scene.roundId ? { roundId: scene.roundId } : {}),
      ...(scene.participantId ? { participantId: scene.participantId } : {}),
      from: scene.from,
      to: scene.from + scene.durationInFrames,
      holds,
      choices,
      uses: [...uses],
    });
  }
  return { contract: 1, scenes };
}

/** Cross references of the layer against the document and the compiled plan. */
export function checkInteractive(document: VideoDocument, plan: CompiledVideo): Diagnostic[] {
  const layer = document.interactive;
  if (!layer) return [];
  const out: Diagnostic[] = [];
  const error = (code: string, message: string, path: string) =>
    out.push({ severity: "error", code, message, path });
  const authored = new Set(allScenes(document).map((s) => s.scene.id));
  const segments = new Set((document.segments ?? []).map((s) => s.id));
  const compiled = plan.interaction ?? compileInteraction(document, plan);
  layer.moments.forEach((m, i) => {
    const path = `interactive.moments.${i}`;
    if (!authored.has(m.sceneId)) return error("INTERACTIVE_SCENE_NOT_FOUND", `Scene ${m.sceneId} does not exist.`, `${path}.sceneId`);
    const instances = compiled.scenes.filter((s) => s.sourceSceneId === m.sceneId);
    if (instances.length && !instances.some((s) => s.holds.some((h) => h.momentId === m.id)))
      error("INTERACTIVE_MOMENT_UNAVAILABLE", `Moment ${m.id} has no frame in scene ${m.sceneId}: the event does not happen there.`, `${path}.at`);
  });
  layer.choices.forEach((c, i) => {
    const path = `interactive.choices.${i}`;
    if (!authored.has(c.sceneId)) return error("INTERACTIVE_SCENE_NOT_FOUND", `Scene ${c.sceneId} does not exist.`, `${path}.sceneId`);
    const found = compiled.scenes.filter((s) => s.sourceSceneId === c.sceneId).flatMap((s) => s.choices.filter((x) => x.choiceId === c.id));
    if (c.cards !== "all")
      for (const card of c.cards)
        if (!found.some((x) => x.cardId === card || x.participantId === card))
          error("INTERACTIVE_CARD_NOT_FOUND", `Card ${card} is not shown in scene ${c.sceneId}.`, `${path}.cards`);
    if (c.cards === "all" && compiled.scenes.some((s) => s.sourceSceneId === c.sceneId) && !found.length)
      error("INTERACTIVE_CARD_NOT_FOUND", `Scene ${c.sceneId} shows no cards to choose.`, `${path}.cards`);
  });
  layer.templates.forEach((t, i) => {
    const path = `interactive.templates.${i}`;
    if (t.segmentId && !segments.has(t.segmentId)) error("INTERACTIVE_SEGMENT_NOT_FOUND", `Segment ${t.segmentId} does not exist.`, `${path}.segmentId`);
    if (t.sceneId && !authored.has(t.sceneId)) error("INTERACTIVE_SCENE_NOT_FOUND", `Scene ${t.sceneId} does not exist.`, `${path}.sceneId`);
  });
  return out;
}

export type PlanSelection = { sceneIds: string[] } | { segmentId: string } | { from: number; to: number };

function clipWindows(windows: Window[], from: number, to: number): Window[] {
  return windows
    .map((w) => ({ from: Math.max(w.from, from) - from, to: Math.min(w.to, to) - from }))
    .filter((w) => w.to > w.from);
}

/**
 * A standalone plan of whole scenes [from, to), rebased to frame 0. Only media of the
 * kept scenes and the audio that sounds inside the window remain, so nothing of the
 * other scenes reaches a viewer.
 */
export function slicePlan(plan: CompiledVideo, selection: PlanSelection): CompiledVideo {
  let picked: CompiledScene[];
  if ("sceneIds" in selection) picked = plan.scenes.filter((s) => selection.sceneIds.includes(s.id));
  else if ("segmentId" in selection) picked = plan.scenes.filter((s) => s.segmentId === selection.segmentId);
  else picked = plan.scenes.filter((s) => s.from >= selection.from && s.from + s.durationInFrames <= selection.to);
  if (!picked.length) throw new Error("SLICE_EMPTY");
  const from = Math.min(...picked.map((s) => s.from));
  const to = Math.max(...picked.map((s) => s.from + s.durationInFrames));
  const scenes = plan.scenes
    .filter((s) => s.from >= from && s.from + s.durationInFrames <= to)
    .map((s, i) => {
      const scene = structuredClone(s);
      scene.from -= from;
      if (i === 0) scene.transition = { type: "none", durationInFrames: 0 };
      return scene;
    });
  const audio: CompiledAudio[] = [];
  for (const cue of plan.audio) {
    const end = cue.from + cue.durationInFrames;
    if (end <= from || cue.from >= to) continue;
    const next = structuredClone(cue);
    const cut = Math.max(0, from - cue.from);
    next.from = Math.max(cue.from, from) - from;
    next.durationInFrames = Math.min(end, to) - Math.max(cue.from, from);
    next.offsetFrames = cue.offsetFrames + cut;
    next.fadeInFrames = Math.max(0, cue.fadeInFrames - cut);
    next.fadeOutFrames = Math.min(cue.fadeOutFrames, next.durationInFrames);
    next.duckWindows = clipWindows(cue.duckWindows, from, to);
    next.muteWindows = clipWindows(cue.muteWindows, from, to);
    audio.push(next);
  }
  const keep = new Set(scenes.map((s) => s.id));
  const result: CompiledVideo = {
    ...structuredClone({ ...plan, scenes: [], audio: [] }),
    durationInFrames: Math.max(1, to - from),
    scenes,
    audio,
  };
  if (plan.segments)
    result.segments = plan.segments
      .filter((s) => s.to > from && s.from < to)
      .map((s) => ({ ...s, from: Math.max(s.from, from) - from, to: Math.min(s.to, to) - from }));
  if (plan.interaction)
    result.interaction = {
      contract: 1,
      scenes: plan.interaction.scenes
        .filter((s) => keep.has(s.id))
        .map((s) => ({
          ...structuredClone(s),
          from: s.from - from,
          to: s.to - from,
          holds: s.holds.map((h) => ({ ...h, frame: h.frame - from })),
        })),
    };
  return result;
}
