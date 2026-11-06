import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompiledNode, CompiledScene } from "../video/types";
import type {
  CompiledTextLayout,
  ResolvedTypography,
} from "../video/typography-types";
import type { CompiledMotion } from "../video/motion-types";
import { execFileSync } from "node:child_process";
import { StudioSceneFrame } from "./StudioVideo";
import { measuredTextMotion } from "./MotionText";

const typography: ResolvedTypography = {
  role: "title",
  font: "arimo",
  weight: 700,
  italic: false,
  fontSize: 40,
  minFontSize: 20,
  lineHeight: 1.25,
  letterSpacing: 0,
  align: "center",
  verticalAlign: "middle",
  padding: { top: 8, right: 12, bottom: 8, left: 12 },
  maxLines: 4,
  wrap: "word",
  fit: "shrink",
  overflow: "error",
  balance: false,
  language: "auto",
  fill: "#ffffff",
  gradient: null,
  outlines: [],
  shadows: [],
  plate: null,
  decoration: "none",
};
const layout: CompiledTextLayout = {
  fontSize: 32,
  lineHeight: 40,
  rect: { x: 12, y: 8, width: 276, height: 104 },
  lines: [
    {
      text: "AV 世界",
      width: 120,
      x: 78,
      y: 12,
      runs: [
        {
          text: "AV 世界",
          width: 120,
          x: 0,
          fonts: ["arimo-700-normal", "noto-sans-jp-700-normal"],
        },
      ],
    },
    {
      text: "Продолжение",
      width: 180,
      x: 48,
      y: 52,
      runs: [
        { text: "Продолжение", width: 180, x: 0, fonts: ["arimo-700-normal"] },
      ],
    },
  ],
  overflow: false,
  truncated: false,
  fonts: ["arimo-700-normal", "noto-sans-jp-700-normal"],
  missing: [],
};
function node(patch: Partial<CompiledNode> = {}): CompiledNode {
  return {
    id: "title",
    type: "text",
    rect: { x: 0, y: 0, width: 300, height: 120 },
    from: 0,
    durationInFrames: 90,
    visible: [{ from: 0, to: 90 }],
    layer: 1,
    style: { fontSize: 9 },
    opacity: 1,
    scale: 1,
    rotate: 0,
    animation: [],
    text: "AV 世界 Продолжение",
    typography,
    textLayout: layout,
    ...patch,
  };
}
function render(nodes: CompiledNode[], frame = 0): string {
  const scene: CompiledScene = {
    id: "scene",
    kind: "custom",
    from: 0,
    durationInFrames: 90,
    nodes,
    background: "#000",
    phases: {},
    transition: { type: "none", durationInFrames: 0 },
  };
  return renderToStaticMarkup(
    React.createElement(StudioSceneFrame, {
      scene,
      frame,
      fps: 30,
      width: 300,
      height: 200,
      assetMode: "url",
    }),
  );
}
const textMotion = (name: CompiledMotion["name"]): CompiledMotion => ({
  name,
  channel: "enter",
  from: 0,
  durationInFrames: 31,
  profile: "smooth",
  intensity: 1,
  direction: "up",
  window: { from: 0, to: 90 },
});

