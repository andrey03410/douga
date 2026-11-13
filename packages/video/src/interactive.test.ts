import { describe, expect, it } from "vitest";
import {
  applyMatchData,
  compileVideo,
  createVideoDocument,
  getVideoDocumentJsonSchema,
  interactiveLayerSchema,
  matchDataSchema,
  parseVideoDocument,
  slicePlan,
  sourceSceneId,
  interactiveExample,
  interactiveExampleManifest,
  type CompiledVideo,
  type VideoDocument,
} from "./index";

const manifest = interactiveExampleManifest;
const archetypes = interactiveExample;

const texts = (plan: CompiledVideo, nodeId: string) =>
  plan.scenes.flatMap((s) => s.nodes).filter((n) => n.id.endsWith(nodeId)).map((n) => n.text);

describe("interactive layer", () => {
  it("leaves documents without a layer untouched", () => {
    const d = createVideoDocument({ kind: "top" });
    expect(applyMatchData(d, { texts: { x: "y" } })).toBe(d);
    expect(compileVideo(d).plan.interaction).toBeUndefined();
  });

  it("compiles moments, choices and uses with plan-absolute frames", () => {
    const r = compileVideo(archetypes(), manifest);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const question = r.plan.interaction!.scenes.find((s) => s.sourceSceneId === "question-scene" && s.holds.length)!;
    const scene = r.plan.scenes.find((s) => s.id === question.id)!;
    expect(question.holds).toEqual([{ momentId: "wait", frame: scene.from + scene.phases.timerStartFrame! }]);
    expect(question.choices.map((c) => c.participantId).sort()).toEqual(["a", "b", "c"]);
    expect(question.choices.every((c) => c.choiceId === "favourite" && c.cardId)).toBe(true);
    const result = r.plan.interaction!.scenes.filter((s) => s.segmentId === "result");
    expect(result.length).toBe(3);
    expect(result[0].uses).toEqual(["votes", "rank", "texts"]);
    expect(sourceSceneId(result[0].id)).toBe("result-scene");
  });

  it("puts sample data into the linear render and real data into a match compile", () => {
    const d = archetypes();
    const sample = compileVideo(d, manifest).plan;
    expect(texts(sample, "votes").sort()).toEqual(["0 голосов", "1 голосов", "3 голосов"]);
    expect(texts(sample, "headline")).toContain("Ваш общий топ");
    const real = compileVideo(
      applyMatchData(d, {
        participants: { a: { votes: 5, rank: 1 }, b: { votes: 2, rank: 2 }, c: { votes: 0, rank: 3 } },
        texts: { headline: "Итог вечера" },
      }),
      manifest,
    ).plan;
    const ranks = real.scenes
      .filter((s) => s.segmentId === "result")
      .map((s) => [s.participantId, s.nodes.find((n) => n.type === "card")?.rank]);
    expect(ranks).toEqual(expect.arrayContaining([["a", 1], ["b", 2], ["c", 3]]));
    expect(texts(real, "votes")).toContain("5 голосов");
    expect(texts(real, "headline")).toContain("Итог вечера");
    // The authored document keeps its own design and data.
    expect(d.source.participants.find((p) => p.id === "a")?.votes).toBeUndefined();
  });

  it("shows players as participants of a scoreboard template", () => {
    const plan = compileVideo(
      applyMatchData(archetypes(), {
        players: [
          { id: "p1", name: "Аня", score: 4, rank: 2 },
          { id: "p2", name: "Боря", score: 7, rank: 1 },
        ],
      }),
      manifest,
    ).plan;
    const board = plan.scenes.filter((s) => s.segmentId === "board");
    expect(board.map((s) => s.participantId).sort()).toEqual(["player:p1", "player:p2"]);
    const labels = board.flatMap((s) => s.nodes).filter((n) => n.type === "card").map((n) => n.label);
    expect(labels.sort()).toEqual(["Аня", "Боря"]);
  });

  it("names broken references with paths", () => {
    const d = archetypes();
    d.interactive!.moments.push({ id: "nope", sceneId: "missing", at: { event: "scene.start" } });
    d.interactive!.moments.push({ id: "no-timer", sceneId: "board-scene", at: { event: "timer.start" } });
    d.interactive!.choices.push({ id: "ghost", sceneId: "question-scene", cards: ["card-z"] });
    d.interactive!.templates.push({ segmentId: "nowhere", uses: ["votes"] });
    const codes = compileVideo(d, manifest).diagnostics.map((x) => [x.code, x.path]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ["INTERACTIVE_SCENE_NOT_FOUND", "interactive.moments.1.sceneId"],
        ["INTERACTIVE_MOMENT_UNAVAILABLE", "interactive.moments.2.at"],
        ["INTERACTIVE_CARD_NOT_FOUND", "interactive.choices.1.cards"],
        ["INTERACTIVE_SEGMENT_NOT_FOUND", "interactive.templates.2.segmentId"],
      ]),
    );
    expect(compileVideo(d, manifest).ready).toBe(false);
  });

  it("validates the layer and match data strictly", () => {
    expect(parseVideoDocument(archetypes()).interactive?.version).toBe(1);
    expect(interactiveLayerSchema.safeParse({ ...archetypes().interactive, extra: 1 }).success).toBe(false);
    expect(
      matchDataSchema.safeParse({ players: Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, name: "x" })) }).success,
    ).toBe(false);
    expect(
      interactiveLayerSchema.safeParse({
        ...archetypes().interactive,
        templates: [{ segmentId: "a", sceneId: "b", uses: ["votes"] }],
      }).success,
    ).toBe(false);
    expect(JSON.stringify(getVideoDocumentJsonSchema())).toContain("participant.votes");
  });
});

describe("slicePlan", () => {
  it("cuts a standalone plan of one segment without other scenes or their media", () => {
    const full = compileVideo(archetypes(), manifest).plan;
    const segment = full.segments!.find((s) => s.id === "result")!;
    const slice = slicePlan(full, { segmentId: "result" });
    expect(slice.durationInFrames).toBe(segment.to - segment.from);
    expect(slice.scenes[0].from).toBe(0);
    expect(slice.scenes[0].transition.type).toBe("none");
    expect(slice.scenes.every((s) => s.segmentId === "result")).toBe(true);
    expect(slice.segments).toEqual([{ ...full.segments!.find((s) => s.id === "result")!, from: 0, to: slice.durationInFrames }]);
    expect(slice.interaction!.scenes.every((s) => s.from >= 0 && s.to <= slice.durationInFrames)).toBe(true);
    const music = slice.audio.find((cue) => cue.asset.id === "song")!;
    const original = full.audio.find((cue) => cue.asset.id === "song")!;
    expect(music.from).toBe(0);
    expect(music.offsetFrames).toBe(original.offsetFrames + (segment.from - original.from));
    expect(music.durationInFrames).toBeLessThanOrEqual(slice.durationInFrames);
  });

  it("keeps holds on frames of the slice and rejects an empty selection", () => {
    const full = compileVideo(archetypes(), manifest).plan;
    const question = full.interaction!.scenes.find((s) => s.holds.length)!;
    const slice = slicePlan(full, { sceneIds: [question.id] });
    expect(slice.interaction!.scenes[0].holds[0].frame).toBe(question.holds[0].frame - question.from);
    expect(() => slicePlan(full, { sceneIds: ["missing"] })).toThrow("SLICE_EMPTY");
  });
});
