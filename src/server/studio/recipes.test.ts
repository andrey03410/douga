import { expect, it, vi } from "vitest";
vi.mock("./shared", () => ({ actor: async () => ({ id: "u", role: "user" }) }));
import { selectStudioRecipes } from "./recipes";
it.each([
  ["Хочу энергичный пикер с ярким раскрытием", "anime-impact"],
  ["Спокойный музыкальный OST топ", "cinematic"],
  ["Длинные имена, главное чтобы читалось", "clean"],
  ["Неоновый свет и свечение", "neon"],
])("recommends a compatible direction from a short author request: %s", async (query, style) => {
  const result = await selectStudioRecipes("u", { kind: "picker", format: "vertical", query });
  expect(result.recommended).toBe(`recipe.${style}.picker.vertical`);
  expect(result.items.length).toBeLessThanOrEqual(3);
});
