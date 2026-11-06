import { applySceneMotion } from "./motion-compiler";
import {
  preflightVideoResources,
  videoResourceLimits,
} from "./resource-limits";
import type {
  AssetManifest,
  CompileResult,
  CompiledVideo,
  Participant,
  PickerRound,
  VideoDocument,
  VideoScene,
  VideoSegment,
  Window,
} from "./types";
import { assetManifestSchema, videoDocumentSchema } from "./schema";
import { OUTPUT_DIMENSIONS } from "./layout";
import { mergeSettings, frames } from "./settings";
import { diagnostic, effectiveSettings, type CompileContext } from "./context";
import { addBackground, compilePicker, compileTop, makeScene } from "./blocks";
import { compileBoard } from "./board-compiler";
import { compileCustomNodes } from "./nodes";
import { compileGlobalAudio } from "./audio";
/** Pure deterministic compiler. A non-ready partial plan is useful for diagnostics, never final rendering. */
export function compileVideo(
  input: VideoDocument,
  manifest: AssetManifest = {},
): CompileResult {
  return compileDocument(input, manifest);
}
function compileDocument(
  input: VideoDocument,
  manifest: AssetManifest,
  segmentContext?: {
    segment: VideoSegment;
    number: number;
    count: number;
    participants: Participant[];
  },
): CompileResult {
  const plan: CompiledVideo = {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    seed: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 1,
    scenes: [],
    audio: [],
  };
  const budget = preflightVideoResources(input);
  if (budget.length) return { plan, ready: false, diagnostics: budget };
  const parsed = videoDocumentSchema.safeParse(input);
  const assets = assetManifestSchema.safeParse(manifest);
  if (!parsed.success || !assets.success)
    return {
      plan,
      ready: false,
      diagnostics: [
        ...(!parsed.success
          ? parsed.error.issues.map((e) => ({
              severity: "error" as const,
              code: "SCHEMA_INVALID",
              message: e.message,
              path: e.path.join(".") || "document",
            }))
          : []),
        ...(!assets.success
          ? assets.error.issues.map((e) => ({
              severity: "error" as const,
              code: "MANIFEST_INVALID",
              message: e.message,
              path: `manifest.${e.path.join(".")}`,
            }))
          : []),
      ],
    };
  const document = parsed.data;
  Object.assign(plan, {
    ...OUTPUT_DIMENSIONS[document.output.format],
    fps: document.output.fps,
    seed: document.seed,
  });
  if (document.schemaVersion === 2) {
    plan.segments = [];
    const active = (document.segments ?? []).filter((s) => s.enabled !== false);
    let cursor = 0;
    let policyWindows = 0;
    const exhausted = (): CompileResult => ({
      plan: { ...plan, scenes: [], audio: [], segments: [] },
      ready: false,
      diagnostics: [
        {
          severity: "error",
          code: "RESOURCE_BUDGET_EXCEEDED",
          path: "segments",
          message: "Aggregate segment timeline exceeds resource budgets.",
        },
      ],
    });
    const diagnostics = [] as CompileResult["diagnostics"];
    for (const [index, segment] of active.entries()) {
      const sourceSegment = document.source.segments?.find(
        (s) => s.id === segment.sourceSegmentId,
      );
      const ids = segment.participantIds ?? sourceSegment?.participantIds;
      const participants = ids
        ? ids
            .map((id) => document.source.participants.find((p) => p.id === id)!)
            .filter(Boolean)
        : document.source.participants;
      const roundIds = segment.roundIds;
      const rounds = roundIds
        ? roundIds
            .map((id) => document.source.rounds.find((r) => r.id === id)!)
            .filter(Boolean)
        : document.source.rounds.filter(
            (r) => !ids || r.cards.every((c) => ids.includes(c.participantId)),
          );
      const local = compileDocument(
        {
          ...document,
          schemaVersion: 1,
          segments: undefined,
          source: {
            ...document.source,
            segments: undefined,
            participants,
            rounds,
          },
          settings: mergeSettings(
            document.settings,
            document.formatSettings?.[document.output.format],
            segment.settings,
          ),
          formatSettings: undefined,
          scenes: segment.scenes,
          audio: segment.audio,
        },
        manifest,
        {
          segment: {
            ...segment,
            poster: segment.poster ?? sourceSegment?.poster,
          },
          number: index + 1,
          count: participants.length,
          participants: document.source.participants,
        },
      );
      for (const diagnostic of local.diagnostics)
        diagnostics.push({
          ...diagnostic,
          path: `segments.${segment.id}.${diagnostic.path}`,
        });
      policyWindows += local.plan.audio.reduce(
        (sum, cue) => sum + cue.duckWindows.length + cue.muteWindows.length,
        0,
      );
      if (
        policyWindows > videoResourceLimits.maxAudioPolicyWindows ||
        local.diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED")
      )
        return exhausted();
      const length = local.plan.scenes.length ? local.plan.durationInFrames : 0;
      if (length)
        plan.segments.push({
          id: segment.id,
          title: segment.title,
          kind: segment.kind,
          from: cursor,
          to: cursor + length,
        });
      for (const scene of local.plan.scenes)
        plan.scenes.push({
          ...scene,
          from: scene.from + cursor,
          segmentId: segment.id,
          segmentTitle: segment.title,
        });
      const shift = (windows: Window[]) =>
        windows.map((w) => ({ from: w.from + cursor, to: w.to + cursor }));
      for (const cue of local.plan.audio)
        plan.audio.push({
          ...cue,
          id: `${encodeURIComponent(segment.id)}/${cue.id}`,
          from: cue.from + cursor,
          duckWindows: shift(cue.duckWindows),
          muteWindows: shift(cue.muteWindows),
        });
      cursor += length;
      if (
        cursor > videoResourceLimits.maxDurationSeconds * plan.fps ||
        plan.scenes.length > videoResourceLimits.maxExpandedScenes ||
        plan.scenes.reduce((sum, s) => sum + s.nodes.length, 0) >
          videoResourceLimits.maxExpandedNodes ||
        plan.audio.length > videoResourceLimits.maxAudioCues
      ) {
        return exhausted();
      }
    }
    plan.durationInFrames = Math.max(1, cursor);
    for (const scene of plan.scenes)
      for (const node of scene.nodes) {
        if (node.progress?.scope === "video") {
          node.progress.from = -scene.from;
          node.progress.durationInFrames = plan.durationInFrames;
        }
      }
    const ctx: CompileContext = {
      document,
      manifest: assets.data,
      fps: plan.fps,
      width: plan.width,
      height: plan.height,
      diagnostics,
      audio: plan.audio,
      settings: mergeSettings(
        document.settings,
        document.formatSettings?.[document.output.format],
      ),
    };
    // Segment playlists override the document playlist for their own intervals.
    const muteWindows = plan.segments
      .filter(
        (s) =>
          document.segments?.find((segment) => segment.id === s.id)?.audio
            ?.playlist,
      )
      .map((s) => ({ from: s.from, to: s.to }));
    for (const scene of plan.scenes) {
      if (
        scene.roundId &&
        document.source.rounds.find((r) => r.id === scene.roundId)?.music !==
          undefined
      )
        muteWindows.push({
          from: scene.from,
          to: scene.from + scene.durationInFrames,
        });
    }
    compileGlobalAudio(ctx, plan.durationInFrames, muteWindows, plan.scenes);
    // Global audio retains segment mute policies while adding document policies.
    // Check the final retained arrays together, not each compilation scope alone.
    if (
      diagnostics.some((d) => d.code === "RESOURCE_BUDGET_EXCEEDED") ||
      plan.audio.reduce(
        (sum, cue) => sum + cue.duckWindows.length + cue.muteWindows.length,
        0,
      ) > videoResourceLimits.maxAudioPolicyWindows
    )
      return exhausted();
    if (!plan.scenes.length)
      diagnostic(
        ctx,
        "EMPTY_TIMELINE",
        "Add enabled segments with source content or custom scenes.",
        "segments",
      );
    return {
      plan: JSON.parse(JSON.stringify(plan)),
      diagnostics,
      ready: !diagnostics.some((d) => d.severity === "error"),
    };
  }
  const ctx: CompileContext = {
    document,
    segment: segmentContext?.segment,
    segmentNumber: segmentContext?.number,
    segmentCount: segmentContext?.count,
    allParticipants: segmentContext?.participants,
    revealedParticipantIds: new Set(),
    manifest: assets.data,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    diagnostics: [],
    audio: plan.audio,
    settings: mergeSettings(
      document.settings,
      document.formatSettings?.[document.output.format],
    ),
  };
  const muteWindows: Window[] = [];
  let cursor = 0;
  let budgetExceeded = false;
  function emit(
    template: VideoScene,
    participant?: Participant,
    round?: PickerRound,
  ): void {
    if (budgetExceeded) return;
    if (template.participantId && !participant) {
      diagnostic(
        ctx,
        "PARTICIPANT_NOT_FOUND",
        `Participant ${template.participantId} no longer exists.`,
        `scenes.${template.id}.participantId`,
        template.id,
      );
      return;
    }
    if (template.roundId && !round) {
      diagnostic(
        ctx,
        "ROUND_NOT_FOUND",
        `Round ${template.roundId} no longer exists.`,
        `scenes.${template.id}.roundId`,
        template.id,
      );
      return;
    }
    if (participant) ctx.revealedParticipantIds?.add(participant.id);
    round?.cards.forEach((card) =>
      ctx.revealedParticipantIds?.add(card.participantId),
    );
    const settings = effectiveSettings(ctx, template.settings);
    let scenes;
    if (template.block === "top") {
      if (!participant) {
        diagnostic(
          ctx,
          "PARTICIPANT_NOT_FOUND",
          "Top scene requires an existing participant or participants repetition.",
          `scenes.${template.id}.participantId`,
          template.id,
        );
        return;
      }
      scenes = [compileTop(ctx, template, participant, cursor, settings)];
    } else if (template.block === "board") {
      scenes = compileBoard(ctx, template, cursor, settings);
    } else if (template.block === "picker") {
      if (!round) {
        diagnostic(
          ctx,
          "ROUND_NOT_FOUND",
          "Picker scene requires an existing round or rounds repetition.",
          `scenes.${template.id}.roundId`,
          template.id,
        );
        return;
      }
      scenes = compilePicker(ctx, template, round, cursor, settings);
    } else {
      const suffix = participant
        ? `/${encodeURIComponent(participant.id)}`
        : round
          ? `/${encodeURIComponent(round.id)}`
          : "";
      const scene = makeScene(
        ctx,
        template,
        `${encodeURIComponent(template.id)}${suffix}`,
        "custom",
        cursor,
        frames(template.duration, ctx.fps, 3 * ctx.fps),
        settings,
      );
      scene.participantId = participant?.id;
      scene.roundId = round?.id;
      scenes = [scene];
    }
    for (const scene of scenes) {
      addBackground(ctx, scene, round?.background ?? template.background);
      compileCustomNodes(
        ctx,
        scene,
        template.nodes,
        effectiveSettings(
          ctx,
          settings,
          round?.settings,
          participant?.settings,
        ),
        participant,
        round,
        mergeSettings(
          ctx.settings,
          template.settings,
          round?.settings,
          participant?.settings,
        ).card?.playSound,
      );
      applySceneMotion(
        ctx,
        scene,
        template,
        effectiveSettings(
          ctx,
          settings,
          round?.settings,
          participant?.settings,
        ),
        round,
      );
      scene.nodes.sort((a, b) => a.layer - b.layer);
      for (const n of scene.nodes) {
        if (
          n.rect.x < 0 ||
          n.rect.y < 0 ||
          n.rect.x + n.rect.width > ctx.width + 0.01 ||
          n.rect.y + n.rect.height > ctx.height + 0.01
        )
          diagnostic(
            ctx,
            "NODE_OUT_OF_BOUNDS",
            "Node extends outside the output frame.",
            `scenes.${template.id}.nodes.${n.id}`,
            n.id,
            "warning",
          );
        if ((n.label || n.text) && n.rect.width < 120)
          diagnostic(
            ctx,
            "TEXT_MAY_BE_SMALL",
            "Caption has a narrow bounding box; inspect a rendered frame.",
            `scenes.${template.id}.nodes.${n.id}`,
            n.id,
            "warning",
          );
      }
      plan.scenes.push(scene);
      cursor += scene.durationInFrames;
      if (
        !Number.isSafeInteger(cursor) ||
        cursor > videoResourceLimits.maxDurationSeconds * ctx.fps ||
        plan.audio.length > videoResourceLimits.maxAudioCues
      ) {
        budgetExceeded = true;
        return;
      }
    }
    if (round && round.music !== undefined)
      muteWindows.push({ from: scenes[0].from, to: cursor });
  }
  for (const template of document.scenes) {
    if (template.repeat === "participants") {
      const participants = [...document.source.participants];
      const order = effectiveSettings(ctx, template.settings).top?.order;
      if (order === "ascending" || order === "descending")
        participants.sort(
          (a, b) =>
            ((a.rank ?? Infinity) - (b.rank ?? Infinity)) *
            (order === "ascending" ? 1 : -1),
        );
      for (const p of participants) emit(template, p);
    } else if (template.repeat === "rounds") {
      for (const r of document.source.rounds) emit(template, undefined, r);
    } else
      emit(
        template,
        document.source.participants.find(
          (p) => p.id === template.participantId,
        ),
        document.source.rounds.find((r) => r.id === template.roundId),
      );
  }
  if (budgetExceeded)
    return {
      plan: { ...plan, scenes: [], audio: [] },
      ready: false,
      diagnostics: [
        {
          severity: "error",
          code: "RESOURCE_BUDGET_EXCEEDED",
          path: "scenes",
          message: "Expanded timeline exceeds duration or audio budgets.",
        },
      ],
    };
  if (!plan.scenes.length)
    diagnostic(
      ctx,
      "EMPTY_TIMELINE",
      "Add source content or a custom scene.",
      "scenes",
    );
  plan.durationInFrames = Math.max(1, cursor);
  compileGlobalAudio(ctx, plan.durationInFrames, muteWindows, plan.scenes);
  for (const scene of plan.scenes)
    for (const node of scene.nodes) {
      if (node.progress?.scope === "video") {
        node.progress.from = -scene.from;
        node.progress.durationInFrames = plan.durationInFrames;
      }
    }
  return {
    plan: JSON.parse(JSON.stringify(plan)) as CompiledVideo,
    diagnostics: ctx.diagnostics,
    ready: !ctx.diagnostics.some((d) => d.severity === "error"),
  };
}
