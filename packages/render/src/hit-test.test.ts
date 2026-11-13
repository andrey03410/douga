import { describe, expect, it } from "vitest";
import { compileVideo, interactiveExample, interactiveExampleManifest } from "@douga/video";
import { choiceRects, hitTest } from "./hit-test";

describe("hitTest", () => {
  const plan = compileVideo(interactiveExample(), interactiveExampleManifest).plan;
  const question = plan.interaction!.scenes.find((s) => s.holds.length)!;
  const hold = question.holds[0].frame;

  it("finds every pressable card on the hold frame and maps a press to it", () => {
    const rects = choiceRects(plan, hold);
    expect(rects.map((r) => r.participantId).sort()).toEqual(["a", "b", "c"]);
    for (const r of rects) {
      const centre = { x: r.rect.x + r.rect.width / 2, y: r.rect.y + r.rect.height / 2 };
      expect(hitTest(plan, hold, centre)).toMatchObject({ choiceId: "favourite", participantId: r.participantId, cardId: r.cardId });
    }
  });

  it("ignores empty space, other scenes and cards that are not on screen yet", () => {
    expect(hitTest(plan, hold, { x: 1, y: 1 })).toBeNull();
    const result = plan.scenes.find((s) => s.segmentId === "result")!;
    expect(choiceRects(plan, result.from + 1)).toEqual([]);
    expect(choiceRects(plan, question.from).length).toBeLessThan(3);
  });
});
