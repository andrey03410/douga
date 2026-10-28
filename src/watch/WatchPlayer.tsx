"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject, SyntheticEvent } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { AnyZodObject } from "zod";
import { prefetch } from "remotion";
import { StudioVideo } from "@/remotion/StudioVideo";
import { imageDecoded, markImageDecoded } from "@/remotion/image-ready";
import type { CompiledVideo } from "@/video";
import {
  chapterAt,
  chapters,
  controlsHidden,
  coverFrame,
  formatClock,
  keyAction,
  nextChapterFrame,
  previousChapterFrame,
  seekBySeconds,
  sharedAudioTagCount,
  upcomingMedia,
  type Chapter,
  type KeyAction,
  type KeyTarget,
} from "./model";

const LOADING_DELAY_MS = 300;
const PREFETCH_HORIZON_SEC = 30;
const PREFETCH_STEP_SEC = 5;
const SEEK_STEP_SEC = 5;

/**
 * Rendered as a <style> next to the markup, so the server page and the offline file
 * are styled before any script runs. Range thumbs are 14 px: chapter marks use the
 * same 7 px inset to sit exactly where the thumb would stop.
 */
const WATCH_CSS = `
.watch-page{box-sizing:border-box;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;background:#05070c;color:#e7ebf5}
.watch-stage{width:min(100%,calc((100dvh - 88px) * var(--aspect)));display:flex;flex-direction:column;gap:10px}
.watch-stage:fullscreen{width:100%;height:100%;align-items:center;justify-content:center;gap:0;background:#000}
.watch-stage:fullscreen .watch-canvas{width:min(100vw,calc(100vh * var(--aspect)))}
.watch-stage:fullscreen .watch-title{display:none}
.watch-canvas{position:relative;width:100%;aspect-ratio:var(--aspect);background:#000;overflow:hidden;container-type:inline-size;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.watch-stage.is-idle .watch-canvas{cursor:none}
.watch-title{margin:0;font-size:16px;font-weight:650;text-align:center}
.watch-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;background:rgba(5,7,12,.45);color:#fff;text-align:center;cursor:pointer}
.watch-cover-play{display:grid;place-items:center;width:76px;height:76px;border:0;border-radius:999px;background:rgba(8,12,20,.78);color:#fff;cursor:pointer}
.watch-loading{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 14px;border-radius:999px;background:rgba(8,12,20,.78);color:#fff;font-size:14px;pointer-events:none}
.watch-controls{position:absolute;left:0;right:0;bottom:0;padding:18px 10px 4px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;transition:opacity .2s}
.watch-stage.is-idle .watch-controls{opacity:0;pointer-events:none}
.watch-row{display:flex;align-items:center;gap:2px}
.watch-btn{flex:0 0 auto;display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:999px;background:transparent;color:#fff;cursor:pointer}
.watch-btn:hover{background:rgba(255,255,255,.14)}
.watch-btn:focus-visible,.watch-range:focus-visible,.watch-cover-play:focus-visible{outline:2px solid #ffd166;outline-offset:2px}
.watch-clock{flex:1 1 auto;min-width:0;padding:0 6px;overflow:hidden;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis}
.watch-seek{position:relative}
.watch-range{-webkit-appearance:none;appearance:none;display:block;box-sizing:border-box;width:100%;height:24px;margin:0;padding:0;border:0;border-radius:0;background:transparent;cursor:pointer}
.watch-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(#ffd166,#ffd166) 0/calc(7px + (100% - 14px) * var(--ratio,0)) 100% no-repeat,rgba(255,255,255,.3)}
.watch-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border:0;border-radius:50%;background:#fff}
.watch-range::-moz-range-track{height:4px;border-radius:2px;background:rgba(255,255,255,.3)}
.watch-range::-moz-range-progress{height:4px;border-radius:2px;background:#ffd166}
.watch-range::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#fff}
.watch-mark{position:absolute;top:50%;left:calc(7px + (100% - 14px) * var(--at));width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}
.watch-volume{flex:0 0 88px;width:88px}
@media (pointer:coarse){.watch-volume{display:none}}
@container (max-width:420px){.watch-chapter-label,.watch-volume{display:none}}
`;

const PLAYER_STYLE: CSSProperties = { width: "100%", height: "100%" };

