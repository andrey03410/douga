import React from "react";
import type { CompiledMotion } from "../video/motion-types";
import { clamp01, motionProgress, wipeMask } from "./motion-frame";

export function textFragments(text: string, name: string): string[] {
  const parts =
    name === "text-letters"
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            text,
          ),
          (s) => s.segment,
        )
      : name === "text-lines"
        ? text.split(/(?<=\n)/u)
        : (text.match(/\s*\S+(?:\s+|$)/gu) ?? [text]);
  // Compiler budgets the whole scene; keep malformed external IR bounded too.
  return parts.length > 500
    ? [...parts.slice(0, 499), parts.slice(499).join("")]
    : parts;
}
export function counterText(text: string, progress: number): string {
  if (progress >= 1) return text;
  const value = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(value)) return text;
  const decimals = text.match(/[.,](\d+)/)?.[1].length ?? 0;
  const formatted = (value * clamp01(progress)).toFixed(Math.min(12, decimals));
  return `${text.match(/^\s*/)?.[0] ?? ""}${text.includes(",") ? formatted.replace(".", ",") : formatted}${text.match(/\s*$/)?.[0] ?? ""}`;
}

export const MotionText: React.FC<{
  text: string;
  motions?: CompiledMotion[];
  frame: number;
  fps: number;
}> = ({ text, motions = [], frame }) => {
  const clips = motions.filter(
    (m) =>
      m.name.startsWith("text-") &&
      frame >= m.window.from &&
      frame < m.window.to,
  );
  if (!clips.length) return <>{text}</>;
  const fragmentClips = clips.filter((m) =>
    ["text-words", "text-lines", "text-letters"].includes(m.name),
  );
  const fragmentsClip =
    fragmentClips.find(
      (m) =>
        frame < m.from + m.durationInFrames &&
        (m.channel === "enter" || frame >= m.from),
    ) ?? fragmentClips[fragmentClips.length - 1];
  const counter = clips.find((m) => m.name === "text-counter");
  const contentText = counter
    ? counterText(text, motionProgress(counter, frame))
    : text;
  const flowWhitespace =
    fragmentsClip?.name === "text-words" ||
    fragmentsClip?.name === "text-letters";
  if (flowWhitespace) {
    const amounts = clips.map((m) => motionProgress(m, frame));
    // Restore the font's native shaping/kerning when all visual clips are neutral.
    if (amounts.every((p) => p === 1)) return <>{contentText}</>;
    if (amounts.every((p) => p === 0))
      return <span style={{ opacity: 0 }}>{contentText}</span>;
  }
  const fragments = fragmentsClip
    ? textFragments(contentText, fragmentsClip.name)
    : [contentText];
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {fragments.map((part, index) => {
        // Whitespace belongs to the shared inline flow. A newline inside an
        // atomic inline-block only breaks that box, leaving its siblings beside it.
        const whitespace = flowWhitespace
          ? part.match(/^(\s*)([\s\S]*?\S)?(\s*)$/u)
          : null;
        if (whitespace && !whitespace[2])
          return <React.Fragment key={index}>{part}</React.Fragment>;
        let opacity = 1,
          scale = 1,
          y = 0,
          rotate = 0;
        const masks: string[] = [];
        for (const m of clips) {
          const p = motionProgress(m, frame);
          if (["text-words", "text-lines", "text-letters"].includes(m.name)) {
            const local = clamp01(
              p * 1.6 - (index / Math.max(1, fragments.length - 1)) * 0.6,
            );
            opacity *= local;
            if (m.name === "text-words") y += 18 * (1 - local) * m.intensity;
            if (m.name === "text-lines") masks.push(wipeMask(local, "up"));
            if (m.name === "text-letters")
              rotate += 12 * (1 - local) * m.intensity;
          } else if (m.name === "text-wipe")
            masks.push(wipeMask(p, m.direction));
          else if (m.name === "text-slam") {
            opacity *= p;
            scale *= 1 + 0.8 * (1 - p) * m.intensity;
            y -= 20 * (1 - p);
          }
        }
        let content: React.ReactNode = (
          <span
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${y}px) rotate(${rotate}deg) scale(${scale})`,
              whiteSpace: "pre-wrap",
            }}
          >
            {whitespace?.[2] ?? part}
          </span>
        );
        for (const mask of masks)
          content = (
            <span
              style={{
                display: "inline-block",
                clipPath: mask,
                whiteSpace: "pre-wrap",
              }}
            >
              {content}
            </span>
          );
        return fragmentsClip?.name === "text-lines" ? (
          <span key={index} style={{ display: "block" }}>
            {content}
          </span>
        ) : (
          <React.Fragment key={index}>
            {whitespace?.[1]}
            {content}
            {whitespace?.[3]}
          </React.Fragment>
        );
      })}
    </span>
  );
};
