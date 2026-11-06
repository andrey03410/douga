import type {
  Settings,
  VideoDocument,
  VideoFormat,
  VideoPreset,
} from "./types";
import { getBoardPresets } from "./board-presets";
import { parseVideoDocument, videoPresetSchema } from "./schema";
import { buildVideoContent, type VideoContentInput } from "./content";

export const videoRecipeStyles = [
  "clean",
  "cinematic",
  "anime-impact",
  "manga",
  "neon",
  "board-clear",
] as const;
export type VideoRecipeStyle = (typeof videoRecipeStyles)[number];
export interface VideoRecipe {
  id: string;
  version: 1;
  name: string;
  description: string;
  style: VideoRecipeStyle;
  kind: VideoPreset["kind"];
  format: VideoFormat;
  supportedFormats: VideoFormat[];
  supportedKinds: VideoPreset["kind"][];
  density: { recommendedCards: number; maxCards: number };
  languages: string[];
  motion: string;
  media: { visual: "image|video"; audio: "optional" };
  durationSec: { recommended: number; minimum: number };
  preset: VideoPreset;
  example: VideoDocument;
  contentForm: {
    required: string[];
    optional: string[];
    constraints: string[];
    slotIds?: string[];
    boardFamilies?: string[];
    example: VideoContentInput;
  };
}
const formats: VideoFormat[] = ["wide", "vertical", "square"];
const styles: Record<
  VideoRecipeStyle,
  { name: string; description: string; motion: string; settings: Settings }
