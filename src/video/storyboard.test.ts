import { describe, expect, it } from "vitest";
import { compileVideo } from "./compiler";
import { createVideoDocument } from "./builders";
import { baseNode } from "./nodes";
import type { CompiledScene, CompiledVideo } from "./types";
import { matchStoryboard, selectStoryboard } from "./storyboard";

function scene(
  id = "s",
  kind: CompiledScene["kind"] = "custom",
  from = 0,
  durationInFrames = 120,
): CompiledScene {
  return {
    id,
    kind,
    from,
    durationInFrames,
    background: "#111",
    nodes: [],
    phases: {},
    transition: { type: "none", durationInFrames: 0 },
  };
}
function plan(scenes: CompiledScene[]): CompiledVideo {
  return {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    seed: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: Math.max(
      0,
      ...scenes.map((s) => s.from + s.durationInFrames),
    ),
    scenes,
    audio: [],
  };
}
function card(id: string, from: number, to: number, labelFrom = from) {
  const n = baseNode(
    id,
    "card",
    { x: 100, y: 100, width: 300, height: 500 },
    to,
  );
  n.visible = [{ from, to }];
  n.labelWindows = [{ from: labelFrom, to }];
  n.label = "Имя";
  return n;
}

describe("semantic storyboard selection", () => {
  it("shows every picker choice before the answer instead of the scene midpoint", () => {
    const s = scene("picker", "picker", 300, 240);
    s.phases = {
      revealStartFrame: 10,
      timerStartFrame: 120,
      answerStartFrame: 150,
    };
    s.nodes = [card("a", 10, 240), card("b", 60, 240), card("c", 120, 240)];
    const t = selectStoryboard(plan([s])).tiles[0];
    expect(t.state).toBe("choice");
    expect(t.localFrame).toBeGreaterThanOrEqual(120);
    expect(t.localFrame).toBeLessThan(150);
    expect(t.frame).toBe(t.localFrame + 300);
    expect(t.timeSec).toBe(t.frame / 30);
  });
  it("waits for a top label and entrance motion to settle", () => {
    const s = scene("top", "top");
    const n = card("card", 0, 120, 85);
    n.motion = [
      {
        name: "fade",
        channel: "enter",
        from: 70,
        durationInFrames: 25,
        window: { from: 0, to: 120 },
        profile: "smooth",
        intensity: 1,
        direction: "up",
      },
    ];
    s.nodes = [n];
    const t = selectStoryboard(plan([s])).tiles[0];
    expect(t.state).toBe("revealed");
    expect(t.localFrame).toBeGreaterThanOrEqual(95);
  });
  it("shows board state after movement and explains custom heuristics", () => {
    const s = scene("board", "board");
    const n = card("c", 0, 120);
    n.animation = [
      {
        property: "x",
        easing: "linear",
        keyframes: [
          { frame: 0, value: 100 },
          { frame: 40, value: 0 },
        ],
      },
    ];
    s.nodes = [n];
    s.boardEvents = [
      { event: "board.place", frame: 0, actionId: "place", cardId: "c" },
    ];
    const r = selectStoryboard(plan([s, scene("custom", "custom", 120)]));
    expect(r.tiles[0].localFrame).toBeGreaterThanOrEqual(40);
    expect(r.tiles[0].state).toBe("board-state");
    expect(r.tiles[1].analysis.method).toBe("heuristic");
    expect(r.tiles[1].analysis.limitations.length).toBeGreaterThan(0);
  });
  it("does not invent a stable pre-answer window in a one-frame picker", () => {
    const s = scene("short", "picker", 50, 1);
    s.phases.answerStartFrame = 0;
    const t = selectStoryboard(plan([s])).tiles[0];
    expect(t.frame).toBe(50);
    expect(t.analysis.limitations).toContain("no-stable-window");
  });
  it("exposes phases, board events, motion and transitions as distinct detailed states", () => {
    const s = scene("detail", "picker");
    s.phases = {
      revealStartFrame: 10,
      timerStartFrame: 40,
      answerStartFrame: 80,
    };
    s.transition = { type: "crossfade", durationInFrames: 8 };
    s.boardEvents = [{ event: "board.place", frame: 20, actionId: "a" }];
    const n = card("n", 10, 120);
    n.animation = [
      {
        property: "x",
        easing: "linear",
        keyframes: [
          { frame: 0, value: 100 },
          { frame: 20, value: 0 },
        ],
      },
    ];
    s.nodes = [n];
    const r = selectStoryboard(plan([s]), {
      mode: "scene",
      sceneId: "detail",
      pageSize: 24,
    });
    expect(r.tiles.map((t) => t.state)).toEqual(
      expect.arrayContaining([
        "choice",
        "reveal",
        "timer",
        "answer",
        "transition:before",
        "transition:during",
        "transition:after",
        "board.place:a:before",
        "board.place:a:during",
        "board.place:a:after",
        "motion:n:animation:x:during",
      ]),
    );
    for (const t of r.tiles)
      (expect(t.localFrame).toBeGreaterThanOrEqual(0),
        expect(t.localFrame).toBeLessThan(120));
    expect(new Set(r.tiles.map((t) => t.id)).size).toBe(r.tiles.length);
  });
  it("paginates long videos without gaps and reports page coverage", () => {
    const p = plan(
      Array.from({ length: 53 }, (_, i) => scene(`s${i}`, "custom", i * 120)),
    );
    const pages = [0, 1, 2, 3, 4].map((page) => selectStoryboard(p, { page }));
    expect(pages.flatMap((p) => p.tiles).map((t) => t.sceneId)).toEqual(
      p.scenes.map((s) => s.id),
    );
    expect(pages[0]).toMatchObject({
      totalScenes: 53,
      scenesCovered: 12,
      remainingScenes: 41,
      totalTiles: 53,
      totalPages: 5,
    });
    expect(pages[4]).toMatchObject({ scenesCovered: 5, remainingScenes: 48 });
    expect(selectStoryboard(p, { page: 7 }).tiles).toEqual([]);
  });
  it("filters segments and rejects unbounded or fractional paging options", () => {
    const a = scene("a"),
      b = scene("b", "custom", 120);
    a.segmentId = "one";
    b.segmentId = "two";
    expect(selectStoryboard(plan([a, b]), { segmentId: "two" })).toMatchObject({
      totalScenes: 1,
      tiles: [{ sceneId: "b" }],
    });
    expect(
      selectStoryboard(plan([a, b]), { sceneId: "missing" }).tiles,
    ).toEqual([]);
    for (const options of [
      { pageSize: 25 },
      { pageSize: 0 },
      { page: -1 },
      { page: 0.5 },
    ])
      expect(() => selectStoryboard(plan([a]), options)).toThrow();
  });
  it.each(["wide", "vertical", "square"] as const)(
    "selects valid semantic frames for real top/picker/board %s plans including v2",
    (format) => {
      for (const kind of ["top", "picker", "board"] as const) {
        const d = createVideoDocument({ kind, format });
        const p = compileVideo(d).plan;
        const count = Math.ceil(p.scenes.length / 24);
        const tiles = Array.from(
          { length: count },
          (_, page) => selectStoryboard(p, { page, pageSize: 24 }).tiles,
        ).flat();
        expect(tiles).toHaveLength(p.scenes.length);
        tiles.forEach((t, i) => {
          expect(t.frame).toBeGreaterThanOrEqual(p.scenes[i].from);
          expect(t.frame).toBeLessThan(
            p.scenes[i].from + p.scenes[i].durationInFrames,
          );
        });
      }
    },
  );
  it("keeps separate answer scenes distinct from picker choices", () => {
    const d = createVideoDocument({
      kind: "picker",
      presetId: "picker.separate-answer.wide",
      roundCount: 1,
    });
    d.source.rounds[0].answer = { cardIds: [d.source.rounds[0].cards[0].id] };
    const p = compileVideo(d).plan,
      tiles = selectStoryboard(p).tiles;
    expect(p.scenes.map((s) => s.kind)).toEqual(["picker", "answer"]);
    expect(tiles.map((t) => t.state)).toEqual(["choice", "answer"]);
    expect(tiles[0].frame).toBeLessThan(p.scenes[1].from);
  });
  it("covers all eight real board families without dropping action or summary scenes", () => {
    for (const family of [
      "tier",
      "kmk",
      "blind-rank",
      "budget-draft",
      "draft",
      "smash-pass",
      "alignment",
      "sort-quiz",
    ]) {
      const d = createVideoDocument({
        kind: "board",
        presetId: `board.${family}.wide`,
      });
      const p = compileVideo(d).plan;
      const tiles = Array.from(
        { length: Math.ceil(p.scenes.length / 24) },
        (_, page) => selectStoryboard(p, { page, pageSize: 24 }).tiles,
      ).flat();
      expect(
        tiles.map((t) => t.sceneId),
        family,
      ).toEqual(p.scenes.map((s) => s.id));
      expect(
        tiles.every((t) => t.state === "board-state"),
        family,
      ).toBe(true);
    }
  });
  it("respects compiled v2 disabled segments and segment-local versus absolute time", () => {
    const d = createVideoDocument({
      kind: "top",
      participants: [{ id: "a", label: "A" }],
    });
    d.schemaVersion = 2;
    d.scenes = [];
    d.segments = [
      {
        id: "intro",
        kind: "custom",
        title: "Вступление",
        scenes: [
          {
            id: "intro-scene",
            block: "custom",
            duration: { frame: 30 },
            nodes: [],
          },
        ],
      },
      {
        id: "disabled",
        kind: "custom",
        title: "Скрыт",
        enabled: false,
        scenes: [
          {
            id: "disabled-scene",
            block: "custom",
            duration: { frame: 90 },
            nodes: [],
          },
        ],
      },
      {
        id: "top",
        kind: "top",
        title: "Топ",
        participantIds: ["a"],
        scenes: [
          { id: "top-scene", block: "top", repeat: "participants", nodes: [] },
        ],
      },
    ];
    const p = compileVideo(d).plan,
      selected = selectStoryboard(p, { segmentId: "top" });
    expect(selected.totalScenes).toBe(1);
    expect(selected.tiles[0].frame).toBe(selected.tiles[0].localFrame + 30);
    expect(selectStoryboard(p, { segmentId: "disabled" }).tiles).toEqual([]);
  });
  it("joins comparison identities before pagination across a long inserted sequence", () => {
    const before = plan(
      Array.from({ length: 27 }, (_, i) => scene(`s${i}`, "top", i * 120)),
    );
    const after = plan([
      scene("added", "top"),
      ...before.scenes.map((s) => ({ ...s, from: s.from + 120 })),
    ]);
    const pairs = [0, 1, 2].flatMap(
      (page) => matchStoryboard(before, after, { page }).pairs,
    );
    expect(pairs).toHaveLength(28);
    expect(pairs.filter((p) => p.before && p.after)).toHaveLength(27);
    expect(new Set(pairs.map((p) => p.id)).size).toBe(28);
  });
  it("keeps semantic comparison pairs despite timing changes, additions and removals", () => {
    const before = plan([scene("kept", "top"), scene("removed", "top", 120)]);
    const after = plan([scene("added", "top"), scene("kept", "top", 120, 240)]);
    const r = matchStoryboard(before, after);
    expect(r.totalPairs).toBe(3);
    const kept = r.pairs.find((p) => p.before?.sceneId === "kept")!;
    expect(kept.after?.sceneId).toBe("kept");
    expect(kept.before?.frame).not.toBe(kept.after?.frame);
    expect(
      r.pairs.some((p) => p.before?.sceneId === "removed" && !p.after),
    ).toBe(true);
    expect(r.pairs.some((p) => !p.before && p.after?.sceneId === "added")).toBe(
      true,
    );
  });
  it("does not pair duplicate scene ids across different v2 segments", () => {
    const a = scene("same"),
      b = scene("same");
    a.segmentId = "one";
    b.segmentId = "two";
    const r = matchStoryboard(plan([a]), plan([b]));
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs.every((p) => !p.before || !p.after)).toBe(true);
  });
  it("waits for the full adjacent entrance rather than halving its duration", () => {
    const s = scene("cross", "top", 0, 120);
    s.transition = { type: "crossfade", durationInFrames: 100 };
    s.nodes = [card("c", 0, 120)];
    expect(
      selectStoryboard(plan([s])).tiles[0].localFrame,
    ).toBeGreaterThanOrEqual(100);
  });
  it("does not call a scene stable while a repeating loop is running", () => {
    const s = scene("loop", "top");
    const n = card("c", 0, 120);
    n.motion = [
      {
        name: "float",
        channel: "loop",
        from: 0,
        durationInFrames: 20,
        window: { from: 0, to: 120 },
        profile: "smooth",
        intensity: 1,
        direction: "up",
      },
    ];
    s.nodes = [n];
    expect(selectStoryboard(plan([s])).tiles[0].analysis.limitations).toContain(
      "no-stable-window",
    );
  });
  it("handles empty plans and zero-frame malformed scenes without illegal frames", () => {
    expect(selectStoryboard(plan([]))).toMatchObject({
      tiles: [],
      totalPages: 0,
    });
    expect(
      selectStoryboard(plan([scene("empty", "custom", 0, 0)])),
    ).toMatchObject({ tiles: [], totalScenes: 1, remainingScenes: 1 });
  });
});
