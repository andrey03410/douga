import React from "react";
import type { CompiledNode } from "../video/types";
import { progressAt, timerState } from "./motion-frame";
import { colorWithAlpha } from "./studio-paint";

export const MotionTimer: React.FC<{
  node: CompiledNode;
  frame: number;
  fps: number;
  renderValue?: (value: number) => React.ReactNode;
}> = ({ node, frame, fps, renderValue }) => {
  const t = node.timer;
  const { value, remaining } = timerState(
    frame - node.from,
    node.timerFrames ?? node.durationInFrames,
    fps,
  );
  if (!t || t.variant === "digits")
    return <>{renderValue ? renderValue(value) : value}</>;
  const size = Math.min(node.rect.width, node.rect.height),
    stroke = Math.min(size / 3, t.strokeWidth);
  const radius = (size - stroke) / 2,
    circumference = 2 * Math.PI * radius;
  const warning = value <= t.warningSec;
  const color = warning ? "#ff625d" : t.color;
  const label = t.showValue ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
      }}
    >
      {renderValue ? renderValue(value) : value}
    </div>
  ) : null;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {t.variant === "bar" ? (
        <div
          style={{
            width: "100%",
            height: stroke,
            background: t.trackColor,
            borderRadius: stroke,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${remaining * 100}%`,
              height: "100%",
              background: color,
            }}
          />
        </div>
      ) : (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size} ${size}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ overflow: "visible" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={t.trackColor}
            strokeWidth={stroke}
          />
          {t.variant === "segments" ? (
            Array.from({ length: 12 }, (_, i) => {
              const gap = 0.08,
                start = (i / 12) * Math.PI * 2 - Math.PI / 2 + gap / 2,
                end = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2 - gap / 2;
              return (
                <path
                  key={i}
                  d={`M ${size / 2 + radius * Math.cos(start)} ${size / 2 + radius * Math.sin(start)} A ${radius} ${radius} 0 0 1 ${size / 2 + radius * Math.cos(end)} ${size / 2 + radius * Math.sin(end)}`}
                  fill="none"
                  stroke={remaining * 12 > i ? color : t.trackColor}
                  strokeWidth={stroke}
                />
              );
            })
          ) : (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - remaining)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </svg>
      )}
      {label}
    </div>
  );
};
export const MotionVersus: React.FC<{
  node: CompiledNode;
  children?: React.ReactNode;
}> = ({ node, children }) => {
  const variant = node.versus?.variant ?? "clean",
    color = node.versus?.color ?? "#ffd166";
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        color,
        fontWeight: 900,
        fontStyle: variant === "clean" ? "normal" : "italic",
        transform: variant === "impact" ? "rotate(-8deg)" : undefined,
        textShadow:
          variant === "neon"
            ? `0 0 10px ${color},0 0 30px ${color}`
            : variant === "impact"
              ? "5px 5px 0 #000"
              : undefined,
      }}
    >
      {variant === "slash" ? (
        <div
          style={{
            position: "absolute",
            width: 6,
            height: "95%",
            background: color,
            transform: "rotate(25deg)",
            opacity: 0.5,
          }}
        />
      ) : null}
      {variant === "impact" ? (
        <div
          style={{
            position: "absolute",
            inset: "8%",
            background: color,
            opacity: 0.2,
            clipPath:
              "polygon(50% 0,60% 28%,95% 10%,78% 42%,100% 60%,67% 65%,70% 100%,46% 78%,15% 100%,23% 65%,0 45%,33% 35%)",
          }}
        />
      ) : null}
      {children ?? <span style={{ position: "relative" }}>VS</span>}
    </div>
  );
};
export const MotionBadge: React.FC<{
  node: CompiledNode;
  children: React.ReactNode;
}> = ({ node, children }) => {
  const kind = node.badge?.kind ?? "label",
    color = node.badge?.color ?? "#ffd166";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `2px solid ${color}`,
        borderRadius: kind === "rank" ? 999 : kind === "label" ? 8 : 18,
        color,
        background:
          kind === "winner" ? colorWithAlpha(color, 40 / 255) : "#101726",
        fontWeight: 900,
      }}
    >
      {kind === "winner" ? <span aria-hidden>★</span> : null}
      {children}
    </div>
  );
};
export const MotionProgress: React.FC<{
  node: CompiledNode;
  frame: number;
}> = ({ node, frame }) => {
  const p = node.progress;
  if (!p) return null;
  return (
    <div
      style={{
        width: "100%",
        height: p.strokeWidth,
        maxHeight: "100%",
        background: p.trackColor,
        overflow: "hidden",
        borderRadius: p.strokeWidth,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progressAt(frame, p) * 100}%`,
          background: p.color,
        }}
      />
    </div>
  );
};
