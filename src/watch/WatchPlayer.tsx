"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import type { PlayerRef } from "@remotion/player";
import { Player } from "@remotion/player";
import type { AnyZodObject } from "zod";
import { prefetch } from "remotion";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { CompiledVideo } from "@/video";
import {
  chapters,
  controlsHidden,
  keyAction,
  nextChapterFrame,
  previousChapterFrame,
  seekBySeconds,
  sharedAudioTagCount,
  type Chapter,
} from "./model";

const STYLE_ID = "douga-watch-style";
const WATCH_CSS = `
.watch-stage{position:relative;width:min(100%,calc((100dvh - 168px) * var(--aspect,1.777)));max-width:100%}
.watch-stage:fullscreen{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000}
.watch-stage:fullscreen .watch-canvas{width:min(100vw,calc(100vh * var(--aspect,1.777)));max-height:100vh}
.watch-canvas{position:relative;width:100%;aspect-ratio:var(--aspect,1.777);background:#000;overflow:hidden}
.watch-canvas .__remotion-player,.watch-canvas [data-remotion-canvas]{width:100%;height:100%}
.watch-title{margin:10px 0 0;font-size:16px;font-weight:650;text-align:center}
.watch-cover,.watch-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(5,7,12,.45);color:#fff}
.watch-cover button,.watch-controls button{min-width:44px;min-height:44px;border:0;border-radius:999px;background:rgba(8,12,20,.72);color:#fff;font-size:18px}
.watch-cover button{width:76px;height:76px;font-size:32px}
.watch-controls{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px 10px;background:linear-gradient(transparent,rgba(0,0,0,.78));transition:opacity .2s}
.watch-controls input[type=range]{min-height:44px;flex:1;min-width:120px}
.watch-time{font-variant-numeric:tabular-nums;font-size:13px;min-width:88px}
.watch-seek{position:relative;flex:1 1 180px;min-width:140px;display:flex;align-items:center}
.watch-chapter{position:absolute;top:18px;width:8px;height:8px;min-width:8px;min-height:8px;padding:0;border-radius:99px;background:#ffd166;transform:translateX(-50%)}
.watch-stage.is-idle,.watch-stage.is-idle *{cursor:none !important}
.watch-stage.is-idle .watch-controls{opacity:0;pointer-events:none}
.watch-volume{width:88px;flex:0 0 88px;min-width:88px}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = WATCH_CSS;
  document.head.appendChild(style);
}

function formatClock(frame: number, fps: number): string {
  const total = Math.max(0, Math.round(frame / fps));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function prefetchStills(plan: CompiledVideo) {
  const urls = new Set<string>();
  for (const scene of plan.scenes)
    for (const node of scene.nodes) {
      const asset = node.media?.asset;
      if (!asset) continue;
      if (asset.kind === "image") urls.add(asset.src);
      if (asset.posterSrc) urls.add(asset.posterSrc);
    }
  for (const url of urls) {
    try {
      prefetch(url, { method: "blob-url" });
    } catch {
      /* A still that cannot be prefetched pauses through pauseWhenLoading. */
    }
  }
}

function WatchChrome({
  playerRef,
  stageRef,
  plan,
  title,
  marks,
}: {
  playerRef: React.RefObject<PlayerRef>;
  stageRef: React.RefObject<HTMLDivElement>;
  plan: CompiledVideo;
  title: string;
  marks: Chapter[];
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const idleAt = useRef(Date.now());
  const last = Math.max(0, plan.durationInFrames - 1);
  const inputProps = useMemo(
    () => ({ plan, assetMode: "url" as const }),
    [plan],
  );

  useEffect(() => {
    ensureStyles();
    setCanFullscreen(document.fullscreenEnabled === true);
    const player = playerRef.current;
    if (!player) return;
    let loadingTimer: number | undefined;
    const onFrame = (event: { detail: { frame: number } }) =>
      setFrame(event.detail.frame);
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => {
      window.clearTimeout(loadingTimer);
      loadingTimer = window.setTimeout(() => setLoading(true), 300);
    };
    const onResume = () => {
      window.clearTimeout(loadingTimer);
      setLoading(false);
    };
    const onVolume = (event: { detail: { volume: number } }) =>
      setVolume(event.detail.volume);
    const onMute = (event: { detail: { isMuted: boolean } }) =>
      setMuted(event.detail.isMuted);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("waiting", onWaiting);
    player.addEventListener("resume", onResume);
    player.addEventListener("volumechange", onVolume);
    player.addEventListener("mutechange", onMute);
    const onFullscreen = () =>
      setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    const hideTimer = window.setInterval(() => {
      setHidden(
        controlsHidden({
          playing: player.isPlaying(),
          loading: false,
          idleMs: Date.now() - idleAt.current,
        }) && !loading,
      );
    }, 200);
    return () => {
      window.clearTimeout(loadingTimer);
      window.clearInterval(hideTimer);
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("waiting", onWaiting);
      player.removeEventListener("resume", onResume);
      player.removeEventListener("volumechange", onVolume);
      player.removeEventListener("mutechange", onMute);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [playerRef, stageRef, loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = keyAction(event.key, {
        tagName: target.tagName,
        type: target instanceof HTMLInputElement ? target.type : undefined,
        isContentEditable: target.isContentEditable,
      });
      if (!action) return;
      const player = playerRef.current;
      if (!player) return;
      event.preventDefault();
      idleAt.current = Date.now();
      setHidden(false);
      const current = player.getCurrentFrame();
      if (action === "toggle") {
        player.toggle(event as unknown as SyntheticEvent);
        return;
      }
      if (action === "seek-back" || action === "seek-forward")
        player.seekTo(
          seekBySeconds(
            current,
            action === "seek-back" ? -5 : 5,
            plan.fps,
            plan.durationInFrames,
          ),
        );
      if (action === "chapter-prev")
        player.seekTo(previousChapterFrame(marks, current, plan.fps));
      if (action === "chapter-next")
        player.seekTo(
          nextChapterFrame(marks, current, plan.durationInFrames),
        );
      if (action === "mute") {
        if (player.isMuted()) player.unmute();
        else player.mute();
      }
      if (action === "fullscreen") void toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marks, plan.durationInFrames, plan.fps, playerRef]);

  function wake() {
    idleAt.current = Date.now();
    setHidden(false);
  }

  function toggleFullscreen() {
    const node = stageRef.current;
    if (!node || document.fullscreenEnabled !== true) return;
    if (document.fullscreenElement === node) void document.exitFullscreen();
    else void node.requestFullscreen();
  }

  function play(event: SyntheticEvent) {
    prefetchStills(plan);
    playerRef.current?.play(event);
  }

  const idle = hidden && playing && !loading;
  return (
    <div
      ref={stageRef}
      className={idle ? "watch-stage is-idle" : "watch-stage"}
      style={{ ["--aspect" as string]: String(plan.width / plan.height) }}
      onPointerMove={wake}
      tabIndex={0}
    >
      <div className="watch-canvas">
        <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
          ref={playerRef}
          component={StudioVideo}
          inputProps={inputProps}
          durationInFrames={Math.max(1, plan.durationInFrames)}
          compositionWidth={plan.width}
          compositionHeight={plan.height}
          fps={plan.fps}
          controls={false}
          clickToPlay={false}
          acknowledgeRemotionLicense
          numberOfSharedAudioTags={sharedAudioTagCount(plan)}
          style={{ width: "100%", height: "100%" }}
          initiallyMuted={false}
        />
        {loading ? <div className="watch-loading">загрузка</div> : null}
        {started ? null : (
          <div className="watch-cover">
            <button type="button" aria-label="Воспроизвести" onClick={play}>
              ▶
            </button>
            <strong>{title}</strong>
            <span>{formatClock(plan.durationInFrames, plan.fps)}</span>
          </div>
        )}
        <div
          className="watch-controls"
          style={idle ? undefined : { opacity: 1 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Предыдущая глава"
            onClick={() =>
              playerRef.current?.seekTo(
                previousChapterFrame(
                  marks,
                  playerRef.current?.getCurrentFrame() ?? 0,
                  plan.fps,
                ),
              )
            }
          >
            ⏮
          </button>
          <button
            type="button"
            aria-label={playing ? "Пауза" : "Воспроизвести"}
            onClick={(event) =>
              started ? playerRef.current?.toggle(event) : play(event)
            }
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            aria-label="Следующая глава"
            onClick={() =>
              playerRef.current?.seekTo(
                nextChapterFrame(
                  marks,
                  playerRef.current?.getCurrentFrame() ?? 0,
                  plan.durationInFrames,
                ),
              )
            }
          >
            ⏭
          </button>
          <div className="watch-seek">
            {marks.map((mark) => (
              <button
                key={`${mark.label}-${mark.frame}`}
                type="button"
                className="watch-chapter"
                style={{
                  left: `${(mark.frame / Math.max(1, plan.durationInFrames)) * 100}%`,
                }}
                aria-label={mark.label}
                title={mark.label}
                onClick={() => playerRef.current?.seekTo(mark.frame)}
              />
            ))}
            <input
              aria-label="Перемотка"
              type="range"
              min={0}
              max={last}
              value={Math.min(frame, last)}
              onChange={(event) =>
                playerRef.current?.seekTo(Number(event.target.value))
              }
            />
          </div>
          <span className="watch-time">
            {formatClock(frame, plan.fps)} /{" "}
            {formatClock(plan.durationInFrames, plan.fps)}
          </span>
          <button
            type="button"
            aria-label={muted ? "Включить звук" : "Выключить звук"}
            onClick={() => {
              const player = playerRef.current;
              if (!player) return;
              if (player.isMuted()) player.unmute();
              else player.mute();
            }}
          >
            {muted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            className="watch-volume"
            aria-label="Громкость"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => {
              const next = Number(event.target.value);
              const player = playerRef.current;
              if (!player) return;
              player.setVolume(next);
              if (next === 0) player.mute();
              else if (player.isMuted()) player.unmute();
            }}
          />
          {canFullscreen ? (
            <button
              type="button"
              aria-label="Полный экран"
              onClick={() => toggleFullscreen()}
            >
              {fullscreen ? "⤡" : "⛶"}
            </button>
          ) : null}
        </div>
      </div>
      <p className="watch-title">{title}</p>
    </div>
  );
}

export function WatchPlayer({
  plan,
  title,
}: {
  plan: CompiledVideo;
  title: string;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => chapters(plan), [plan]);
  return (
    <WatchChrome
      playerRef={playerRef}
      stageRef={stageRef}
      plan={plan}
      title={title}
      marks={marks}
    />
  );
}
