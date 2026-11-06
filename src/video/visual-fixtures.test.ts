import { describe, expect, it } from "vitest";
import { buildVisualFixtures, visualFixtureCoverage } from "./visual-fixtures";
import { getVideoRecipes } from "./recipes";
import { getBuiltinPresets } from "./presets";
import { motionCatalog } from "./motion-catalog";
import { typographyExampleIds } from "./typography-examples";
import { typographyStyles, typographyThemes } from "./typography-catalog";
import { getTypographyMeasureText } from "../server/studio/typography-fonts";
import { selectStoryboard } from "./storyboard";
import { compileVideo } from "./compiler";
describe("reproducible visual fixture matrix", () => {
  it("covers every legacy preset and current catalog entry without external media", async () => {
    const measureText = await getTypographyMeasureText();
    const fixtures = buildVisualFixtures(), coverage = visualFixtureCoverage(fixtures);
    expect(coverage.presets).toEqual(getBuiltinPresets().filter((p) => !p.id.startsWith("recipe.")).map((p) => p.id).sort());
    expect(coverage.recipes).toEqual(getVideoRecipes().map((r) => r.id).sort());
    expect(coverage.motion).toEqual(motionCatalog.entries.map((e) => `${e.category}:${e.name}`).sort());
    expect(coverage.typographyExamples).toEqual([...typographyExampleIds].sort());
    expect(coverage.typographyStyles).toEqual(typographyStyles.map((e) => e.id).sort());
    expect(coverage.typographyThemes).toEqual(typographyThemes.map((e) => e.id).sort());
    expect(coverage.cases).toEqual(expect.arrayContaining(["dense", "empty-board", "long-ru", "long-jp", "mixed", "edge"]));
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    for (const fixture of fixtures) {
      expect(fixture.document.seed).toBe(3201);
      expect(fixture.document.title).toMatch(/[А-Яа-я]/);
      expect(Object.values(fixture.manifest).every((a) => a.src.startsWith("fixture:"))).toBe(true);
      const result = compileVideo(fixture.document, fixture.manifest, { measureText });
      expect(result.diagnostics.filter((d) => d.severity === "error"), fixture.id).toEqual([]);
      expect(result.plan.scenes.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.frames.map((f) => f.phase)).toEqual(expect.arrayContaining(["before", "during", "after"]));
      expect(new Set(fixture.frames.map((f) => f.frame)).size, fixture.id).toBeLessThanOrEqual(12);
      expect(fixture.sampling.available.length).toBeGreaterThanOrEqual(fixture.frames.length);
      expect(fixture.sampling.strategy).toBe("representative-events-v1");
      expect(fixture.frames.every((f) => f.frame >= 0 && f.frame < result.plan.durationInFrames), fixture.id).toBe(true);
    }
  });
  it("selects the stable first-scene representative of every preset and recipe for native thumbnails", async () => {
    const measureText = await getTypographyMeasureText();
    for (const fixture of buildVisualFixtures().filter((f) => f.coverage.presets?.length || f.coverage.recipes?.length)) {
      const { plan, ready } = compileVideo(fixture.document, fixture.manifest, { measureText });
      expect(ready, fixture.id).toBe(true);
      const scene = plan.scenes[0], representative = selectStoryboard(plan, { sceneId: scene.id, segmentId: scene.segmentId, pageSize: 1 }).tiles[0];
      expect(representative.analysis.limitations, fixture.id).not.toContain("no-stable-window");
      expect(fixture.frames, fixture.id).toContainEqual(expect.objectContaining({ frame: representative.frame, reason: `${scene.id}:representative` }));
      expect(fixture.sampling.selected, fixture.id).toContain(representative.frame);
      expect(fixture.sampling.selected.length, fixture.id).toBeLessThanOrEqual(12);
    }
  });
  it("is byte-stable across calls and does not share mutable documents", () => {
    const a = buildVisualFixtures(), b = buildVisualFixtures();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    a[0].document.title = "changed";
    expect(b[0].document.title).not.toBe("changed");
  });
});
