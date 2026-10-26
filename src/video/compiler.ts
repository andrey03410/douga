import type {
  AssetManifest,
  CompileResult,
  CompiledVideo,
  Participant,
  PickerRound,
  VideoDocument,
  VideoScene,
  Window,
} from "./types";
import { assetManifestSchema, videoDocumentSchema } from "./schema";
import { OUTPUT_DIMENSIONS } from "./layout";
import { mergeSettings, frames } from "./settings";
import { diagnostic, effectiveSettings, type CompileContext } from "./context";
import { addBackground, compilePicker, compileTop, makeScene } from "./blocks";
import { compileCustomNodes } from "./nodes";
import { compileGlobalAudio } from "./audio";
/** Pure deterministic compiler. A non-ready partial plan is useful for diagnostics, never final rendering. */
export function compileVideo(
  input: VideoDocument,
  manifest: AssetManifest = {},
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
  const ctx: CompileContext = {
    document,
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
  function emit(
    template: VideoScene,
    participant?: Participant,
    round?: PickerRound,
  ): void {
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
  if (!plan.scenes.length)
    diagnostic(
      ctx,
      "EMPTY_TIMELINE",
      "Add source content or a custom scene.",
      "scenes",
    );
  plan.durationInFrames = Math.max(1, cursor);
  compileGlobalAudio(ctx, plan.durationInFrames, muteWindows, plan.scenes);
  return {
    plan: JSON.parse(JSON.stringify(plan)) as CompiledVideo,
    diagnostics: ctx.diagnostics,
    ready: !ctx.diagnostics.some((d) => d.severity === "error"),
  };
}