describe("measured typography renderer", () => {
  it("uses compiler line geometry and final size without browser wrapping or legacy fitting", () => {
    const html = render([node()]);
    expect(html).toContain('data-typography="true"');
    expect(html.match(/data-typography-line="/g)).toHaveLength(2);
    expect(html).toContain("font-size:32px");
    expect(html).toContain("left:78px;top:12px;width:120px;height:40px");
    expect(html).toContain("white-space:pre");
    expect(html).toContain("font-synthesis:none");
    expect(html).toContain("Douga Noto Sans JP");
    expect(html).not.toContain("overflow-wrap:anywhere");
  });

  it("draws rich runs, two decorative outlines, shadows, gradient and plate from the resolved style", () => {
    const rich = node({
      typography: {
        ...typography,
        outlines: [
          { color: "#000000", width: 6 },
          { color: "#ffffff", width: 2 },
        ],
        shadows: [
          { color: "#121212", x: 3, y: 4, blur: 2 },
          { color: "#ff0000", blur: 8 },
        ],
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { at: 0, color: "#ff0000" },
            { at: 1, color: "#0000ff" },
          ],
        },
        plate: { color: "#222222", padding: 4, borderRadius: 5 },
      },
      textLayout: {
        ...layout,
        lines: [
          {
            ...layout.lines[0],
            runs: [
              { text: "AV ", x: 0, width: 48, fonts: ["arimo-700-normal"] },
              {
                text: "世界",
                x: 48,
                width: 72,
                fonts: ["noto-sans-jp-700-normal"],
                color: "#ffff00",
                weight: 400,
                decoration: "underline",
              },
            ],
          },
        ],
      },
    });
    const html = render([rich]);
    expect(html.match(/data-typography-outline="/g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain("-webkit-text-stroke:12px #000000");
    expect(html).toContain("-webkit-text-stroke:4px #ffffff");
    expect(html).toContain("3px 4px 2px #121212, 0px 0px 8px #ff0000");
    expect(html).toContain("linear-gradient(90deg");
    expect(html).toContain("background:#222222");
    expect(html).toContain("color:#ffff00");
    expect(html).toContain("text-decoration:underline");
  });

  it("reveals actual visual lines on their fixed full-text positions", () => {
    const moving = node({ motion: [textMotion("text-lines")] });
    const a = render([moving], 10),
      b = render([moving], 30);
    expect(a.match(/data-typography-line="/g)).toHaveLength(2);
    expect(a).toContain("left:48px;top:52px;width:180px;height:40px");
    expect(b).toContain("left:48px;top:52px;width:180px;height:40px");
    expect(a).toContain("clip-path:inset(");
    expect(a).not.toEqual(b);
  });

  it("keeps dynamic counter and timer values inside the reserved full-size line", () => {
    const reserved: CompiledTextLayout = {
      ...layout,
      reservedText: "100",
      lines: [
        {
          text: "100",
          width: 80,
          x: 98,
          y: 32,
          runs: [{ text: "100", width: 80, x: 0, fonts: ["arimo-700-normal"] }],
        },
      ],
    };
    const counter = node({
      text: "100",
      textLayout: reserved,
      motion: [textMotion("text-counter")],
    });
    const values = [0, 15, 30].map((frame) => render([counter], frame));
    for (const html of values)
      expect(html).toContain("left:98px;top:32px;width:80px;height:40px");
    expect(values[0]).toContain(">0</span>");
    expect(values[1]).toContain(">50</span>");
    expect(values[2]).toContain(">100</span>");
    const timer = node({ type: "timer", textLayout: reserved });
    expect(render([timer], 0)).toContain(">3</span>");
    expect(render([timer], 60)).toContain(">1</span>");
    expect(render([timer], 60)).toContain(
      "left:98px;top:32px;width:80px;height:40px",
    );
  });

  it("shows the counter target after its clip window ends rather than the widest reserved number", () => {
    const reserved: CompiledTextLayout = {
      ...layout,
      reservedText: "88",
      lines: [
        {
          text: "88",
          width: 80,
          x: 98,
          y: 32,
          runs: [{ text: "88", width: 80, x: 0, fonts: ["arimo-700-normal"] }],
        },
      ],
    };
    const counter = node({
      text: "100",
      textLayout: reserved,
      motion: [{ ...textMotion("text-counter"), window: { from: 0, to: 31 } }],
    });
    expect(render([counter], 31)).toContain(">100</span>");
    expect(render([counter], 31)).not.toContain(">88</span>");
  });

  it("paints the progress percentage inside its reserved line while keeping the track", () => {
    const reserved: CompiledTextLayout = {
      ...layout,
      reservedText: "100%",
      lines: [
        {
          text: "100%",
          width: 100,
          x: 88,
          y: 32,
          runs: [
            { text: "100%", width: 100, x: 0, fonts: ["arimo-700-normal"] },
          ],
        },
      ],
    };
    const progress = node({
      type: "progress",
      textLayout: reserved,
      progress: {
        scope: "scene",
        color: "#22ff22",
        trackColor: "#333333",
        strokeWidth: 6,
        from: 0,
        durationInFrames: 60,
      },
    });
    for (const [frame, text] of [
      [0, "0%"],
      [30, "50%"],
      [60, "100%"],
    ] as const) {
      const html = render([progress], frame);
      expect(html).toContain(`>${text}</span>`);
      expect(html).toContain("left:88px;top:32px;width:100px;height:40px");
      expect(html).toContain("background:#333333");
    }
  });

  it("segments letter animation by whole graphemes and restores shaped runs at rest", () => {
    const text = "AV 👨‍👩‍👧‍👦か\u3099";
    const animated = node({
      text,
      motion: [textMotion("text-letters")],
      textLayout: {
        ...layout,
        lines: [
          {
            text,
            width: 180,
            x: 48,
            y: 32,
            runs: [
              {
                text,
                width: 180,
                x: 0,
                fonts: ["arimo-700-normal", "noto-sans-jp-700-normal"],
              },
            ],
          },
        ],
      },
    });
    const active = render([animated], 15),
      complete = render([animated], 30);
    expect(active.match(/data-typography-fragment="/g)).toHaveLength(5);
    expect(active).toContain(">👨‍👩‍👧‍👦</span>");
    expect(active).toContain(">か\u3099</span>");
    expect(complete).not.toContain("data-typography-fragment");
    expect(complete).toContain(`>${text}</span>`);
  });

  it("keeps the primary family first when Japanese appears before Latin in a measured run", () => {
    const jpFirst = node({
      textLayout: {
        ...layout,
        lines: [
          {
            ...layout.lines[0],
            text: "世界 AV",
            runs: [
              {
                text: "世界 AV",
                x: 0,
                width: 120,
                fonts: ["noto-sans-jp-700-normal", "arimo-700-normal"],
              },
            ],
          },
        ],
      },
    });
    expect(render([jpFirst])).toContain(
      "font-family:&quot;Douga Arimo&quot;, &quot;Douga Noto Sans JP&quot;",
    );
  });

  it("intersects simultaneous text masks without dropping either visual reveal", () => {
    const reveal = textMotion("text-wipe");
    const pose = measuredTextMotion(
      [reveal, { ...reveal, direction: "right" }],
      15,
      0,
      1,
      0,
      1,
    );
    expect(pose.style.clipPath).toBe("inset(50% 0% 0% 50%)");
  });

  it.each(["card", "group", "timer", "versus", "badge", "progress"] as const)(
    "routes %s text through measured typography while preserving widget graphics",
    (type) => {
      const html = render(
        [
          node({
            type,
            label: "AV 世界 Продолжение",
            labelWindows: [{ from: 0, to: 90 }],
            timer:
              type === "timer"
                ? {
                    variant: "ring",
                    color: "#22ff22",
                    trackColor: "#333333",
                    strokeWidth: 6,
                    showValue: true,
                    warningSec: 1,
                  }
                : undefined,
            progress:
              type === "progress"
                ? {
                    scope: "scene",
                    color: "#22ff22",
                    trackColor: "#333333",
                    strokeWidth: 6,
                    from: 0,
                    durationInFrames: 90,
                  }
                : undefined,
          }),
        ],
        10,
      );
      expect(html).toContain('data-typography="true"');
      if (type === "timer") expect(html).toContain("<circle");
      if (type === "progress") expect(html).toContain("background:#333333");
    },
  );

  it("keeps legacy text on the original fitter and omits typography markers", () => {
    const html = render([
      node({ typography: undefined, textLayout: undefined }),
    ]);
    expect(html).not.toContain("data-typography");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("font-weight:700");
  });

  it("shows a loading boundary before a Player can paint an unloaded font", () => {
    const html = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import React from "react";
      import {renderToString} from "react-dom/server";
      import {Player} from "@remotion/player";
      import {StudioVideo} from "./src/remotion/StudioVideo.tsx";
      import {typographyFontAssets} from "./src/video/font-manifest.ts";
      const plan={schemaVersion:1,compilerVersion:"1.0.0",seed:1,width:300,height:200,fps:30,durationInFrames:30,scenes:[],audio:[],fonts:[typographyFontAssets[0]]};
      console.log(renderToString(React.createElement(Player,{acknowledgeRemotionLicense:true,component:StudioVideo,inputProps:{plan},compositionWidth:300,compositionHeight:200,fps:30,durationInFrames:30})));
    `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
      },
    );
    expect(html).toContain('data-typography-font-loading="true"');
  });
});
