import "server-only";
import { z } from "zod";
import { getVideoRecipes, getVideoRecipe, videoRecipeStyles } from "@/video/recipes";
import { actor } from "./shared";
import { StudioError } from "./errors";
export const selectStudioRecipesSchema = z
  .object({
    kind: z.enum(["top", "picker", "board"]).optional(),
    format: z.enum(["wide", "vertical", "square"]).optional(),
    style: z.enum(videoRecipeStyles).optional(),
    query: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(3).default(3),
  })
  .strict();
export type SelectStudioRecipesInput = z.input<
  typeof selectStudioRecipesSchema
>;
const directionHints: Record<string, string[]> = {
  clean: ["длин", "чита", "ясн", "миним", "clean", "readab"],
  cinematic: ["кино", "спокой", "музык", "ost", "cinemat", "calm"],
  "anime-impact": ["энерг", "ярк", "динами", "аниме", "impact", "energet"],
  manga: ["манг", "комик", "manga", "comic"],
  neon: ["неон", "свеч", "neon", "glow"],
  "board-clear": ["доск", "слот", "распредел", "board"],
};
function queryScore(recipe: ReturnType<typeof getVideoRecipes>[number], query = "") {
  const text = query.toLocaleLowerCase();
  const description = `${recipe.name} ${recipe.description}`.toLocaleLowerCase();
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
  return (directionHints[recipe.style] ?? []).filter(hint => text.includes(hint)).length * 20
    + tokens.filter(token => description.includes(token.slice(0, Math.min(4, token.length)))).length;
}
export async function selectStudioRecipes(
  userId: string,
  raw: SelectStudioRecipesInput = {},
) {
  const input = selectStudioRecipesSchema.parse(raw);
  await actor(userId);
  const all = getVideoRecipes();
  const compatible = all.filter(
    (r) =>
      (!input.kind || r.kind === input.kind) &&
      r.format === (input.format ?? "wide"),
  );
  const scored = compatible
    .filter((r) => !input.style || r.style === input.style)
    .map((recipe) => {
      return {
        recipe,
        score:
          queryScore(recipe, input.query) +
          (recipe.style === "clean" || recipe.style === "board-clear" ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
  const items = scored
    .slice(0, input.limit)
    .map(
      ({ recipe: { preset: _preset, example: _example, ...metadata } }) =>
        metadata,
    );
  return {
    items,
    recommended: items[0]?.id ?? null,
    reason: items.length
      ? null
      : "Для этого типа ролика направление не поддержано. Выберите совместимый вариант.",
    alternatives: items.length ? [] : compatible.slice(0, 3).map((r) => r.id),
  };
}

export async function getVideoRecipeForActor(userId: string, id: string) {
  await actor(userId);
  const recipe = getVideoRecipe(id);
  if (!recipe) throw new StudioError("NOT_FOUND");
  return recipe;
}
export async function listStudioRecipeGallery(userId: string, raw: z.input<typeof selectStudioRecipesSchema> & { all?: boolean } = {}) {
  const { all, ...filters } = z.object({ ...selectStudioRecipesSchema.shape, all: z.boolean().default(false) }).strict().parse(raw);
  const selected = await selectStudioRecipes(userId, filters);
  if (!all) return selected;
  const items = getVideoRecipes().filter(r => (!filters.kind || r.kind === filters.kind)
    && (!filters.format || r.format === filters.format) && (!filters.style || r.style === filters.style)
    && (!filters.query || queryScore(r, filters.query) > 0))
    .map(({ preset: _, example: __, ...metadata }) => metadata);
  return { ...selected, items, total: items.length };
}
