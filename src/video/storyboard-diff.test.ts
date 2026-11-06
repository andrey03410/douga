import { describe, expect, it } from "vitest";
import { compileVideo } from "./compiler";
import { patchVideoDocument } from "./patches";
import { createVideoDocument } from "./builders";
import type { AssetManifest, VideoDocument } from "./types";
import type { MeasureText } from "./typography-types";
import { compareStoryboardDocuments } from "./storyboard-diff";
const measureText: MeasureText = (text, style) => ({
  width: Array.from(text).length * style.fontSize * 0.6,
  fonts: [style.font],
  missing: [],
});
function document(): VideoDocument {
  return {
    schemaVersion: 1,
    id: "diff",
    title: "Сравнение",
    kind: "top",
    seed: 1,
    output: { format: "wide", fps: 30 },
    source: { kind: "manual", participants: [], rounds: [] },
    bindings: {},
    settings: {},
    scenes: [
      {
        id: "scene",
        block: "custom",
        duration: { sec: 5 },
        nodes: [
          {
            id: "label",
            type: "text",
            text: "Имя",
            units: "px",
            rect: { x: 100, y: 100, width: 240, height: 90 },
            typography: {
              role: "label",
              font: "arimo",
              fontSize: 36,
              minFontSize: 20,
              maxLines: 1,
              fit: "fixed",
            },
          },
        ],
      },
    ],
  };
}
function input(d = document(), manifest?: AssetManifest) {
  const r = compileVideo(d, manifest, { measureText });
  return {
    document: d,
    plan: r.plan,
    diagnostics: r.diagnostics,
    ...(manifest ? { manifest } : {}),
  };
}

