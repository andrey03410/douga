import type { CompiledVideo } from "@douga/video";
import { imageDecoded, markImageDecoded } from "@douga/render/image-ready";
import { upcomingMedia } from "./model";

export const PREFETCH_HORIZON_SEC = 30;
export const PREFETCH_STEP_SEC = 5;

/**
 * Warms what the plan needs next: sounds go to the HTTP cache (the <audio> src does
 * not change, so a playing cue is never reloaded), pictures are decoded ahead so
 * <Img> does not pause the player. Shared by /watch, the offline file and games.
 */
export function createMediaWarmer(plan: CompiledVideo, horizonSec = PREFETCH_HORIZON_SEC) {
  const warmed = new Set<string>();
  const warming = new AbortController();
  // Decoded pictures stay in the memory cache while something holds them.
  const stills = new Map<string, HTMLImageElement>();
  let step = Number.NaN;
  const warm = (afterFrame: number) => {
    const ahead = upcomingMedia(plan, afterFrame, horizonSec * plan.fps);
    for (const url of ahead.sounds) {
      if (warmed.has(url)) continue;
      warmed.add(url);
      void fetch(url, { signal: warming.signal })
        .then((response) => response.body?.pipeTo(new WritableStream()))
        .catch(() => {});
    }
    for (const url of ahead.stills) {
      if (stills.has(url) || imageDecoded(url)) continue;
      const image = new Image();
      image.src = url;
      stills.set(url, image);
      image.decode().then(
        () => markImageDecoded(url),
        () => {
          // Undecodable here: <Img> keeps pausing for it as before.
        },
      );
    }
  };
  return {
    warm,
    /** Warms again only when the frame enters the next prefetch step. */
    onFrame(frame: number) {
      const next = Math.floor(frame / (PREFETCH_STEP_SEC * plan.fps));
      if (next === step) return;
      step = next;
      warm(frame);
    },
    dispose() {
      warming.abort();
      stills.clear();
    },
  };
}
