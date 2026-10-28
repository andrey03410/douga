import type { CompiledAudio, CompiledNode, CompiledVideo } from "@/video";

/** Plan fixtures shared by the player and offline-file tests. */
export const hash = "a".repeat(64);
export const hashB = "b".repeat(64);

export function plan(patch: Partial<CompiledVideo> = {}): CompiledVideo {
  return {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    seed: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
    scenes: [],
    audio: [],
    ...patch,
  };
}

export function cue(
  patch: Partial<CompiledAudio> & { hash?: string; offsetFrames?: number },
): CompiledAudio {
  const digest = patch.hash ?? hash;
  return {
    id: patch.id ?? "cue",
    asset: {
      id: "asset",
      kind: "audio",
      src: `/api/studio/media?path=studio%2Fuser%2Fproj%2F${digest}.m4a`,
      hash: digest,
      durationSec: 10,
      ...patch.asset,
    },
    role: "music",
    from: 0,
    durationInFrames: 30,
    offsetFrames: 0,
    loopFrames: null,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    duckVolume: 1,
    duckWindows: [],
    muteWindows: [],
    ...patch,
  };
}

export function videoNode(
  patch: Partial<CompiledNode> & { hash?: string } = {},
): CompiledNode {
  const digest = patch.hash ?? hashB;
  return {
    id: patch.id ?? "video",
    type: "video",
    from: 0,
    durationInFrames: 60,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    layer: 1,
    visible: [],
    style: {},
    opacity: 1,
    rotate: 0,
    scale: 1,
    animation: [],
    media: {
      asset: {
        id: "vid",
        kind: "video",
        src: `/api/arts/secret`,
        hash: digest,
        durationSec: 10,
        posterSrc: `/api/studio/media?path=studio%2Fposter.jpg`,
      },
      offsetFrames: 90,
      loopFrames: null,
      fit: "cover",
    },
    ...patch,
  } as CompiledNode;
}


export function imageNode(src: string, digest = "c".repeat(64)): CompiledNode {
  return {
    ...videoNode({ id: `image-${digest.slice(0, 4)}` }),
    type: "image",
    media: {
      asset: { id: "img", kind: "image", src, hash: digest },
      offsetFrames: 0,
      loopFrames: null,
      fit: "cover",
    },
  } as CompiledNode;
}
