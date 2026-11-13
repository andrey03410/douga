import { createVideoDocument, textNode } from "./builders";
import type { VideoDocument, VideoFormat } from "./types";
import type { InteractiveLayer, MatchData } from "./interactive-types";

/**
 * Task 34: recipes of interactive videos. A recipe is a ready document with an
 * interactive layer; an agent copies it and fills content with `video_content_set`
 * (participants, rounds and the `interactive` part), never by hand-written nodes.
 */
export const interactiveFlows = ["quiz-question", "quiz-media", "quiz-reveal", "vote-result", "scoreboard"] as const;
export type InteractiveFlow = (typeof interactiveFlows)[number];

export interface InteractiveRecipe {
  id: string;
  version: 1;
  flow: InteractiveFlow;
  format: VideoFormat;
  name: string;
  description: string;
  /** What the game does at each moment of this flow. */
  gameplay: string;
  example: VideoDocument;
  contentForm: {
    required: string[];
    optional: string[];
    constraints: string[];
    /** A `video_content_set` call that turns the example into another video of this flow. */
    example: Record<string, unknown>;
  };
}

const formats: VideoFormat[] = ["wide", "vertical", "square"];

const meta: Record<InteractiveFlow, { name: string; description: string; gameplay: string }> = {
  "quiz-question": {
    name: "Вопрос квиза",
    description: "Вопрос с карточками ответов; видео ждёт ответов на старте таймера",
    gameplay: "Момент wait на timer.start: игра держит кадр, игроки жмут карточку в кадре или в форме",
  },
  "quiz-media": {
    name: "Вопрос по картинке",
    description: "Крупные карточки с картинками или клипами, ответ кликом по кадру",
    gameplay: "Момент wait на timer.start, выбор по всем карточкам; нужна визуальная привязка у каждого участника",
  },
  "quiz-reveal": {
    name: "Вопрос с раскрытием",
    description: "Вопрос, ожидание ответов и раскрытие верного ответа из данных партии",
    gameplay: "wait на timer.start, reveal на answer.reveal; ответ раунда приходит в matchData.rounds",
  },
  "vote-result": {
    name: "Топ по голосам",
    description: "Итог голосования: участники по местам, число голосов и заголовок партии",
    gameplay: "Шаблон сегмента с votes, rank и texts, порядок по месту; данные приходят после голосования",
  },
  scoreboard: {
    name: "Табло игроков",
    description: "Игроки партии как карточки топа с именами и очками",
    gameplay: "Шаблон participants: players; карточки строятся из matchData.players",
  },
};

const options = ["a", "b", "c", "d"].map((id, i) => ({ id, label: `Вариант ${id.toUpperCase()}`, rank: i + 1 }));

function pickerDocument(format: VideoFormat, cards: number): VideoDocument {
  const participants = options.slice(0, cards);
  const d = createVideoDocument({
    kind: "picker",
    format,
    participants,
    rounds: [
      { id: "q1", prompt: "Вопрос 1", cards: participants.map((p) => ({ id: `q1-${p.id}`, participantId: p.id })) },
      { id: "q2", prompt: "Вопрос 2", cards: participants.map((p) => ({ id: `q2-${p.id}`, participantId: p.id })) },
    ],
  });
  d.schemaVersion = 2;
  d.scenes = [];
  d.segments = [
    {
      id: "questions",
      kind: "picker",
      title: "Вопросы",
      participantIds: participants.map((p) => p.id),
      roundIds: ["q1", "q2"],
      scenes: [{ id: "question", block: "picker", repeat: "rounds", nodes: [] }],
    },
  ];
  return d;
}

function topDocument(format: VideoFormat, segment: "result" | "board"): VideoDocument {
  const d = createVideoDocument({ kind: "top", format, participants: options.slice(0, 3) });
  d.schemaVersion = 2;
  d.scenes = [];
  const nodes =
    segment === "result"
      ? [
          textNode({ id: "votes", text: { bind: "participant.votes", plural: [" голос", " голоса", " голосов"] }, rect: { x: 0.1, y: 0.82, width: 0.8, height: 0.08 } }),
          textNode({ id: "headline", text: { bind: "match.text", key: "headline" }, rect: { x: 0.1, y: 0.04, width: 0.8, height: 0.08 } }),
        ]
      : [textNode({ id: "score", text: { bind: "participant.score", plural: [" очко", " очка", " очков"] }, rect: { x: 0.1, y: 0.82, width: 0.8, height: 0.08 } })];
  d.segments = [
    {
      id: segment,
      kind: "top",
      title: segment === "result" ? "Итог голосования" : "Счёт",
      scenes: [{ id: `${segment}-scene`, block: "top", repeat: "participants", duration: { sec: 2 }, nodes }],
    },
  ];
  return d;
}

