import { expect, it } from "vitest";
import { plan, videoNode, imageNode, hashB } from "@douga/player/fixtures";
import type { CompiledScene } from "@douga/video";
import { rewritePlanMedia, upcomingMedia } from "@douga/player/model";
import {
  mediaSlices,
  applySlices,
  posterHashes,
  offlineMediaUnresolved,
  posterSliceId,
} from "./offline";
import { compiledMediaUsages } from "@douga/video/compiled-media";
const makePlan = (image = false) =>
  plan({
    scenes: [
      {
        id: "s",
        kind: "custom",
        from: 30,
        durationInFrames: 100,
        nodes: [],
        background: "#000",
        phases: {},
        transition: { type: "none", durationInFrames: 0 },
        backdrop: {
          preset: "art-blur",
          source: "asset",
          colors: [],
          blur: 20,
          dim: 0.3,
          motion: true,
          intensity: 1,
          particles: 0,
          layers: [
            {
              from: 0,
              to: 90,
              fadeInFrames: 12,
              media: image
                ? imageNode("/art", hashB).media!
                : videoNode().media!,
            },
          ],
        },
      } satisfies CompiledScene,
    ],
  });
it("traverses backdrop-only media with complete extended crossfade duration", () => {
  const p = makePlan();
  const usages = [...compiledMediaUsages(p)];
  expect(usages).toHaveLength(1);
  expect(usages[0].durationInFrames).toBe(90);
  expect(usages[0].from).toBe(30);
  const next = rewritePlanMedia(
    p,
    { [hashB]: { file: "clip.mp4", poster: "poster.jpg" } },
    "tok",
  );
  expect(next.scenes[0].backdrop!.layers[0].media.asset.src).toBe(
    "/api/watch/tok/media/clip.mp4",
  );
  expect(next.scenes[0].backdrop!.layers[0].media.asset.posterSrc).toBe(
    "/api/watch/tok/media/poster.jpg",
  );
  expect(upcomingMedia(next, 0, 60).stills).toContain(
    "/api/watch/tok/media/poster.jpg",
  );
  expect(upcomingMedia(makePlan(true), 0, 60).stills).toContain("/art");
});
it("slices backdrop video, retargets offsets/posters, detects unembedded media", () => {
  const p = makePlan(),
    slices = mediaSlices(p);
  expect(slices[0]).toMatchObject({
    startFrame: 75,
    endFrame: 195,
    role: "visual",
  });
  expect(posterHashes(p)).toEqual([hashB]);
  expect(offlineMediaUnresolved(p, new Set())).toBe(true);
  const next = applySlices(p),
    m = next.scenes[0].backdrop!.layers[0].media;
  expect(m.offsetFrames).toBe(15);
  expect(m.asset.posterSrc).toBe("slice:" + posterSliceId(hashB));
  expect(
    offlineMediaUnresolved(next, new Set([slices[0].id, posterSliceId(hashB)])),
  ).toBe(false);
  expect(offlineMediaUnresolved(next, new Set([slices[0].id]))).toBe(true);
  expect(mediaSlices(makePlan(true))[0].whole).toBe(true);
});
it("retargets shared source references independently for each usage window", () => {
  const p = makePlan();
  const media = p.scenes[0].backdrop!.layers[0].media;
  p.scenes[0].nodes.push(
    videoNode({ media: { ...media, offsetFrames: 220, freezeAtFrame: 249 } }),
  );
  // Same resolved asset is shared by compiler; windows must keep separate trims.
  media.freezeAtFrame = 179;
  const next = applySlices(p);
  expect(next.scenes[0].nodes[0].media!.offsetFrames).toBe(15);
  expect(next.scenes[0].backdrop!.layers[0].media.offsetFrames).toBe(15);
  expect(next.scenes[0].nodes[0].media!.asset.src).not.toBe(
    next.scenes[0].backdrop!.layers[0].media.asset.src,
  );
});
