import { describe, expect, it } from "vitest";
import { compileVideo } from "./compiler";
import { videoDocumentSchema } from "./schema";
import { mergeSettings } from "./settings";
import type { VideoDocument, VideoNode } from "./types";
import type { MeasureText, ResolvedTypography } from "./typography-types";

// A deterministic pixel metric makes a wrong wrap/fit branch visible independently
// of platform fonts. Real font shaping is verified by the server adapter suite.
const measureText: MeasureText = (text, style) => ({
  width:
    (Array.from(
      new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text),
    ).length *
      style.fontSize) /
      2 +
    Math.max(0, Array.from(text).length - 1) * style.letterSpacing,
  fonts: [
    `${style.font}-${style.weight}-${style.italic ? "italic" : "normal"}`,
  ],
  missing: [],
});
function doc(
  nodes: VideoNode[] = [
    {
      id: "text",
      type: "text",
      text: "Hello 日本語",
      rect: { x: 0, y: 0, width: 400, height: 120 },
      units: "px",
    },
  ],
): VideoDocument {
  return {
    schemaVersion: 1,
    id: "typography-test",
    title: "Тест",
    kind: "top",
    seed: 1,
    output: { format: "wide", fps: 30 },
    source: { kind: "manual", participants: [], rounds: [] },
    bindings: {},
    settings: {},
    scenes: [{ id: "scene", block: "custom", duration: { sec: 2 }, nodes }],
  };
}
const compile = (d: VideoDocument, provider = true) =>
  compileVideo(d, {}, provider ? { measureText } : undefined);
const textNode = (result: ReturnType<typeof compile>) =>
  result.plan.scenes[0]?.nodes.find((n) => n.type === "text")!;

