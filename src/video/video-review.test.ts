import { describe, expect, it } from "vitest";
import { compileVideo } from "./compiler";
import { createVideoDocument } from "./builders";
import { patchVideoDocument } from "./patches";
import type { MeasureText } from "./typography-types";
import type { VideoDocument, VideoNode } from "./types";
import { reviewVideo } from "./video-review";
const measureText: MeasureText = (text, style) => ({
  width:
    Array.from(text).length *
    style.fontSize *
    (style.font === "oswald" ? 0.3 : 0.6),
  fonts: [style.font],
  missing: text.includes("\uFFFF") ? ["\uFFFF"] : [],
});
function doc(nodes?: VideoNode[]): VideoDocument {
  return {
    schemaVersion: 1,
    id: "review",
    title: "Проверка",
    kind: "top",
    seed: 1,
    output: { format: "wide", fps: 30 },
    source: { kind: "manual", participants: [], rounds: [] },
    bindings: {},
    settings: { typography: { theme: "clean" } },
    scenes: [
      {
        id: "scene",
        block: "custom",
        duration: { sec: 5 },
        nodes: nodes ?? [
          {
            id: "label",
            type: "text",
            text: "Длинная подпись персонажа для проверки",
            units: "px",
            rect: { x: 100, y: 100, width: 240, height: 65 },
            typography: {
              role: "label",
              font: "arimo",
              fontSize: 36,
              minFontSize: 20,
              fit: "fixed",
              maxLines: 1,
            },
          },
        ],
      },
    ],
  };
}
const review = (
  d: VideoDocument,
  profile?: Parameters<typeof reviewVideo>[3],
) => {
  const r = compileVideo(d, {}, { measureText });
  return reviewVideo(r.plan, r.diagnostics, d, profile);
};

