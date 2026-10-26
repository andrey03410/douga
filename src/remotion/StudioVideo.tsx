import React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type {
  CompiledAudio,
  CompiledNode,
  CompiledScene,
  CompiledVideo,
  Rect,
} from "../video/types";
import {
  answerCardFrames,
  audioVolumeAt,
  evaluateNode,
  fitTextSize,
  inWindows,
  mediaFrameAt,
  mediaLayout,
  transitionAt,
} from "./studio-frame";

export interface StudioVideoProps {
  plan: CompiledVideo;
  /** url: usable HTTP/data URLs. static: paths relative to the worker's publicDir. */
  assetMode?: "url" | "static";
}
type AssetMode = NonNullable<StudioVideoProps["assetMode"]>;
const resolveAsset = (src: string, mode: AssetMode) =>
  mode === "static" ? staticFile(src) : src;
const FONT = '"Arial", "Helvetica Neue", sans-serif';
const GOLD = "#ffd166";

const Media: React.FC<{
  node: CompiledNode;
  frame: number;
  mode: AssetMode;
  heldFrame?: number;
}> = ({ node, frame, mode, heldFrame }) => {
  const media = node.media;
  if (!media) return null;
  const layout = mediaLayout(media, node.rect);
  const source = resolveAsset(media.asset.src, mode);
  const outsideActive =
    heldFrame !== undefined ||
    (node.activeWindow && !inWindows([node.activeWindow], frame));
  return (
    <div style={layout.viewport}>
      {media.asset.kind === "image" ? (
        <Img src={source} style={layout.source} />
      ) : outsideActive && media.asset.posterSrc ? (
        <Img
          src={resolveAsset(media.asset.posterSrc, mode)}
          style={layout.source}
        />
      ) : (
        // Freeze maps every output frame onto the exact source frame, including
        // offset loops, inactive card stills, and non-looping source-tail holds.
        // Keep Freeze at zero: a large frozen frame plus the scene offset can
        // exceed the composition duration and Remotion clamps that timeline.
        <Freeze frame={0}>
          <OffthreadVideo
            muted
            src={source}
            startFrom={heldFrame ?? mediaFrameAt(node, frame)}
            style={layout.source}
          />
        </Freeze>
      )}
    </div>
  );
};

const Shape: React.FC<{ node: CompiledNode }> = ({ node }) => {
  const { width, height } = node.rect;
  const paint = {
    fill: node.fill ?? node.style.background ?? "#7c9cff",
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
  };
  const inset = (node.strokeWidth ?? 0) / 2;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
    >
      {node.shape === "path" ? (
        <path d={node.path} {...paint} />
      ) : node.shape === "ellipse" ? (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={Math.max(0, width / 2 - inset)}
          ry={Math.max(0, height / 2 - inset)}
          {...paint}
        />
      ) : (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, width - 2 * inset)}
          height={Math.max(0, height - 2 * inset)}
          rx={node.style.borderRadius}
          {...paint}
        />
      )}
    </svg>
  );
};

