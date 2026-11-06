import type { CompileContext } from "./context";
import { diagnostic, effectiveSettings, resolveAsset } from "./context";
import type {
  CompiledNode,
  CompiledScene,
  PickerRound,
  Settings,
  VideoScene,
  Window,
} from "./types";
import type {
  ChoreographyName,
  MotionAnchor,
  MotionChannel,
  MotionSettings,
  MotionSpec,
  TimerSettings,
  VersusSettings,
} from "./motion-types";
import { frames } from "./settings";
import { motionChannels } from "./motion-catalog";
import { compileMedia } from "./media";
import { baseNode } from "./nodes";
const channels: MotionChannel[] = ["enter", "exit", "loop", "emphasis"];
const multiplier = (v: MotionSettings["intensity"]) =>
  v === "subtle" ? 0.5 : v === "bold" ? 1.5 : 1;
const authoredMotion = new WeakMap<CompiledNode, MotionSettings>();
/** Keeps authored overrides out of serialized IR, including repeated custom nodes. */
export function setNodeMotion(
  node: CompiledNode,
  motion: MotionSettings | undefined,
): void {
  if (motion) authoredMotion.set(node, motion);
}
export function normalizeTimer(
  settings: TimerSettings,
): Required<TimerSettings> {
  return {
    variant: settings.variant ?? "digits",
    color: settings.color ?? "#ffffff",
    trackColor: settings.trackColor ?? "#ffffff33",
    strokeWidth: settings.strokeWidth ?? 6,
    showValue: settings.showValue ?? true,
    warningSec: settings.warningSec ?? 3,
  };
}
export function normalizeVersus(
  settings: VersusSettings,
): Required<VersusSettings> {
  return {
    variant: settings.variant ?? "clean",
    color: settings.color ?? "#ffffff",
  };
}
function anchorFrame(
  scene: CompiledScene,
  node: CompiledNode,
  anchor: MotionAnchor,
): number | undefined {
  if ("sec" in anchor || "frame" in anchor) return undefined; // Time handled with fps at the caller.
  let frame: number | undefined;
  if (anchor.event === "scene.start") frame = 0;
  else if (anchor.event === "card.reveal")
    frame =
      node.activeWindow?.from ??
      (node.type === "card"
        ? node.visible[0]?.from
        : scene.phases.revealStartFrame);
  else if (anchor.event === "timer.start") frame = scene.phases.timerStartFrame;
  else if (anchor.event === "answer.reveal")
    frame = node.answerFrom ?? scene.phases.answerStartFrame;
  else
    frame = scene.boardEvents?.find(
      (e) =>
        e.event === anchor.event &&
        (!anchor.cardId || e.cardId === anchor.cardId) &&
        (!anchor.slotId || e.slotId === anchor.slotId) &&
        (!anchor.actionId || e.actionId === anchor.actionId),
    )?.frame;
  return frame;
}
function recipeCompatible(
  scene: CompiledScene,
  name: ChoreographyName,
  template?: VideoScene,
  round?: PickerRound,
): boolean {
  if (name === "versus-impact")
    return (
      scene.nodes.filter((n) => n.type === "card").length === 2 &&
      ["picker", "answer"].includes(scene.kind)
    );
  if (name === "picker-cascade")
    return ["picker", "answer"].includes(scene.kind);
  if (name === "winner-spotlight")
    return (
      scene.nodes.some((n) => n.answer) &&
      (scene.phases.answerStartFrame !== undefined || !!round?.answer)
    );
  if (name === "rank-reveal") return scene.kind === "top";
  if (name === "podium-finale")
    return scene.nodes.some((n) => n.type === "card" && n.rank !== undefined);
  if (name === "board-place")
    return (
      scene.kind === "board" &&
      !!template?.board?.rounds.some((r) =>
        r.actions.some((a) => ["place", "move", "replace"].includes(a.type)),
      )
    );
  if (name === "board-swap")
    return (
      scene.kind === "board" &&
      !!template?.board?.rounds.some((r) =>
        r.actions.some((a) => a.type === "swap"),
      )
    );
  if (name === "title-reveal")
    return scene.nodes.some((n) => n.type === "text" && n.text);
  if (name === "cinematic-pan") return scene.nodes.some((n) => n.media);
  return (
    scene.kind === "picker" || scene.kind === "answer" || scene.kind === "board"
  );
}
function recipeFor(
  scene: CompiledScene,
  node: CompiledNode,
  name: ChoreographyName | undefined | null,
  index: number,
): MotionSettings {
  if (!name) return {};
  const card = node.type === "card";
  switch (name) {
    case "versus-impact":
      return card
        ? {
            enter: { name: index % 2 ? "slide-left" : "slide-right" },
            emphasis: node.answer
              ? { name: "stamp", at: { event: "answer.reveal" } }
              : null,
          }
        : node.type === "versus"
          ? { enter: "elastic" }
          : {};
    case "picker-cascade":
      return card
        ? {
            enter: "pop",
            emphasis: node.answer
              ? { name: "pulse", at: { event: "answer.reveal" } }
              : null,
          }
        : node.type === "timer"
          ? {
              enter: "zoom-in",
              emphasis: { name: "pulse", at: { event: "timer.start" } },
            }
          : {};
    case "winner-spotlight":
      return node.answer
        ? { emphasis: { name: "spotlight", at: { event: "answer.reveal" } } }
        : {};
    case "rank-reveal":
      return card
        ? { enter: "wipe-reveal" }
        : node.type === "text" || node.type === "badge"
          ? { enter: { name: "text-slam", delay: { sec: 0.12 } } }
          : {};
    case "podium-finale":
      return card && node.rank !== undefined && node.rank <= 3
        ? { enter: "elastic", emphasis: { name: "glow", delay: { sec: 0.4 } } }
        : {};
    case "board-place": {
      const event = scene.boardEvents?.find(
        (e) =>
          e.cardId === node.cardId &&
          ["board.place", "board.move", "board.replace"].includes(e.event),
      );
      return card && event
        ? {
            emphasis: {
              name: "stamp",
              at: { event: event.event, cardId: node.cardId },
            },
          }
        : {};
    }
    case "board-swap":
      return card &&
        scene.boardEvents?.some(
          (e) =>
            e.event === "board.swap" &&
            (e.cardId === node.cardId || node.animation.length > 0),
        )
        ? { emphasis: { name: "outline", at: { event: "board.swap" } } }
        : {};
    case "title-reveal":
      return node.type === "text" ? { enter: "text-words" } : {};
    case "cinematic-pan":
      return node.media ? { enter: "fade", loop: "ken-burns" } : {};
    case "round-intro":
      return node.type === "text"
        ? { enter: "text-slam" }
        : card
          ? { enter: "slide-up" }
          : node.type === "badge"
            ? { enter: "pop" }
            : {};
  }
}
function localSettings(
  ctx: CompileContext,
  settings: Settings,
  node: CompiledNode,
  round?: PickerRound,
): Settings {
  const p = ctx.document.source.participants.find(
    (p) => p.id === node.participantId,
  );
  const card = round?.cards.find((c) => c.id === node.cardId);
  const group = round?.groups?.find((g) => g.id === node.groupId);
  return effectiveSettings(
    ctx,
    settings,
    p?.settings,
    group?.settings,
    card?.settings,
  );
}
interface MotionBudget {
  fragments: number;
  perNode: Map<CompiledNode, number>;
}
function cascadeRanks(
  nodes: CompiledNode[],
): Record<string, Map<CompiledNode, number>> {
  const forward = new Map(nodes.map((node, index) => [node, index]));
  const rows = [...nodes].sort(
    (a, b) =>
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      forward.get(a)! - forward.get(b)!,
  );
  return {
    forward,
    reverse: new Map(
      nodes.map((node, index) => [node, nodes.length - 1 - index]),
    ),
    center: new Map(
      nodes.map((node, index) => [
        node,
        Math.abs(index - (nodes.length - 1) / 2),
      ]),
    ),
    rows: new Map(rows.map((node, index) => [node, index])),
  };
}
function compileChannel(
  ctx: CompileContext,
  scene: CompiledScene,
  node: CompiledNode,
  channel: MotionChannel,
  input: MotionSpec,
  settings: MotionSettings,
  rank: number,
  maxRank: number,
  budget: MotionBudget,
): void {
  const spec = typeof input === "string" ? { name: input } : input;
  const name = spec.name === "flip" ? "flip-y" : spec.name;
  if (!motionChannels(name).includes(channel)) {
    diagnostic(
      ctx,
      "MOTION_CHANNEL_INCOMPATIBLE",
      `${name} cannot be used as ${channel}.`,
      `nodes.${node.id}.motion`,
      node.id,
    );
    return;
  }
  if (
    name.startsWith("text-") &&
    node.type !== "text" &&
    node.type !== "badge"
  ) {
    diagnostic(
      ctx,
      "MOTION_NODE_INCOMPATIBLE",
      `${name} requires a text or badge node.`,
      `nodes.${node.id}.motion`,
      node.id,
    );
    return;
  }
  let fragments: number | undefined;
  if (name.startsWith("text-")) {
    const text = node.text ?? "";
    if (name === "text-counter" && !/^\s*[-+]?\d+(?:[.,]\d+)?\s*$/.test(text)) {
      diagnostic(
        ctx,
        "MOTION_TEXT_COUNTER_INVALID",
        "Text counter requires numeric text.",
        `nodes.${node.id}.motion`,
        node.id,
      );
      return;
    }
    fragments =
      name === "text-letters"
        ? Array.from(text).length
        : name === "text-words"
          ? text.trim().split(/\s+/).filter(Boolean).length
          : name === "text-lines"
            ? text.split("\n").length
            : 1;
    const otherFragments = budget.fragments - (budget.perNode.get(node) ?? 0);
    if (fragments + otherFragments > 500) {
      diagnostic(
        ctx,
        "MOTION_TEXT_BUDGET_EXCEEDED",
        "Text motion exceeds 500 visual fragments.",
        `nodes.${node.id}.motion`,
        node.id,
      );
      return;
    }
  }
  let explicit: number | undefined;
  if (spec.at) {
    if ("event" in spec.at) {
      const event = anchorFrame(scene, node, spec.at);
      if (event === undefined) {
        diagnostic(
          ctx,
          "MOTION_EVENT_UNAVAILABLE",
          `Event ${spec.at.event} is unavailable.`,
          `nodes.${node.id}.motion`,
          node.id,
        );
        return;
      }
      explicit = event + frames(spec.at.offset, ctx.fps);
    } else explicit = node.from + frames(spec.at, ctx.fps);
  }
  let emitted = false;
  for (const visible of node.visible) {
    const window: Window = {
      from: Math.max(0, node.from, visible.from),
      to: Math.min(
        scene.durationInFrames,
        node.from + node.durationInFrames,
        visible.to,
      ),
    };
    if (
      channel === "enter" &&
      node.activeWindow &&
      window.from <= node.activeWindow.from
    )
      window.to = Math.min(window.to, node.activeWindow.to);
    if (window.to <= window.from) continue;
    if (
      explicit !== undefined &&
      (explicit < window.from || explicit >= window.to)
    )
      continue;
    const available = window.to - window.from;
    const requested = Math.max(
      1,
      frames(
        spec.duration ?? settings.duration,
        ctx.fps,
        channel === "loop"
          ? available
          : Math.round(
              ctx.fps *
                (settings.profile === "snappy"
                  ? 0.25
                  : settings.profile === "cinematic"
                    ? 0.8
                    : 0.45),
            ),
      ),
    );
    const delay = frames(spec.delay, ctx.fps);
    const pairedEdges =
      (channel === "enter" || channel === "exit") &&
      !!settings.enter &&
      !!settings.exit &&
      explicit === undefined;
    const edgeBudget = pairedEdges
      ? Math.max(1, Math.floor((available - 1) / 2))
      : available;
    const duration = Math.min(requested, edgeBudget);
    const stagger = frames(settings.stagger?.interval, ctx.fps);
    const spread = Math.min(
      stagger * maxRank,
      Math.max(
        0,
        edgeBudget -
          Math.min(duration, Math.max(1, Math.floor(edgeBudget / 2))),
      ),
    );
    const offset = Math.round(maxRank ? (spread * rank) / maxRank : 0);
    const from =
      channel === "exit" && explicit === undefined
        ? Math.max(
            window.from,
            window.to -
              duration -
              Math.min(delay + offset, edgeBudget - duration),
          )
        : Math.min(
            (pairedEdges ? window.from + edgeBudget : window.to) - 1,
            (explicit ?? window.from) + delay + offset,
          );
    const durationInFrames = Math.max(
      1,
      Math.min(
        duration,
        (pairedEdges && channel === "enter"
          ? window.from + edgeBudget
          : window.to) - from,
      ),
    );
    if (fragments !== undefined) {
      const previous = budget.perNode.get(node) ?? 0;
      const next = Math.max(previous, fragments);
      budget.fragments += next - previous;
      budget.perNode.set(node, next);
    }
    emitted = true;
    (node.motion ??= []).push({
      name,
      channel,
      from,
      durationInFrames,
      profile: settings.profile ?? "smooth",
      intensity: multiplier(spec.intensity ?? settings.intensity),
      direction:
        spec.direction ??
        (name.endsWith("left")
          ? "left"
          : name.endsWith("right")
            ? "right"
            : name.endsWith("down")
              ? "down"
              : name === "zoom-out"
                ? "out"
                : name === "zoom-in"
                  ? "in"
                  : "up"),
      window,
      ...(fragments !== undefined ? { fragments } : {}),
    });
  }
  if (explicit !== undefined && !emitted)
    diagnostic(
      ctx,
      "MOTION_EVENT_OUTSIDE_WINDOW",
      "Motion anchor falls outside the visible node window.",
      `nodes.${node.id}.motion`,
      node.id,
    );
}
function compileBackdrop(
  ctx: CompileContext,
  scene: CompiledScene,
  settings: Settings,
  template: VideoScene,
  round?: PickerRound,
): void {
  const b = settings.backdrop;
  if (!b) return;
  const source = b.source ?? (b.asset ? "asset" : "current-card");
  const layers: NonNullable<CompiledScene["backdrop"]>["layers"] = [];
  const push = (
    key: string | undefined,
    from: number,
    to: number,
    required = false,
  ) => {
    if (!key || to <= from) return;
    // Optional unavailable artwork is neutral; explicit assets always diagnose.
    if (!required && !ctx.manifest[key]) return;
    const asset = resolveAsset(
      ctx,
      key,
      `scenes.${scene.id}.backdrop.asset`,
      "visual",
      required,
    );
    if (!asset) return;
    const media = compileMedia(
      ctx,
      asset,
      { fit: "cover", loop: true },
      `scenes.${scene.id}.backdrop.asset`,
    );
    layers.push({
      from,
      to,
      fadeInFrames: Math.min(Math.round(ctx.fps * 0.3), to - from),
      media,
    });
  };
  if (b.asset) push(b.asset, 0, scene.durationInFrames, true);
  else if (source === "round")
    push(round?.background ?? template.background, 0, scene.durationInFrames);
  else if (source === "current-card") {
    if (scene.kind === "top")
      push(
        scene.nodes.find((n) => n.type === "card")?.media?.asset
          ? ctx.document.source.participants.find(
              (p) => p.id === scene.participantId,
            )?.media?.visual
          : undefined,
        0,
        scene.durationInFrames,
      );
    else if (scene.kind === "picker" || scene.kind === "answer") {
      const timer = scene.phases.timerStartFrame ?? 0;
      const answer = scene.phases.answerStartFrame ?? scene.durationInFrames;
      const cards = scene.nodes
        .filter((n) => n.type === "card")
        .sort(
          (a, b) =>
            (a.activeWindow?.from ?? a.from) - (b.activeWindow?.from ?? b.from),
        );
      for (const card of cards) {
        if (card.activeWindow)
          push(
            ctx.document.source.participants.find(
              (p) => p.id === card.participantId,
            )?.media?.visual,
            card.activeWindow.from,
            Math.min(card.activeWindow.to, timer),
          );
      }
      // Decision phase is stable round media, never a future winner.
      push(
        round?.background ?? template.background,
        scene.kind === "answer" ? 0 : timer,
        answer,
      );
      const winner = cards.find((n) => n.answer);
      if (winner && answer < scene.durationInFrames)
        push(
          ctx.document.source.participants.find(
            (p) => p.id === winner.participantId,
          )?.media?.visual,
          answer,
          scene.durationInFrames,
        );
    } else
      push(round?.background ?? template.background, 0, scene.durationInFrames);
  }
  for (let i = 1; i < layers.length; i++) {
    const previous = layers[i - 1],
      current = layers[i];
    if (previous.to === current.from)
      previous.to = Math.min(
        scene.durationInFrames,
        current.to,
        current.from + current.fadeInFrames,
      );
  }
  scene.backdrop = {
    preset: b.preset,
    source,
    colors: b.colors ?? ["#101522", "#33456b"],
    blur: b.blur ?? (b.preset === "art-blur" ? 32 : 0),
    dim: b.dim ?? 0.4,
    motion: b.motion ?? true,
    intensity: multiplier(b.intensity),
    particles:
      b.particles ??
      (b.preset === "particles" ? 24 : b.preset === "light-orbs" ? 6 : 0),
    layers,
  };
}
/** Post-pass: recipes, inheritance and event resolution. Never alters semantic timing or audio. */
export function applySceneMotion(
  ctx: CompileContext,
  scene: CompiledScene,
  template: VideoScene,
  settings: Settings,
  round?: PickerRound,
): void {
  const recipe = settings.motion?.choreography;
  const compatible =
    !recipe || recipeCompatible(scene, recipe, template, round);
  if (recipe && !compatible)
    diagnostic(
      ctx,
      "MOTION_CHOREOGRAPHY_INCOMPATIBLE",
      `Choreography ${recipe} is incompatible with this scene.`,
      `scenes.${scene.id}.settings.motion.choreography`,
    );
  if (
    recipe &&
    compatible &&
    recipe === "versus-impact" &&
    !scene.nodes.some((n) => n.type === "versus")
  ) {
    const vs = baseNode(
      `${scene.id}/motion/versus`,
      "versus",
      {
        x: ctx.width * 0.42,
        y: ctx.height * 0.38,
        width: ctx.width * 0.16,
        height: ctx.height * 0.18,
      },
      scene.durationInFrames,
    );
    vs.layer = 20;
    vs.versus = normalizeVersus(settings.versus ?? { variant: "impact" });
    scene.nodes.push(vs);
  }
  if (recipe && compatible && ["rank-reveal", "round-intro"].includes(recipe)) {
    const badge = baseNode(
      `${scene.id}/motion/badge`,
      "badge",
      {
        x: ctx.width * 0.04,
        y: ctx.height * 0.04,
        width: ctx.width * 0.2,
        height: ctx.height * 0.1,
      },
      scene.durationInFrames,
    );
    badge.layer = 20;
    badge.badge = {
      kind: recipe === "rank-reveal" ? "rank" : "round",
      color: "#ffffff",
    };
    badge.text =
      recipe === "rank-reveal"
        ? String(scene.nodes.find((n) => n.rank !== undefined)?.rank ?? "")
        : String((round ? ctx.document.source.rounds.indexOf(round) : 0) + 1);
    scene.nodes.push(badge);
  }
  const candidates = scene.nodes.filter(
    (n) => n.layer > -100 && (n.type !== "container" || authoredMotion.has(n)),
  );
  const ranks = cascadeRanks(candidates);
  const budget: MotionBudget = { fragments: 0, perNode: new Map() };
  for (const [index, node] of candidates.entries()) {
    const local = localSettings(ctx, settings, node, round);
    const inherited = { ...local.motion, ...authoredMotion.get(node) };
    const localRecipe = inherited.choreography;
    let selected =
      localRecipe === null
        ? undefined
        : (localRecipe ?? (compatible ? recipe : undefined));
    if (
      selected &&
      selected !== recipe &&
      !recipeCompatible(scene, selected, template, round)
    ) {
      diagnostic(
        ctx,
        "MOTION_CHOREOGRAPHY_INCOMPATIBLE",
        `Choreography ${selected} is incompatible with this scene.`,
        `nodes.${node.id}.motion.choreography`,
        node.id,
      );
      selected = undefined;
    }
    const defaults = recipeFor(scene, node, selected, index);
    if (
      scene.kind === "picker" &&
      scene.phases.answerStartFrame === undefined &&
      defaults.emphasis &&
      typeof defaults.emphasis === "object" &&
      defaults.emphasis.at &&
      "event" in defaults.emphasis.at &&
      defaults.emphasis.at.event === "answer.reveal"
    )
      delete defaults.emphasis;
    const m: MotionSettings = { ...defaults, ...inherited };
    if (m.stagger === undefined && selected === "picker-cascade")
      m.stagger = { interval: { sec: 0.08 }, order: "forward" };
    if (m.stagger === undefined && selected === "podium-finale")
      m.stagger = { interval: { sec: 0.12 }, order: "reverse" };
    const rank = ranks[m.stagger?.order ?? "forward"].get(node)!;
    const maxRank =
      m.stagger?.order === "center"
        ? (candidates.length - 1) / 2
        : candidates.length - 1;
    for (const channel of channels) {
      const spec = m[channel];
      if (spec)
        compileChannel(
          ctx,
          scene,
          node,
          channel,
          spec,
          m,
          rank,
          maxRank,
          budget,
        );
    }
    if (node.type === "timer" && local.timer)
      node.timer = normalizeTimer({ ...local.timer, ...node.timer });
    if (node.type === "versus")
      node.versus = normalizeVersus({ ...local.versus, ...node.versus });
  }
  compileBackdrop(ctx, scene, settings, template, round);
}
