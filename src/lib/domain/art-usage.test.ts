import { describe, it, expect } from "vitest";
import {
  usageBreakdown,
  describeUsage,
  describeDeletion,
  sumUsage,
  pluralRu,
} from "./art-usage";

const counts = {
  renderItems: 0,
  audioRenderItems: 0,
  pickerTiles: 0,
  playlistItems: 0,
  projectBgs: 0,
  projectMusics: 0,
  roundBgs: 0,
  roundMusics: 0,
};

describe("usageBreakdown", () => {
  it("groups the relation counts into what a user recognizes", () => {
    expect(
      usageBreakdown({
        ...counts,
        renderItems: 2,
        audioRenderItems: 1,
        pickerTiles: 3,
        playlistItems: 4,
        projectBgs: 1,
        projectMusics: 1,
        roundBgs: 2,
        roundMusics: 1,
      }),
    ).toEqual({
      positions: 2,
      audioPositions: 1,
      cards: 3,
      playlist: 4,
      backgrounds: 5,
      total: 15,
    });
  });

  it("is all zeros for unused media", () => {
    expect(usageBreakdown(counts)).toEqual({
      positions: 0,
      audioPositions: 0,
      cards: 0,
      playlist: 0,
      backgrounds: 0,
      total: 0,
    });
  });
});

describe("describeUsage", () => {
  it("says plainly that nothing uses the media", () => {
    expect(describeUsage(usageBreakdown(counts))).toBe("не используется");
  });

  it("lists every kind of use with the right plural", () => {
    expect(describeUsage(usageBreakdown({ ...counts, pickerTiles: 1 }))).toBe("1 карточка в раунде");
    expect(describeUsage(usageBreakdown({ ...counts, pickerTiles: 3 }))).toBe(
      "3 карточки в раундах",
    );
    expect(describeUsage(usageBreakdown({ ...counts, pickerTiles: 5 }))).toBe(
      "5 карточек в раундах",
    );
    expect(describeUsage(usageBreakdown({ ...counts, renderItems: 1 }))).toBe("1 позиция топа");
    expect(describeUsage(usageBreakdown({ ...counts, renderItems: 2 }))).toBe("2 позиции топа");
    // a manual-top position that sounds with this media is still a top position
    expect(describeUsage(usageBreakdown({ ...counts, audioRenderItems: 1 }))).toBe(
      "1 позиция топа",
    );
    expect(
      describeUsage(usageBreakdown({ ...counts, renderItems: 3, audioRenderItems: 2 })),
    ).toBe("5 позиций топа");
    expect(describeUsage(usageBreakdown({ ...counts, playlistItems: 7 }))).toBe(
      "7 треков в плейлистах",
    );
    expect(describeUsage(usageBreakdown({ ...counts, projectBgs: 1 }))).toBe("1 фон");
    expect(describeUsage(usageBreakdown({ ...counts, roundMusics: 4 }))).toBe("4 фона");
  });

  it("joins several kinds of use in one line", () => {
    expect(
      describeUsage(usageBreakdown({ ...counts, pickerTiles: 2, renderItems: 1, projectBgs: 1 })),
    ).toBe("2 карточки в раундах, 1 позиция топа, 1 фон");
  });
});

describe("describeDeletion", () => {
  it("spells out the consequences, not just the count", () => {
    // cards and playlist entries disappear with the media (cascade), positions
    // are only freed — the difference is what the user needs to know
    expect(describeDeletion(usageBreakdown({ ...counts, pickerTiles: 3 }))).toBe(
      "3 карточки в раундах будут удалены",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, playlistItems: 2 }))).toBe(
      "2 трека выпадут из плейлистов",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, renderItems: 1 }))).toBe(
      "1 позиция топа освободится",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, roundBgs: 2 }))).toBe("2 фона сбросятся");
    expect(
      describeDeletion(usageBreakdown({ ...counts, pickerTiles: 1, renderItems: 2, projectBgs: 1 })),
    ).toBe("1 карточка в раунде будет удалена, 2 позиции топа освободятся, 1 фон сбросится");
  });

  it("says a manual-top position goes away with the media it sounds with", () => {
    // RenderItem.audioArtId cascades: the position itself is deleted, not freed
    expect(describeDeletion(usageBreakdown({ ...counts, audioRenderItems: 1 }))).toBe(
      "1 позиция ручного топа будет удалена",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, audioRenderItems: 3 }))).toBe(
      "3 позиции ручного топа будут удалены",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, audioRenderItems: 11 }))).toBe(
      "11 позиций ручного топа будут удалены",
    );
    expect(describeDeletion(usageBreakdown({ ...counts, audioRenderItems: 21 }))).toBe(
      "21 позиция ручного топа будет удалена",
    );
  });

  it("keeps freed and deleted positions apart", () => {
    expect(
      describeDeletion(
        usageBreakdown({ ...counts, pickerTiles: 2, renderItems: 1, audioRenderItems: 2 }),
      ),
    ).toBe(
      "2 карточки в раундах будут удалены, 2 позиции ручного топа будут удалены, " +
        "1 позиция топа освободится",
    );
  });

  it("is empty when there is nothing to warn about", () => {
    expect(describeDeletion(usageBreakdown(counts))).toBe("");
  });
});

describe("sumUsage", () => {
  it("adds up the breakdowns of a selection", () => {
    const a = usageBreakdown({ ...counts, pickerTiles: 2, renderItems: 1 });
    const b = usageBreakdown({ ...counts, pickerTiles: 1, playlistItems: 3, audioRenderItems: 2 });
    expect(sumUsage([a, b])).toEqual({
      positions: 1,
      audioPositions: 2,
      cards: 3,
      playlist: 3,
      backgrounds: 0,
      total: 9,
    });
    expect(describeDeletion(sumUsage([a, b]))).toBe(
      "3 карточки в раундах будут удалены, 2 позиции ручного топа будут удалены, " +
        "3 трека выпадут из плейлистов, 1 позиция топа освободится",
    );
  });

  it("is all zeros for an empty selection", () => {
    expect(sumUsage([])).toEqual({
      positions: 0,
      audioPositions: 0,
      cards: 0,
      playlist: 0,
      backgrounds: 0,
      total: 0,
    });
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