describe("opt-in measured typography", () => {
  it("keeps an unrelated node legacy when another node explicitly enables typography", () => {
    const d = doc([
      {
        id: "new",
        type: "text",
        text: "日本語",
        typography: { preset: "jp-title", fontSize: 40 },
        units: "px",
        rect: { x: 0, y: 0, width: 300, height: 100 },
      },
      { id: "old", type: "text", text: "Legacy" },
    ]);
    const r = compile(d);
    expect(r.diagnostics).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0].nodes[0].textLayout?.lines[0].text).toBe("日本語");
    expect(r.plan.scenes[0].nodes[1]).not.toHaveProperty("typography");
    expect(r.plan.scenes[0].nodes[1]).not.toHaveProperty("textLayout");
  });
  it("requires real measurement only in enabled scopes", () => {
    const d = doc();
    expect(compile(d, false).ready).toBe(true);
    d.settings.typography = { theme: "clean" };
    expect(compile(d, false).diagnostics.map((d) => d.code)).toContain(
      "TEXT_LAYOUT_REQUIRED",
    );
  });
  it("preserves authored legacy color and font size but lets local typography override them", () => {
    const d = doc();
    d.settings = {
      typography: { theme: "clean" },
      card: { color: "#ff0000", fontSize: 42 },
    };
    const first = textNode(compile(d));
    expect(first.typography).toMatchObject({ fontSize: 42, fill: "#ff0000" });
    d.scenes[0].nodes[0].typography = { fontSize: 32, fill: "#00ff00" };
    expect(textNode(compile(d)).typography).toMatchObject({
      fontSize: 32,
      fill: "#00ff00",
    });
  });
  it("deeply inherits role properties and uses null to disable a subtree", () => {
    const merged = mergeSettings(
      {
        typography: {
          theme: "clean",
          defaults: { padding: { left: 10, top: 4 } },
          roles: { label: { fill: "#ff0000", fontSize: 32 } },
        },
      },
      {
        typography: {
          defaults: { padding: { right: 12 } },
          roles: { label: { maxLines: 3 } },
        },
      },
    );
    expect(merged.typography?.roles?.label).toEqual({
      fill: "#ff0000",
      fontSize: 32,
      maxLines: 3,
    });
    expect(merged.typography?.defaults?.padding).toEqual({
      left: 10,
      top: 4,
      right: 12,
    });
    const d = doc([
      {
        id: "container",
        type: "container",
        typography: null,
        children: [
          { id: "legacy", type: "text", text: "Старый" },
          {
            id: "local",
            type: "text",
            text: "Новый",
            typography: { fontSize: 40 },
          },
        ],
      },
    ]);
    d.settings.typography = { theme: "clean" };
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(
      r.plan.scenes[0].nodes.find((n) => n.text === "Старый"),
    ).not.toHaveProperty("typography");
    expect(
      r.plan.scenes[0].nodes.find((n) => n.text === "Новый")?.typography,
    ).toBeDefined();
  });
  it("resolves flat rich text bindings before measuring without recursive authoring", () => {
    const d = doc([
      {
        id: "rich",
        type: "text",
        text: {
          runs: [
            { text: "Ролик: " },
            {
              text: { bind: "document.title" },
              color: "#ffcc00",
              weight: 700,
              italic: true,
            },
          ],
        },
        typography: { font: "arimo", fontSize: 30 },
      },
    ]);
    const n = textNode(compile(d));
    expect(n.text).toBe("Ролик: Тест");
    expect(n.textLayout?.lines[0].runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Тест",
          color: "#ffcc00",
          weight: 700,
          italic: true,
          width: 60,
        }),
      ]),
    );
    const recursive = structuredClone(d) as any;
    recursive.scenes[0].nodes[0].text.runs[0].text = {
      runs: [{ text: "bad" }],
    };
    expect(videoDocumentSchema.safeParse(recursive).success).toBe(false);
  });
  it.each([
    { font: "Arial" },
    { fill: "url(https://bad.test/font)" },
    { maxLines: 13 },
    { weight: 500 },
    {
      outlines: [
        { color: "red", width: 1 },
        { color: "white", width: 2 },
        { color: "black", width: 3 },
      ],
    },
  ])("rejects unsafe or unsupported typography %j", (typography) => {
    const d = doc();
    (d.scenes[0].nodes[0] as any).typography = typography;
    expect(videoDocumentSchema.safeParse(d).success).toBe(false);
  });
  it("rejects unsupported italic instead of synthesizing a face", () => {
    const d = doc();
    d.settings.typography = { defaults: { font: "manrope", italic: true } };
    expect(compile(d).diagnostics.map((d) => d.code)).toContain(
      "FONT_FACE_UNSUPPORTED",
    );
  });
  it("rejects rich runs and graphemes above bounded text budgets", () => {
    const d = doc();
    (d.scenes[0].nodes[0] as any).text = {
      runs: Array.from({ length: 101 }, () => ({ text: "a" })),
    };
    expect(videoDocumentSchema.safeParse(d).success).toBe(false);
    (d.scenes[0].nodes[0] as any).text = "a".repeat(10001);
    expect(videoDocumentSchema.safeParse(d).success).toBe(false);
  });
});

