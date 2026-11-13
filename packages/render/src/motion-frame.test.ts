import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  motionNames,
  transitionNames,
  type CompiledMotion,
} from "@douga/video/motion-types";
import {
  evaluateMotion,
  motionProgress,
  transitionLayers,
  timerState,
  progressAt,
} from "./motion-frame";
import { textFragments, counterText, MotionText } from "./MotionText";
import { MotionBadge, MotionTimer } from "./MotionWidgets";
import { MotionBackdrop, backdropLayersAt } from "./MotionBackdrop";
import { evaluateNode } from "./studio-frame";
import { videoNode } from "@douga/player/fixtures";
const rect = { x: 0, y: 0, width: 640, height: 200 };
const clip = (
  name: CompiledMotion["name"],
  patch: Partial<CompiledMotion> = {},
): CompiledMotion => ({
  name,
  channel: name.startsWith("text-")
    ? "enter"
    : motionNames.indexOf(name) >= 16 && motionNames.indexOf(name) <= 22
      ? "loop"
      : motionNames.indexOf(name) >= 23 && motionNames.indexOf(name) <= 33
        ? "emphasis"
        : "enter",
  from: 10,
  durationInFrames: 21,
  profile: "smooth",
  intensity: 1,
  direction: "left",
  window: { from: 0, to: 100 },
  ...patch,
});
describe("motion frame contract", () => {
  it.each(motionNames)(
    "evaluates %s deterministically with finite bounded states",
    (name) => {
      const motion = clip(name);
      const states = [0, 10, 15, 20, 30, 40, 99, 100].map((f) =>
        evaluateMotion([motion], f, 30, rect),
      );
      expect(evaluateMotion([motion], 20, 30, rect)).toEqual(states[3]);
      for (const state of states) {
        for (const v of Object.values(state))
          if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
        expect(state.opacity).toBeGreaterThanOrEqual(0);
        expect(state.opacity).toBeLessThanOrEqual(1);
        expect(state.scale).toBeGreaterThan(0);
        expect(state.scale).toBeLessThanOrEqual(4);
      }
      if (!name.startsWith("text-"))
        expect(
          new Set(states.slice(1, 5).map((s) => JSON.stringify(s))).size,
        ).toBeGreaterThan(1);
      expect(states[7]).toEqual(evaluateMotion([], 100, 30, rect));
    },
  );
  it("uses window-bounded enter/exit completion including one-frame clips", () => {
    for (const channel of ["enter", "exit"] as const) {
      const c = clip("fade", { channel, durationInFrames: 1 });
      expect(motionProgress(c, 10)).toBe(channel === "enter" ? 1 : 0);
      expect(evaluateMotion([c], 10, 30, rect).opacity).toBe(
        channel === "enter" ? 1 : 0,
      );
      expect(evaluateMotion([c], 100, 30, rect).opacity).toBe(1);
    }
    expect(evaluateMotion([clip("float")], 9, 30, rect).y).toBe(0);
  });
  it("composes manual tracks by adding position and multiplying scale and opacity", () => {
    const n = videoNode({
      from: 0,
      visible: [{ from: 0, to: 100 }],
      motion: [clip("slide-left")],
      animation: [
        {
          property: "x",
          easing: "linear",
          keyframes: [{ frame: 0, value: 17 }],
        },
      ],
    });
    expect(evaluateNode(n, 20, 30).x).toBeCloseTo(
      17 + evaluateMotion(n.motion!, 20, 30, n.rect).x,
    );
  });
  it.each([24, 25, 30, 50, 60])(
    "keeps timer/progress tied to frame at %i fps",
    (fps) => {
      expect(timerState(fps, 3 * fps, fps).value).toBe(2);
      expect(timerState(3 * fps, 3 * fps, fps).remaining).toBe(0);
      expect(progressAt(30, { from: -30, durationInFrames: 120 })).toBe(0.5);
    },
  );
  it("renders physical circles in a rectangular timer box", () => {
    const n = videoNode({
      type: "timer",
      rect,
      timerFrames: 90,
      timer: {
        variant: "ring",
        color: "#fff",
        trackColor: "#333",
        strokeWidth: 8,
        showValue: true,
        warningSec: 2,
      },
    });
    const html = renderToStaticMarkup(
      React.createElement(MotionTimer, { node: n, frame: 30, fps: 30 }),
    );
    expect(html).toContain('viewBox="0 0 200 200"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});
describe("adjacent scene transitions", () => {
  it.each(
    transitionNames.filter((n) => !["none", "fade", "slide"].includes(n)),
  )("%s starts covered and completes, supports all directions", (type) => {
    for (const direction of [
      "left",
      "right",
      "up",
      "down",
      "in",
      "out",
    ] as const) {
      const t = { type, durationInFrames: 21, direction };
      const start = transitionLayers(t, 0, 100, 640, 360),
        end = transitionLayers(t, 20, 100, 640, 360);
      expect(start.active).toBe(true);
      expect(start.outgoing).not.toEqual(end.outgoing);
      expect(end.incoming.opacity ?? 1).toBe(1);
      expect(end.progress).toBe(1);
      expect(transitionLayers(t, 21, 100, 640, 360).active).toBe(false);
      expect(
        transitionLayers({ ...t, durationInFrames: 1 }, 0, 1, 640, 360)
          .progress,
      ).toBe(1);
    }
  });
});
describe("text and background", () => {
  const text = "  Привет 👨‍👩‍👧‍👦!\n世界  42 ";
  it.each(["text-words", "text-lines", "text-letters"] as const)(
    "%s preserves exact Unicode and whitespace",
    (name) => {
      expect(textFragments(text, name).join("")).toBe(text);
      expect(textFragments(text, name).length).toBeLessThanOrEqual(500);
      const html = renderToStaticMarkup(
        React.createElement(MotionText, {
          text,
          motions: [clip(name)],
          frame: 30,
          fps: 30,
        }),
      );
      expect(html).not.toContain("NaN");
    },
  );
  it("ends counters with original formatting", () => {
    for (const text of ["003.50", "-12.5", "+42", "1e3"])
      expect(counterText(text, 1)).toBe(text);
    expect(counterText("100", 0.5)).toBe("50");
  });
  it("does not mount future backdrop media and fades an expiring layer to neutral", () => {
    const media = videoNode().media!;
    const b = {
      preset: "art-blur" as const,
      source: "current-card" as const,
      colors: [],
      blur: 20,
      dim: 0.4,
      motion: true,
      intensity: 1,
      particles: 8,
      layers: [
        { from: 0, to: 50, fadeInFrames: 10, media },
        { from: 70, to: 100, fadeInFrames: 10, media },
      ],
    };
    expect(backdropLayersAt(b, 60)).toEqual([]);
    expect(backdropLayersAt(b, 49)[0].opacity).toBeLessThan(
      backdropLayersAt(b, 40)[0].opacity,
    );
    expect(backdropLayersAt(b, 69)).toEqual([]);
    expect(backdropLayersAt(b, 70)[0].opacity).toBe(0);
  });
});
it("crossfade and zoom keep an opaque outgoing surface beneath incoming pixels", () => {
  for (const type of ["crossfade", "zoom"] as const) {
    const s = transitionLayers(
      { type, durationInFrames: 21 },
      10,
      100,
      640,
      360,
    );
    expect(s.outgoing.opacity).toBe(1);
  }
});
it.each([
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
])("evaluates every motion across all fps on %ix%i", (width, height) => {
  for (const fps of [24, 25, 30, 50, 60])
    for (const name of motionNames) {
      const state = evaluateMotion([clip(name)], 20, fps, {
        x: 0,
        y: 0,
        width,
        height,
      });
      expect(JSON.stringify(state)).not.toMatch(/NaN|Infinity/);
    }
});

it("uses effect-specific initial poses and neutral completed entrance poses", () => {
  const cases: [CompiledMotion["name"], string, number][] = [
    ["fade", "opacity", 0],
    ["pop", "scale", 0.65],
    ["slide-up", "y", 70],
    ["slide-down", "y", -70],
    ["slide-left", "x", 70],
    ["slide-right", "x", -70],
    ["zoom-in", "scale", 0.4],
    ["zoom-out", "scale", 1.7],
    ["flip-x", "rotateX", -90],
    ["flip-y", "rotateY", -90],
    ["tilt", "rotate", -18],
    ["blur-reveal", "blur", 24],
    ["elastic", "scaleX", 0.05],
    ["spin", "rotate", -240],
  ];
  for (const [name, property, value] of cases) {
    const m = clip(name),
      start = evaluateMotion([m], 10, 30, rect),
      end = evaluateMotion([m], 30, 30, rect);
    expect((start as unknown as Record<string, unknown>)[property]).toBeCloseTo(
      value,
    );
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(0);
    expect(end.scale).toBeCloseTo(1);
    expect(end.opacity).toBe(1);
    expect(end.rotate).toBeCloseTo(0);
    expect(end.blur).toBe(0);
  }
  expect(evaluateMotion([clip("wipe-reveal")], 10, 30, rect).masks).toEqual([
    "inset(0 100% 0 0)",
  ]);
  expect(evaluateMotion([clip("iris")], 10, 30, rect).masks).toEqual([
    "circle(0% at 50% 50%)",
  ]);
});
it("matches compiler word budgets while preserving whitespace and decimal commas", () => {
  expect(textFragments("  один   два\nтри  ", "text-words")).toHaveLength(3);
  expect(counterText(" 003,50 ", 0.5)).toBe(" 1,75 ");
});

it("keeps full central coverage throughout blur transitions", () => {
  for (const frame of [0, 1, 5, 10, 15, 19, 20]) {
    const layers = transitionLayers(
      { type: "blur", durationInFrames: 21 },
      frame,
      100,
      640,
      360,
    );
    const incoming = Number(layers.incoming.opacity ?? 1),
      outgoing = Number(layers.outgoing.opacity ?? 1);
    expect(incoming + outgoing * (1 - incoming)).toBe(1);
    expect(layers.incoming.filter).toContain("blur(");
    expect(layers.outgoing.filter).toContain("blur(");
  }
});
it.each([
  "#123",
  "#123456",
  "#1234",
  "#12345678",
  "red",
  "rgb(1, 2, 3)",
  "rgba(1, 2, 3, 0.5)",
])(
  "uses valid alpha composition for vignette and winner badge with %s",
  (color) => {
    const backdrop = renderToStaticMarkup(
      React.createElement(MotionBackdrop, {
        backdrop: {
          preset: "vignette",
          source: "asset",
          colors: [color],
          blur: 0,
          dim: 0,
          motion: false,
          intensity: 1,
          particles: 0,
          layers: [],
        },
        frame: 0,
        fps: 30,
        seed: 1,
        renderMedia: () => null,
      }),
    );
    const badge = renderToStaticMarkup(
      React.createElement(MotionBadge, {
        node: videoNode({ type: "badge", badge: { kind: "winner", color } }),
        children: "Winner",
      }),
    );
    expect(backdrop).toContain(`color-mix(in srgb, ${color} 80%, transparent)`);
    expect(badge).toContain(
      `color-mix(in srgb, ${color} 15.686274509803921%, transparent)`,
    );
  },
);
it.each([0, 3, 32, 40])(
  "uses the normalized particle count for light-orbs (%i)",
  (count) => {
    const html = renderToStaticMarkup(
      React.createElement(MotionBackdrop, {
        backdrop: {
          preset: "light-orbs",
          source: "asset",
          colors: ["red"],
          blur: 0,
          dim: 0,
          motion: false,
          intensity: 1,
          particles: count,
          layers: [],
        },
        frame: 0,
        fps: 30,
        seed: 1,
        renderMedia: () => null,
      }),
    );
    expect((html.match(/background:radial-gradient/g) ?? []).length).toBe(
      Math.min(32, count),
    );
  },
);

it.each(["text-words", "text-letters"] as const)(
  "%s keeps explicit line separators in the shared pre-wrap flow",
  (name) => {
    const text = "  М 👨‍👩‍👧‍👦\r\n\r\nЖ 世界  \n";
    for (const channel of ["enter", "exit"] as const)
      for (const frame of [0, 10, 20, 30, 100]) {
        const html = renderToStaticMarkup(
          React.createElement(MotionText, {
            text,
            motions: [clip(name, { channel, from: 0 })],
            frame,
            fps: 30,
          }),
        );
        const ancestors: boolean[] = [];
        let lineSeparators = 0;
        for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
          if (token.startsWith("</")) ancestors.pop();
          else if (token.startsWith("<"))
            ancestors.push(token.includes("display:inline-block"));
          else
            for (const separator of token.match(/\r\n|\r|\n/g) ?? []) {
              // A preserved newline inside an atomic inline box cannot break its siblings.
              expect(ancestors.includes(true)).toBe(false);
              lineSeparators++;
            }
        }
        expect(lineSeparators).toBe(3);
      }
  },
);
it.each(["text-words", "text-letters"] as const)(
  "%s restores raw shaping in neutral and completed poses",
  (name) => {
    const text = "AV М\nЖ VA",
      raw = renderToStaticMarkup(React.createElement(React.Fragment, {}, text));
    for (const [channel, frame] of [
      ["enter", 20],
      ["enter", 30],
      ["exit", 0],
    ] as const) {
      const html = renderToStaticMarkup(
        React.createElement(MotionText, {
          text,
          motions: [clip(name, { channel, from: 0 })],
          frame,
          fps: 30,
        }),
      );
      // Atomic glyph boxes disable kerning (e.g. AV); completed poses must shape as raw text.
      expect(html).toBe(raw);
    }
    const hidden = renderToStaticMarkup(
      React.createElement(MotionText, {
        text,
        motions: [clip(name, { channel: "exit", from: 0 })],
        frame: 20,
        fps: 30,
      }),
    );
    expect(hidden).toBe(
      renderToStaticMarkup(
        React.createElement("span", { style: { opacity: 0 } }, text),
      ),
    );
  },
);

it("keeps continuing backdrop layer keys stable when overlap membership changes", () => {
  const media = videoNode().media!;
  const backdrop = {
    preset: "art-blur" as const,
    source: "current-card" as const,
    colors: [],
    blur: 0,
    dim: 0,
    motion: false,
    intensity: 1,
    particles: 0,
    // Identical source/from must still produce distinct layer identities.
    layers: [
      { from: 0, to: 20, fadeInFrames: 0, media },
      { from: 0, to: 30, fadeInFrames: 0, media },
    ],
  };
  const keys = (frame: number) => {
    const tree = MotionBackdrop({
      backdrop,
      frame,
      fps: 30,
      seed: 1,
      renderMedia: () => null,
    }) as React.ReactElement;
    return (tree.props.children[0] as React.ReactElement[]).map(
      (child) => child.key,
    );
  };
  expect(new Set(keys(15)).size).toBe(2);
  expect(keys(21)[0]).toBe(keys(15)[1]);
});
