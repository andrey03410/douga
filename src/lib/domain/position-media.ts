// Pure rules for what a render position shows and plays (spec 04).
//
// Visual precedence: attached pool media (image or video) -> the video track's
// own footage -> the "#N" placeholder. Audio comes from the track by default,
// or from the attached pool video when the user flips the per-position switch.

import type { MediaKind } from "./media-ext";

export type { MediaKind } from "./media-ext";
export type TrackKind = "audio" | "video";
export type AudioSource = "track" | "media";

/** The pool media attached to a position, as the domain needs to see it. */
export interface PoolMediaInfo {
  kind: MediaKind;
  durationSec: number | null;
  hasAudio: boolean;
}

export type VisualSource =
  | { source: "media"; kind: MediaKind }
  | { source: "track"; kind: "video" }
  | { source: "none" };

/** Which entity provides the position's visual. */
export function resolveVisualSource(
  trackKind: TrackKind,
  media: PoolMediaInfo | null,
): VisualSource {
  if (media) return { source: "media", kind: media.kind };
  if (trackKind === "video") return { source: "track", kind: "video" };
  return { source: "none" };
}

/** Can this position take its audio from the attached pool media? */
export function mediaAudioAvailable(media: PoolMediaInfo | null): boolean {
  return media !== null && media.kind === "video" && media.hasAudio;
}

export function parseAudioSource(
  input: unknown,
  media: PoolMediaInfo | null,
):
  | { ok: true; audioSource: AudioSource }
  | { ok: false; error: "INVALID_AUDIO_SOURCE" | "NO_MEDIA_AUDIO" } {
  if (input !== "track" && input !== "media") {
    return { ok: false, error: "INVALID_AUDIO_SOURCE" };
  }
  if (input === "media" && !mediaAudioAvailable(media)) {
    return { ok: false, error: "NO_MEDIA_AUDIO" };
  }
  return { ok: true, audioSource: input };
}

/**
 * Validate a footage start offset. null resets to 0 (default). Rejects
 * non-finite/negative values and offsets at/past the known footage end.
 */
export function parseMediaStartSec(
  input: unknown,
  footageDurationSec?: number | null,
): { ok: true; value: number | null } | { ok: false } {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    return { ok: false };
  }
  if (footageDurationSec != null && input >= footageDurationSec) return { ok: false };
  return { ok: true, value: input };
}

const EPS = 1e-3;

/** How a visual-only video plays inside a segment: offset + loop-or-not. */
export interface Footage {
  startSec: number;
  /** Length (sec) of footage to loop; null = footage covers the segment, play straight. */
  loopSec: number | null;
}

/**
 * Resolve footage playback for a segment of `segmentSec`. When the footage
 * length is unknown, play straight and hope for the best (the render pipeline
 * probes real durations). A start offset past the footage end falls back to 0.
 */
export function resolveFootage(
  startSec: number,
  footageDurationSec: number | null,
  segmentSec: number,
): Footage {
  const start = Math.max(0, startSec);
  if (footageDurationSec == null) return { startSec: start, loopSec: null };

  const available = footageDurationSec - start;
  if (available <= EPS) {
    // stale offset (footage got shorter than the stored start) -> whole footage
    return {
      startSec: 0,
      loopSec: footageDurationSec < segmentSec - EPS ? footageDurationSec : null,
    };
  }
  if (available >= segmentSec - EPS) return { startSec: start, loopSec: null };
  return { startSec: start, loopSec: available };
}
