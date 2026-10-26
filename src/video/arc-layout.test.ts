import { describe, expect, it } from "vitest";
import { compileVideo, createVideoDocument, type Rect } from "./index";

function arc(format: "wide" | "vertical" | "square", count = 4) {
  return createVideoDocument({
    kind: "picker",
    presetId: `picker.arc.${format}`,
    roundCount: 1,
    cardsPerRound: count,
  });
}
function rows(rects: Rect[]) {
  const result: Rect[][] = [];
  for (const rect of rects) {
    const row = result.at(-1);
    if (!row || rect.x <= row.at(-1)!.x) result.push([rect]);
    else row.push(rect);
  }
  return result;
}
function expectCurve(rects: Rect[]) {
  const row = rows(rects).find((row) => row.length >= 3);
  expect(
    row,
    "an automatic arc must contain at least three points",
  ).toBeDefined();
  const first = row![0],
    last = row!.at(-1)!;
  const middle = row![Math.floor(row!.length / 2)];
  expect(first.y - middle.y).toBeGreaterThan(middle.height * 0.05);
  expect(last.y).toBeCloseTo(first.y);
}
function expectGeometry(rects: Rect[], width: number, height: number) {
  for (const rect of rects) {
    expect(Object.values(rect).every(Number.isFinite)).toBe(true);
    expect(rect.width).toBeGreaterThan(40);
    expect(rect.height).toBeGreaterThan(40);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.01);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height + 0.01);
  }
  for (let i = 0; i < rects.length; i++)
    for (const b of rects.slice(i + 1)) {
      const a = rects[i];
      expect(
        a.x + a.width <= b.x + 0.01 ||
          b.x + b.width <= a.x + 0.01 ||
          a.y + a.height <= b.y + 0.01 ||
          b.y + b.height <= a.y + 0.01,
      ).toBe(true);
    }
}
function cardRects(document: ReturnType<typeof arc>) {
  const compiled = compileVideo(document);
  expect(compiled.ready).toBe(true);
  return {
    plan: compiled.plan,
    rects: compiled.plan.scenes[0].nodes
      .filter((node) => node.type === "card")
      .map((node) => node.rect),
  };
}

describe("ARC-1: public arc preset geometry", () => {
  it.each(["wide", "vertical", "square"] as const)(
    "curves the built-in four-card %s preset",
    (format) => {
      const { plan, rects } = cardRects(arc(format));
      expect(rects).toHaveLength(4);
      expectCurve(rects);
      expectGeometry(rects, plan.width, plan.height);
    },
  );
  for (const format of ["wide", "vertical", "square"] as const)
    for (const orientation of ["landscape", "portrait"] as const)
      it.each([3, 4, 8, 12])(
        `keeps %i ${orientation} cards curved, sized and disjoint in ${format}`,
        (count) => {
          const document = arc(format, count);
          document.settings.card = { orientation };
          const { plan, rects } = cardRects(document);
          expect(rects).toHaveLength(count);
          expectCurve(rects);
          expectGeometry(rects, plan.width, plan.height);
          for (const rect of rects)
            expect(rect.width / rect.height).toBeCloseTo(
              orientation === "portrait" ? 2 / 3 : 16 / 9,
            );
        },
      );
  it("honors explicit two-column arcs with symmetric pairs", () => {
    const document = arc("wide");
    document.settings.layout = { type: "arc", columns: 2 };
    const { rects } = cardRects(document);
    expect(rows(rects).map((row) => row.length)).toEqual([2, 2]);
    for (const row of rows(rects)) expect(row[0].y).toBe(row[1].y);
  });
  it("uses a symmetric pair when only two cards exist", () => {
    const { plan, rects } = cardRects(arc("vertical", 2));
    expect(rects[0].y).toBe(rects[1].y);
    expect(rects[0].x).toBeCloseTo(plan.width - rects[1].x - rects[1].width);
    expectGeometry(rects, plan.width, plan.height);
  });
  it("retains round-local grid and free placements above the preset", () => {
    const document = arc("square");
    document.source.rounds[0].settings = { layout: { type: "grid" } };
    const { rects } = cardRects(document);
    expect(rows(rects).map((row) => row.length)).toEqual([2, 2]);
    expect(rects[0].y).toBe(rects[1].y);
    document.source.rounds[0].settings = {
      layout: {
        type: "free",
        positions: [
          { x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
          { x: 0.5, y: 0.2, width: 0.2, height: 0.3 },
          { x: 0.1, y: 0.6, width: 0.2, height: 0.3 },
          { x: 0.5, y: 0.6, width: 0.2, height: 0.3 },
        ],
      },
    };
    expect(cardRects(document).rects[0]).toEqual({
      x: 108,
      y: 216,
      width: 216,
      height: 324,
    });
  });
  it("does not cap larger arc rosters", () => {
    const { rects } = cardRects(arc("vertical", 37));
    expect(rects).toHaveLength(37);
    expectCurve(rects);
  });
});
