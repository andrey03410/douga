import { describe, it, expect } from "vitest";
import {
  usageBreakdown,
  describeUsage,
  describeDeletion,
  sumUsage,
  pluralRu,
} from "./art-usage";

describe("usageBreakdown", () => {
  it("counts only studio references", () => {
    expect(usageBreakdown({ studioReferences: 2 })).toEqual({
      studio: 2,
      total: 2,
    });
  });

  it("is all zeros for unused media", () => {
    expect(usageBreakdown({ studioReferences: 0 })).toEqual({
      studio: 0,
      total: 0,
    });
  });
});

describe("describeUsage", () => {
  it("says plainly that nothing uses the media", () => {
    expect(describeUsage(usageBreakdown({ studioReferences: 0 }))).toBe(
      "не используется",
    );
  });

  it("names studio references with the right plural", () => {
    expect(describeUsage(usageBreakdown({ studioReferences: 1 }))).toBe(
      "1 ссылка в проектах Studio",
    );
    expect(describeUsage(usageBreakdown({ studioReferences: 2 }))).toBe(
      "2 ссылки в проектах Studio",
    );
    expect(describeUsage(usageBreakdown({ studioReferences: 5 }))).toBe(
      "5 ссылок в проектах Studio",
    );
  });
});

describe("describeDeletion", () => {
  it("blocks deletion while a studio project still points at the media", () => {
    expect(describeDeletion(usageBreakdown({ studioReferences: 1 }))).toBe(
      "Удаление недоступно: медиа используется в черновиках или версиях Studio",
    );
  });

  it("is empty when there is nothing to warn about", () => {
    expect(describeDeletion(usageBreakdown({ studioReferences: 0 }))).toBe("");
  });
});

describe("sumUsage", () => {
  it("adds up the breakdowns of a selection", () => {
    const a = usageBreakdown({ studioReferences: 2 });
    const b = usageBreakdown({ studioReferences: 1 });
    expect(sumUsage([a, b])).toEqual({ studio: 3, total: 3 });
    expect(describeDeletion(sumUsage([a, b]))).toBe(
      "Удаление недоступно: медиа используется в черновиках или версиях Studio",
    );
  });

  it("is all zeros for an empty selection", () => {
    expect(sumUsage([])).toEqual({ studio: 0, total: 0 });
  });
});

describe("pluralRu", () => {
  it("picks the Russian form by the number", () => {
    const files: [string, string, string] = ["файл", "файла", "файлов"];
    expect(pluralRu(1, files)).toBe("файл");
    expect(pluralRu(2, files)).toBe("файла");
    expect(pluralRu(5, files)).toBe("файлов");
    expect(pluralRu(11, files)).toBe("файлов");
    expect(pluralRu(21, files)).toBe("файл");
    expect(pluralRu(112, files)).toBe("файлов");
    expect(pluralRu(0, files)).toBe("файлов");
  });
});

it("counts tournament covers and posters and explains their deletion protection", () => {
  const usage = usageBreakdown({
    studioReferences: 0,
    trackCovers: 1,
    segmentPosters: 1,
  });
  expect(usage).toEqual({ studio: 0, tournament: 2, total: 2 });
  expect(describeUsage(usage)).toBe("2 ссылки в турнирах");
  expect(describeDeletion(usage)).toContain("турнирах");
  expect(sumUsage([usage, { studio: 1, total: 1 }])).toEqual({
    studio: 1,
    tournament: 2,
    total: 3,
  });
});
