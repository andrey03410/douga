"use client";
import React, { useRef, useState } from "react";

export function mediaClock(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function playableDuration(
  actual: number,
  fallback?: number | null,
): number {
  return Number.isFinite(actual) && actual > 0
    ? actual
    : Number.isFinite(fallback) && fallback! > 0
      ? fallback!
      : 0;
}
export function toggleMediaSound(
  media: Pick<HTMLMediaElement, "muted" | "volume">,
) {
  if (media.muted || media.volume === 0) {
    media.muted = false;
    if (media.volume === 0) media.volume = 1;
  } else media.muted = true;
}
function Icon({ kind }: { kind: "play" | "pause" | "volume" | "mute" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "play" ? (
        <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
      ) : kind === "pause" ? (
        <>
          <path d="M8 5v14M16 5v14" strokeWidth="4" />
        </>
      ) : (
        <>
          <path d="M11 5 6 9H3v6h3l5 4z" />
          {kind === "mute" ? (
            <path d="m16 9 5 6m0-6-5 6" />
          ) : (
            <>
              <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
            </>
          )}
        </>
      )}
    </svg>
  );
}
export function MediaPlayer({
  src,
  title,
  durationSec,
  kind = "audio",
  maxHeight = 240,
  mediaRef,
  onPlay,
}: {
  src: string;
  title: string;
  durationSec?: number | null;
  kind?: "audio" | "video";
  maxHeight?: number;
  mediaRef?: (element: HTMLMediaElement | null) => void;
  onPlay?: (e: React.SyntheticEvent<HTMLMediaElement>) => void;
}) {
  const element = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(() =>
    playableDuration(0, durationSec),
  );
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    const media = element.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    setError("");
    setWaiting(true);
    try {
      if (media.ended) media.currentTime = 0;
      await media.play();
    } catch {
      setWaiting(false);
      setError("Не удалось воспроизвести файл. Попробуйте ещё раз.");
    }
  }
  const props = {
    src,
    preload: kind === "video" || !durationSec ? "metadata" : "none",
    ref: (node: HTMLMediaElement | null) => {
      element.current = node;
      mediaRef?.(node);
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setDuration(playableDuration(e.currentTarget.duration, durationSec)),
    onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setDuration(playableDuration(e.currentTarget.duration, durationSec)),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setCurrent(e.currentTarget.currentTime),
    onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      setPlaying(true);
      onPlay?.(e);
    },
    onPlaying: () => setWaiting(false),
    onWaiting: () => setWaiting(true),
    onPause: () => {
      setPlaying(false);
      setWaiting(false);
    },
    onEnded: () => {
      setPlaying(false);
      setWaiting(false);
    },
    onError: () => {
      setWaiting(false);
      setPlaying(false);
      setError("Файл не удалось воспроизвести");
    },
    onVolumeChange: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      setMuted(e.currentTarget.muted);
      setVolume(e.currentTarget.volume);
    },
  };
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  return (
    <div
      className={`media-player${kind === "video" ? " with-video" : ""}`}
      role="group"
      aria-label={`Проигрыватель: ${title}`}
    >
      {kind === "video" ? (
        <video
          {...props}
          className="media-player-video"
          style={{ maxHeight }}
          playsInline
        />
      ) : (
        <audio {...props} />
      )}
      <div className="media-player-controls">
        <button
          type="button"
          className={`media-play${playing ? " playing" : ""}`}
          aria-label={`${playing ? "Приостановить" : "Воспроизвести"} ${title}`}
          onClick={() => void toggle()}
        >
          <Icon kind={playing ? "pause" : "play"} />
        </button>
        <div className="media-timeline">
          <div className="media-times">
            <span>{mediaClock(current)}</span>
            <span aria-live="off">
              {waiting ? "Загрузка…" : mediaClock(duration)}
            </span>
          </div>
          <input
            className="media-seek"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(current, duration || 0)}
            disabled={!duration}
            aria-label="Позиция воспроизведения"
            aria-valuetext={`${mediaClock(current)} из ${mediaClock(duration)}`}
            style={
              { "--media-progress": `${progress}%` } as React.CSSProperties
            }
            onChange={(e) => {
              const time = Number(e.target.value);
              if (element.current) {
                element.current.currentTime = time;
                setCurrent(time);
              }
            }}
          />
        </div>
        <button
          type="button"
          className="media-mute"
          aria-label={
            muted || volume === 0 ? "Включить звук" : "Выключить звук"
          }
          aria-pressed={muted || volume === 0}
          onClick={() => {
            if (element.current) toggleMediaSound(element.current);
          }}
        >
          <Icon kind={muted || volume === 0 ? "mute" : "volume"} />
        </button>
        <input
          className="media-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Громкость"
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onChange={(e) => {
            if (element.current) {
              element.current.volume = Number(e.target.value);
              element.current.muted = false;
            }
          }}
        />
      </div>
      {error ? (
        <p className="media-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
