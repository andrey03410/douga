import { describe, expect, it } from "vitest";
import { getRecipePresets, getVideoRecipe, getVideoRecipes } from "./recipes";
import { videoPresetSchema, videoDocumentSchema } from "./schema";
import { compileVideo } from "./compiler";
import { getTypographyMeasureText } from "../server/studio/typography-fonts";
import { videoContentInputSchema, buildVideoContent } from "./content";

describe("curated recipes", () => {
  it("provides independently valid presets and playable examples for every offered format", async () => {
    const recipes = getVideoRecipes();
    const measureText = await getTypographyMeasureText();
    expect(new Set(recipes.map((r) => r.style)).size).toBe(6);
    for (const recipe of recipes) {
      expect(recipe.id).toBe(
        `recipe.${recipe.style}.${recipe.kind}.${recipe.format}`,
      );
      expect(
        videoPresetSchema.safeParse(recipe.preset).success,
        recipe.id,
      ).toBe(true);
      expect(
        videoDocumentSchema.safeParse(recipe.example).success,
        recipe.id,
      ).toBe(true);
      const compiled = compileVideo(recipe.example, {}, { measureText });
      expect(
        compiled.ready,
        recipe.id + JSON.stringify(compiled.diagnostics),
      ).toBe(true);
      expect(
        videoContentInputSchema.safeParse(recipe.contentForm.example).success,
        recipe.id,
      ).toBe(true);
      expect(() =>
        buildVideoContent(recipe.example, recipe.contentForm.example),
      ).not.toThrow();
      expect(
        recipes
          .filter((r) => r.style === recipe.style && r.kind === recipe.kind)
          .map((r) => r.format)
          .sort(),
      ).toEqual(["square", "vertical", "wide"]);
    }
    expect(getRecipePresets().map((p) => p.id)).toEqual(
      recipes.map((r) => r.id),
    );
    expect(getVideoRecipe("unknown")).toBeUndefined();
  });
  it("returns independent values so reading a recipe cannot mutate the catalog", () => {
    const recipe = getVideoRecipes()[0];
    recipe.preset.name = "Corrupted";
    expect(getVideoRecipe(recipe.id)!.preset.name).not.toBe("Corrupted");
  });
});