> = {
  clean: {
    name: "Clean",
    description: "Ясная иерархия для длинных имён",
    motion: "Мягкое появление",
    settings: {
      background: "#101522",
      typography: { theme: "clean" },
      card: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#53627e",
        color: "#ffffff",
        background: "#1e293b",
      },
      motion: { enter: "fade", duration: { sec: 0.35 } },
    },
  },
  cinematic: {
    name: "Cinematic OST",
    description: "Крупный арт и спокойный музыкальный ритм",
    motion: "Спокойное приближение",
    settings: {
      background: "#08090d",
      typography: { theme: "cinematic" },
      card: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#b79b62",
        background: "#151a25",
      },
      motion: { enter: "fade", profile: "cinematic", duration: { sec: 0.7 } },
      backdrop: {
        preset: "art-blur",
        source: "current-card",
        blur: 32,
        dim: 0.7,
      },
    },
  },
  "anime-impact": {
    name: "Anime impact",
    description: "Энергичное раскрытие с защищёнными подписями",
    motion: "Короткое раскрытие и каскад",
    settings: {
      background: "#13152a",
      typography: { theme: "anime-impact" },
      card: { borderRadius: 12, borderColor: "#f6ca56", borderWidth: 3 },
      motion: {
        enter: "pop",
        choreography: "picker-cascade",
        duration: { sec: 0.3 },
      },
      timer: { variant: "ring", color: "#f6ca56" },
    },
  },
  manga: {
    name: "Manga",
    description: "Контрастные плашки и чёткие границы",
    motion: "Короткий штамп",
    settings: {
      background: "#ece9e1",
      typography: { theme: "manga" },
      card: {
        borderRadius: 0,
        borderColor: "#151515",
        borderWidth: 4,
        background: "#242424",
        color: "#ffffff",
        shadow: { color: "#111111", x: 6, y: 6, blur: 0 },
      },
      motion: {
        enter: "pop",
        emphasis: "stamp",
        profile: "snappy",
        duration: { sec: 0.25 },
      },
      timer: { variant: "segments", color: "#151515" },
    },
  },
  neon: {
    name: "Neon",
    description: "Вечерняя палитра с согласованным свечением",
    motion: "Скольжение с мягким акцентом",
    settings: {
      background: "#0b0920",
      typography: { theme: "neon" },
      card: {
        borderRadius: 18,
        borderColor: "#8a63ff",
        borderWidth: 2,
        background: "#17112f",
        shadow: { color: "#6145b8", x: 0, y: 0, blur: 18 },
      },
      motion: { enter: "slide-up", duration: { sec: 0.4 } },
      backdrop: {
        preset: "gradient-flow",
        colors: ["#0b0920", "#251344"],
        dim: 0.35,
        motion: true,
      },
      timer: { variant: "bar", color: "#d49dff" },
    },
  },
  "board-clear": {
    name: "Board clear",
    description: "Читаемые слоты и понятное размещение карточек",
    motion: "Короткий перенос карточки",
    settings: {
      background: "#111827",
      typography: { theme: "clean" },
      card: {
        orientation: "portrait",
        borderRadius: 10,
        borderColor: "#8092ae",
        borderWidth: 1,
        background: "#253044",
      },
      motion: {
        enter: "fade",
        choreography: "board-place",
        duration: { sec: 0.35 },
      },
    },
  },
};
function makePreset(
  style: VideoRecipeStyle,
  kind: VideoPreset["kind"],
  format: VideoFormat,
): VideoPreset {
  const settings = structuredClone(styles[style].settings);
  if (style === "anime-impact" && kind === "top")
    settings.motion!.choreography = "rank-reveal";
  settings.layout = {
    type: "grid",
    gap: format === "vertical" ? 16 : 24,
    padding: format === "vertical" ? 24 : 40,
  };
  settings.labels = { mode: "always", showRank: kind === "top" };
  if (kind === "top")
    settings.top = {
      durationSec: style === "cinematic" ? 8 : 6,
      order: "descending",
      snippet: { mode: "manual", startSec: 0 },
    };
  if (kind === "picker")
    settings.picker = {
      leadSec: 0.6,
      revealSec: 2,
      timerSec: 5,
      answerSec: 2.5,
      answerMode: "inline",
      staggerSec: 0.15,
    };
  const board =
    kind === "board"
      ? getBoardPresets().find((p) => p.id === `board.tier.${format}`)!
      : undefined;
  return videoPresetSchema.parse({
    schemaVersion: 1,
    id: `recipe.${style}.${kind}.${format}`,
    version: 1,
    name: `${styles[style].name} · ${kind} · ${format}`,
    kind,
    output: { format, fps: 30 },
    settings,
    scenes: board?.scenes ?? [
      {
        id: "main",
        block: kind,
        repeat: kind === "top" ? "participants" : "rounds",
        nodes: [],
        transition: {
          type: "fade",
          duration: { sec: style === "cinematic" ? 0.6 : 0.25 },
        },
      },
    ],
    skeleton: {
      roundCount: kind === "top" ? 0 : 1,
      cardsPerRound: kind === "board" ? 1 : format === "vertical" ? 2 : 4,
      groupCount: 0,
    },
  });
}
function makeRecipe(
  style: VideoRecipeStyle,
  kind: VideoPreset["kind"],
  format: VideoFormat,
): VideoRecipe {
  const preset = makePreset(style, kind, format);
  const participants =
    kind === "board"
      ? [{ id: "a", label: "葬送のフリーレン" }]
      : [
          {
            id: "a",
            label: "Фрирен / フリーレン",
            ...(kind === "top" ? { rank: 1 } : {}),
          },
          {
            id: "b",
            label: "Вайолет / ヴァイオレット",
            ...(kind === "top" ? { rank: 2 } : {}),
          },
        ];
  const sceneId = preset.scenes[0].id;
  const example: VideoContentInput =
    kind === "top"
      ? { kind, mode: "replace", title: "Любимые истории", participants }
      : kind === "picker"
        ? {
            kind,
            mode: "replace",
            title: "Кого выберешь?",
            participants,
            rounds: [
              {
                id: "round-1",
                prompt: "Выбери персонажа",
                cards: participants.map((p) => ({ participantId: p.id })),
                answerParticipantIds: ["a"],
              },
            ],
          }
        : {
            kind,
            mode: "replace",
            title: "Моя доска",
            participants,
            boards: [
              {
                sceneId,
                rounds: [
                  {
                    id: "round-1",
                    cards: [{ id: "card-a", participantId: "a" }],
                    actions: [
                      {
                        id: "place-a",
                        type: "place",
                        cardId: "card-a",
                        slotId: preset.scenes[0].board!.slots[0].id,
                      },
                    ],
                  },
                ],
              },
            ],
          };
  const base = parseVideoDocument({
    schemaVersion: 1,
    id: `example-${style}-${kind}-${format}`,
    title: "Пример",
    kind,
    seed: 32,
    output: preset.output,
    source: { kind: "manual", participants: [], rounds: [] },
    bindings: {},
    settings: preset.settings,
    scenes: preset.scenes,
    preset: { id: preset.id, version: preset.version },
  });
  return {
    id: preset.id,
    version: 1,
    name: preset.name,
    description: styles[style].description,
    style,
    kind,
    format,
    supportedFormats: [...formats],
    supportedKinds: style === "board-clear" ? ["board"] : ["top", "picker"],
    density: {
      recommendedCards: kind === "top" ? 1 : preset.skeleton.cardsPerRound,
      maxCards: kind === "top" ? 1 : format === "vertical" ? 4 : 6,
    },
    languages: ["ru", "en", "ja"],
    motion: styles[style].motion,
    media: { visual: "image|video", audio: "optional" },
    durationSec: { recommended: style === "cinematic" ? 8 : 6, minimum: 3 },
    preset,
    example: buildVideoContent(base, example),
    contentForm: {
      required: [
        "kind",
        "mode",
        "participants[].id",
        "participants[].label",
        ...(kind === "top"
          ? ["participants[].rank"]
          : kind === "picker"
            ? ["rounds[].id", "rounds[].cards[].participantId"]
            : ["boards[].sceneId", "boards[].rounds[].actions"]),
      ],
      optional: [
        "title",
        "participants[].visualAssetId",
        "participants[].audioAssetId",
        "participants[].caption",
        ...(kind === "picker" ? ["rounds[].answerParticipantIds"] : []),
      ],
      constraints: [
        "mode обязателен: merge или replace",
        "assetId — собственное загруженное изображение/видео или аудио; пример не подставляет demo-media",
        "Система не выбирает места, ответы и действия за автора",
        "Частичное обновление использует стабильные id; null очищает материал или ответ",
      ],
      ...(kind === "board"
        ? {
            slotIds: preset.scenes[0].board!.slots.map((s) => s.id),
            boardFamilies: [
              "tier",
              "kmk",
              "smash-pass",
              "blind-rank",
              "draft",
              "sort-quiz",
              "alignment",
              "budget-draft",
            ],
          }
        : {}),
      example,
    },
  };
}
/** No presets/builders import: safe for direct browser use and preset catalog integration. */
export function getVideoRecipes(): VideoRecipe[] {
  return videoRecipeStyles.flatMap((style) =>
    (style === "board-clear"
      ? ["board" as const]
      : ["top" as const, "picker" as const]
    ).flatMap((kind) =>
      formats.map((format) => makeRecipe(style, kind, format)),
    ),
  );
}
export function getVideoRecipe(id: string): VideoRecipe | undefined {
  return getVideoRecipes().find((r) => r.id === id);
}
export function getRecipePresets(): VideoPreset[] {
  return videoRecipeStyles.flatMap((style) =>
    (style === "board-clear"
      ? ["board" as const]
      : ["top" as const, "picker" as const]
    ).flatMap((kind) =>
      formats.map((format) => makePreset(style, kind, format)),
    ),
  );
}
