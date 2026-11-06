import React from "react";
import type { CompiledNode } from "../video/types";
import type {
  CompiledTextLine,
  CompiledTextRun,
} from "../video/typography-types";
import { getFontFace } from "../video/font-manifest";
import { gradientToCss } from "./studio-paint";
import {
  counterText,
  measuredTextMotion,
  textFragments,
  typographyMotions,
} from "./MotionText";
import { motionProgress } from "./motion-frame";
import { useTypographyFonts } from "./typography-fonts";

/** Each run stays in its measured box. Neither effects nor reveal poses change wrapping. */
export const TypographyText: React.FC<{
  node: CompiledNode;
  frame: number;
  fps: number;
  /** Timer/counter values reuse the compiler's worst-case line box. */
  text?: string;
}> = ({ node, frame, text }) => {
  const assets = useTypographyFonts();
  const layout = node.textLayout,
    style = node.typography;
  if (!layout || !style) return null;
  const clips = typographyMotions(node.motion, frame);
  const counter = clips.find((clip) => clip.name === "text-counter");
  const dynamicText =
    text ??
    (counter
      ? counterText(node.text ?? "", motionProgress(counter, frame))
      : node.motion?.some((clip) => clip.name === "text-counter")
        ? (node.text ?? "")
        : undefined);
  const fragmentClip = clips.find((clip) =>
    ["text-letters", "text-words"].includes(clip.name),
  );
  const fragmentName = fragmentClip?.name;
  const count = Math.max(
    1,
    layout.lines.reduce(
      (total, line) =>
        total +
        line.runs.reduce(
          (n, run) =>
            n +
            (fragmentName ? textFragments(run.text, fragmentName).length : 1),
          0,
        ),
      0,
    ),
  );
  const fontStyle = (run: CompiledTextRun): React.CSSProperties => ({
    fontFamily: [
      ...new Set(
        [
          `${style.font}-${run.weight ?? style.weight}-${(run.italic ?? style.italic) ? "italic" : "normal"}`,
          ...run.fonts,
        ]
          .map(
            (id) =>
              (assets.find((font) => font.id === id) ?? getFontFace(id))
                ?.family,
          )
          .filter((family): family is string => !!family),
      ),
    ]
      .map((family) => JSON.stringify(family))
      .join(", "),
    fontWeight: run.weight ?? style.weight,
    fontStyle: (run.italic ?? style.italic) ? "italic" : "normal",
    textDecoration: run.decoration ?? style.decoration,
  });
  const common: React.CSSProperties = {
    position: "absolute",
    fontSize: layout.fontSize,
    lineHeight: `${layout.lineHeight}px`,
    fontSynthesis: "none",
    letterSpacing: style.letterSpacing,
    whiteSpace: "pre",
    overflowWrap: "normal",
    wordBreak: "normal",
    boxSizing: "border-box",
    margin: 0,
    padding: 0,
  };
  const shadow =
    style.shadows
      .slice(0, 2)
      .map((s) => `${s.x ?? 0}px ${s.y ?? 0}px ${s.blur ?? 0}px ${s.color}`)
      .join(", ") || undefined;
  const gradient = gradientToCss(style.gradient);
  function lineContent(
    line: CompiledTextLine,
    lineIndex: number,
    outline: boolean,
    offset: number,
  ) {
    let index = offset;
    const runs =
      dynamicText !== undefined && lineIndex === 0
        ? [{ ...line.runs[0], text: dynamicText, x: 0, width: line.width }]
        : dynamicText !== undefined
          ? []
          : line.runs;
    return runs.map((run, runIndex) => {
      const parts = fragmentName
        ? textFragments(run.text, fragmentName)
        : [run.text];
      const children = parts.map((part, partIndex) => {
        const motion = measuredTextMotion(
          clips.filter(
            (clip) =>
              clip.name === "text-letters" || clip.name === "text-words",
          ),
          frame,
          index++,
          count,
          lineIndex,
          layout!.lines.length,
        );
        // Neutral poses retain native shaping, including AV pairs and Japanese ligatures.
        return motion.neutral ? (
          <React.Fragment key={partIndex}>{part}</React.Fragment>
        ) : (
          <span
            key={partIndex}
            data-typography-fragment={partIndex}
            style={{ display: "inline-block", ...motion.style }}
          >
            {part}
          </span>
        );
      });
      const ownGradient = !outline && gradient && !run.color;
      return (
        <span
          key={runIndex}
          data-typography-run={runIndex}
          style={{
            ...common,
            ...fontStyle(run),
            left: run.x,
            top: 0,
            width: run.width,
            height: layout!.lineHeight,
            textAlign: dynamicText !== undefined ? style!.align : "left",
            color: outline ? "transparent" : (run.color ?? style!.fill),
            WebkitTextFillColor:
              outline || ownGradient
                ? "transparent"
                : (run.color ?? style!.fill),
            backgroundImage: ownGradient ? gradient : undefined,
            backgroundClip: ownGradient ? "text" : undefined,
            WebkitBackgroundClip: ownGradient ? "text" : undefined,
            textShadow: outline ? undefined : shadow,
          }}
        >
          {children}
        </span>
      );
    });
  }
  function layer(
    outline?: { color: string; width: number },
    layerIndex?: number,
  ) {
    let offset = 0;
    return (
      <div
        key={layerIndex ?? "fill"}
        data-typography-outline={outline ? layerIndex : undefined}
        aria-hidden={outline ? true : undefined}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          WebkitTextStroke: outline
            ? `${outline.width * 2}px ${outline.color}`
            : undefined,
        }}
      >
        {layout!.lines.map((line, lineIndex) => {
          const start = offset;
          offset += line.runs.reduce(
            (n, run) =>
              n +
              (fragmentName ? textFragments(run.text, fragmentName).length : 1),
            0,
          );
          const motion = measuredTextMotion(
            clips.filter(
              (clip) =>
                clip.name !== "text-letters" && clip.name !== "text-words",
            ),
            frame,
            lineIndex,
            layout!.lines.length,
            lineIndex,
            layout!.lines.length,
          );
          return (
            <div
              key={lineIndex}
              data-typography-line={outline ? undefined : lineIndex}
              style={{
                position: "absolute",
                left: line.x,
                top: line.y,
                width: line.width,
                height: layout!.lineHeight,
                whiteSpace: "pre",
                ...motion.style,
              }}
            >
              {lineContent(line, lineIndex, !!outline, start)}
            </div>
          );
        })}
      </div>
    );
  }
  const bounds = textBounds(layout.lines, layout.lineHeight);
  const plate = style.plate,
    padding = plate?.padding ?? 0;
  return (
    <div
      data-typography="true"
      style={{
        position: "absolute",
        inset: 0,
        fontSynthesis: "none",
        overflow:
          style.overflow === "clip" && layout.overflow ? "hidden" : "visible",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: layout.rect.x,
          top: layout.rect.y,
          width: layout.rect.width,
          height: layout.rect.height,
        }}
      >
        {plate && bounds ? (
          <div
            data-typography-plate="true"
            style={{
              position: "absolute",
              left: bounds.x - padding,
              top: bounds.y - padding,
              width: bounds.width + padding * 2,
              height: bounds.height + padding * 2,
              background: plate.color,
              borderRadius: plate.borderRadius ?? 0,
            }}
          />
        ) : null}
        {[...style.outlines]
          .slice(0, 2)
          .sort((a, b) => b.width - a.width)
          .map((outline, index) => layer(outline, index))}
        {layer()}
      </div>
    </div>
  );
};

function textBounds(lines: CompiledTextLine[], lineHeight: number) {
  if (!lines.length) return undefined;
  const x = Math.min(...lines.map((line) => line.x)),
    y = Math.min(...lines.map((line) => line.y));
  return {
    x,
    y,
    width: Math.max(...lines.map((line) => line.x + line.width)) - x,
    height: Math.max(...lines.map((line) => line.y + lineHeight)) - y,
  };
}