describe("bounded static storyboard differences", () => {
  it("returns no document deltas for equal data or merely reordered object keys", () => {
    const before = document(),
      after = {
        ...before,
        settings: { ...before.settings },
        output: { fps: 30, format: "wide" as const },
      };
    const r = compareStoryboardDocuments(input(before), input(after));
    expect(r.changes).toEqual([]);
    expect(r.changesTotal).toBe(0);
    expect(r.contentChanged).toBe(false);
    expect(r.totals).toEqual({ resolved: 0, new: 0, remaining: 0 });
    expect(r.coverage.notChecked).toEqual(
      expect.arrayContaining([
        "motion",
        "audio",
        "pixelContrast",
        "renderedFrames",
      ]),
    );
  });
  it("reports real typography patch properties and the measured error it resolves", () => {
    const d = document();
    (d.scenes[0].nodes[0] as { text: string }).text =
      "Длинная подпись персонажа";
    d.scenes[0].nodes[0].typography!.fontSize = 72;
    const next = patchVideoDocument(d, [
      {
        op: "set",
        target: { type: "node", id: "label" },
        path: ["typography", "fontSize"],
        value: 24,
      },
      {
        op: "set",
        target: { type: "node", id: "label" },
        path: ["typography", "maxLines"],
        value: 2,
      },
      {
        op: "set",
        target: { type: "node", id: "label" },
        path: ["typography", "fit"],
        value: "shrink",
      },
    ]);
    const r = compareStoryboardDocuments(input(d), input(next));
    expect(r.changes).toContainEqual({
      path: ["scenes", "scene", "nodes", "label", "typography", "fontSize"],
      label: "Размер текста",
      kind: "changed",
      before: "72",
      after: "24",
    });
    expect(r.resolvedIssues.some((i) => i.code === "TEXT_OVERFLOW")).toBe(true);
    expect(r.newIssues).toEqual([]);
    expect(r.totals.resolved).toBeGreaterThan(0);
    expect(r.contentChanged).toBe(false);
  });
  it("finds new issues and keeps the identity of a remaining issue rather than comparing its message", () => {
    const d = document(),
      after = structuredClone(d);
    after.scenes[0].duration = { sec: 0.1 };
    const r = compareStoryboardDocuments(input(d), input(after));
    expect(r.newIssues.some((i) => i.code === "TEXT_READABLE_WINDOW")).toBe(
      true,
    );
    expect(r.changes.some((c) => c.label === "Длительность")).toBe(true);
    const longer = structuredClone(after);
    (longer.scenes[0].nodes[0] as { text: string }).text = "Другое имя";
    const remaining = compareStoryboardDocuments(input(after), input(longer));
    expect(
      remaining.remainingIssues.some((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toBe(true);
    expect(
      remaining.resolvedIssues.some((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toBe(false);
    expect(
      remaining.newIssues.some((i) => i.code === "TEXT_READABLE_WINDOW"),
    ).toBe(false);
  });
  it("compares ID arrays by identity and reports reordering once without per-node edits", () => {
    const d = document(),
      base = d.scenes[0];
    d.scenes = ["a", "b", "removed"].map((id) => ({
      ...structuredClone(base),
      id,
      nodes: [{ ...structuredClone(base.nodes[0]), id: `node-${id}` }],
    }));
    const after = structuredClone(d);
    after.scenes = [
      after.scenes[1],
      after.scenes[0],
      {
        ...structuredClone(base),
        id: "added",
        nodes: [{ ...structuredClone(base.nodes[0]), id: "node-added" }],
      },
    ];
    const r = compareStoryboardDocuments(input(d), input(after));
    expect(r.changes.map((c) => [c.kind, c.path])).toEqual(
      expect.arrayContaining([
        ["removed", ["scenes", "removed"]],
        ["added", ["scenes", "added"]],
        ["reordered", ["scenes", "$order"]],
      ]),
    );
    expect(r.changes).toHaveLength(3);
    expect(r.contentChanged).toBe(true);
  });
  it("does not report insertion or removal alone as a reorder of retained nodes", () => {
    const d = document(),
      after = structuredClone(d);
    after.scenes.push({
      ...structuredClone(d.scenes[0]),
      id: "added",
      nodes: [],
    });
    expect(
      compareStoryboardDocuments(input(d), input(after)).changes.map(
        (c) => c.kind,
      ),
    ).toEqual(["added"]);
  });
  it("keeps nested v2 segment scene and node IDs in technical paths", () => {
    const d = createVideoDocument({
      kind: "board",
      presetId: "board.tier.wide",
    });
    const next = structuredClone(d);
    next.segments![0].scenes[0].board!.slots[0].label = "Новый слот";
    const r = compareStoryboardDocuments(input(d), input(next));
    expect(
      r.changes.some(
        (c) =>
          JSON.stringify(c.path) ===
          JSON.stringify([
            "segments",
            "board",
            "scenes",
            "main",
            "board",
            "slots",
            "tier-slot-1",
            "label",
          ]),
      ),
    ).toBe(true);
    expect(r.contentChanged).toBe(true);
  });
  it("bounds long property values and counts all changes beyond the visible maximum", () => {
    const d = document(),
      after = structuredClone(d);
    (after.scenes[0].nodes[0] as { text: string }).text =
      "非常に長い名前".repeat(300);
    after.title = "x".repeat(500);
    after.seed = 99;
    const r = compareStoryboardDocuments(input(d), input(after), {
      maxChanges: 1,
    });
    expect(r.changes).toHaveLength(1);
    expect(r.changesTotal).toBe(3);
    expect(r.changesTruncated).toBe(true);
    const all = compareStoryboardDocuments(input(d), input(after));
    expect(
      all.changes.every((c) => c.before.length <= 160 && c.after.length <= 160),
    ).toBe(true);
    expect(all.changes.find((c) => c.path.at(-1) === "text")?.after).toContain(
      "…",
    );
    expect(JSON.stringify(all)).not.toContain("非常に長い名前".repeat(100));
  });
  it("caps every issue category independently while reporting full totals", () => {
    const d = document(),
      after = structuredClone(d);
    after.scenes = Array.from({ length: 8 }, (_, i) => ({
      ...structuredClone(d.scenes[0]),
      id: `short-${i}`,
      duration: { sec: 0.1 },
      nodes: [{ ...structuredClone(d.scenes[0].nodes[0]), id: `text-${i}` }],
    }));
    const r = compareStoryboardDocuments(input(d), input(after), {
      maxIssues: 2,
    });
    expect(r.newIssues).toHaveLength(2);
    expect(r.totals.new).toBe(8);
    expect(r.newIssues.every((i) => i.message.length <= 160)).toBe(true);
    expect(r.coverage.after.examinedScenes).toBe(8);
  });
  it("marks media bytes changed without inventing a visual regression or comparing storage URLs", () => {
    const d = document(),
      first = {
        art: {
          id: "art",
          kind: "image" as const,
          src: "/old-location.png",
          hash: "a".repeat(64),
          width: 100,
          height: 100,
        },
      };
    const relocated = {
      art: { ...first.art, src: "/copied-frozen-location.png" },
    };
    expect(
      compareStoryboardDocuments(input(d, first), input(d, relocated))
        .contentChanged,
    ).toBe(false);
    const changed = { art: { ...relocated.art, hash: "b".repeat(64) } };
    const r = compareStoryboardDocuments(input(d, first), input(d, changed));
    expect(r.contentChanged).toBe(true);
    expect(r.changes).toContainEqual(
      expect.objectContaining({
        path: ["manifest", "art", "hash"],
        label: "Содержимое медиа",
        kind: "changed",
      }),
    );
    expect(r.totals).toEqual({ resolved: 0, new: 0, remaining: 0 });
    expect(r.coverage.notChecked).toContain("pixelContrast");
  });
  it("does not invent media removal when one manifest was not supplied", () => {
    const d = document(),
      manifest = {
        art: {
          id: "art",
          kind: "image" as const,
          src: "/art.png",
          hash: "a".repeat(64),
        },
      };
    const r = compareStoryboardDocuments(input(d, manifest), input(d));
    expect(r.contentChanged).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.coverage.notChecked).toContain("mediaContent");
  });
  it("uses the same explicit safe-area profile on both sides", () => {
    const d = document(),
      after = structuredClone(d);
    d.scenes[0].nodes[0].rect!.x = 0;
    const r = compareStoryboardDocuments(input(d), input(after), {
      profile: { safeArea: { x: 50, y: 50, width: 1800, height: 980 } },
    });
    expect(r.resolvedIssues.some((i) => i.code === "TEXT_SAFE_AREA")).toBe(
      true,
    );
    expect(r.contentChanged).toBe(false);
  });
  it("defaults to fifty property changes and still counts later style edits", () => {
    const d = document();
    d.scenes[0].nodes = Array.from({ length: 55 }, (_, i) => ({
      ...structuredClone(d.scenes[0].nodes[0]),
      id: `n${i}`,
    }));
    const after = structuredClone(d);
    after.scenes[0].nodes.forEach((n) => {
      n.typography!.fontSize = 30;
    });
    const r = compareStoryboardDocuments(input(d), input(after));
    expect(r.changes).toHaveLength(50);
    expect(r.changesTotal).toBe(55);
    expect(r.changesTruncated).toBe(true);
    expect(r.contentChanged).toBe(false);
  });
  it("excerpts long issue messages without including diagnostic evidence or proposed operations", () => {
    const before = input(),
      after = input();
    after.diagnostics = [
      {
        severity: "warning",
        code: "EXTERNAL_RISK",
        message: "Длинное сообщение ".repeat(100),
        path: "document",
      },
    ];
    const r = compareStoryboardDocuments(before, after);
    expect(r.newIssues).toHaveLength(1);
    expect(r.newIssues[0].message.length).toBeLessThanOrEqual(160);
    expect(r.newIssues[0]).not.toHaveProperty("evidence");
    expect(r.newIssues[0]).not.toHaveProperty("operations");
    expect(r.newIssues[0].message).toContain("…");
  });
  it("treats undefined fields as absent and rejects unbounded requested output", () => {
    const d = document(),
      after = structuredClone(d);
    after.scenes[0].nodes[0].typography!.plate = undefined;
    expect(compareStoryboardDocuments(input(d), input(after)).changes).toEqual(
      [],
    );
    for (const options of [
      { maxChanges: 51 },
      { maxIssues: 51 },
      { maxChanges: 0 },
      { maxIssues: -1 },
      { maxIssues: 1.5 },
    ])
      expect(() =>
        compareStoryboardDocuments(input(d), input(after), options),
      ).toThrow();
  });
});
