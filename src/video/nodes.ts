import {
  setNodeMotion,
  normalizeTimer,
  normalizeVersus,
} from "./motion-compiler";
import type {
  CompiledNode,
  CompiledScene,
  Participant,
  PickerRound,
  Rect,
  Settings,
  TextValue,
  VideoNode,
  Window,
} from "./types";
import {
  diagnostic,
  effectiveSettings,
  resolveAsset,
  type CompileContext,
} from "./context";
import { frames } from "./settings";
import { layoutCards, resolveRect } from "./layout";
import { compileMedia } from "./media";
import { addAudio } from "./audio";
export function baseNode(
  id: string,
  type: CompiledNode["type"],
  rect: Rect,
  duration: number,
  style: CompiledNode["style"] = {},
): CompiledNode {
  return {
    id,
    type,
    rect,
    layer: 0,
    from: 0,
    durationInFrames: duration,
    visible: [{ from: 0, to: duration }],
    style,
    opacity: 1,
    rotate: 0,
    scale: 1,
    animation: [],
  };
}
export function labelWindows(
  settings: Settings,
  start: number,
  activeEnd: number,
  finale: number,
  answer: number | undefined,
  end: number,
  fps: number,
): Window[] {
  const mode = settings.labels?.mode ?? "always";
  if (mode === "never") return [];
  const from =
    mode === "finale" ? finale : mode === "answer" ? (answer ?? end) : start;
  const to = mode === "active" ? activeEnd : end;
  const delay = Math.round((settings.labels?.delaySec ?? 0) * fps);
  const hold =
    settings.labels?.holdSec === undefined
      ? Infinity
      : Math.round(settings.labels.holdSec * fps);
  return from + delay < to
    ? [{ from: from + delay, to: Math.min(to, from + delay + hold) }]
    : [];
}
export function boundText(
  ctx: CompileContext,
  value: TextValue,
  p?: Participant,
  r?: PickerRound,
): string {
  if (typeof value === "string") return value;
  let result: string | number | undefined;
  switch (value.bind) {
    case "document.title":
      result = ctx.document.title;
      break;
    case "participant.label":
      result = p?.label;
      break;
    case "participant.rank":
      result = p?.rank;
      break;
    case "participant.comment":
      result = p?.comment;
      break;
    case "participant.album":
      result = p?.album;
      break;
    case "participant.score":
      result = p?.score;
      break;
    case "segment.title":
      result = ctx.segment?.title;
      break;
    case "segment.subtitle":
      result = ctx.segment?.subtitle;
      break;
    case "segment.number":
      result = ctx.segmentNumber;
      break;
    case "segment.count":
      result = ctx.segmentCount;
      break;
    case "round.prompt":
      result = r?.prompt;
      break;
    case "group.label":
      result = value.groupId
        ? r?.groups?.find((g) => g.id === value.groupId)?.label
        : r?.groups?.length === 1
          ? r.groups[0].label
          : undefined;
      break;
  }
  if (result === undefined)
    diagnostic(
      ctx,
      "TEXT_BINDING_UNRESOLVED",
      `Text binding ${value.bind} has no value in this context.`,
      "nodes.text",
      undefined,
      "warning",
    );
  return `${value.prefix ?? ""}${result ?? ""}${value.suffix ?? ""}`;
}
function mediaKey(
  ctx: CompileContext,
  key: string,
  participant: Participant | undefined,
  nodeId: string,
): string | undefined {
  const dynamic =
    key === "$participant.visual"
      ? participant?.media?.visual
      : key === "$participant.audio"
        ? participant?.media?.audio
        : key === "$segment.poster"
          ? ctx.segment?.poster
          : key;
  if (key.startsWith("$") && !dynamic)
    diagnostic(
      ctx,
      "MEDIA_BINDING_UNRESOLVED",
      `Media binding ${key} has no value in this context.`,
      `nodes.${nodeId}.asset`,
      nodeId,
    );
  return dynamic;
}
export function compileCustomNodes(
  ctx: CompileContext,
  scene: CompiledScene,
  nodes: VideoNode[],
  settings: Settings,
  participant?: Participant,
  round?: PickerRound,
  authoredPlaySound: boolean | undefined = ctx.settings.card?.playSound,
  parent: Rect = { x: 0, y: 0, width: ctx.width, height: ctx.height },
  parentId?: string,
  parentFrom = 0,
  parentEnd = scene.durationInFrames,
  flow: "parallel" | "sequence" = "parallel",
  layout?: Settings["layout"],
): void {
  if (layout?.type === "free" && layout.positions?.length !== nodes.length) {
    diagnostic(
      ctx,
      "LAYOUT_POSITIONS_MISMATCH",
      "Free layout needs one position per child.",
      `nodes.${parentId ?? scene.id}.layout.positions`,
      parentId,
    );
  }
  let cursor = parentFrom;
  const rects = layout
    ? layoutCards(nodes.length, parent, layout, settings.card?.orientation)
    : undefined;
  for (const [index, node] of nodes.entries()) {
    const id = `${scene.id}/node/${encodeURIComponent(node.id)}`;
    const from =
      (flow === "sequence" ? cursor : parentFrom) +
      frames(node.timing?.at, ctx.fps);
    const duration = Math.min(
      frames(node.timing?.duration, ctx.fps, parentEnd - from),
      parentEnd - from,
    );
    if (duration <= 0) {
      diagnostic(
        ctx,
        "NODE_OUTSIDE_SCENE",
        "Node has no visible frames inside its scene.",
        `nodes.${node.id}.timing`,
        node.id,
      );
      continue;
    }
    const end = from + duration;
    cursor = end;
    const style = {
      ...settings.card,
      ...node.style,
      ...(node.type === "video" &&
      node.asset === "$participant.visual" &&
      participant?.bestMomentSec !== undefined
        ? { offsetSec: participant.bestMomentSec }
        : {}),
    };
    if (node.type === "audio") {
      const asset = resolveAsset(
        ctx,
        mediaKey(ctx, node.asset, participant, node.id),
        `nodes.${node.id}.asset`,
        "audio",
      );
      if (asset)
        addAudio(ctx, {
          ...node,
          offsetSec:
            node.asset === "$participant.audio"
              ? (participant?.bestMomentSec ?? node.offsetSec)
              : node.offsetSec,
          id,
          asset,
          from: scene.from + from,
          durationInFrames: duration,
        });
      continue;
    }
    const rect = node.rect
      ? resolveRect(node.rect, parent, node.units, node.anchor)
      : (rects?.[index] ?? { ...parent });
    const compiled = baseNode(id, node.type, rect, duration, style);
    Object.assign(compiled, {
      from,
      visible: [{ from, to: end }],
      parentId,
      layer: node.layer ?? 0,
      opacity: node.opacity ?? 1,
      rotate: node.rotate ?? 0,
      scale: node.scale ?? 1,
      animation: (node.animation ?? []).map((a) => ({
        property: a.property,
        easing: a.easing ?? "linear",
        keyframes: a.keyframes
          .map((k) => ({ frame: frames(k.at, ctx.fps), value: k.value }))
          .sort((a, b) => a.frame - b.frame),
      })),
    });
    setNodeMotion(
      compiled,
      node.type === "container"
        ? node.motion
        : { ...settings.motion, ...node.motion },
    );
    for (const animation of compiled.animation) {
      if (
        new Set(animation.keyframes.map((k) => k.frame)).size !==
        animation.keyframes.length
      ) {
        diagnostic(
          ctx,
          "ANIMATION_KEYFRAMES_INVALID",
          "Keyframe times must resolve to distinct frames.",
          `nodes.${node.id}.animation`,
          node.id,
        );
      }
    }
    if (node.type === "text")
      compiled.text = boundText(ctx, node.text, participant, round);
    if (node.type === "shape")
      Object.assign(compiled, {
        shape: node.shape,
        path: node.path,
        fill: node.fill,
        stroke: node.stroke,
        strokeWidth: node.strokeWidth,
      });
    if (node.type === "image" || node.type === "video") {
      const asset = resolveAsset(
        ctx,
        mediaKey(ctx, node.asset, participant, node.id),
        `nodes.${node.id}.asset`,
        "visual",
        node.required !== false,
      );
      if (asset) {
        if (asset.kind !== node.type)
          diagnostic(
            ctx,
            "ASSET_KIND_MISMATCH",
            `Expected ${node.type} media.`,
            `nodes.${node.id}.asset`,
            node.id,
          );
        else {
          compiled.media = compileMedia(
            ctx,
            asset,
            style,
            `nodes.${node.id}.style.offsetSec`,
          );
          if (asset.kind === "video" && asset.hasAudio && style.playSound)
            addAudio(ctx, {
              id: `${id}/primary`,
              asset,
              role: "primary",
              from: scene.from + from,
              durationInFrames: duration,
              offsetSec: style.offsetSec,
              loop: style.loop,
              volume: style.volume,
            });
        }
      }
    }
    if (node.type === "timer") {
      compiled.timerFrames = frames(node.duration, ctx.fps, duration);
      const { variant, color, trackColor, strokeWidth, showValue, warningSec } =
        node;
      if (
        settings.timer ||
        [variant, color, trackColor, strokeWidth, showValue, warningSec].some(
          (v) => v !== undefined,
        )
      )
        compiled.timer = normalizeTimer(
          Object.fromEntries(
            Object.entries({
              ...settings.timer,
              ...Object.fromEntries(
                Object.entries({
                  variant,
                  color,
                  trackColor,
                  strokeWidth,
                  showValue,
                  warningSec,
                }).filter(([, v]) => v !== undefined),
              ),
            }).filter(([, v]) => v !== undefined),
          ),
        );
    }
    if (node.type === "versus")
      compiled.versus = normalizeVersus({
        ...settings.versus,
        ...(node.variant ? { variant: node.variant } : {}),
        ...(node.color ? { color: node.color } : {}),
      });
    if (node.type === "badge") {
      compiled.badge = {
        kind: node.kind,
        ...(node.color ? { color: node.color } : {}),
      };
      compiled.text =
        node.text !== undefined
          ? boundText(ctx, node.text, participant, round)
          : node.kind === "rank"
            ? String(participant?.rank ?? "")
            : node.kind === "winner"
              ? "Победитель"
              : node.kind === "round" && round
                ? String(ctx.document.source.rounds.indexOf(round) + 1)
                : "";
      if (!compiled.text)
        diagnostic(
          ctx,
          "WIDGET_BINDING_UNRESOLVED",
          `Badge ${node.kind} has no value in this context.`,
          `nodes.${node.id}`,
          node.id,
        );
      if (node.kind === "winner" && node.text === undefined) {
        const answer = scene.phases.answerStartFrame;
        if (answer !== undefined)
          compiled.visible =
            answer < end ? [{ from: Math.max(from, answer), to: end }] : [];
        else if (round?.answer) compiled.visible = [];
        else
          diagnostic(
            ctx,
            "WIDGET_BINDING_UNRESOLVED",
            "Winner badge requires an answer event.",
            `nodes.${node.id}`,
            node.id,
          );
      }
    }
    if (node.type === "progress")
      compiled.progress = {
        scope: node.scope ?? "scene",
        color: node.color ?? "#ffffff",
        trackColor: node.trackColor ?? "#ffffff33",
        strokeWidth: node.strokeWidth ?? 6,
        from: 0,
        durationInFrames: scene.durationInFrames,
      };
    if (node.type === "card") {
      const p =
        node.participantId === "$participant"
          ? participant
          : ctx.document.source.participants.find(
              (p) => p.id === node.participantId,
            );
      if (!p)
        diagnostic(
          ctx,
          "PARTICIPANT_NOT_FOUND",
          `Participant ${node.participantId} no longer exists.`,
          `nodes.${node.id}.participantId`,
          node.id,
        );
      else {
        const local = effectiveSettings(ctx, settings, p.settings, {
          card: node.style,
        });
        setNodeMotion(compiled, { ...local.motion, ...node.motion });
        compiled.style = {
          ...local.card,
          ...(p.bestMomentSec !== undefined
            ? { offsetSec: p.bestMomentSec }
            : {}),
        };
        compiled.participantId = p.id;
        compiled.rank = p.rank;
        compiled.showRank = local.labels?.showRank ?? true;
        compiled.label = node.label
          ? boundText(ctx, node.label, p, round)
          : (p.caption ?? p.label);
        compiled.labelWindows = labelWindows(
          local,
          from,
          end,
          from,
          undefined,
          end,
          ctx.fps,
        );
        const asset = resolveAsset(
          ctx,
          p.media?.visual,
          `source.participants.${p.id}.media.visual`,
          "visual",
        );
        if (asset)
          compiled.media = compileMedia(
            ctx,
            asset,
            compiled.style,
            `nodes.${node.id}.style.offsetSec`,
          );
        // DEFAULT_SETTINGS.playSound:false controls embedded footage only.
        // Only v2 adds full mute. Legacy v1 keeps its separate participant audio.
        const playSound =
          node.style?.playSound ??
          p.settings?.card?.playSound ??
          authoredPlaySound;
        const audio =
          ctx.segment && playSound === false
            ? undefined
            : (resolveAsset(
                ctx,
                p.media?.audio,
                `source.participants.${p.id}.media.audio`,
                "audio",
              ) ??
              (asset?.kind === "video" &&
              asset.hasAudio &&
              compiled.style.playSound
                ? asset
                : undefined));
        if (audio)
          addAudio(ctx, {
            id: `${id}/primary`,
            asset: audio,
            role: "primary",
            from: scene.from + from,
            durationInFrames: duration,
            offsetSec: compiled.style.offsetSec,
            loop: compiled.style.loop,
            volume: compiled.style.volume,
          });
      }
    }
    scene.nodes.push(compiled);
    if (node.type === "container" && node.repeat === "participants") {
      const collection = [
        ...(node.selection === "document"
          ? (ctx.allParticipants ?? ctx.document.source.participants)
          : ctx.document.source.participants),
      ].filter(
        (p) =>
          node.selection !== "revealed" ||
          ctx.revealedParticipantIds?.has(p.id),
      );
      const order = settings.top?.order;
      if (order === "ascending" || order === "descending")
        collection.sort(
          (a, b) =>
            ((a.rank ?? Infinity) - (b.rank ?? Infinity)) *
            (order === "ascending" ? 1 : -1),
        );
      if (
        node.layout?.type === "free" &&
        node.layout.positions?.length !== collection.length
      )
        diagnostic(
          ctx,
          "LAYOUT_POSITIONS_MISMATCH",
          "Participant set free layout needs one position per participant.",
          `nodes.${node.id}.layout.positions`,
          node.id,
        );
      const items = layoutCards(
        collection.length,
        rect,
        node.layout,
        settings.card?.orientation,
      );
      collection.forEach((p, i) => {
        const suffix = encodeURIComponent(p.id);
        const clone = (n: VideoNode): VideoNode =>
          n.type === "container"
            ? { ...n, id: `${n.id}/${suffix}`, children: n.children.map(clone) }
            : { ...n, id: `${n.id}/${suffix}` };
        compileCustomNodes(
          ctx,
          scene,
          node.children.map(clone),
          effectiveSettings(ctx, settings, { card: node.style }),
          p,
          round,
          node.style?.playSound ?? authoredPlaySound,
          items[i],
          id,
          from,
          end,
          node.flow,
        );
      });
    } else if (node.type === "container")
      compileCustomNodes(
        ctx,
        scene,
        node.children,
        effectiveSettings(ctx, settings, { card: node.style }),
        participant,
        round,
        node.style?.playSound ?? authoredPlaySound,
        rect,
        id,
        from,
        end,
        node.flow,
        node.layout,
      );
  }
}
