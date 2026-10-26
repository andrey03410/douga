import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CompiledAudio,
  CompiledNode,
  CompiledScene,
} from "../video/types";
import {
  audioVolumeAt,
  evaluateNode,
  mediaFrameAt,
  mediaLayout,
  transitionAt,
  answerCardFrames,
  fitTextSize,
} from "./studio-frame";
import { StudioSceneFrame } from "./StudioVideo";

const node = (overrides: Partial<CompiledNode> = {}): CompiledNode => ({
  id: "card",
  type: "card",
  rect: { x: 100, y: 80, width: 300, height: 200 },
  layer: 0,
  from: 10,
  durationInFrames: 90,
  visible: [{ from: 10, to: 100 }],
  style: {},
  opacity: 1,
  rotate: 0,
  scale: 1,
  animation: [],
  ...overrides,
});
const cue = (overrides: Partial<CompiledAudio> = {}): CompiledAudio => ({
  id: "music",
  role: "music",
  asset: { id: "music", src: "music.wav", kind: "audio", durationSec: 5 },
  from: 30,
  durationInFrames: 60,
  offsetFrames: 15,
  loopFrames: 15,
  volume: 0.8,
  fadeInFrames: 10,
  fadeOutFrames: 10,
  duckVolume: 0.25,
  duckWindows: [{ from: 50, to: 65 }],
  muteWindows: [{ from: 60, to: 62 }],
  ...overrides,
});
const scene = (nodes: CompiledNode[]): CompiledScene => ({
  id: "scene",
  kind: "custom",
  from: 120,
  durationInFrames: 100,
  background: "#102030",
  nodes,
  phases: {},
  transition: { type: "none", durationInFrames: 0 },
});
const html = (s: CompiledScene, frame: number) =>
  renderToStaticMarkup(
    React.createElement(StudioSceneFrame, {
      scene: s,
      frame,
      fps: 30,
      width: 640,
      height: 360,
      assetMode: "url",
    }),
  );

