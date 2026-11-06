import type { BoardCard, BoardDefinition, BoardEvent, BoardState, CompiledNode, CompiledScene, Rect, Settings, VideoScene } from "./types";
import { diagnostic, effectiveSettings, resolveAsset, type CompileContext } from "./context";
import { createBoardState, resolveBoard } from "./board-state";
import { baseNode } from "./nodes";
import { makeScene } from "./blocks";
import { compileMedia } from "./media";
import { addAudio } from "./audio";
import { mergeSettings } from "./settings";

/** Board data compiles to the same nodes and audio used by every existing output. */
export function compileBoard(ctx: CompileContext, template: VideoScene, from: number, settings: Settings): CompiledScene[] {
  const b = template.board!;
  const resolution = resolveBoard(b, ctx.document.source.participants);
  ctx.diagnostics.push(...resolution.diagnostics.map((d) => ({ ...d, path: `scenes.${template.id}.${d.path}` })));
  if (resolution.diagnostics.some((d) => d.severity === "error")) return [];
  if (!b.rounds.length) diagnostic(ctx, "BOARD_EMPTY", "Add authored rounds and placements to the board.", `scenes.${template.id}.board.rounds`);
  const p = b.presentation ?? {};
  const f = (sec: number | undefined, fallback: number, minimum = 0) => Math.max(minimum, Math.round((sec ?? fallback) * ctx.fps));
  const revealFrames = f(p.revealSec, 1.5, 1), moveFrames = f(p.moveSec, .65, 1), holdFrames = f(p.holdSec, .6);
  const scenes: CompiledScene[] = [];
  let cursor = from, serial = 0;
  const allCards = new Map(b.rounds.flatMap((r) => r.cards).map((c) => [c.id, c]));
  const participant = (c: BoardCard) => ctx.document.source.participants.find((p) => p.id === c.participantId)!;
  const area: Rect = { x: ctx.width * .04, y: ctx.height * .18, width: ctx.width * .92, height: ctx.height * .66 };
  const candidateArea: Rect = { x: ctx.width * .12, y: ctx.height * .22, width: ctx.width * .76, height: ctx.height * .50 };
  const slotRects = (focus?: string): Map<string, Rect> => {
    if (focus) return new Map([[focus, area]]);
    const columns = b.layout === "grid" ? Math.min(b.slots.length, b.columns ?? 3) : 1;
    const rows = Math.ceil(b.slots.length / columns), gap = Math.min(ctx.width, ctx.height) * .012;
    return new Map(b.slots.map((s, i) => [s.id, b.layout === "free" && s.rect ? {
      x: s.rect.x * ctx.width, y: s.rect.y * ctx.height, width: s.rect.width * ctx.width, height: s.rect.height * ctx.height,
    } : {
      x: area.x + (i % columns) * area.width / columns,
      y: area.y + Math.floor(i / columns) * area.height / rows,
      width: area.width / columns - gap, height: area.height / rows - gap,
    }]));
  };
  const tileRects = (count: number, rect: Rect): Rect[] => {
    if (!count) return [];
    const gap = Math.min(ctx.width, ctx.height) * .009;
    // Fixed aspect ratio lets the existing scalar transform animate both reveal and placement.
    let best = { columns: 1, width: 0, height: 0 };
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const width = Math.max(1, Math.min((rect.width - (columns - 1) * gap) / columns, ((rect.height - (rows - 1) * gap) / rows) * .8));
      if (width > best.width) best = { columns, width, height: width / .8 };
    }
    return Array.from({ length: count }, (_, i) => ({
      x: rect.x + (i % best.columns) * (best.width + gap),
      y: rect.y + Math.floor(i / best.columns) * (best.height + gap),
      width: best.width, height: best.height,
    }));
  };
  const contentRect = (rect: Rect): Rect => b.layout === "rows" || !b.layout ? {
    x: rect.x + rect.width * .21, y: rect.y + rect.height * .08, width: rect.width * .77, height: rect.height * .84,
  } : { x: rect.x + rect.width * .04, y: rect.y + rect.height * .23, width: rect.width * .92, height: rect.height * .73 };
  const placements = (state: BoardState, focus?: string): Map<string, Rect> => {
    const result = new Map<string, Rect>();
    for (const [slotId, rect] of slotRects(focus)) {
      const ids = Object.entries(state.placements).filter(([, s]) => s === slotId).map(([id]) => id);
      tileRects(ids.length, contentRect(rect)).forEach((r, i) => result.set(ids[i], r));
    }
    return result;
  };
  const text = (scene: CompiledScene, id: string, value: string, rect: Rect, size = 38, color = "#f5f5fa") => {
    const n = baseNode(`${scene.id}/${id}`, "text", rect, scene.durationInFrames, { color, fontSize: size });
    n.text = value; n.layer = 8; scene.nodes.push(n); return n;
  };
  const mediaNode = (scene: CompiledScene, id: string, key: string | undefined, rect: Rect, layer: number) => {
    if (!key) return;
    const asset = resolveAsset(ctx, key, `scenes.${template.id}.board.${id}`, "visual");
    if (!asset) return;
    const n = baseNode(`${scene.id}/${id}`, asset.kind === "video" ? "video" : "image", rect, scene.durationInFrames);
    n.media = compileMedia(ctx, asset, { fit: "cover", loop: true }, `scenes.${template.id}.board.${id}`); n.layer = layer; scene.nodes.push(n);
  };
  const cardNode = (scene: CompiledScene, c: BoardCard, rect: Rect, placed: boolean, active?: { from: number; to: number }): CompiledNode => {
    const person = participant(c), local = effectiveSettings(ctx, settings, person.settings);
    const n = baseNode(`${scene.id}/card/${encodeURIComponent(c.id)}`, "card", rect, scene.durationInFrames, { ...local.card, borderRadius: local.card?.borderRadius ?? 12 });
    n.cardId = c.id; n.participantId = c.participantId; n.layer = placed ? 3 : 12;
    n.label = !placed && p.hideLabelsUntilPlaced ? "?" : (person.caption ?? person.label) + (b.budget !== undefined ? ` · ${c.cost ?? 0}` : "");
    n.labelWindows = [{ from: 0, to: scene.durationInFrames }]; n.showRank = false;
    n.activeWindow = active ?? { from: 0, to: 0 };
    if (placed || !p.hideVisualsUntilPlaced) {
      const asset = resolveAsset(ctx, person.media?.visual, `source.participants.${person.id}.media.visual`, "visual");
      if (asset) n.media = compileMedia(ctx, asset, { ...local.card, offsetSec: person.bestMomentSec ?? local.card?.offsetSec }, `source.participants.${person.id}.media.visual`);
    }
    scene.nodes.push(n); return n;
  };
  const scene = (suffix: string, duration: number, state: BoardState, prompt?: string, focus?: string): CompiledScene => {
    const s = makeScene(ctx, template, `${encodeURIComponent(template.id)}/${++serial}/${suffix}`, "board", cursor, Math.max(1, duration), settings);
    s.boardState = structuredClone(state); s.boardEvents = [];
    text(s, "title", ctx.segment?.title ?? ctx.document.title, { x: ctx.width * .04, y: ctx.height * .025, width: ctx.width * .92, height: ctx.height * .065 }, Math.min(48, ctx.width * .045));
    if (prompt) text(s, "prompt", prompt, { x: ctx.width * .04, y: ctx.height * .095, width: ctx.width * .92, height: ctx.height * .065 }, Math.min(34, ctx.width * .032));
    for (const [slotId, rect] of slotRects(focus)) {
      const slot = b.slots.find((s) => s.id === slotId)!;
      const bg = baseNode(`${s.id}/slot/${encodeURIComponent(slotId)}`, "shape", rect, s.durationInFrames, slot.style);
      bg.shape = "rect"; bg.fill = slot.background ?? "#202b40"; bg.layer = 0; s.nodes.push(bg);
      mediaNode(s, `slot-bg/${slotId}`, slot.backgroundAsset, rect, 1);
      const labelRect: Rect = b.layout === "rows" || !b.layout ? { x: rect.x + rect.width * .015, y: rect.y + rect.height * .08, width: rect.width * .18, height: rect.height * .84 } : { x: rect.x + rect.width * .04, y: rect.y + rect.height * .02, width: rect.width * .92, height: rect.height * .18 };
      text(s, `slot-label/${slotId}`, slot.label, labelRect, Math.min(38, labelRect.height * .6), slot.color);
      if (slot.image) mediaNode(s, `slot-icon/${slotId}`, slot.image, { ...labelRect, width: labelRect.width * .35, height: labelRect.height * .35 }, 9);
    }
    for (const [id, rect] of placements(state, focus)) { const c = allCards.get(id); if (c) cardNode(s, c, rect, true); }
    if (b.xLabel) text(s, "x-axis", b.xLabel, { x: ctx.width * .30, y: ctx.height * .85, width: ctx.width * .65, height: ctx.height * .035 }, 26);
    if (b.yLabel) text(s, "y-axis", b.yLabel, { x: ctx.width * .04, y: ctx.height * .85, width: ctx.width * .24, height: ctx.height * .035 }, 26);
    if (b.budget !== undefined) text(s, "budget", `${state.spent} / ${b.budget}`, { x: ctx.width * .68, y: ctx.height * .91, width: ctx.width * .27, height: ctx.height * .06 }, 40);
    scenes.push(s); cursor += s.durationInFrames; return s;
  };
  const sound = (key: string | undefined, s: CompiledScene, id: string) => {
    if (!key) return;
    const asset = resolveAsset(ctx, key, `scenes.${template.id}.board.sound.${id}`, "audio");
    if (asset) addAudio(ctx, { id: `${s.id}/sound/${id}`, asset, role: "sfx", from: s.from, durationInFrames: s.durationInFrames });
  };
  const audition = (c: BoardCard, s: CompiledScene, start: number, duration: number) => {
    const person = participant(c), local = effectiveSettings(ctx, settings, person.settings);
    if (mergeSettings(ctx.settings, template.settings, person.settings).card?.playSound === false) return;
    const key = person.media?.audio ?? person.media?.visual;
    const source = key ? ctx.manifest[key] : undefined;
    if (!source || source.kind === "image" || (source.kind === "video" && source.hasAudio !== true)) return;
    const asset = resolveAsset(ctx, key, `source.participants.${person.id}.media.audio`, "audio");
    if (asset) addAudio(ctx, { id: `${s.id}/primary/${c.id}`, asset, role: "primary", from: s.from + start, durationInFrames: duration, offsetSec: person.bestMomentSec ?? local.card?.offsetSec, volume: local.card?.volume });
  };
  const shuffle = (cards: BoardCard[], index: number) => {
    const result = [...cards]; let seed = (ctx.document.seed + index * 2654435761) >>> 0;
    for (let i = result.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  };
  const actions = (resolved: typeof resolution.rounds[number]) => {
    for (const step of resolved.steps) {
      const { action, before, after } = step;
      const s = scene(`action/${encodeURIComponent(action.id)}`, moveFrames + holdFrames, after, resolved.round.prompt);
      s.roundId = resolved.round.id;
      const beforeRects = placements(before), afterRects = placements(after);
      const hero = tileRects(1, candidateArea)[0];
      const ids = new Set([...beforeRects.keys(), ...afterRects.keys()]);
      for (const id of ids) {
        const old = beforeRects.get(id), dest = afterRects.get(id);
        if (old && dest && old.x === dest.x && old.y === dest.y && old.width === dest.width) continue;
        let n = s.nodes.find((node) => node.cardId === id);
        if (!n && old) n = cardNode(s, allCards.get(id)!, old, true);
        if (!n) continue;
        const start = old ?? hero, end = dest ?? hero;
        const endScale = dest ? 1 : hero.width / n.rect.width;
        const startScale = start.width / n.rect.width;
        const centerX = (r: Rect) => r.x + r.width / 2, centerY = (r: Rect) => r.y + r.height / 2;
        n.layer = 15;
        const last = Math.max(1, moveFrames - 1);
        n.animation = [
          { property: "x", easing: "easeInOut", keyframes: [{ frame: 0, value: centerX(start) - centerX(n.rect) }, { frame: last, value: centerX(end) - centerX(n.rect) }] },
          { property: "y", easing: "easeInOut", keyframes: [{ frame: 0, value: centerY(start) - centerY(n.rect) }, { frame: last, value: centerY(end) - centerY(n.rect) }] },
          { property: "scale", easing: "easeInOut", keyframes: [{ frame: 0, value: startScale }, { frame: last, value: endScale }] },
        ];
        if (!dest) n.animation.push({ property: "opacity", easing: "linear", keyframes: [{ frame: 0, value: 1 }, { frame: last, value: 0 }] });
      }
      const slotId = "slotId" in action ? action.slotId : after.placements[action.cardId] ?? before.placements[action.cardId];
      if (slotId) {
        const bg = s.nodes.find((n) => n.id.endsWith(`/slot/${encodeURIComponent(slotId)}`));
        if (bg) { bg.stroke = "#ffd166"; bg.strokeWidth = 5; }
      }
      s.boardEvents!.push({ event: `board.${action.type}` as BoardEvent["event"], frame: 0, cardId: action.cardId, participantId: allCards.get(action.cardId)?.participantId, slotId, actionId: action.id });
      if (action.comment) text(s, "comment", action.comment, { x: ctx.width * .04, y: ctx.height * .89, width: ctx.width * .59, height: ctx.height * .08 }, 34);
      sound(action.sound ?? b.slots.find((slot) => slot.id === slotId)?.sound, s, action.id);
    }
    const duration = holdFrames;
    if (duration) scene(`round/${resolved.round.id}/result`, duration, resolved.final, resolved.round.prompt).roundId = resolved.round.id;
  };
  const lead = f(p.leadSec, .4);
  if (lead) scene("empty", lead, createBoardState());
  for (const [index, resolved] of resolution.rounds.entries()) {
    const round = resolved.round, state = p.answerReveal === "end" ? createBoardState() : resolved.initial;
    const candidates = p.shuffleCandidates ? shuffle(round.cards, index) : round.cards;
    const sequential = p.reveal === "sequential";
    const groups = sequential ? candidates.map((c) => [c]) : candidates.length ? [candidates] : [];
    let displayed: BoardCard[] = [];
    for (const group of groups) {
      displayed = sequential ? (p.focusActive === false ? [...displayed, ...group] : group) : group;
      const s = scene(`round/${round.id}/reveal`, revealFrames * group.length, state, round.prompt); s.roundId = round.id;
      const rects = tileRects(displayed.length, candidateArea);
      displayed.forEach((c, i) => {
        const activeIndex = group.findIndex((item) => item.id === c.id);
        const active = activeIndex < 0 ? undefined : { from: activeIndex * revealFrames, to: (activeIndex + 1) * revealFrames };
        cardNode(s, c, rects[i], false, active);
        if (active) {
          s.boardEvents!.push({ event: "board.reveal", frame: active.from, cardId: c.id, participantId: c.participantId });
          audition(c, s, active.from, revealFrames);
        }
      });
    }
    const think = f(p.thinkSec, 2);
    if (think) {
      const s = scene(`round/${round.id}/think`, think, state, round.prompt); s.roundId = round.id;
      const shown = p.focusActive === false || !sequential ? candidates : displayed;
      tileRects(shown.length, candidateArea).forEach((r, i) => cardNode(s, shown[i], r, false));
      const timer = baseNode(`${s.id}/timer`, "timer", { x: ctx.width * .43, y: ctx.height * .88, width: ctx.width * .14, height: ctx.height * .08 }, think, { color: "#ffd166", fontSize: 56 });
      timer.timerFrames = think; timer.layer = 20; s.nodes.push(timer); s.phases.timerStartFrame = 0;
    }
    if (p.answerReveal !== "end") actions(resolved);
  }
  if (p.answerReveal === "end") resolution.rounds.forEach(actions);
  const summary = scene("summary", f(p.finalSec, 2, 1), resolution.final);
  summary.boardEvents!.push({ event: "board.summary", frame: 0 });
  const focus = f(p.rowFocusSec, 0);
  if (focus) for (const slot of b.slots) {
    const s = scene(`focus/${encodeURIComponent(slot.id)}`, focus, resolution.final, slot.label, slot.id);
    s.boardEvents!.push({ event: "board.summary", frame: 0, slotId: slot.id });
  }
  return scenes;
}