const players: MatchData["players"] = [
  { id: "p1", name: "Аня", score: 3, rank: 1 },
  { id: "p2", name: "Боря", score: 1, rank: 2 },
];

function layer(flow: InteractiveFlow): InteractiveLayer {
  const empty = { version: 1 as const, moments: [], choices: [], templates: [], sample: {} };
  switch (flow) {
    case "quiz-question":
    case "quiz-media":
      return {
        ...empty,
        moments: [{ id: "wait", sceneId: "question", at: { event: "timer.start" } }],
        choices: [{ id: "answer", sceneId: "question", cards: "all" }],
      };
    case "quiz-reveal":
      return {
        ...empty,
        moments: [
          { id: "wait", sceneId: "question", at: { event: "timer.start" } },
          { id: "reveal", sceneId: "question", at: { event: "answer.reveal" } },
        ],
        choices: [{ id: "answer", sceneId: "question", cards: "all" }],
        templates: [{ segmentId: "questions", uses: ["answer"] }],
        sample: { rounds: { q1: { answer: { cardIds: ["q1-a"] } }, q2: { answer: { cardIds: ["q2-b"] } } } },
      };
    case "vote-result":
      return {
        ...empty,
        templates: [{ segmentId: "result", uses: ["votes", "rank", "texts"], order: "rank" }],
        sample: {
          participants: { a: { votes: 2, rank: 2 }, b: { votes: 5, rank: 1 }, c: { votes: 0, rank: 3 } },
          texts: { headline: "Ваш общий топ" },
        },
      };
    case "scoreboard":
      return { ...empty, templates: [{ segmentId: "board", uses: ["players"], participants: "players" }], sample: { players } };
  }
}

function exampleDocument(flow: InteractiveFlow, format: VideoFormat): VideoDocument {
  const d =
    flow === "vote-result"
      ? topDocument(format, "result")
      : flow === "scoreboard"
        ? topDocument(format, "board")
        : pickerDocument(format, flow === "quiz-media" ? 2 : format === "vertical" ? 3 : 4);
  d.id = `interactive-${flow}-${format}`;
  d.title = meta[flow].name;
  d.interactive = layer(flow);
  return d;
}

function contentForm(flow: InteractiveFlow): InteractiveRecipe["contentForm"] {
  const picker = flow.startsWith("quiz");
  const interactive = layer(flow);
  return {
    required: picker
      ? ["kind", "mode", "participants[].id", "participants[].label", "rounds[].id", "rounds[].cards[].participantId"]
      : ["kind", "mode", "participants[].id", "participants[].label", "participants[].rank"],
    optional: [
      "title",
      "participants[].visualAssetId",
      ...(picker ? ["rounds[].prompt"] : []),
      "interactive.moments",
      "interactive.choices",
      "interactive.templates",
      "interactive.sample",
    ],
    constraints: [
      "Сцены и сегменты рецепта не меняются: moments и choices ссылаются на authored sceneId",
      "sample — данные для линейного рендера и превью; партия подставляет свои",
      ...(flow === "quiz-media" ? ["У каждого участника нужен visualAssetId: ответ выбирают по картинке"] : []),
      "Код в конфиге не исполняется: только данные",
    ],
    example: {
      kind: picker ? "picker" : "top",
      mode: "merge",
      title: meta[flow].name,
      ...(picker
        ? { rounds: [{ id: "q1", prompt: "Кто из них главный герой?", cards: options.slice(0, 2).map((p) => ({ participantId: p.id })) }] }
        : {}),
      interactive: { sample: interactive.sample },
    },
  };
}

export function getInteractiveRecipes(): InteractiveRecipe[] {
  return interactiveFlows.flatMap((flow) =>
    formats.map((format) => ({
      id: `recipe.interactive.${flow}.${format}`,
      version: 1 as const,
      flow,
      format,
      name: `${meta[flow].name} · ${format}`,
      description: meta[flow].description,
      gameplay: meta[flow].gameplay,
      example: exampleDocument(flow, format),
      contentForm: contentForm(flow),
    })),
  );
}

export function getInteractiveRecipe(id: string): InteractiveRecipe | undefined {
  return getInteractiveRecipes().find((recipe) => recipe.id === id);
}