describe("explainable static video review", () => {
  it("reports measured overflow once with stable identity and actual scene frame", () => {
    const d = doc(),
      r = review(d),
      issue = r.issues.find((i) => i.code === "TEXT_OVERFLOW")!;
    expect(issue).toMatchObject({
      severity: "error",
      sceneId: "scene",
      nodeId: "scene/node/label",
    });
    expect(issue.frame).toBeGreaterThanOrEqual(0);
    expect(issue.evidence).toHaveProperty("rule");
    expect(r.issues.filter((i) => i.code === "TEXT_OVERFLOW")).toHaveLength(1);
    expect(review(d).issues.map((i) => i.id)).toEqual(
      r.issues.map((i) => i.id),
    );
  });
  it("reports measured missing glyphs as factual errors and keeps intentional clipping a warning", () => {
    const d = doc();
    (d.scenes[0].nodes[0] as any).text += "\uFFFF";
    d.scenes[0].nodes[0].typography!.overflow = "clip";
    const r = review(d);
    expect(r.issues.find((i) => i.code === "FONT_GLYPH_MISSING")).toMatchObject(
      { severity: "error", evidence: { missing: ["\uFFFF"] } },
    );
    expect(r.issues.find((i) => i.code === "TEXT_CLIPPED")).toMatchObject({
      severity: "warning",
    });
    expect(r.issues.some((i) => i.code === "TEXT_OVERFLOW")).toBe(false);
  });
  it("offers a real stable authoring node patch that resolves the compact label fixture", () => {
    const d = doc(),
      r = review(d);
    const fix = r.suggestions.find((s) => s.kind === "compact-label")!;
    expect(fix).toBeDefined();
    expect(fix.risk).toBe("low");
    expect(fix.operations[0].target).toEqual({ type: "node", id: "label" });
    const patched = patchVideoDocument(d, fix.operations),
      after = review(patched);
    expect(after.issues.some((i) => i.code === "TEXT_OVERFLOW")).toBe(false);
    expect((patched.scenes[0].nodes[0] as any).text).toBe(
      (d.scenes[0].nodes[0] as any).text,
    );
    expect(patched.source).toEqual(d.source);
    expect(patched.bindings).toEqual(d.bindings);
  });
  it("does not invent compact fixes for Japanese text or incompatible fit groups", () => {
    for (const change of ["日本語の長い人物名", "group"]) {
      const d = doc();
      if (change === "group")
        d.scenes[0].nodes[0].typography!.fitGroup = "shared";
      else (d.scenes[0].nodes[0] as any).text += change;
      expect(
        review(d).suggestions.some((s) => s.kind === "compact-label"),
      ).toBe(false);
    }
  });
  it("does not patch a generated node id or silently change every repeat", () => {
    const d = doc();
    d.source.participants = [
      { id: "a", label: "А" },
      { id: "b", label: "Б" },
    ];
    d.scenes[0].repeat = "participants";
    const r = review(d);
    expect(r.issues.some((i) => i.code === "TEXT_OVERFLOW")).toBe(true);
    expect(r.suggestions).toEqual([]);
    expect(
      r.issues.find((i) => i.code === "TEXT_OVERFLOW")?.nextAction,
    ).toMatchObject({ type: "text_inspect" });
  });
  it("does not misidentify repeated container children as real authoring IDs", () => {
    const d = doc();
    d.source.participants = [{ id: "a", label: "А" }];
    d.scenes[0].nodes = [
      {
        id: "repeat",
        type: "container",
        repeat: "participants",
        children: d.scenes[0].nodes,
      },
    ];
    const r = review(d);
    expect(r.suggestions).toEqual([]);
  });
  it("scopes a generated top label fix to its real participant without touching others", () => {
    const d = createVideoDocument({
      kind: "top",
      participants: [
        { id: "a", label: "Длинное имя ".repeat(35) },
        { id: "b", label: "Б" },
      ],
    });
    d.settings.typography = {
      theme: "clean",
      roles: {
        label: { fontSize: 36, minFontSize: 20, fit: "fixed", maxLines: 1 },
      },
    };
    const r = review(d),
      fix = r.suggestions.find((s) => s.kind === "compact-label")!;
    expect(fix.operations[0].target).toEqual({ type: "participant", id: "a" });
    const patched = patchVideoDocument(d, fix.operations);
    expect(patched.source.participants[1]).toEqual(d.source.participants[1]);
  });
  it("warns about a chosen safe area and short stable reading windows without treating overlaps as errors", () => {
    const d = doc([
      {
        id: "caption",
        type: "text",
        text: "Слишком длинный текст для очень короткого времени",
        units: "px",
        rect: { x: 0, y: 0, width: 500, height: 100 },
        timing: { duration: { frame: 10 } },
        typography: { role: "caption", fontSize: 20 },
      },
      { id: "background", type: "shape", shape: "rect", fill: "#111111" },
    ]);
    const r = review(d, {
      safeArea: { x: 100, y: 100, width: 1720, height: 880 },
    });
    expect(r.issues.find((i) => i.code === "TEXT_SAFE_AREA")).toMatchObject({
      severity: "warning",
    });
    expect(
      r.issues.find((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toMatchObject({ severity: "warning" });
    expect(r.issues.some((i) => /OVERLAP/.test(i.code))).toBe(false);
    expect(r.checks.find((c) => c.id === "motion")?.status).toBe("notChecked");
    expect(r.checks.find((c) => c.code === "audio")?.status).toBe("notChecked");
  });
  it("uses label windows rather than whole scene duration and never flags intentional hidden labels", () => {
    const d = createVideoDocument({
      kind: "top",
      participants: [{ id: "a", label: "Достаточно длинное имя персонажа" }],
    });
    d.settings.labels = { holdSec: 0.1 };
    expect(
      review(d).issues.some((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toBe(true);
    d.settings.labels = { mode: "never" };
    expect(
      review(d).issues.some((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toBe(false);
  });
  it("proposes a subtitle plate only for an actual visual underlay with known compatible styling", () => {
    const d = doc([
      { id: "art", type: "image", asset: "art", layer: -1 },
      {
        id: "subtitle",
        type: "text",
        text: "Подпись",
        layer: 1,
        units: "px",
        rect: { x: 200, y: 800, width: 800, height: 100 },
        typography: {
          role: "subtitle",
          font: "arimo",
          fontSize: 30,
          minFontSize: 20,
          fill: "#ffffff",
          plate: null,
        },
      },
    ]);
    const compiled = compileVideo(
      d,
      { art: { id: "art", kind: "image", src: "/art.png" } },
      { measureText },
    );
    const r = reviewVideo(compiled.plan, compiled.diagnostics, d),
      fix = r.suggestions.find((s) => s.kind === "subtitle-plate")!;
    expect(fix).toBeDefined();
    expect(
      patchVideoDocument(d, fix.operations).scenes[0].nodes[1].typography
        ?.plate,
    ).not.toBeNull();
    expect(
      r.issues.find((i) => i.code === "TEXT_BACKGROUND_RISK")?.severity,
    ).toBe("warning");
    expect(
      review(doc()).suggestions.some((s) => s.kind === "subtitle-plate"),
    ).toBe(false);
  });
  it("can return a local label override to the selected theme without changing role or content", () => {
    const d = doc();
    const r = review(d),
      fix = r.suggestions.find((s) => s.kind === "return-label-theme")!;
    expect(fix).toBeDefined();
    const patched = patchVideoDocument(d, fix.operations);
    expect(patched.scenes[0].nodes[0].typography).toEqual({ role: "label" });
    expect(
      review(patched).issues.some((i) => i.code === "LABEL_THEME_OVERRIDE"),
    ).toBe(false);
  });
  it("leaves unavailable layout and unspecified safe area notChecked with examined coverage", () => {
    const d = doc();
    d.settings = {};
    d.scenes[0].nodes[0].typography = undefined;
    const result = compileVideo(d),
      r = reviewVideo(result.plan, result.diagnostics, d);
    expect(r.checks.find((c) => c.code === "layout")?.status).toBe(
      "notChecked",
    );
    expect(r.checks.find((c) => c.code === "textSafeArea")?.status).toBe(
      "notChecked",
    );
    expect(r.coverage).toMatchObject({
      totalScenes: 1,
      examinedScenes: 1,
      mode: "static-plan",
    });
    expect(r.checks.find((c) => c.code === "motion")?.examinedFrames).toEqual(
      [],
    );
  });
  it("maps diagnostic errors outside layout and v2 scene identity without mutating the document", () => {
    const d = createVideoDocument({
        kind: "board",
        presetId: "board.tier.vertical",
      }),
      original = structuredClone(d),
      compiled = compileVideo(d);
    const s = compiled.plan.scenes[0];
    const diagnostics = [
      {
        severity: "error" as const,
        code: "ASSET_NOT_FOUND",
        message: "Нет файла",
        path: "bindings.missing",
        nodeId: s.nodes[0].id,
      },
    ];
    const r = reviewVideo(compiled.plan, diagnostics, d);
    expect(r.issues.find((i) => i.code === "ASSET_NOT_FOUND")).toMatchObject({
      severity: "error",
      sceneId: s.id,
      segmentId: s.segmentId,
    });
    expect(d).toEqual(original);
  });
  it("counts a loop's whole visibility window when estimating stable reading time", () => {
    const d = doc();
    (d.scenes[0].nodes[0] as any).text = "Имя";
    d.scenes[0].nodes[0].motion = {
      loop: { name: "float", duration: { frame: 10 } },
    };
    const issue = review(d).issues.find(
      (i) => i.code === "TEXT_READABLE_WINDOW",
    );
    expect(issue?.evidence.availableSec).toBe(0);
  });
  it("connects issues to real suggestion ids and never marks suggestions already resolved", () => {
    const r = review(doc());
    const issue = r.issues.find((i) => i.code === "TEXT_OVERFLOW")!;
    expect(issue.suggestionIds).toEqual(
      expect.arrayContaining([
        r.suggestions.find((s) => s.kind === "compact-label")!.id,
      ]),
    );
    expect(r.suggestions.every((s) => s.requiresRecheck)).toBe(true);
  });
  it("rejects malformed review profiles instead of silently skipping coverage", () => {
    expect(() => review(doc(), { minReadableSec: -1 })).toThrow();
    expect(() =>
      review(doc(), { safeArea: { x: 0, y: 0, width: -1, height: 30 } }),
    ).toThrow();
  });
});
