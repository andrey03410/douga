import { describe, expect, it } from "vitest";
import { applyMatchData, buildVideoContent, compileVideo, getInteractiveRecipes, parseVideoDocument } from "./index";

describe("interactive recipes", () => {
  const recipes = getInteractiveRecipes();
  it("has five flows in three formats with unique ids", () => {
    expect(recipes).toHaveLength(15);
    expect(new Set(recipes.map((r) => r.id)).size).toBe(15);
    expect(recipes.every((r) => r.id === `recipe.interactive.${r.flow}.${r.format}`)).toBe(true);
  });

  it.each(getInteractiveRecipes().map((r) => [r.id, r] as const))("%s compiles ready with interaction", (_id, recipe) => {
    const document = parseVideoDocument(recipe.example);
    const result = compileVideo(document);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.plan.interaction?.scenes.length).toBeGreaterThan(0);
    if (recipe.flow.startsWith("quiz")) {
      const held = result.plan.interaction!.scenes.filter((s) => s.holds.length);
      expect(held.length).toBe(2);
      expect(held.every((s) => s.choices.length > 0)).toBe(true);
    }
    // The short form of the recipe applies to its own example.
    const next = buildVideoContent(document, recipe.contentForm.example as never);
    expect(compileVideo(next).ready).toBe(true);
  });

  it("builds a scoreboard from players and a top from votes", () => {
    const board = getInteractiveRecipes().find((r) => r.flow === "scoreboard")!;
    const plan = compileVideo(
      applyMatchData(board.example, { players: [{ id: "x", name: "Икс", score: 9 }, { id: "y", name: "Игрек", score: 4 }, { id: "z", name: "Зет" }] }),
    ).plan;
    expect(plan.scenes.map((s) => s.participantId).sort()).toEqual(["player:x", "player:y", "player:z"]);
    const top = getInteractiveRecipes().find((r) => r.flow === "vote-result")!;
    const ranked = compileVideo(applyMatchData(top.example, { participants: { a: { votes: 9, rank: 1 }, b: { votes: 1, rank: 3 }, c: { votes: 4, rank: 2 } } })).plan;
    const texts = ranked.scenes.flatMap((s) => s.nodes).map((n) => n.text);
    expect(texts).toContain("9 голосов");
  });

  it("merges, replaces and removes the interactive part of the short form", () => {
    const recipe = getInteractiveRecipes().find((r) => r.id === "recipe.interactive.quiz-question.wide")!;
    const merged = buildVideoContent(recipe.example, {
      kind: "picker",
      mode: "merge",
      interactive: { moments: [{ id: "late", sceneId: "question", at: { event: "answer.reveal" } }] },
    });
    expect(merged.interactive!.moments.map((m) => m.id)).toEqual(["wait", "late"]);
    expect(merged.interactive!.choices).toHaveLength(1);
    const removed = buildVideoContent(recipe.example, { kind: "picker", mode: "merge", interactive: null });
    expect(removed.interactive).toBeUndefined();
    expect(() =>
      buildVideoContent(recipe.example, {
        kind: "picker",
        mode: "merge",
        interactive: { moments: [{ id: "x", sceneId: "question", at: { event: "scene.start" } }, { id: "x", sceneId: "question", at: { event: "scene.end" } }] },
      }),
    ).toThrow("CONTENT_DUPLICATE_ID");
  });
});
