import { describe, expect, it } from "vitest";
import { compileVideo, createVideoDocument } from "./index";
import type { VideoFormat } from "./types";

function grouped(format: VideoFormat, orientation: "landscape" | "portrait") {
  const document = createVideoDocument({
    kind: "picker",
    format,
    participants: Array.from({ length: 5 }, (_, index) => ({
      id: `p${index}`,
      label: `P${index}`,
    })),
    rounds: [
      {
        id: "r",
        cards: Array.from({ length: 5 }, (_, index) => ({
          id: `c${index}`,
          participantId: `p${index}`,
        })),
        groups: [
          { id: "a", cardIds: ["c0", "c1", "c2"] },
          { id: "b", cardIds: ["c3", "c4"] },
        ],
      },
    ],
  });
  document.settings.card = { orientation };
  document.settings.layout = { type: "grid", gap: 20, padding: 20 };
  return document;
}
describe("asymmetric grouped renderer geometry", () => {
  // Catches independently maximizing each panel: 3-vs-2 must not favor two larger cards.
  for (const format of ["wide", "vertical", "square"] as const) {
    for (const orientation of ["landscape", "portrait"] as const) {
      it(`uses one automatic card size for 3-vs-2 in ${format}/${orientation}`, () => {
        const result = compileVideo(grouped(format, orientation));
        expect(result.ready).toBe(true);
        const nodes = result.plan.scenes[0].nodes;
        const cards = nodes.filter((node) => node.type === "card");
        expect(cards).toHaveLength(5);
        for (const card of cards) {
          expect(card.rect.width).toBeCloseTo(cards[0].rect.width, 6);
          expect(card.rect.height).toBeCloseTo(cards[0].rect.height, 6);
          expect(card.rect.width / card.rect.height).toBeCloseTo(
            orientation === "portrait" ? 2 / 3 : 16 / 9,
            6,
          );
          const panel = nodes.find(
            (node) => node.type === "group" && node.groupId === card.groupId,
          )!;
          expect(card.rect.x).toBeGreaterThanOrEqual(panel.rect.x);
          expect(card.rect.y).toBeGreaterThanOrEqual(panel.rect.y);
          expect(card.rect.x + card.rect.width).toBeLessThanOrEqual(
            panel.rect.x + panel.rect.width + 0.001,
          );
          expect(card.rect.y + card.rect.height).toBeLessThanOrEqual(
            panel.rect.y + panel.rect.height + 0.001,
          );
        }
      });
    }
  }
  it("retains explicit free positions and group orientation overrides", () => {
    const document = grouped("wide", "landscape");
    document.source.rounds[0].groups![1].settings = {
      layout: {
        type: "free",
        positions: [
          { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
          { x: 0.1, y: 0.5, width: 0.8, height: 0.2 },
        ],
      },
    };
    let nodes = compileVideo(document).plan.scenes[0].nodes;
    const panel = nodes.find(
      (node) => node.type === "group" && node.groupId === "b",
    )!;
    const free = nodes.find((node) => node.cardId === "c3")!;
    expect(free.rect.width).toBeCloseTo(panel.rect.width * 0.8, 6);
    expect(free.rect.height).toBeCloseTo(panel.rect.height * 0.84 * 0.2, 6);
    document.source.rounds[0].groups![1].settings = {
      card: { orientation: "portrait" },
    };
    nodes = compileVideo(document).plan.scenes[0].nodes;
    const overridden = nodes.find((node) => node.cardId === "c3")!;
    expect(overridden.rect.width / overridden.rect.height).toBeCloseTo(
      2 / 3,
      6,
    );
    expect(
      nodes.find((node) => node.cardId === "c0")!.rect.width /
        nodes.find((node) => node.cardId === "c0")!.rect.height,
    ).toBeCloseTo(16 / 9, 6);
  });
});
