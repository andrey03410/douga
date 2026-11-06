import { createVideoDocument } from "./builders";
import { applyTypographyTheme } from "./typography-catalog";
import type { AssetManifest, VideoDocument, VideoFormat } from "./types";
export const typographyExampleIds = [
  "ost-top",
  "character-picker",
  "manga-board",
  "mixed-title",
] as const;
export type TypographyExampleId = (typeof typographyExampleIds)[number];
export interface TypographyExample {
  id: TypographyExampleId;
  name: string;
  description: string;
  document: VideoDocument;
  manifest: AssetManifest;
}
function makeExample(id: TypographyExampleId): TypographyExample {
  const participants = [
    { id: "akira", label: "Акира — 運命の光", rank: 1 },
    { id: "haru", label: "Хару / 春の風", rank: 2 },
  ];
  let document: VideoDocument;
  if (id === "ost-top") {
    document = applyTypographyTheme(
      createVideoDocument({
        kind: "top",
        title: "Музыка, которая остаётся",
        participants,
      }),
      "cinematic",
    );
    document.scenes[0].nodes.push({
      id: "ost-title",
      type: "text",
      text: { bind: "document.title" },
      rect: { x: 0.08, y: 0.03, width: 0.84, height: 0.12 },
      typography: { role: "title", fontSize: 52 },
    });
  } else if (id === "character-picker") {
    document = applyTypographyTheme(
      createVideoDocument({
        kind: "picker",
        title: "Выбери персонажа",
        participants,
        rounds: [
          {
            id: "pair",
            prompt: "С кем отправишься в путешествие?",
            cards: [
              { id: "a", participantId: "akira" },
              { id: "b", participantId: "haru" },
            ],
            answer: { cardIds: ["a"] },
          },
        ],
      }),
      "anime-impact",
    );
    document.settings.motion = { choreography: "versus-impact" };
  } else if (id === "manga-board") {
    document = applyTypographyTheme(
      createVideoDocument({
        kind: "board",
        title: "Моя доска героев",
        participants,
        board: {
          version: 1,
          mode: "accumulate",
          layout: "rows",
          slots: [
            { id: "s", label: "Главные герои" },
            { id: "a", label: "Союзники / 仲間" },
          ],
          rounds: [
            {
              id: "cast",
              prompt: "Распредели героев",
              cards: [
                { id: "ca", participantId: "akira" },
                { id: "cb", participantId: "haru" },
              ],
              actions: [
                { id: "place-a", type: "place", cardId: "ca", slotId: "s" },
                { id: "place-b", type: "place", cardId: "cb", slotId: "a" },
              ],
            },
          ],
          presentation: { leadSec: 0, thinkSec: 2, finalSec: 2 },
        },
      }),
      "manga",
    );
  } else {
    document = applyTypographyTheme(
      createVideoDocument({
        kind: "top",
        title: "Русский × 日本語",
        participants: [],
      }),
      "clean",
    );
    document.scenes = [
      {
        id: "mixed",
        block: "custom",
        duration: { sec: 5 },
        nodes: [
          {
            id: "rich-title",
            type: "text",
            text: {
              runs: [
                { text: "История " },
                { text: "未来", color: "#ffd166", weight: 700 },
                { text: " начинается" },
              ],
            },
            rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.24 },
            typography: { preset: "jp-title", fontSize: 64, maxLines: 3 },
          },
          {
            id: "caption",
            type: "text",
            text: "Свет, музыка и новая глава / 新しい物語",
            rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.18 },
            typography: {
              role: "caption",
              preset: "subtitle-safe",
              fontSize: 32,
              maxLines: 3,
            },
          },
          {
            id: "countdown",
            type: "timer",
            duration: { sec: 5 },
            rect: { x: 0.4, y: 0.7, width: 0.2, height: 0.15 },
            typography: { role: "timer" },
          },
        ],
      },
    ];
  }
  document.id = `typography-${id}`;
  const names: Record<TypographyExampleId, [string, string]> = {
    "ost-top": ["OST-топ", "Кинотитр, русские названия и японские оригиналы"],
    "character-picker": [
      "Пикер персонажей",
      "Контрастные подписи одного размера, VS и таймер",
    ],
    "manga-board": [
      "Доска героев",
      "Роли заголовка, промпта, слотов и карточек",
    ],
    "mixed-title": [
      "Смешанный титр",
      "Плоские фрагменты, локальные акценты и японская подстановка",
    ],
  };
  return {
    id,
    name: names[id][0],
    description: names[id][1],
    document,
    manifest: {},
  };
}
export const typographyExamples: TypographyExample[] =
  typographyExampleIds.map(makeExample);
export function createTypographyExample(
  id: TypographyExampleId,
  options: { format?: VideoFormat } = {},
): TypographyExample {
  if (!typographyExampleIds.includes(id))
    throw new Error(`Unknown typography example: ${id}`);
  const result = makeExample(id);
  if (options.format) result.document.output.format = options.format;
  return result;
}
