import type { AudioCue, CompiledAudio, ResolvedAsset, Window } from "./types";
import { diagnostic, resolveAsset, type CompileContext } from "./context";
import { frames } from "./settings";
export function addAudio(
  ctx: CompileContext,
  options: {
    id: string;
    asset: ResolvedAsset;
    role: AudioCue["role"];
    from: number;
    durationInFrames: number;
    offsetSec?: number;
    loop?: boolean;
    volume?: number;
    fadeInSec?: number;
    fadeOutSec?: number;
  },
): CompiledAudio | undefined {
  const offsetFrames = Math.round((options.offsetSec ?? 0) * ctx.fps);
  const available =
    options.asset.durationSec === undefined
      ? undefined
      : Math.floor(options.asset.durationSec * ctx.fps) - offsetFrames;
  if (available !== undefined && available <= 0) {
    diagnostic(
      ctx,
      "AUDIO_OFFSET_OUT_OF_RANGE",
      "Audio offset exceeds the available source.",
      `audio.${options.id}`,
    );
    return;
  }
  if (options.loop && available === undefined) {
    diagnostic(
      ctx,
      "MEDIA_DURATION_REQUIRED",
      "Looping audio requires duration metadata.",
      `audio.${options.id}`,
    );
    return;
  }
  const durationInFrames = Math.max(
    0,
    Math.min(
      options.durationInFrames,
      options.loop ? Infinity : (available ?? Infinity),
    ),
  );
  if (!durationInFrames) return;
  const cue: CompiledAudio = {
    id: options.id,
    asset: options.asset,
    role: options.role,
    from: options.from,
    durationInFrames,
    offsetFrames,
    loopFrames: options.loop ? available! : null,
    volume: options.volume ?? 1,
    fadeInFrames: Math.min(
      durationInFrames,
      Math.round((options.fadeInSec ?? 0) * ctx.fps),
    ),
    fadeOutFrames: Math.min(
      durationInFrames,
      Math.round((options.fadeOutSec ?? 0.08) * ctx.fps),
    ),
    duckVolume: 0.2,
    duckWindows: [],
    muteWindows: [],
  };
  ctx.audio.push(cue);
  return cue;
}
export function compileGlobalAudio(
  ctx: CompileContext,
  total: number,
  muteWindows: Window[],
): void {
  for (const cue of ctx.document.audio?.cues ?? []) {
    const asset = resolveAsset(
      ctx,
      cue.asset,
      `audio.cues.${cue.id}.asset`,
      "audio",
    );
    if (!asset) continue;
    const from = frames(cue.at, ctx.fps);
    if (from >= total) {
      diagnostic(
        ctx,
        "AUDIO_OUTSIDE_TIMELINE",
        "Audio cue starts after the composition ends.",
        `audio.cues.${cue.id}`,
      );
      continue;
    }
    addAudio(ctx, {
      ...cue,
      asset,
      from,
      durationInFrames: Math.min(
        total - from,
        frames(cue.duration, ctx.fps, total - from),
      ),
    });
  }
  const playlist = ctx.document.audio?.playlist;
  if (playlist?.tracks.length) {
    const tracks = playlist.tracks.flatMap((key, i) => {
      const asset = resolveAsset(
        ctx,
        key,
        `audio.playlist.tracks.${i}`,
        "audio",
      );
      if (!asset) return [];
      if (!asset.durationSec) {
        diagnostic(
          ctx,
          "MEDIA_DURATION_REQUIRED",
          "Playlist tracks require duration metadata.",
          `audio.playlist.tracks.${i}`,
        );
        return [];
      }
      return [asset];
    });
    let cursor = 0,
      index = 0;
    while (
      tracks.length &&
      cursor < total &&
      (playlist.loop !== false || index < tracks.length)
    ) {
      const asset = tracks[index % tracks.length];
      const next = tracks[(index + 1) % tracks.length];
      const length = Math.max(1, Math.floor(asset.durationSec! * ctx.fps));
      const fade = Math.min(
        Math.round((playlist.crossfadeSec ?? 1) * ctx.fps),
        Math.floor(length / 2),
        Math.floor((next.durationSec! * ctx.fps) / 2),
      );
      const cue = addAudio(ctx, {
        id: `playlist/${index}`,
        asset,
        role: "music",
        from: cursor,
        durationInFrames: Math.min(length, total - cursor),
        volume: playlist.volume ?? 0.35,
        fadeInSec: fade / ctx.fps,
        fadeOutSec: fade / ctx.fps,
      });
      if (cue) {
        cue.muteWindows = muteWindows;
        cue.duckVolume = playlist.duckVolume ?? 0.2;
      }
      cursor += Math.max(1, length - fade);
      index++;
    }
  }
  const duck = ctx.audio
    .filter((a) => a.role === "primary" || a.role === "voice")
    .map((a) => ({ from: a.from, to: a.from + a.durationInFrames }));
  for (const audio of ctx.audio)
    if (audio.role === "music")
      audio.duckWindows = duck.filter(
        (w) =>
          w.from < audio.from + audio.durationInFrames && w.to > audio.from,
      );
  ctx.audio.sort(
    (a, b) => a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
