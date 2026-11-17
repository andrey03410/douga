import { createVideoDocument } from "./builders";
import { getCompositionPreset, getCompositionPresets } from "./composition-presets";
import { mergeSettings } from "./settings";
import type { Settings, VideoDocument, VideoFormat } from "./types";
import type { VideoRecipe } from "./recipes";

export const videoKinds = ["top", "picker", "tier-list"] as const;
export type VideoAuthoringKind = typeof videoKinds[number];
export type VideoSubject = "characters" | "anime" | "music";
export interface VideoDesign {
  accent?: string;
  palette?: string[];
  typography?: Settings["typography"];
  motion?: Settings["motion"];
  backdrop?: Settings["backdrop"];
}
export interface VideoIntent {
  kind: VideoAuthoringKind;
  subject?: VideoSubject;
  format?: VideoFormat;
  title?: string;
  roundCount?: number;
  cardsPerRound?: number;
  design?: VideoDesign;
}
export function compositionIdFor(input: VideoIntent): string {
  const family = input.kind === "top"
    ? `top.${input.subject === "music" ? "music" : "portrait"}` : input.kind;
  return `composition.${family}.${input.format ?? "wide"}`;
}
export function createVideoFromIntent(input: VideoIntent): VideoDocument {
  const preset = getCompositionPreset(compositionIdFor(input));
  if (!preset) throw Error("COMPOSITION_NOT_FOUND");
  const doc = createVideoDocument({ kind: input.kind === "tier-list" ? "board" : input.kind,
    preset, title: input.title, roundCount: input.roundCount, cardsPerRound: input.cardsPerRound });
  if (input.design) {
    const { accent, palette, ...settings } = input.design;
    doc.settings = mergeSettings(doc.settings, settings, {
      composition: { ...doc.settings.composition!, ...(accent ? { accent } : {}), ...(palette ? { palette } : {}) },
    });
  }
  return doc;
}
export const authoringKindFor = (kind: "top" | "picker" | "board"): VideoAuthoringKind => kind === "board" ? "tier-list" : kind;
export function getVideoDesignGuide(kind: VideoAuthoringKind, subject: VideoSubject = "characters", format: VideoFormat = "wide") {
  return {
    kind, subject, format,
    recommended: compositionIdFor({ kind, subject, format }),
    decisionOrder: ["type", "content and user direction", "style decision", "composition and typography", "actual frames and motion", "correct and recheck"],
    principle: "Сначала тип ролика. Затем выбери и согласуй стиль по составу и пожеланию пользователя. Хорошая основа не заменяет визуальную проверку.",
    geometry: kind === "picker" ? "Крупные лица и одинаковый масштаб; группы видны сразу. Вход заканчивается до таймера. При переполнении измени раскладку/раздели сцену, не уменьшай текст до микрошрифта."
      : kind === "tier-list" ? "Читаемые ряды, акцент на текущем тире, затем общий обзор. Готовое распределение задаёт автор."
      : subject === "music" ? "Место — главный акцент, название — второй, метаданные — третий. Затемнённый фон и спокойное движение оставляют место музыке."
      : "Крупный портрет и узнаваемое лицо. Место, имя и аниме — отдельные уровни, без тяжёлой общей плашки.",
    fontPairs: subject === "music" && kind === "top"
      ? [{ title: "cormorant-garamond", rank: "cinzel", caption: "cormorant-garamond", use: "Спокойные музыкальные подборки; кириллица в Cormorant, Cinzel только числа/латиница" },
         { title: "oswald", rank: "oswald", caption: "manrope", use: "Энергичный OST или компактный современный топ" }]
      : [{ title: "oswald", rank: "oswald", caption: "manrope", use: "Крупный характерный заголовок и спокойные читаемые подписи" },
         { title: "manrope", rank: "oswald", caption: "manrope", use: "Сдержанный вариант и длинные имена" }],
    palettes: [{ accent: "#efc47b", background: "#0c0b15", use: "Тёплый спокойный акцент" },
      { accent: "#a58bfa", background: "#0b0b16", use: "Холодный выразительный акцент" },
      { accent: "#67d9e8", background: "#08131a", use: "Светлый свежий акцент" }],
    styling: "Уточняй design.accent/palette и существующие typography.roles, motion/backdrop. Одна согласованная пара и палитра на ролик. Явное пожелание пользователя приоритетнее рекомендации. JP — Noto fallback.",
    avoid: ["Пустые большие контейнеры и мелкие портреты", "Имя на светлом арте без затемнения", "Случайное смешивание шрифтов/эффектов", "Постоянная тряска, вращения карточек и вспышки", "Непроверенные legacy presets", "Придуманный победитель выбора без правильного ответа"],
    verification: ["video_storyboard: все страницы, начало/середина/конец и плотные сцены", "video_text_inspect: длинные RU/JP имена, overflow и glyphs", "video_review + apply: исправить адресные проблемы", "video_review mode:deep или video_job_start kind:clip: увидеть вход, стабильный кадр, переход и услышать звук", "После изменений повторить проверку; ready=true не означает красивый ролик"],
    contentExample: kind === "tier-list" ? { kind: "board", mode: "replace", participants: [{ id: "hero", label: "Персонаж" }], tiers: [{ id: "s", label: "S", participantIds: ["hero"] }] }
      : kind === "picker" ? { kind: "picker", mode: "replace", participants: [{ id: "a", label: "Первый" }, { id: "b", label: "Второй" }], rounds: [{ id: "r1", prompt: "Кого выберешь?", cards: [{ id: "a-card", participantId: "a" }, { id: "b-card", participantId: "b" }], groups: [{ id: "g1", label: "Группа 1", cardIds: ["a-card"] }, { id: "g2", label: "Группа 2", cardIds: ["b-card"] }], musicAssetId: null }] }
      : { kind: "top", mode: "replace", participants: [{ id: "first", label: "Название", subtitle: "Аниме / композитор", rank: 1 }] },
  };
}
export function getCompositionRecipes(): VideoRecipe[] {
  return getCompositionPresets().map(preset => {
    const kind = authoringKindFor(preset.kind), music = preset.id.includes(".music.");
    const guide = getVideoDesignGuide(kind, music ? "music" : "characters", preset.output.format);
    const example = createVideoFromIntent({ kind, subject: music ? "music" : "characters", format: preset.output.format });
    return { id: preset.id, version: 1, name: preset.name,
      description: guide.geometry, style: music ? "cinematic" : preset.kind === "board" ? "board-clear" : "clean",
      kind: preset.kind, format: preset.output.format, supportedFormats: ["wide", "vertical", "square"], supportedKinds: [preset.kind],
      density: { recommendedCards: preset.kind === "top" ? 1 : preset.skeleton.cardsPerRound, maxCards: preset.kind === "top" ? 1 : 6 },
      languages: ["ru", "en", "ja"], motion: "Согласованный вход, спокойное чтение, адресный акцент", media: { visual: "image|video", audio: "optional" },
      durationSec: { recommended: 6, minimum: 3 }, preset, example,
      contentForm: { required: ["kind", "mode", "participants"], optional: ["title", "participants[].subtitle", "participants[].visualAssetId", "participants[].audioAssetId", ...(kind === "picker" ? ["rounds[].groups", "rounds[].musicAssetId", "rounds[].backgroundAssetId"] : kind === "tier-list" ? ["tiers"] : [])], constraints: ["Сначала выберите тип ролика, затем стиль по составу", "Порядок, места и ответы задаёт автор", "Смотрите реальные кадры и движение после стилизации"], example: guide.contentExample as VideoRecipe["contentForm"]["example"] },
    };
  });
}
