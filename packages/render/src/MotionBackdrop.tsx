import React from "react";
import type { CompiledBackdrop } from "@douga/video/motion-types";
import type { CompiledMedia } from "@douga/video/types";
import { clamp01 } from "./motion-frame";
import { colorWithAlpha } from "./studio-paint";

/** No future layer is returned, including during crossfades. Fade to neutral at gaps. */
export function backdropLayersAt(backdrop: CompiledBackdrop, frame: number) {
  return backdrop.layers.flatMap((layer, index) => {
    if (frame < layer.from || frame >= layer.to) return [];
    const next = backdrop.layers[index + 1];
    const fadeOut =
      !next || next.from >= layer.to
        ? Math.min(layer.fadeInFrames, layer.to - layer.from)
        : 0;
    const opacity =
      (layer.fadeInFrames
        ? clamp01((frame - layer.from) / layer.fadeInFrames)
        : 1) * (fadeOut ? clamp01((layer.to - frame) / fadeOut) : 1);
    return [{ ...layer, opacity, index }];
  });
}
const noise = (seed: number, index: number) => {
  const x = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const MotionBackdrop: React.FC<{
  backdrop: CompiledBackdrop;
  frame: number;
  fps: number;
  seed: number;
  renderMedia: (
    media: CompiledMedia,
    from: number,
    to: number,
  ) => React.ReactNode;
}> = ({ backdrop: b, frame, fps, seed, renderMedia }) => {
  const time = b.motion ? frame / fps : 0,
    a = b.intensity,
    colors = b.colors.length ? b.colors : ["#111b35", "#45305f", "#164e63"];
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
  };
  return (
    <div style={base} data-backdrop={b.preset}>
      {b.preset === "art-blur"
        ? backdropLayersAt(b, frame).map((layer) => (
            <div
              key={layer.index}
              style={{
                ...base,
                opacity: layer.opacity,
                filter: `blur(${b.blur}px)`,
                transform: `scale(${1.08 + 0.02 * a * Math.sin(time * 0.4)})`,
              }}
            >
              {renderMedia(layer.media, layer.from, layer.to)}
            </div>
          ))
        : null}
      {b.preset === "gradient-flow" ? (
        <div
          style={{
            ...base,
            inset: "-50%",
            background: `linear-gradient(${120 + Math.sin(time * 0.3) * 30 * a}deg,${colors.join(",")})`,
            transform: `translate(${Math.sin(time * 0.2) * 8}%,${Math.cos(time * 0.2) * 8}%) rotate(${Math.sin(time * 0.1) * 12}deg)`,
          }}
        />
      ) : null}
      {b.preset === "light-orbs"
        ? Array.from({ length: Math.min(32, b.particles) }, (_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${noise(seed, i) * 100 + Math.sin(time * 0.3 + i) * 12 * a}%`,
                top: `${noise(seed, i + 20) * 100 + Math.cos(time * 0.25 + i) * 12 * a}%`,
                width: "45%",
                aspectRatio: "1",
                borderRadius: "50%",
                background: `radial-gradient(circle,${colors[i % colors.length]},transparent 68%)`,
                filter: `blur(${Math.max(10, b.blur)}px)`,
                opacity: 0.7,
                transform: "translate(-50%,-50%)",
              }}
            />
          ))
        : null}
      {b.preset === "particles"
        ? Array.from({ length: Math.min(32, b.particles) }, (_, i) => {
            const x =
              ((noise(seed, i) * 100 +
                time * (2 + noise(seed, i + 40) * 5) * a) %
                110) -
              5;
            const y =
              (noise(seed, i + 20) * 100 -
                time * (3 + noise(seed, i + 60) * 4) * a) %
              110;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: `${(y + 110) % 110}%`,
                  width: 3 + noise(seed, i + 80) * 8,
                  height: 3 + noise(seed, i + 80) * 8,
                  borderRadius: "50%",
                  background: colors[i % colors.length],
                  boxShadow: `0 0 12px ${colors[i % colors.length]}`,
                  opacity: 0.3 + 0.6 * noise(seed, i + 100),
                }}
              />
            );
          })
        : null}
      {b.preset === "vignette" ? (
        <div
          style={{
            ...base,
            background: `radial-gradient(ellipse at ${50 + Math.sin(time * 0.3) * 8 * a}% ${50 + Math.cos(time * 0.2) * 8 * a}%,transparent 20%,${colorWithAlpha(colors[0], 0.8)} 80%,#000 100%)`,
          }}
        />
      ) : null}
      <div style={{ ...base, background: "#000", opacity: b.dim }} />
    </div>
  );
};
