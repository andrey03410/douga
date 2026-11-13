import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { AnyZodObject } from "remotion";
import { StudioVideo } from "@douga/render/StudioVideo";
import { hitTest } from "@douga/render/hit-test";
import type { ChoiceHit, CompiledVideo } from "@douga/video";
import { createMediaWarmer } from "./preload";
import { sharedAudioTagCount } from "./model";
import { frameLimit, syncStep, targetFrame } from "./clock";

export type InteractiveEvent =
  | { type: "ready" }
  | { type: "hold"; frame: number }
  | { type: "ended" }
  | { type: "waiting" }
  | { type: "resume" }
  | { type: "audio-blocked" }
  | { type: "error"; message: string };

export interface InteractivePlayerProps {
  plan: CompiledVideo;
  /** Server time when frame 0 of the plan plays, ms. */
  startedAt: number;
  /** Server clock, ms. A paused host returns a frozen time. */
  now: () => number;
  /** Stop on this frame and wait for the game; null plays to the end. */
  holdFrame?: number | null;
  paused?: boolean;
  muted?: boolean;
  /** 0..1 */
  volume?: number;
  onEvent?: (event: InteractiveEvent) => void;
  /** A pressable card of the plan was pressed. */
  onPick?: (hit: ChoiceHit) => void;
  /** Called once with a function that turns sound on from a user gesture. */
  onUnlockAudio?: (unlock: (event: ReactMouseEvent) => void) => void;
  className?: string;
  style?: CSSProperties;
}

const PLAYER_STYLE: CSSProperties = { width: "100%", height: "100%" };
const SYNC_MS = 200;

/**
 * Plays a compiled plan in step with the game's server clock: no controls, holds on a
 * frame while the game waits, reports presses on pressable cards. The picture is the
 * same StudioVideo as /watch, stills and MP4.
 */
export function InteractivePlayer(props: InteractivePlayerProps) {
  const { plan, startedAt, holdFrame = null, paused = false, muted = false, volume = 1 } = props;
  const playerRef = useRef<PlayerRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [soundBlocked, setSoundBlocked] = useState(false);
  const inputProps = useMemo(() => ({ plan, assetMode: "url" as const }), [plan]);
  const audioTags = useMemo(() => sharedAudioTagCount(plan), [plan]);
  const initialFrame = useMemo(
    () => targetFrame({ now: props.now(), startedAt, fps: plan.fps, durationInFrames: plan.durationInFrames, holdFrame }),
    // The first frame only; later frames come from the sync loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan],
  );

  // Browsers refuse sound before the first user gesture: start muted and say so.
  const needsGesture =
    typeof navigator !== "undefined" &&
    "userActivation" in navigator &&
    !(navigator as Navigator & { userActivation: { hasBeenActive: boolean } }).userActivation.hasBeenActive;
  useEffect(() => {
    if (needsGesture) {
      setSoundBlocked(true);
      live.current.onEvent?.({ type: "audio-blocked" });
    }
    live.current.onUnlockAudio?.((event) => {
      const player = playerRef.current;
      if (!player) return;
      player.unmute();
      if (player.isPlaying()) player.play(event);
      setSoundBlocked(false);
    });
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted || soundBlocked) player.mute();
    else player.unmute();
    player.setVolume(Math.max(0, Math.min(1, volume)));
  }, [muted, soundBlocked, volume]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const warmer = createMediaWarmer(plan);
    warmer.warm(-1);
    let held = false;
    let ended = false;
    const tick = () => {
      const p = live.current;
      const limit = frameLimit({ durationInFrames: plan.durationInFrames, holdFrame: p.holdFrame });
      const target = targetFrame({
        now: p.now(),
        startedAt: p.startedAt,
        fps: plan.fps,
        durationInFrames: plan.durationInFrames,
        holdFrame: p.holdFrame,
      });
      const step = syncStep({
        current: player.getCurrentFrame(),
        playing: player.isPlaying(),
        target,
        limit,
        paused: Boolean(p.paused),
      });
      if (step.type === "seek") {
        player.seekTo(step.frame);
        if (step.play && !player.isPlaying()) player.play();
      } else if (step.type === "play") player.play();
      else if (step.type === "pause") {
        if (player.isPlaying()) player.pause();
        if (player.getCurrentFrame() !== step.frame) player.seekTo(step.frame);
      }
      const atHold = !p.paused && p.holdFrame !== null && p.holdFrame !== undefined && target >= limit && limit < plan.durationInFrames - 1;
      if (atHold && !held) p.onEvent?.({ type: "hold", frame: limit });
      held = atHold;
      const atEnd = target >= plan.durationInFrames - 1 && !atHold;
      if (atEnd && !ended) p.onEvent?.({ type: "ended" });
      ended = atEnd;
    };
    const onFrame = (event: { detail: { frame: number } }) => warmer.onFrame(event.detail.frame);
    const onWaiting = () => live.current.onEvent?.({ type: "waiting" });
    const onResume = () => live.current.onEvent?.({ type: "resume" });
    const onError = (event: { detail: { error: Error } }) =>
      live.current.onEvent?.({ type: "error", message: event.detail.error.message });
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("waiting", onWaiting);
    player.addEventListener("resume", onResume);
    player.addEventListener("error", onError);
    tick();
    live.current.onEvent?.({ type: "ready" });
    const timer = window.setInterval(tick, SYNC_MS);
    return () => {
      window.clearInterval(timer);
      warmer.dispose();
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("waiting", onWaiting);
      player.removeEventListener("resume", onResume);
      player.removeEventListener("error", onError);
    };
  }, [plan]);

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    const player = playerRef.current;
    if (!box || !player || !live.current.onPick) return;
    // The player letterboxes the composition into the box.
    const scale = Math.min(box.width / plan.width, box.height / plan.height);
    const offsetX = (box.width - plan.width * scale) / 2;
    const offsetY = (box.height - plan.height * scale) / 2;
    const point = {
      x: (event.clientX - box.left - offsetX) / scale,
      y: (event.clientY - box.top - offsetY) / scale,
    };
    const hit = hitTest(plan, player.getCurrentFrame(), point);
    if (hit) live.current.onPick(hit);
  };

  return (
    <div
      ref={boxRef}
      className={props.className}
      style={{ position: "relative", width: "100%", height: "100%", ...props.style }}
      onClick={onClick}
      data-douga-interactive=""
    >
      <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
        ref={playerRef}
        component={StudioVideo}
        inputProps={inputProps}
        durationInFrames={Math.max(1, plan.durationInFrames)}
        compositionWidth={plan.width}
        compositionHeight={plan.height}
        fps={plan.fps}
        initialFrame={initialFrame}
        initiallyMuted={needsGesture || muted}
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        moveToBeginningWhenEnded={false}
        numberOfSharedAudioTags={audioTags}
        acknowledgeRemotionLicense
        style={PLAYER_STYLE}
      />
    </div>
  );
}