const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  previous: "M6 5h2v14H6zM9.5 12 18 5v14z",
  next: "M16 5h2v14h-2zM14.5 12 6 19V5z",
  sound:
    "M4 9v6h4l5 4V5L8 9zM15.5 8.5l1.4-1.4A7 7 0 0 1 19 12a7 7 0 0 1-2.1 4.9l-1.4-1.4A5 5 0 0 0 17 12a5 5 0 0 0-1.5-3.5z",
  muted: "M4 9v6h4l5 4V5L8 9zM16.3 9.7l1.4-1.4 1.8 1.8 1.8-1.8 1.4 1.4-1.8 1.8 1.8 1.8-1.4 1.4-1.8-1.8-1.8 1.8-1.4-1.4 1.8-1.8z",
  enterFullscreen: "M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM18 14h2v6h-6v-2h4zM4 14h2v4h4v2H4z",
  exitFullscreen: "M8 4h2v6H4V8h4zM14 4h2v4h4v2h-6zM14 14h6v2h-4v4h-2zM4 14h6v6H8v-4H4z",
};

function Icon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

/** The page frame of the watch route and the offline file, with the player styles. */
export function WatchShell({ children }: { children: ReactNode }) {
  return (
    <main className="watch-page">
      <style dangerouslySetInnerHTML={{ __html: WATCH_CSS }} />
      {children}
    </main>
  );
}

/** Never re-renders after mount: the frame lives in the seek bar and the clock. */
const WatchCanvas = memo(function WatchCanvas({
  playerRef,
  plan,
}: {
  playerRef: RefObject<PlayerRef>;
  plan: CompiledVideo;
}) {
  const inputProps = useMemo(() => ({ plan, assetMode: "url" as const }), [plan]);
  const initialFrame = useMemo(() => coverFrame(plan), [plan]);
  const audioTags = useMemo(() => sharedAudioTagCount(plan), [plan]);
  return (
    <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
      ref={playerRef}
      component={StudioVideo}
      inputProps={inputProps}
      durationInFrames={Math.max(1, plan.durationInFrames)}
      compositionWidth={plan.width}
      compositionHeight={plan.height}
      fps={plan.fps}
      initialFrame={initialFrame}
      controls={false}
      clickToPlay={false}
      moveToBeginningWhenEnded={false}
      numberOfSharedAudioTags={audioTags}
      acknowledgeRemotionLicense
      style={PLAYER_STYLE}
    />
  );
});

function usePlayerFrame(playerRef: RefObject<PlayerRef>) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    setFrame(player.getCurrentFrame());
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
    };
  }, [playerRef]);
  return frame;
}

function SeekBar({
  playerRef,
  plan,
  marks,
  started,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef>;
  plan: CompiledVideo;
  marks: readonly Chapter[];
  started: boolean;
  onSeek: (frame: number) => void;
}) {
  const frame = usePlayerFrame(playerRef);
  const last = Math.max(0, plan.durationInFrames - 1);
  // Before the first play the canvas shows the cover, but the video starts at 0.
  const shown = started ? Math.min(frame, last) : 0;
  const share = (value: number) => (last > 0 ? value / last : 0);
  return (
    <div className="watch-seek" style={{ ["--ratio" as string]: share(shown) }}>
      <input
        className="watch-range"
        type="range"
        aria-label="Перемотка"
        aria-valuetext={`${formatClock(shown, plan.fps)} из ${formatClock(plan.durationInFrames, plan.fps)}`}
        min={0}
        max={last}
        value={shown}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      {marks.map((mark) => (
        <span
          key={`${mark.label}-${mark.frame}`}
          className="watch-mark"
          aria-hidden="true"
          style={{ ["--at" as string]: share(mark.frame) }}
        />
      ))}
    </div>
  );
}

function Clock({
  playerRef,
  plan,
  marks,
  started,
}: {
  playerRef: RefObject<PlayerRef>;
  plan: CompiledVideo;
  marks: readonly Chapter[];
  started: boolean;
}) {
  const frame = usePlayerFrame(playerRef);
  const shown = started ? frame : 0;
  const chapter = chapterAt(marks, shown);
  return (
    <span className="watch-clock">
      {formatClock(shown, plan.fps)} / {formatClock(plan.durationInFrames, plan.fps)}
      {chapter ? <span className="watch-chapter-label"> · {chapter.label}</span> : null}
    </span>
  );
}

function keyTarget(target: EventTarget | null): KeyTarget {
  if (!(target instanceof HTMLElement)) return { tagName: "BODY" };
  return {
    tagName: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    isContentEditable: target.isContentEditable,
    nativeArrows: target.dataset.nativeArrows === "true",
  };
}

const fromControls = (target: EventTarget | null) =>
  target instanceof Element && target.closest(".watch-controls, .watch-cover") !== null;

