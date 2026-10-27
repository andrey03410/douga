import { describe, it, expect } from "vitest";
import { projectSummary } from "./project-summary";
import type { LoadedProject } from "@/server/projects";

const fake = {
  id: "p1", title: "Персонажи Madhouse", kind: "picker",
  introEnabled: true, introText: null, outroEnabled: false, outroText: "Пока",
  bgArt: null,
  playlist: [{ artId: "a9", art: { label: "OST", durationSec: 164 } }],
  rounds: [
    { id: "r1", order: 0, prompt: "Кто главный?", mode: "single", groups: [],
      tiles: [
        { id: "t1", label: "Лайт", isAnswer: true, artId: "a1" },
        { id: "t2", label: "Рюук", isAnswer: false, artId: "a2" },
      ] },
  ],
} as unknown as LoadedProject;

describe("projectSummary", () => {
  it("projects a loaded project into a compact structure", () => {
    const s = projectSummary(fake);
    expect(s).toEqual({
      id: "p1", title: "Персонажи Madhouse", kind: "picker", url: "/projects/p1",
      // blank intro text falls back to the title; a disabled card reads as null
      intro: "Персонажи Madhouse", outro: null,
      background: null,
      playlist: [{ artId: "a9", label: "OST", durationSec: 164 }],
      playlistSec: 164,
      rounds: [
        { id: "r1", order: 0, prompt: "Кто главный?", mode: "single", groups: [],
          tiles: [
            { id: "t1", label: "Лайт", isAnswer: true, artId: "a1" },
            { id: "t2", label: "Рюук", isAnswer: false, artId: "a2" },
          ] },
      ],
    });
  });

  it("projects the blocks of a group round with their names and the winner", () => {
    const grouped = {
      ...fake,
      rounds: [
        {
          id: "r2", order: 0, prompt: "Кто сильнее?", mode: "groups",
          tiles: [{ id: "c1", label: null, isAnswer: false, artId: "a1", groupId: "g1" }],
          groups: [
            { id: "g1", order: 0, label: "Тройка", isAnswer: false,
              tiles: [{ id: "c1", label: "Лайт", isAnswer: false, artId: "a1" }] },
            { id: "g2", order: 1, label: null, isAnswer: true,
              tiles: [{ id: "c2", label: "Эл", isAnswer: false, artId: "a2" }] },
          ],
        },
      ],
    } as unknown as LoadedProject;
    const s = projectSummary(grouped);
    expect(s.rounds[0].mode).toBe("groups");
    // a grouped card is not repeated as a loose tile
    expect(s.rounds[0].tiles).toEqual([]);
    expect(s.rounds[0].groups.map((g) => ({ label: g.label, isAnswer: g.isAnswer, n: g.tiles.length })))
      .toEqual([
        { label: "Тройка", isAnswer: false, n: 1 },
        { label: null, isAnswer: true, n: 1 },
      ]);
  });

  it("reports the background art and the planned runtime when given one", () => {
    const withBg = {
      ...fake,
      bgArt: { id: "bg1", label: "Нагиса", kind: "image" },
    } as unknown as LoadedProject;
    const s = projectSummary(withBg, { durationSec: 551.9 });
    expect(s.background).toEqual({ artId: "bg1", label: "Нагиса", kind: "image" });
    expect(s.durationSec).toBe(551.9);
  });

  it("names the rounds the render will refuse, and only when there are some", () => {
    expect(projectSummary(fake)).not.toHaveProperty("invalidRounds");
    const lonely = {
      ...fake,
      rounds: [
        ...fake.rounds,
        { id: "r2", order: 1, prompt: null, mode: "single", groups: [],
          tiles: [{ id: "t3", label: null, isAnswer: false, artId: "a3" }] },
        { id: "r3", order: 2, prompt: null, mode: "single", groups: [], tiles: [] },
      ],
    } as unknown as LoadedProject;
    // round 2 has one card (render refuses); empty round 3 is skipped silently
    expect(projectSummary(lonely).invalidRounds).toEqual([2]);
  });
});