describe("pixel layout", () => {
  function laidOut(
    text: string,
    typography: any = {},
    width = 100,
    height = 160,
  ) {
    const d = doc([
      {
        id: "layout",
        type: "text",
        text,
        units: "px",
        rect: { x: 0, y: 0, width, height },
        typography: {
          font: "arimo",
          fontSize: 20,
          minFontSize: 16,
          padding: 0,
          lineHeight: 1,
          ...typography,
        },
      },
    ]);
    return compile(d);
  }
  it("wraps measured words and explicit newlines", () => {
    const n = textNode(laidOut("hello world\n日本語", { maxLines: 3 }));
    expect(n.textLayout?.lines.map((l) => l.text)).toEqual([
      "hello",
      "world",
      "日本語",
    ]);
    expect(n.textLayout?.fontSize).toBe(20);
  });
  it("keeps combining graphemes and Japanese closing punctuation together", () => {
    const n = textNode(laidOut("がきくけ。", { wrap: "char" }, 40));
    expect(n.textLayout?.lines.map((l) => l.text)).toEqual([
      "がきく",
      "け。",
    ]);
  });
  it("never shrinks below the readable minimum and reports overflow", () => {
    const r = laidOut("too much text for this box", { maxLines: 1 }, 60, 30);
    expect(r.ready).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("TEXT_OVERFLOW");
    expect(textNode(r).textLayout?.fontSize).toBe(16);
  });
  it("ellipsis and clipping are explicit overflow policies", () => {
    const ellipsis = laidOut(
      "abcdefghijk",
      { fit: "fixed", overflow: "ellipsis", wrap: "none", maxLines: 1 },
      50,
      30,
    );
    expect(ellipsis.ready).toBe(true);
    expect(textNode(ellipsis).textLayout?.lines[0].text).toBe("abcd…");
    expect(textNode(ellipsis).textLayout?.truncated).toBe(true);
    const clip = laidOut(
      "abcdefghijk",
      { fit: "fixed", overflow: "clip", wrap: "none", maxLines: 1 },
      50,
      30,
    );
    expect(clip.ready).toBe(true);
    expect(textNode(clip).textLayout?.overflow).toBe(true);
  });
  it("reserves effect extents inside the text rectangle", () => {
    const n = textNode(
      laidOut(
        "abc",
        {
          padding: 4,
          outlines: [{ color: "black", width: 2 }],
          shadows: [{ color: "black", x: 6, y: 3, blur: 2 }],
        },
        100,
        50,
      ),
    );
    expect(n.textLayout?.rect).toMatchObject({
      x: 6,
      y: 6,
      width: 80,
      height: 33,
    });
  });
  it("reports missing glyphs returned by the measurement provider", () => {
    const d = doc();
    d.settings.typography = { theme: "clean" };
    const r = compileVideo(
      d,
      {},
      { measureText: (t, s) => ({ ...measureText(t, s), missing: ["𰻞"] }) },
    );
    expect(r.diagnostics.map((d) => d.code)).toContain("FONT_GLYPH_MISSING");
  });
  it("fits compatible groups to the smallest required size and rejects incompatible groups", () => {
    const d = doc(
      ["short", "a long word"].map((text, i) => ({
        id: `group-${i}`,
        type: "text",
        text,
        units: "px",
        rect: { x: 0, y: i * 100, width: 120, height: 80 },
        typography: {
          font: "arimo",
          fontSize: 40,
          minFontSize: 16,
          maxLines: 1,
          fitGroup: "labels",
          padding: 0,
        },
      })),
    );
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0].nodes.map((n) => n.textLayout?.fontSize)).toEqual([
      expect.closeTo(21.8, 0),
      expect.closeTo(21.8, 0),
    ]);
    d.scenes[0].nodes[1].typography = {
      ...d.scenes[0].nodes[1].typography,
      font: "oswald",
    };
    expect(compile(d).diagnostics.map((d) => d.code)).toContain(
      "TEXT_FIT_GROUP_INCOMPATIBLE",
    );
  });
  it("reserves the widest countdown digits before animation", () => {
    const d = doc([
      {
        id: "timer",
        type: "timer",
        duration: { sec: 12 },
        typography: { preset: "timer-digits", fontSize: 40 },
        units: "px",
        rect: { x: 0, y: 0, width: 100, height: 60 },
      },
    ]);
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes[0].nodes[0].textLayout?.reservedText).toHaveLength(2);
  });
});

import * as sdk from "./index";
import { createVideoDocument } from "./builders";
import { getBuiltinPresets } from "./presets";
import { typographyStyles, typographyThemes } from "./typography-catalog";

