import { createVideoDocument, textNode } from "./builders";
import type { AssetManifest, VideoDocument } from "./types";

/**
 * A small interactive document: a question with three cards and a hold on the timer,
 * a top by votes and a scoreboard of players. Used by tests, examples and hosts.
 */
export const interactiveExampleManifest: AssetManifest = {
  a: { id: "a", kind: "image", src: "a.png", width: 100, height: 100 },
  b: { id: "b", kind: "image", src: "b.png", width: 100, height: 100 },
  c: { id: "c", kind: "image", src: "c.png", width: 100, height: 100 },
  song: { id: "song", kind: "audio", src: "song.wav", durationSec: 120 },
};

/** Archetypes: a question with three cards, a top by votes and a scoreboard. */
export function interactiveExample(): VideoDocument {
  const d = createVideoDocument({
    kind: "picker",
    participants: ["a", "b", "c"].map((id, i) => ({
      id,
      label: `Архетип ${id.toUpperCase()}`,
      rank: i + 1,
      media: { visual: id },
    })),
    rounds: [
      {
        id: "pick",
        prompt: "Кто твой любимец?",
        cards: ["a", "b", "c"].map((id) => ({ id: `card-${id}`, participantId: id })),
      },
    ],
  });
  d.schemaVersion = 2;
  d.scenes = [];
  d.source.segments = [{ id: "all", title: "Все", participantIds: ["a", "b", "c"] }];
  d.audio = { playlist: { tracks: ["song"] } };
  d.segments = [
    {
      id: "question",
      kind: "picker",
      title: "Выбор",
      participantIds: ["a", "b", "c"],
      roundIds: ["pick"],
      scenes: [{ id: "question-scene", block: "picker", repeat: "rounds", nodes: [] }],
    },
    {
      id: "result",
      kind: "top",
      title: "Топ по голосам",
      sourceSegmentId: "all",
      scenes: [
        {
          id: "result-scene",
          block: "top",
          repeat: "participants",
          duration: { sec: 2 },
          nodes: [
            textNode({
              id: "votes",
              text: { bind: "participant.votes", plural: [" голос", " голоса", " голосов"] },
              rect: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 },
            }),
            textNode({
              id: "headline",
              text: { bind: "match.text", key: "headline" },
              rect: { x: 0.1, y: 0.05, width: 0.8, height: 0.1 },
            }),
          ],
        },
      ],
    },
    {
      id: "board",
      kind: "top",
      title: "Счёт",
      scenes: [{ id: "board-scene", block: "top", repeat: "participants", duration: { sec: 1 }, nodes: [] }],
    },
  ];
  d.interactive = {
    version: 1,
    moments: [{ id: "wait", sceneId: "question-scene", at: { event: "timer.start" } }],
    choices: [{ id: "favourite", sceneId: "question-scene", cards: "all" }],
    templates: [
      { segmentId: "result", uses: ["votes", "rank", "texts"], order: "rank" },
      { segmentId: "board", uses: ["players"], participants: "players" },
    ],
    sample: {
      participants: { a: { votes: 1, rank: 2 }, b: { votes: 3, rank: 1 }, c: { votes: 0, rank: 3 } },
      players: [
        { id: "p1", name: "Аня", score: 3 },
        { id: "p2", name: "Боря", score: 1 },
      ],
      texts: { headline: "Ваш общий топ" },
    },
  };
  return d;
}