describe("Studio frame evaluation", () => {
  // Catches scene/node time confusion and additive opacity/scale animation.
  it("interpolates node-local keyframes and composes repeated tracks", () => {
    const n = node({
      opacity: 0.8,
      rotate: 10,
      scale: 2,
      animation: [
        {
          property: "opacity",
          easing: "linear",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 20, value: 1 },
          ],
        },
        {
          property: "opacity",
          easing: "linear",
          keyframes: [{ frame: 0, value: 0.5 }],
        },
        {
          property: "x",
          easing: "linear",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 20, value: 100 },
          ],
        },
        {
          property: "rotate",
          easing: "linear",
          keyframes: [{ frame: 0, value: 30 }],
        },
        {
          property: "scale",
          easing: "linear",
          keyframes: [{ frame: 0, value: 1.5 }],
        },
      ],
    });
    expect(evaluateNode(n, 20, 30)).toMatchObject({
      opacity: 0.2,
      x: 50,
      y: 0,
      rotate: 40,
      scale: 3,
    });
    expect(evaluateNode(n, 90, 30).opacity).toBeCloseTo(0.4);
  });
  it.each(["linear", "easeIn", "easeOut", "easeInOut", "spring"] as const)(
    "clamps %s keyframe endpoints",
    (easing) => {
      const n = node({
        animation: [
          {
            property: "x",
            easing,
            keyframes: [
              { frame: 5, value: 20 },
              { frame: 25, value: 120 },
            ],
          },
        ],
      });
      expect(evaluateNode(n, 10, 30).x).toBe(20);
      expect(evaluateNode(n, 50, 30).x).toBe(120);
      expect(evaluateNode(n, 25, 30).x).toBeGreaterThan(20);
    },
  );
  it("gates labels, winners and visibility with half-open scene windows", () => {
    const n = node({
      label: "Ответ",
      answer: true,
      answerFrom: 60,
      labelWindows: [{ from: 60, to: 80 }],
      visible: [
        { from: 10, to: 30 },
        { from: 50, to: 100 },
      ],
    });
    expect(evaluateNode(n, 30, 30).visible).toBe(false);
    expect(evaluateNode(n, 59, 30)).toMatchObject({
      labelVisible: false,
      answer: false,
    });
    expect(evaluateNode(n, 60, 30)).toMatchObject({
      labelVisible: true,
      answer: true,
    });
    expect(evaluateNode(n, 80, 30).labelVisible).toBe(false);
    expect(evaluateNode(n, 100, 30).visible).toBe(false);
  });
  it("counts down from the timer start at the actual composition fps", () => {
    expect(
      evaluateNode(node({ type: "timer", from: 30, timerFrames: 60 }), 30, 24)
        .countdown,
    ).toBe(3);
    expect(
      evaluateNode(node({ type: "timer", from: 30, timerFrames: 60 }), 66, 24)
        .countdown,
    ).toBe(1);
  });
  it("maps video offsets, available-segment loops, active holds and source tails", () => {
    const n = node({
      media: {
        asset: { id: "v", src: "v.mp4", kind: "video" },
        offsetFrames: 20,
        loopFrames: 15,
        fit: "cover",
        freezeAtFrame: 34,
      },
      activeWindow: { from: 30, to: 70 },
    });
    expect(mediaFrameAt(n, 30)).toBe(20);
    expect(mediaFrameAt(n, 45)).toBe(20);
    expect(mediaFrameAt(n, 69)).toBe(29);
    expect(mediaFrameAt(n, 90)).toBe(29);
    expect(mediaFrameAt(n, 20)).toBe(29); // final active frame before reveal / in answer scene
    expect(mediaFrameAt({ ...n, activeWindow: undefined }, 29)).toBe(24);
    expect(
      mediaFrameAt(
        {
          ...n,
          activeWindow: undefined,
          media: { ...n.media!, loopFrames: null },
        },
        90,
      ),
    ).toBe(34);
  });
  it("retains the preceding active frame in a separate answer scene, including segment loops", () => {
    const moving = node({
      cardId: "c",
      media: {
        asset: { id: "v", src: "v.mp4", kind: "video" },
        offsetFrames: 20,
        loopFrames: 15,
        fit: "cover",
        freezeAtFrame: 34,
      },
      activeWindow: { from: 30, to: 70 },
    });
    const main = { ...scene([moving]), kind: "picker" as const, roundId: "r" };
    const answer = {
      ...scene([{ ...moving, id: "answer-card", activeWindow: undefined }]),
      kind: "answer" as const,
      roundId: "r",
      from: 220,
    };
    expect(answerCardFrames(answer, [main, answer])).toEqual({
      "answer-card": 29,
    });
  });
  it("rejects incomplete crop metadata explicitly when a caller bypasses compilation", () => {
    const media = {
      asset: { id: "incomplete", src: "image.png", kind: "image" as const },
      offsetFrames: 0,
      loopFrames: null,
      fit: "contain" as const,
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    };
    expect(() =>
      mediaLayout(media, { x: 0, y: 0, width: 300, height: 200 }),
    ).toThrow(/MEDIA_DIMENSIONS_REQUIRED.*incomplete/);
    expect(
      mediaLayout(
        { ...media, fit: "fill" },
        { x: 0, y: 0, width: 300, height: 200 },
      ).source,
    ).toMatchObject({ width: "200%", height: "100%", left: "-50%" });
    expect(
      mediaLayout(
        { ...media, crop: undefined },
        { x: 0, y: 0, width: 300, height: 200 },
      ).source,
    ).toMatchObject({ width: "100%", height: "100%", objectFit: "contain" });
  });
  it("fits the selected source crop without stretching contain media", () => {
    const media = {
      asset: {
        id: "i",
        src: "i.png",
        kind: "image" as const,
        width: 200,
        height: 100,
      },
      offsetFrames: 0,
      loopFrames: null,
      fit: "contain" as const,
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    };
    expect(
      mediaLayout(media, { x: 0, y: 0, width: 300, height: 200 }),
    ).toMatchObject({
      viewport: { left: 50, top: 0, width: 200, height: 200 },
      source: { width: 400, height: 200, left: -100, top: 0 },
    });
  });
  it("shrinks long Cyrillic captions into their available plate instead of clipping the beginning", () => {
    const caption =
      "#1 Очень длинная кириллическая подпись, которая должна переноситься на несколько строк";
    expect(fitTextSize(caption, 380, 100, 40)).toBeLessThanOrEqual(24);
    expect(fitTextSize("Коротко", 380, 100, 40)).toBe(40);
  });
  it("evaluates transitions inside the scene without changing its interval", () => {
    expect(
      transitionAt({ type: "fade", durationInFrames: 10 }, 5, 100, 640),
    ).toEqual({ opacity: 0.5, x: 0 });
    expect(
      transitionAt({ type: "slide", durationInFrames: 10 }, 5, 100, 640),
    ).toEqual({ opacity: 1, x: 320 });
    expect(
      transitionAt({ type: "fade", durationInFrames: 10 }, 99, 100, 640)
        .opacity,
    ).toBeCloseTo(0.1);
  });
});