describe("authoring and complete catalog", () => {
  it("applies a theme immutably with preserve and clears scoped overrides with replace", () => {
    expect(sdk).toHaveProperty("applyTypographyTheme");
    const d = doc();
    d.settings = {
      typography: { theme: "clean", defaults: { fill: "red" } },
      card: { color: "blue", fontSize: 42 },
    };
    d.scenes[0].nodes[0].style = { fontSize: 32 };
    d.scenes[0].nodes[0].typography = { font: "arimo", fill: "yellow" };
    const kept = sdk.applyTypographyTheme(d, "cinematic", { mode: "preserve" });
    expect(kept.settings.typography).toMatchObject({
      theme: "cinematic",
      defaults: { fill: "red" },
    });
    expect(kept.scenes[0].nodes[0].typography).toMatchObject({
      fill: "yellow",
    });
    expect(d.settings.typography?.theme).toBe("clean");
    const replaced = sdk.applyTypographyTheme(d, "cinematic", {
      scope: { type: "scene", id: "scene" },
      mode: "replace",
    });
    expect(replaced.settings.card).toEqual({ color: "blue", fontSize: 42 });
    expect(replaced.scenes[0].settings?.typography).toEqual({
      version: 1,
      theme: "cinematic",
    });
    expect(replaced.scenes[0].nodes[0].typography).toBeUndefined();
    expect(replaced.scenes[0].nodes[0].style?.fontSize).toBeUndefined();
  });
  it("uses every theme and style as valid measured authoring data", () => {
    expect(typographyStyles).toHaveLength(12);
    expect(typographyThemes).toHaveLength(6);
    for (const entry of typographyThemes) {
      expect(Object.keys(entry.roles)).toHaveLength(8);
      const d = doc();
      d.settings.typography = { theme: entry.id };
      expect(
        compile(d).diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([]);
    }
    for (const entry of typographyStyles) {
      const d = doc();
      d.scenes[0].nodes[0].typography = { preset: entry.id };
      expect(
        compile(d).diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([]);
    }
  });
  it("ships four complete bound examples with valid plans", () => {
    expect(sdk).toHaveProperty("typographyExamples");
    expect(sdk.typographyExamples).toHaveLength(4);
    for (const example of sdk.typographyExamples) {
      const result = compileVideo(example.document, example.manifest, {
        measureText,
      });
      expect(
        result.diagnostics.filter((d) => d.severity === "error"),
        example.id,
      ).toEqual([]);
      expect(
        result.plan.scenes.flatMap((s) => s.nodes).some((n) => n.textLayout),
      ).toBe(true);
    }
  });
  it("does not turn legacy presets or their format changes into typography scopes", () => {
    const presets = getBuiltinPresets();
    expect(presets).toHaveLength(54);
    for (const preset of presets)
      for (const format of ["wide", "vertical", "square"] as const) {
        const d = createVideoDocument({ kind: preset.kind, preset });
        d.output.format = format;
        const r = compileVideo(d);
        expect(
          r.diagnostics.some((d) => d.code === "TEXT_LAYOUT_REQUIRED"),
          `${preset.id}/${format}`,
        ).toBe(false);
        expect(r.plan).not.toHaveProperty("fonts");
        expect(
          r.plan.scenes
            .flatMap((s) => s.nodes)
            .every((n) => !n.typography && !n.textLayout && !n.textRuns),
        ).toBe(true);
      }
  });
  it("inherits specific new font size through a deeper default without reviving an older legacy override", () => {
    const d = doc();
    d.settings = {
      card: { fontSize: 42 },
      typography: { defaults: { fontSize: 34 } },
    };
    d.scenes[0].settings = { typography: { defaults: { maxLines: 4 } } };
    expect(textNode(compile(d)).typography?.fontSize).toBe(34);
  });
  it("counts measured lines and whole graphemes for motion", () => {
    const d = doc([
      {
        id: "animated",
        type: "text",
        text: "áb́ćd́",
        units: "px",
        rect: { x: 0, y: 0, width: 30, height: 120 },
        typography: {
          fontSize: 20,
          minFontSize: 20,
          maxLines: 4,
          wrap: "char",
        },
        motion: {
          enter: { name: "text-letters" },
          exit: { name: "text-lines" },
        },
      },
    ]);
    const n = textNode(compile(d));
    expect(n.motion?.find((m) => m.name === "text-letters")?.fragments).toBe(4);
    expect(n.motion?.find((m) => m.name === "text-lines")?.fragments).toBe(2);
  });
  it("reserves counter intermediate widths rather than only the final number", () => {
    const d = doc([
      {
        id: "counter",
        type: "text",
        text: "100",
        typography: { font: "arimo", fontSize: 30 },
        motion: { enter: { name: "text-counter" } },
        units: "px",
        rect: { x: 0, y: 0, width: 200, height: 100 },
      },
    ]);
    const r = compileVideo(
      d,
      {},
      {
        measureText: (text, style) => ({
          ...measureText(text, style),
          width: Array.from(text).reduce(
            (n, c) => n + (c === "8" ? style.fontSize : style.fontSize / 4),
            0,
          ),
        }),
      },
    );
    expect(textNode(r).textLayout?.reservedText).toBe("88");
  });
  it("rejects a requested minimum greater than the starting font size", () => {
    const d = doc();
    d.scenes[0].nodes[0].typography = { fontSize: 20, minFontSize: 30 };
    expect(compile(d).diagnostics.map((d) => d.code)).toContain(
      "TEXT_SIZE_RANGE_INVALID",
    );
  });
});

import { getFontFace } from "./font-manifest";
import { extractVideoPreset } from "./presets";

describe("integration boundaries and inheritance", () => {
  it("keeps selected font assets detached from the immutable catalog", () => {
    const d = doc();
    d.settings.typography = { defaults: { font: "arimo" } };
    const r = compile(d),
      face = r.plan.fonts![0];
    expect(face.id).toBe("arimo-700-normal");
    face.src = "/a-frozen-revision/font.ttf";
    expect(getFontFace("arimo-700-normal")?.src).toBe(
      "/fonts/typography-v1/arimo-normal.ttf",
    );
  });
  it("binds custom rich card captions to the actual selected participant and includes rank", () => {
    const d = doc([
      {
        id: "card",
        type: "card",
        participantId: "p",
        label: {
          runs: [{ text: { bind: "participant.label" }, color: "yellow" }],
        },
        typography: { fontSize: 36 },
      },
    ]);
    d.source.participants = [{ id: "p", label: "Акира", rank: 3 }];
    const r = compile(d),
      n = r.plan.scenes[0].nodes[0];
    expect(
      r.diagnostics.filter((d) => d.code === "TEXT_BINDING_UNRESOLVED"),
    ).toEqual([]);
    expect(n.textLayout?.lines.map((l) => l.text).join("")).toBe("#3 Акира");
  });
  it("does not leak bound private text or group IDs when extracting rich preset authoring", () => {
    const d = doc([
      {
        id: "rich-preset",
        type: "text",
        text: {
          runs: [
            { text: "My private caption", color: "yellow" },
            { text: { bind: "group.label", groupId: "private-group" } },
          ],
        },
        typography: { preset: "jp-title" },
      },
    ]);
    const preset = extractVideoPreset(d, { id: "rich", name: "Rich" });
    expect(JSON.stringify(preset)).not.toContain("My private caption");
    expect(JSON.stringify(preset)).not.toContain("private-group");
    expect(preset.scenes[0].nodes[0].typography).toEqual({
      preset: "jp-title",
    });
    expect(sdk.videoPresetSchema.safeParse(preset).success).toBe(true);
  });
  it("retains settings and semantic roles in repeated picker answer scenes", () => {
    const d = createVideoDocument({
      kind: "picker",
      participants: [
        { id: "a", label: "Small" },
        { id: "b", label: "A much longer label" },
      ],
      rounds: [
        {
          id: "r",
          prompt: "Choose",
          cards: [
            {
              id: "ca",
              participantId: "a",
              settings: {
                typography: {
                  roles: { label: { fill: "yellow", fontSize: 42 } },
                },
              },
            },
            { id: "cb", participantId: "b" },
          ],
          answer: { cardIds: ["ca"] },
        },
      ],
    });
    d.settings.typography = { theme: "clean" };
    d.settings.picker!.answerMode = "separate";
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(
      r.plan.scenes
        .flatMap((s) => s.nodes)
        .filter((n) => n.cardId === "ca")
        .map((n) => n.typography?.fill),
    ).toEqual(["yellow", "yellow"]);
    expect(
      r.plan.scenes[0].nodes.find((n) => n.type === "timer")?.typography?.role,
    ).toBe("timer");
    expect(
      r.plan.scenes[0].nodes.find((n) => n.id.endsWith("/prompt"))?.typography
        ?.role,
    ).toBe("prompt");
  });
  it("keeps local segment legacy overrides above document typography defaults", () => {
    const d = doc();
    d.schemaVersion = 2;
    d.settings.typography = { theme: "clean", defaults: { fontSize: 34 } };
    d.segments = [
      {
        id: "part",
        title: "Part",
        kind: "custom",
        settings: { card: { fontSize: 26 } },
        scenes: d.scenes,
      },
    ];
    d.scenes = [];
    expect(textNode(compile(d)).typography?.fontSize).toBe(26);
  });
  it("balances measured words without changing forced paragraph breaks", () => {
    const d = doc([
      {
        id: "balanced",
        type: "text",
        text: "a b c d e f",
        typography: {
          fontSize: 20,
          minFontSize: 20,
          maxLines: 3,
          balance: true,
        },
        units: "px",
        rect: { x: 0, y: 0, width: 90, height: 80 },
      },
    ]);
    expect(textNode(compile(d)).textLayout?.lines.map((l) => l.text)).toEqual([
      "a b c",
      "d e f",
    ]);
    d.scenes[0].nodes[0] = {
      ...d.scenes[0].nodes[0],
      type: "text",
      text: "a b\nc d e f",
    };
    expect(textNode(compile(d)).textLayout?.lines[0].text).toBe("a b");
  });
  it("bounds aggregate rich literal text, not just each individual run", () => {
    const d = doc([
      {
        id: "big",
        type: "text",
        text: {
          runs: [{ text: "a".repeat(6000) }, { text: "b".repeat(6000) }],
        },
      },
    ]);
    expect(videoDocumentSchema.safeParse(d).success).toBe(false);
  });
});

describe("segment fit groups and readable defaults", () => {
  it("fits explicit groups across scenes within one segment", () => {
    const d = doc([
      {
        id: "first",
        type: "text",
        text: "short",
        units: "px",
        rect: { x: 0, y: 0, width: 120, height: 80 },
        typography: {
          fontSize: 40,
          minFontSize: 16,
          maxLines: 1,
          fitGroup: "shared",
        },
      },
    ]);
    d.scenes.push({
      id: "other",
      block: "custom",
      duration: { sec: 2 },
      nodes: [
        {
          id: "long",
          type: "text",
          text: "a long word",
          units: "px",
          rect: { x: 0, y: 0, width: 120, height: 80 },
          typography: {
            fontSize: 40,
            minFontSize: 16,
            maxLines: 1,
            fitGroup: "shared",
          },
        },
      ],
    });
    const r = compile(d);
    expect(r.ready).toBe(true);
    expect(r.plan.scenes.map((s) => s.nodes[0].textLayout?.fontSize)).toEqual([
      21.81, 21.81,
    ]);
  });
  it("uses role and format readable minima while respecting explicit minima", () => {
    const d = doc([
      { id: "label", type: "text", text: "abc", typography: { role: "label" } },
    ]);
    d.settings.typography = { theme: "clean" };
    expect(textNode(compile(d)).typography?.minFontSize).toBe(20);
    d.output.format = "square";
    expect(textNode(compile(d)).typography?.minFontSize).toBe(18);
    d.scenes[0].nodes[0].typography = { role: "label", minFontSize: 12 };
    expect(textNode(compile(d)).typography?.minFontSize).toBe(12);
  });
  it("warns when an explicit policy permits truncation or clipping", () => {
    const d = doc([
      {
        id: "clip",
        type: "text",
        text: "This is much too wide for a tiny box",
        units: "px",
        rect: { x: 0, y: 0, width: 40, height: 30 },
        typography: {
          fontSize: 20,
          fit: "fixed",
          wrap: "none",
          overflow: "clip",
        },
      },
    ]);
    expect(compile(d).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TEXT_CLIPPED", severity: "warning" }),
      ]),
    );
    d.scenes[0].nodes[0].typography!.overflow = "ellipsis";
    expect(compile(d).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TEXT_TRUNCATED",
          severity: "warning",
        }),
      ]),
    );
  });
});
