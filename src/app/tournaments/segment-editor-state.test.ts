import { describe, it, expect } from "vitest";
import {
  moveSelectedTracks,
  groupTracksByAlbum,
  moveItem,
} from "./segment-editor-state";

describe("segment editor transactions", () => {
  it("moves selected tracks once and preserves every other assignment", () => {
    const source = [
      { id: "a", title: "A", trackIds: ["1", "2"] },
      { id: "b", title: "B", trackIds: ["3", "4"] },
    ];
    const result = moveSelectedTracks(source, ["2", "3", "3"], "b");
    expect(result.map((s) => s.trackIds)).toEqual([["1"], ["4", "2", "3"]]);
    expect(source[0].trackIds).toEqual(["1", "2"]);
    expect(new Set(result.flatMap((s) => s.trackIds)).size).toBe(4);
  });
  it("cannot lose selected tracks if the target was removed", () => {
    const source = [{ id: "a", title: "A", trackIds: ["1", "2"] }];
    expect(moveSelectedTracks(source, ["1"], "gone")).toEqual(source);
  });
  it("groups by real album and keeps untagged tracks together", () => {
    const result = groupTracksByAlbum([
      { id: "1", album: "Episode 1" },
      { id: "2", album: null },
      { id: "3", album: "Episode 1" },
      { id: "4", album: "Episode 2" },
    ]);
    expect(
      result.map((s) => ({ title: s.title, trackIds: s.trackIds })),
    ).toEqual([
      { title: "Episode 1", trackIds: ["1", "3"] },
      { title: "Без альбома", trackIds: ["2"] },
      { title: "Episode 2", trackIds: ["4"] },
    ]);
  });
  it("moves any result directly to the requested rank", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});