export function WatchPlayer({ plan, title }: { plan: CompiledVideo; title: string }) {
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => chapters(plan), [plan]);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Timers and window listeners read these; they are bound once.
  const live = useRef({
    idleAt: 0,
    playing: false,
    loading: false,
    started: false,
    hover: false,
    focus: false,
    pointer: "mouse",
    lastVolume: 1,
  });

  const actions = useMemo(() => {
    const player = () => playerRef.current;
    const wake = () => {
      live.current.idleAt = Date.now();
      setHidden(false);
    };
    const markStarted = () => {
      live.current.started = true;
      setStarted(true);
    };
    const play = (event?: SyntheticEvent) => {
      const current = player();
      if (!current) return;
      // The cover is a frame from inside the first scene; the video itself starts at 0.
      if (!live.current.started) current.seekTo(0);
      current.play(event);
    };
    const toggle = (event?: SyntheticEvent) => {
      if (live.current.started && player()?.isPlaying()) player()?.pause();
      else play(event);
    };
    const seek = (frame: number) => {
      player()?.seekTo(frame);
      markStarted();
      wake();
    };
    const frameNow = () => (live.current.started ? (player()?.getCurrentFrame() ?? 0) : 0);
    const toggleMute = () => {
      const current = player();
      if (!current) return;
      if (current.isMuted() || current.getVolume() === 0) {
        if (current.getVolume() === 0) current.setVolume(live.current.lastVolume);
        current.unmute();
      } else current.mute();
    };
    const setLevel = (level: number) => {
      const current = player();
      if (!current) return;
      current.setVolume(level);
      if (level === 0) current.mute();
      else if (current.isMuted()) current.unmute();
    };
    const toggleFullscreen = () => {
      const stage = stageRef.current;
      if (!stage || document.fullscreenEnabled !== true) return;
      const change =
        document.fullscreenElement === stage
          ? document.exitFullscreen()
          : stage.requestFullscreen();
      void change.catch(() => {});
    };
    const run = (action: KeyAction, event: KeyboardEvent) => {
      const frame = frameNow();
      if (action === "toggle") toggle(event as unknown as SyntheticEvent);
      else if (action === "seek-back" || action === "seek-forward")
        seek(
          seekBySeconds(
            frame,
            action === "seek-back" ? -SEEK_STEP_SEC : SEEK_STEP_SEC,
            plan.fps,
            plan.durationInFrames,
          ),
        );
      else if (action === "chapter-prev") seek(previousChapterFrame(marks, frame, plan.fps));
      else if (action === "chapter-next")
        seek(nextChapterFrame(marks, frame, plan.durationInFrames));
      else if (action === "mute") toggleMute();
      else toggleFullscreen();
    };
    return {
      wake,
      markStarted,
      play,
      toggle,
      seek,
      frameNow,
      toggleMute,
      setLevel,
      toggleFullscreen,
      run,
    };
  }, [marks, plan]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const state = live.current;
    setCanFullscreen(document.fullscreenEnabled === true);
    // Remotion keeps the volume between visits; show what it restored.
    setVolume(player.getVolume());
    setMuted(player.isMuted());
    if (player.getVolume() > 0) state.lastVolume = player.getVolume();

    const prefetched = new Set<string>();
    // Decoded pictures stay in the memory cache while something holds them.
    const stills = new Map<string, HTMLImageElement>();
    const warm = (afterFrame: number) => {
      const ahead = upcomingMedia(plan, afterFrame, PREFETCH_HORIZON_SEC * plan.fps);
      for (const url of ahead.sounds) {
        if (prefetched.has(url)) continue;
        prefetched.add(url);
        try {
          void prefetch(url, { method: "blob-url" })
            .waitUntilDone()
            .catch(() => {});
        } catch {
          // A cue that cannot be prefetched still streams once it is premounted.
        }
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
    warm(-1);
    let step = -1;
    const onFrame = (event: { detail: { frame: number } }) => {
      if (!state.started) return;
      const next = Math.floor(event.detail.frame / (PREFETCH_STEP_SEC * plan.fps));
      if (next === step) return;
      step = next;
      warm(event.detail.frame);
    };

    let loadingTimer: number | undefined;
    const stopLoading = () => {
      window.clearTimeout(loadingTimer);
      state.loading = false;
      setLoading(false);
    };
    const onPlay = () => {
      state.playing = true;
      setPlaying(true);
      actions.markStarted();
      actions.wake();
    };
    const onPause = () => {
      state.playing = false;
      setPlaying(false);
      stopLoading();
      actions.wake();
    };
    const onWaiting = () => {
      window.clearTimeout(loadingTimer);
      loadingTimer = window.setTimeout(() => {
        state.loading = true;
        setLoading(true);
      }, LOADING_DELAY_MS);
    };
    const onVolume = (event: { detail: { volume: number } }) => {
      setVolume(event.detail.volume);
      if (event.detail.volume > 0) state.lastVolume = event.detail.volume;
    };
    const onMute = (event: { detail: { isMuted: boolean } }) => setMuted(event.detail.isMuted);
    const onFullscreen = () => setFullscreen(document.fullscreenElement === stageRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyAction(event, keyTarget(event.target));
      if (!action) return;
      event.preventDefault();
      actions.wake();
      actions.run(action, event);
    };
    // Firefox clicks a focused button on Space keyup even after keydown was handled.
    const onKeyUp = (event: KeyboardEvent) => {
      if (keyAction(event, keyTarget(event.target)) === "toggle") event.preventDefault();
    };
    const hideTimer = window.setInterval(() => {
      setHidden(
        controlsHidden({
          playing: state.playing,
          loading: state.loading,
          pinned: state.hover || state.focus,
          idleMs: Date.now() - state.idleAt,
        }),
      );
    }, 200);

    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("waiting", onWaiting);
    player.addEventListener("resume", stopLoading);
    player.addEventListener("volumechange", onVolume);
    player.addEventListener("mutechange", onMute);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      stills.clear();
      window.clearTimeout(loadingTimer);
      window.clearInterval(hideTimer);
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("waiting", onWaiting);
      player.removeEventListener("resume", stopLoading);
      player.removeEventListener("volumechange", onVolume);
      player.removeEventListener("mutechange", onMute);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [actions, plan]);

  const level = muted ? 0 : volume;
  return (
    <div
      ref={stageRef}
      className={hidden ? "watch-stage is-idle" : "watch-stage"}
      style={{ ["--aspect" as string]: String(plan.width / plan.height) }}
    >
      <div
        className="watch-canvas"
        onPointerDown={(event) => {
          live.current.pointer = event.pointerType;
          actions.wake();
        }}
        onPointerMove={actions.wake}
        // A mouse click plays or pauses; a tap only brings the panel back.
        onClick={(event) => {
          if (!fromControls(event.target) && live.current.pointer === "mouse")
            actions.toggle(event);
        }}
        onDoubleClick={(event) => {
          if (!fromControls(event.target) && live.current.pointer === "mouse")
            actions.toggleFullscreen();
        }}
      >
        <WatchCanvas playerRef={playerRef} plan={plan} />
        {loading ? (
          <div className="watch-loading" role="status">
            Загрузка…
          </div>
        ) : null}
        {started ? null : (
          <div className="watch-cover" onClick={(event) => actions.play(event)}>
            <button type="button" className="watch-cover-play" aria-label="Воспроизвести">
              <Icon name="play" size={36} />
            </button>
            <strong>{title}</strong>
            <span>{formatClock(plan.durationInFrames, plan.fps)}</span>
          </div>
        )}
        <div
          className="watch-controls"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") live.current.hover = true;
          }}
          onPointerLeave={() => {
            live.current.hover = false;
            actions.wake();
          }}
          onFocus={(event) => {
            live.current.focus = event.target.matches(":focus-visible");
            actions.wake();
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              live.current.focus = false;
          }}
        >
          <SeekBar
            playerRef={playerRef}
            plan={plan}
            marks={marks}
            started={started}
            onSeek={actions.seek}
          />
          <div className="watch-row">
            <button
              type="button"
              className="watch-btn"
              aria-label="Предыдущая глава"
              title="Предыдущая глава"
              onClick={() => actions.seek(previousChapterFrame(marks, actions.frameNow(), plan.fps))}
            >
              <Icon name="previous" />
            </button>
            <button
              type="button"
              className="watch-btn"
              aria-label={playing ? "Пауза" : "Воспроизвести"}
              title={playing ? "Пауза" : "Воспроизвести"}
              onClick={(event) => actions.toggle(event)}
            >
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button
              type="button"
              className="watch-btn"
              aria-label="Следующая глава"
              title="Следующая глава"
              onClick={() =>
                actions.seek(nextChapterFrame(marks, actions.frameNow(), plan.durationInFrames))
              }
            >
              <Icon name="next" />
            </button>
            <Clock playerRef={playerRef} plan={plan} marks={marks} started={started} />
            <button
              type="button"
              className="watch-btn"
              aria-label={level === 0 ? "Включить звук" : "Выключить звук"}
              title={level === 0 ? "Включить звук" : "Выключить звук"}
              onClick={actions.toggleMute}
            >
              <Icon name={level === 0 ? "muted" : "sound"} />
            </button>
            <input
              className="watch-range watch-volume"
              type="range"
              aria-label="Громкость"
              data-native-arrows="true"
              min={0}
              max={1}
              step={0.05}
              value={level}
              style={{ ["--ratio" as string]: level }}
              onChange={(event) => actions.setLevel(Number(event.target.value))}
            />
            {canFullscreen ? (
              <button
                type="button"
                className="watch-btn"
                aria-label={fullscreen ? "Выйти из полного экрана" : "Полный экран"}
                title={fullscreen ? "Выйти из полного экрана" : "Полный экран"}
                onClick={actions.toggleFullscreen}
              >
                <Icon name={fullscreen ? "exitFullscreen" : "enterFullscreen"} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="watch-title">{title}</p>
    </div>
  );
}
