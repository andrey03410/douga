import "server-only";
import { z } from "zod";
import { getVideoRecipes, videoRecipeStyles } from "@/video/recipes";
import { actor } from "./shared";
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
      const query = input.query?.toLocaleLowerCase() ?? "";
      const match =
        query.length &&
        `${recipe.style} ${recipe.name} ${recipe.description}`
          .toLocaleLowerCase()
          .includes(query);
      return {
        recipe,
        score:
          (match ? 10 : 0) +
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
