import type {
  CompiledNode,
  CompiledScene,
  Participant,
  PickerCard,
  PickerRound,
  Rect,
  Settings,
  VideoScene,
} from "./types";
import {
  diagnostic,
  effectiveSettings,
  resolveAsset,
  type CompileContext,
} from "./context";
import { frames, mergeSettings } from "./settings";
import { layoutCards, resolveRect } from "./layout";
import { compileMedia } from "./media";
import { addAudio } from "./audio";
import { baseNode, labelWindows } from "./nodes";
export function makeScene(
  ctx: CompileContext,
  template: VideoScene,
  id: string,
  kind: CompiledScene["kind"],
  from: number,
  duration: number,
  settings: Settings,
): CompiledScene {
  const durationInFrames = Math.max(1, duration);
  return {
    id,
    kind,
    from,
    durationInFrames,
    background: settings.background ?? "#101522",
    nodes: [],
    phases: {},
    transition: {
      type: template.transition?.type ?? "none",
      durationInFrames: Math.min(
        durationInFrames,
        frames(template.transition?.duration, ctx.fps),
      ),
    },
  };
}
export function addBackground(
  ctx: CompileContext,
  scene: CompiledScene,
  key: string | undefined,
): void {
  const asset = resolveAsset(
    ctx,
    key,
    `scenes.${scene.id}.background`,
    "visual",
  );
  if (!asset) return;
  const node = baseNode(
    `${scene.id}/background`,
    asset.kind === "video" ? "video" : "image",
    { x: 0, y: 0, width: ctx.width, height: ctx.height },
    scene.durationInFrames,
  );
  node.layer = -100;
  node.media = compileMedia(
    ctx,
    asset,
    { fit: "cover", loop: true },
    `scenes.${scene.id}.background`,
  );
  scene.nodes.unshift(node);
}
export function compileTop(
  ctx: CompileContext,
  template: VideoScene,
  p: Participant,
  from: number,
  settings: Settings,
): CompiledScene {
  const s = effectiveSettings(ctx, settings, p.settings);
  const snippet = s.top?.snippet;
  const audio = resolveAsset(
    ctx,
    p.media?.audio,
    `source.participants.${p.id}.media.audio`,
    "audio",
  );
  const visual = resolveAsset(
    ctx,
    p.media?.visual,
    `source.participants.${p.id}.media.visual`,
    "visual",
  );
  const source = audio ?? visual;
  let duration = frames(
    template.duration,
    ctx.fps,
    Math.max(
      1,
      Math.round((snippet?.durationSec ?? s.top?.durationSec ?? 5) * ctx.fps),
    ),
  );
  let offset = snippet?.startSec ?? 0;
  if (snippet?.mode === "full") {
    offset = 0;
    if (source?.durationSec)
      duration = Math.max(1, Math.floor(source.durationSec * ctx.fps));
    else
      diagnostic(
        ctx,
        "SNIPPET_DURATION_REQUIRED",
        "Full snippet requires an audio/video asset with duration.",
        `source.participants.${p.id}`,
      );
  }
  if (snippet?.mode === "active") {
    offset = snippet.activeStartSec ?? 0;
    const end = snippet.activeEndSec;
    if (end === undefined || end <= offset)
      diagnostic(
        ctx,
        "SNIPPET_RANGE_INVALID",
        "Active snippet requires activeEndSec greater than activeStartSec.",
        `source.participants.${p.id}`,
      );
    else duration = Math.max(1, Math.round((end - offset) * ctx.fps));
  }
  const scene = makeScene(
    ctx,
    template,
    `${encodeURIComponent(template.id)}/${encodeURIComponent(p.id)}`,
    "top",
    from,
    duration,
    s,
  );
  scene.participantId = p.id;
  if (s.layout?.type === "free" && s.layout.positions?.length !== 1) {
    diagnostic(
      ctx,
      "LAYOUT_POSITIONS_MISMATCH",
      "A top scene free layout needs exactly one card position.",
      `source.participants.${p.id}.settings.layout.positions`,
    );
  }
  const rect = layoutCards(
    1,
    { x: 0, y: 0, width: ctx.width, height: ctx.height },
    s.layout,
    s.card?.orientation,
  )[0];
  const card = baseNode(`${scene.id}/card`, "card", rect, duration, s.card);
  Object.assign(card, {
    participantId: p.id,
    rank: p.rank,
    showRank: s.labels?.showRank ?? true,
    label: p.label,
    labelWindows: labelWindows(s, 0, duration, 0, undefined, duration, ctx.fps),
    activeWindow: { from: 0, to: duration },
  });
  // The defaults contain offsetSec:0; inspect only authored layers to distinguish
  // a deliberate footage offset (including zero) from the implicit default.
  const authoredVisualOffset = mergeSettings(
    ctx.settings,
    template.settings,
    p.settings,
  ).card?.offsetSec;
  const visualStyle = { ...s.card };
  if (
    visual?.kind === "video" &&
    audio?.kind === "video" &&
    visual.id === audio.id &&
    authoredVisualOffset === undefined
  ) {
    visualStyle.offsetSec = offset;
  }
  card.style = visualStyle;
  if (visual)
    card.media = compileMedia(
      ctx,
      visual,
      visualStyle,
      `source.participants.${p.id}.settings.card.offsetSec`,
    );
  scene.nodes.push(card);
  if (audio)
    addAudio(ctx, {
      id: `${scene.id}/primary`,
      asset: audio,
      role: "primary",
      from,
      durationInFrames: duration,
      offsetSec: offset,
      volume: s.card?.volume,
    });
  else if (visual?.kind === "video" && visual.hasAudio && s.card?.playSound)
    addAudio(ctx, {
      id: `${scene.id}/primary`,
      asset: visual,
      role: "primary",
      from,
      durationInFrames: duration,
      offsetSec: s.card.offsetSec,
      volume: s.card.volume,
      loop: s.card.loop,
    });
  return scene;
}
export function compilePicker(
  ctx: CompileContext,
  template: VideoScene,
  r: PickerRound,
  from: number,
  settings: Settings,
): CompiledScene[] {
  const s = effectiveSettings(ctx, settings, r.settings);
  const p = s.picker!;
  const f = (v: number) => Math.round(v * ctx.fps);
  const lead = f(p.leadSec ?? 0.5),
    reveal = Math.max(1, f(p.revealSec ?? 2)),
    timer = f(p.timerSec ?? 5),
    answerDuration = Math.max(1, f(p.answerSec ?? 2.5));
  const grouped = !!r.groups?.length;
  const groups = r.groups ?? [];
  const steps = grouped ? groups.length : r.cards.length;
  if (!steps)
    diagnostic(
      ctx,
      "ROUND_EMPTY",
      "Add at least one card to the round.",
      `source.rounds.${r.id}.cards`,
    );
  const cardIds = new Set(r.cards.map((c) => c.id));
  const groupIds = new Set(groups.map((g) => g.id));
  for (const id of r.answer?.cardIds ?? [])
    if (!cardIds.has(id))
      diagnostic(
        ctx,
        "ANSWER_NOT_FOUND",
        `Answer card ${id} does not exist.`,
        `source.rounds.${r.id}.answer`,
      );
  for (const id of r.answer?.groupIds ?? [])
    if (!groupIds.has(id))
      diagnostic(
        ctx,
        "ANSWER_NOT_FOUND",
        `Answer group ${id} does not exist.`,
        `source.rounds.${r.id}.answer`,
      );
  if (grouped) {
    const assigned = groups.flatMap((g) => g.cardIds);
    for (const id of assigned)
      if (!cardIds.has(id))
        diagnostic(
          ctx,
          "CARD_NOT_FOUND",
          `Group references missing card ${id}.`,
          `source.rounds.${r.id}.groups`,
        );
    if (
      new Set(assigned).size !== assigned.length ||
      r.cards.some((c) => !assigned.includes(c.id))
    )
      diagnostic(
        ctx,
        "GROUP_MEMBERSHIP_INVALID",
        "Every card must belong to exactly one group.",
        `source.rounds.${r.id}.groups`,
      );
    groups.forEach((g) => {
      if (!g.cardIds.length)
        diagnostic(
          ctx,
          "GROUP_EMPTY",
          "Groups must contain at least one card.",
          `source.rounds.${r.id}.groups.${g.id}`,
        );
    });
  }
  const hasAnswer = !!(
    (r.answer?.cardIds?.length ?? 0) + (r.answer?.groupIds?.length ?? 0)
  );
  const finale = lead + steps * reveal,
    answerAt = hasAnswer ? finale + timer : undefined;
  const separate = p.answerMode === "separate" && hasAnswer;
  const duration =
    finale + timer + (hasAnswer && !separate ? answerDuration : 0);
  const main = makeScene(
    ctx,
    template,
    `${encodeURIComponent(template.id)}/${encodeURIComponent(r.id)}`,
    "picker",
    from,
    duration,
    s,
  );
  main.roundId = r.id;
  main.phases = {
    revealStartFrame: lead,
    timerStartFrame: finale,
    ...(answerAt !== undefined && !separate
      ? { answerStartFrame: answerAt }
      : {}),
  };
  const area = {
    x: ctx.width * 0.035,
    y: ctx.height * 0.17,
    width: ctx.width * 0.93,
    height: ctx.height * 0.66,
  };
  if (p.showPrompt !== false && r.prompt) {
    const text = baseNode(
      `${main.id}/prompt`,
      "text",
      {
        x: ctx.width * 0.05,
        y: ctx.height * 0.03,
        width: ctx.width * 0.9,
        height: ctx.height * 0.1,
      },
      duration,
      { ...s.card, fontSize: Math.min(56, ctx.width * 0.045) },
    );
    text.text = r.prompt;
    main.nodes.push(text);
  }
  const timerNode = baseNode(
    `${main.id}/timer`,
    "timer",
    resolveRect(p.timerRect ?? { x: 0.42, y: 0.86, width: 0.16, height: 0.1 }, {
      x: 0,
      y: 0,
      width: ctx.width,
      height: ctx.height,
    }),
    timer,
    s.card,
  );
  Object.assign(timerNode, {
    from: finale,
    visible: timer ? [{ from: finale, to: finale + timer }] : [],
    timerFrames: timer,
  });
  main.nodes.push(timerNode);
  const localCardSettings = new Map<string, Settings>();
  const addCard = (
    c: PickerCard,
    rect: Rect,
    step: number,
    stagger: number,
    groupId?: string,
    groupSettings?: Settings,
    soundAllowed = true,
  ): boolean => {
    const participant = ctx.document.source.participants.find(
      (item) => item.id === c.participantId,
    );
    if (!participant) {
      diagnostic(
        ctx,
        "PARTICIPANT_NOT_FOUND",
        `Participant ${c.participantId} no longer exists.`,
        `source.rounds.${r.id}.cards.${c.id}.participantId`,
        c.id,
      );
      return false;
    }
    const local = effectiveSettings(
      ctx,
      s,
      participant.settings,
      groupSettings,
      c.settings,
    );
    const start = lead + step * reveal + stagger;
    const activeEnd = lead + (step + 1) * reveal;
    const card = baseNode(
      `${main.id}/card/${encodeURIComponent(c.id)}`,
      "card",
      rect,
      duration,
      local.card,
    );
    const isAnswer =
      (r.answer?.cardIds ?? []).includes(c.id) ||
      (!!groupId && (r.answer?.groupIds ?? []).includes(groupId));
    Object.assign(card, {
      participantId: participant.id,
      cardId: c.id,
      label: c.label ?? participant.label,
      rank: participant.rank,
      showRank: local.labels?.showRank ?? true,
      groupId,
      answer: isAnswer,
      answerFrom: separate ? undefined : answerAt,
      activeWindow: { from: start, to: activeEnd },
      visible: p.hideAfterReveal
        ? [
            { from: start, to: activeEnd },
            { from: finale, to: duration },
          ]
        : [{ from: start, to: duration }],
      labelWindows: labelWindows(
        local,
        start,
        activeEnd,
        finale,
        separate ? undefined : answerAt,
        duration,
        ctx.fps,
      ),
    });
    localCardSettings.set(card.id, local);
    const visual = resolveAsset(
      ctx,
      participant.media?.visual,
      `source.participants.${participant.id}.media.visual`,
      "visual",
    );
    if (visual)
      card.media = compileMedia(
        ctx,
        visual,
        local.card ?? {},
        `source.participants.${participant.id}.settings.card.offsetSec`,
      );
    main.nodes.push(card);
    const audio = resolveAsset(
      ctx,
      participant.media?.audio,
      `source.participants.${participant.id}.media.audio`,
      "audio",
    );
    const sound =
      audio ??
      (visual?.kind === "video" && visual.hasAudio && local.card?.playSound
        ? visual
        : undefined);
    if (sound && soundAllowed) {
      addAudio(ctx, {
        id: `${main.id}/${c.id}/primary`,
        asset: sound,
        role: "primary",
        from: from + start,
        durationInFrames: activeEnd - start,
        offsetSec: local.card?.offsetSec,
        loop: local.card?.loop,
        volume: local.card?.volume,
      });
      return true;
    }
    return false;
  };
  if (grouped) {
    const panels = layoutCards(
      groups.length,
      area,
      {
        type: "grid",
        gap: 20,
        padding: 0,
        columns: ctx.width >= ctx.height ? groups.length : 1,
      },
      ctx.width >= ctx.height ? "portrait" : "landscape",
    );
    groups.forEach((g, gi) => {
      const panel = baseNode(
        `${main.id}/group/${encodeURIComponent(g.id)}`,
        "group",
        panels[gi],
        duration,
        s.card,
      );
      panel.text = g.label ?? `Group ${gi + 1}`;
      panel.groupId = g.id;
      panel.answer = r.answer?.groupIds?.includes(g.id) ?? false;
      panel.answerFrom = separate ? undefined : answerAt;
      panel.visible = p.hideAfterReveal
        ? [
            { from: lead + gi * reveal, to: lead + (gi + 1) * reveal },
            { from: finale, to: duration },
          ]
        : [{ from: lead + gi * reveal, to: duration }];
      main.nodes.push(panel);
      const groupArea = {
        ...panels[gi],
        y: panels[gi].y + panels[gi].height * 0.16,
        height: panels[gi].height * 0.84,
      };
      const groupLayout = g.settings?.layout ?? s.layout;
      if (
        groupLayout?.type === "free" &&
        groupLayout.positions?.length !== g.cardIds.length
      ) {
        diagnostic(
          ctx,
          "LAYOUT_POSITIONS_MISMATCH",
          "A group free layout needs one position per card.",
          `source.rounds.${r.id}.groups.${g.id}.settings.layout.positions`,
        );
      }
      const rects = layoutCards(
        g.cardIds.length,
        groupArea,
        groupLayout,
        g.settings?.card?.orientation ?? s.card?.orientation,
      );
      let soundTaken = false;
      g.cardIds.forEach((id, ci) => {
        const c = r.cards.find((c) => c.id === id);
        if (!c) return;
        const stagger =
          Math.min(
            f(p.staggerSec ?? 0.15),
            Math.floor((reveal - 1) / Math.max(1, g.cardIds.length)),
          ) * ci;
        if (addCard(c, rects[ci], gi, stagger, g.id, g.settings, !soundTaken))
          soundTaken = true;
      });
    });
  } else {
    const free = s.layout?.type === "free";
    const rects = layoutCards(
      r.cards.length,
      free ? { x: 0, y: 0, width: ctx.width, height: ctx.height } : area,
      s.layout,
      s.card?.orientation,
    );
    if (free && s.layout?.positions?.length !== r.cards.length)
      diagnostic(
        ctx,
        "LAYOUT_POSITIONS_MISMATCH",
        "Free layout needs one position per card.",
        `source.rounds.${r.id}.settings.layout.positions`,
      );
    r.cards.forEach((c, i) => addCard(c, rects[i], i, 0));
  }
  if (p.tick && timer) {
    const asset = resolveAsset(
      ctx,
      p.tick,
      `source.rounds.${r.id}.settings.picker.tick`,
      "audio",
    );
    if (asset)
      for (let i = 0; i < timer; i += ctx.fps)
        addAudio(ctx, {
          id: `${main.id}/tick/${i}`,
          asset,
          role: "sfx",
          from: from + finale + i,
          durationInFrames: Math.min(ctx.fps, timer - i),
        });
  }
  const result = [main];
  if (separate) {
    const answer = makeScene(
      ctx,
      template,
      `${main.id}/answer`,
      "answer",
      from + duration,
      answerDuration,
      s,
    );
    answer.roundId = r.id;
    answer.phases = { answerStartFrame: 0 };
    answer.nodes = main.nodes
      .filter(
        (n) => n.type === "card" || n.type === "group" || n.type === "text",
      )
      .map((n) => ({
        ...structuredClone(n),
        id: `${n.id}/answer`,
        from: 0,
        durationInFrames: answerDuration,
        visible: [{ from: 0, to: answerDuration }],
        activeWindow: undefined,
        answerFrom: 0,
        labelWindows: labelWindows(
          localCardSettings.get(n.id) ?? s,
          0,
          0,
          0,
          0,
          answerDuration,
          ctx.fps,
        ),
      }));
    result.push(answer);
  }
  if (r.music) {
    const asset = resolveAsset(
      ctx,
      r.music,
      `source.rounds.${r.id}.music`,
      "audio",
    );
    if (asset)
      addAudio(ctx, {
        id: `${main.id}/music`,
        asset,
        role: "music",
        from,
        durationInFrames: duration + (separate ? answerDuration : 0),
        loop: true,
        volume: 0.35,
        fadeInSec: 0.3,
        fadeOutSec: 0.3,
      });
  }
  return result;
}