describe("Studio audio envelope", () => {
  it("keeps fades cue-local and duck/mute windows composition-absolute across loops", () => {
    expect(audioVolumeAt(cue(), 29)).toBe(0);
    expect(audioVolumeAt(cue(), 35)).toBeCloseTo(0.4);
    expect(audioVolumeAt(cue(), 49)).toBeCloseTo(0.8);
    expect(audioVolumeAt(cue(), 50)).toBeCloseTo(0.2);
    expect(audioVolumeAt(cue(), 60)).toBe(0);
    expect(audioVolumeAt(cue(), 62)).toBeCloseTo(0.2);
    expect(audioVolumeAt(cue(), 65)).toBeCloseTo(0.8);
    expect(audioVolumeAt(cue(), 85)).toBeCloseTo(0.4);
    expect(audioVolumeAt(cue(), 90)).toBe(0);
  });
  it.each(["primary", "voice", "sfx"] as const)(
    "applies fades and mute, but not music ducking, to %s",
    (role) => {
      expect(audioVolumeAt(cue({ role }), 50)).toBeCloseTo(0.8);
      expect(audioVolumeAt(cue({ role }), 60)).toBe(0);
    },
  );
});

describe("Studio primitive renderer boundary", () => {
  it("inherits container visibility and transforms without adding the absolute parent position twice", () => {
    const parent = node({
      id: "parent",
      type: "container",
      rect: { x: 80, y: 60, width: 400, height: 300 },
      opacity: 0.5,
      rotate: 20,
      scale: 1.5,
      visible: [{ from: 10, to: 40 }],
    });
    const child = node({
      id: "child",
      type: "text",
      parentId: "parent",
      text: "Длинная подпись",
      rect: { x: 100, y: 80, width: 300, height: 200 },
    });
    const markup = html(scene([child, parent]), 20);
    expect(markup).toContain("left:80px;top:60px");
    expect(markup).toContain("left:20px;top:20px");
    expect(markup).toContain("opacity:0.5");
    expect(markup).toContain("rotate(20deg) scale(1.5)");
    expect(markup).toContain("Длинная подпись");
    expect(html(scene([child, parent]), 40)).not.toContain("Длинная подпись");
  });
  it("renders paths and ellipse geometry and respects paint layers", () => {
    const markup = html(
      scene([
        node({
          id: "front",
          type: "shape",
          shape: "path",
          path: "M 0 0 L 300 0 L 0 200 Z",
          fill: "#ff0000",
          layer: 3,
        }),
        node({
          id: "back",
          type: "shape",
          shape: "ellipse",
          fill: "#00ff00",
          layer: -1,
        }),
      ]),
      20,
    );
    expect(markup).toContain('d="M 0 0 L 300 0 L 0 200 Z"');
    expect(markup).toContain("<ellipse");
    expect(markup.indexOf('data-node-id="back"')).toBeLessThan(
      markup.indexOf('data-node-id="front"'),
    );
  });
  it("scales answer winners and dims other cards only after answer start", () => {
    const winner = node({ answer: true, answerFrom: 50 });
    const loser = node({ id: "loser", answer: false, answerFrom: 50 });
    expect(html(scene([winner, loser]), 40)).not.toContain("opacity:0.25");
    expect(html(scene([winner, loser]), 50)).toContain("opacity:0.25");
    expect(html(scene([winner, loser]), 50)).toContain("scale(1.05)");
  });
  it("reveals card labels, ranks and card/group answers only during their phases", () => {
    const cards = [
      node({
        label: "Победитель",
        rank: 2,
        showRank: true,
        answer: true,
        answerFrom: 50,
        labelWindows: [{ from: 50, to: 100 }],
      }),
      node({
        id: "group",
        type: "group",
        text: "Группа А",
        answer: true,
        answerFrom: 50,
      }),
    ];
    expect(html(scene(cards), 40)).not.toContain("Победитель");
    expect(html(scene(cards), 40)).not.toContain('data-answer="true"');
    expect(html(scene(cards), 50)).toContain("#2");
    expect(html(scene(cards), 50)).toContain("Победитель");
    expect(html(scene(cards), 50)).toContain('data-answer="true"');
    expect(html(scene(cards), 50)).toContain("Группа А");
  });
});