/** Pure visual boundary shared by Player, stills, clips, and full compositions. */
export const StudioSceneFrame: React.FC<{
  scene: CompiledScene;
  frame: number;
  fps: number;
  width: number;
  height: number;
  assetMode: AssetMode;
  heldFrames?: Record<string, number>;
}> = ({ scene, frame, fps, width, height, assetMode, heldFrames }) => {
  const children = new Map<string | undefined, CompiledNode[]>();
  for (const node of [...scene.nodes].sort((a, b) => a.layer - b.layer)) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const answerPhase = scene.nodes.some(
    (node) =>
      node.answer && node.answerFrom !== undefined && frame >= node.answerFrom,
  );
  const renderNode = (node: CompiledNode, parent?: Rect): React.ReactNode => {
    const state = evaluateNode(node, frame, fps);
    if (!state.visible) return null;
    const { rect, style } = node;
    const card = node.type === "card",
      group = node.type === "group";
    const framed = card || group;
    const fontSize =
      style.fontSize ??
      Math.max(18, Math.min(48, rect.width * 0.07, rect.height * 0.16));
    const textStyle: React.CSSProperties = {
      color: style.color ?? "white",
      fontSize,
      fontWeight: 700,
      lineHeight: 1.15,
      textAlign: "center",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    };
    const label = `${node.showRank && node.rank !== undefined ? `#${node.rank} ` : ""}${node.label ?? ""}`;
    const textPadding = Math.min(20, rect.width * 0.03);
    const text =
      node.type === "timer" ? String(state.countdown) : (node.text ?? "");
    const labelSize = fitTextSize(
      label,
      Math.max(1, rect.width - 46),
      Math.max(1, rect.height * 0.5 - 18),
      fontSize,
    );
    const textSize = fitTextSize(
      text,
      Math.max(1, rect.width - textPadding * 2),
      Math.max(1, rect.height - textPadding * 2),
      fontSize,
    );
    return (
      <div
        key={node.id}
        data-node-id={node.id}
        data-answer={state.answer || undefined}
        style={{
          position: "absolute",
          left: rect.x - (parent?.x ?? 0),
          top: rect.y - (parent?.y ?? 0),
          width: rect.width,
          height: rect.height,
          opacity:
            state.opacity * (framed && answerPhase && !state.answer ? 0.25 : 1),
          transform: `translate(${state.x}px, ${state.y}px) rotate(${state.rotate}deg) scale(${state.scale * (state.answer ? 1.05 : 1)})`,
          transformOrigin: "center",
          zIndex: node.layer,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxSizing: "border-box",
            overflow: node.type === "container" ? "visible" : "hidden",
            borderRadius: style.borderRadius ?? (framed ? 18 : 0),
            background:
              style.background ??
              (card ? "#19243a" : group ? "rgba(255,255,255,0.06)" : undefined),
            border: `${state.answer ? Math.max(5, style.borderWidth ?? 0) : (style.borderWidth ?? (framed ? 2 : 0))}px solid ${state.answer ? GOLD : (style.borderColor ?? "#596b8c")}`,
            boxShadow: state.answer ? `0 0 30px ${GOLD}80` : undefined,
          }}
        >
          {node.type === "shape" ? <Shape node={node} /> : null}
          {node.media ? (
            <Media
              node={node}
              frame={frame}
              mode={assetMode}
              heldFrame={heldFrames?.[node.id]}
            />
          ) : null}
          {card && !node.media ? (
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                color: "#9cadcb",
                fontSize: Math.min(rect.width, rect.height) * 0.3,
              }}
            >
              {node.showRank && node.rank !== undefined ? `#${node.rank}` : "◇"}
            </AbsoluteFill>
          ) : null}
          {node.type === "text" || node.type === "timer" ? (
            <AbsoluteFill
              style={{
                ...textStyle,
                fontSize: textSize,
                alignItems: "center",
                justifyContent: "center",
                padding: textPadding,
                boxSizing: "border-box",
              }}
            >
              {node.type === "timer" ? state.countdown : node.text}
            </AbsoluteFill>
          ) : null}
          {group ? (
            <div
              style={{
                ...textStyle,
                position: "absolute",
                top: 12,
                left: 12,
                right: 12,
                fontSize: fitTextSize(
                  node.text ?? "",
                  rect.width - 24,
                  rect.height * 0.14 - 12,
                  Math.min(fontSize, rect.height * 0.1),
                ),
              }}
            >
              {node.text}
            </div>
          ) : null}
          {card && state.labelVisible && label ? (
            <div
              style={{
                ...textStyle,
                fontSize: labelSize,
                position: "absolute",
                bottom: 10,
                left: 10,
                right: 10,
                padding: "8px 12px",
                borderRadius: 10,
                background: "rgba(7,12,22,0.88)",
                border: `1px solid ${state.answer ? GOLD : "#7c9cff"}`,
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
        {(children.get(node.id) ?? []).map((child) => renderNode(child, rect))}
      </div>
    );
  };
  const transition = transitionAt(
    scene.transition,
    frame,
    scene.durationInFrames,
    width,
  );
  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        background: scene.background,
        fontFamily: FONT,
        overflow: "hidden",
        opacity: transition.opacity,
        transform: `translateX(${transition.x}px)`,
      }}
    >
      {(children.get(undefined) ?? []).map((node) => renderNode(node))}
    </div>
  );
};

const Scene: React.FC<{
  scene: CompiledScene;
  plan: CompiledVideo;
  mode: AssetMode;
}> = ({ scene, plan, mode }) => (
  <StudioSceneFrame
    scene={scene}
    frame={useCurrentFrame()}
    fps={plan.fps}
    width={plan.width}
    height={plan.height}
    assetMode={mode}
    heldFrames={answerCardFrames(scene, plan.scenes)}
  />
);

const AudioCue: React.FC<{ cue: CompiledAudio; mode: AssetMode }> = ({
  cue,
  mode,
}) => {
  const frame = useCurrentFrame();
  const audio = (
    <Audio
      src={resolveAsset(cue.asset.src, mode)}
      startFrom={cue.offsetFrames}
      endAt={cue.offsetFrames + (cue.loopFrames ?? cue.durationInFrames)}
      volume={() => audioVolumeAt(cue, cue.from + frame)}
    />
  );
  // The envelope closes over cue-local time outside Loop: it never resets with
  // a short source segment, and source offsets never shift duck/mute windows.
  return cue.loopFrames === null ? (
    audio
  ) : (
    <Loop durationInFrames={Math.max(1, cue.loopFrames)}>{audio}</Loop>
  );
};

export const StudioVideo: React.FC<StudioVideoProps> = ({
  plan,
  assetMode = "url",
}) => (
  <AbsoluteFill style={{ background: "#080c14" }}>
    {plan.scenes
      .filter((scene) => scene.durationInFrames > 0)
      .map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <Scene scene={scene} plan={plan} mode={assetMode} />
        </Sequence>
      ))}
    {plan.audio
      .filter((cue) => cue.durationInFrames > 0)
      .map((cue) => (
        <Sequence
          key={cue.id}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          layout="none"
        >
          <AudioCue cue={cue} mode={assetMode} />
        </Sequence>
      ))}
  </AbsoluteFill>
);

export const DEFAULT_STUDIO_PROPS: StudioVideoProps = {
  plan: {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    seed: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
    scenes: [],
    audio: [],
  },
  assetMode: "url",
};
