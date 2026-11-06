import type {
  CompiledAudio,
  CompiledMedia,
  CompiledScene,
  CompiledVideo,
  ResolvedAsset,
} from "./types";

/** Mutable references into a plan; scene-local windows become absolute usages. */
export interface CompiledMediaUsage {
  asset: ResolvedAsset;
  from: number;
  durationInFrames: number;
  media?: CompiledMedia;
  cue?: CompiledAudio;
  scene?: CompiledScene;
}

/** One browser-safe traversal for worker, watch, preloading and offline slicing. */
export function* compiledMediaUsages(
  plan: CompiledVideo,
): Generator<CompiledMediaUsage> {
  for (const cue of plan.audio)
    yield {
      asset: cue.asset,
      from: cue.from,
      durationInFrames: cue.durationInFrames,
      cue,
    };
  for (const scene of plan.scenes) {
    for (const node of scene.nodes) {
      if (!node.media) continue;
      yield {
        asset: node.media.asset,
        from: scene.from + node.from,
        durationInFrames: node.durationInFrames,
        media: node.media,
        scene,
      };
    }
    for (const layer of scene.backdrop?.layers ?? [])
      yield {
        asset: layer.media.asset,
        from: scene.from + layer.from,
        durationInFrames: layer.to - layer.from,
        media: layer.media,
        scene,
      };
  }
}
