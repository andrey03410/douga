import { describe, expect, it } from "vitest";
import { ownedScenarioContent, measurePcm16, parseMcpToolData } from "../../../scripts/storyboard-verification-helpers";
import { getVideoRecipes } from "./recipes";
import { videoContentInputSchema } from "./content";
describe("live storyboard verification helpers", () => {
  it("fills every advertised content form using owned media without constructing render nodes", () => {
    for (const recipe of getVideoRecipes()) {
      const original = JSON.stringify(recipe.contentForm.example);
      const content = ownedScenarioContent(recipe.contentForm.example, { visualAssetIds: ["owned-a", "owned-b"], audioAssetId: "owned-tone" }, "Проверка");
      expect(videoContentInputSchema.safeParse(content).success, recipe.id).toBe(true);
      expect(content.participants!.every((p) => p.visualAssetId?.startsWith("owned-") && p.audioAssetId === "owned-tone")).toBe(true);
      expect(JSON.stringify(recipe.contentForm.example)).toBe(original);
      expect(content).not.toHaveProperty("scenes"); expect(content).not.toHaveProperty("settings");
    }
  });
  it("measures decoded PCM samples and distinguishes sine from silence", () => {
    const silence = measurePcm16(Buffer.alloc(96000), 48000);
    expect(silence).toMatchObject({ sampleCount: 48000, durationSec: 1, silent: true, rms: 0, peak: 0 });
    const pcm = Buffer.alloc(96000);
    for (let i = 0; i < 48000; i++) pcm.writeInt16LE(Math.round(8192 * Math.sin(i * 2 * Math.PI * 440 / 48000)), i * 2);
    const tone = measurePcm16(pcm, 48000);
    expect(tone.silent).toBe(false); expect(tone.peak).toBeCloseTo(0.25, 3); expect(tone.rms).toBeCloseTo(0.1768, 3);
  });
  it("rejects malformed PCM and error responses instead of fabricating success", () => {
    expect(() => measurePcm16(Buffer.alloc(1), 48000)).toThrow();
    expect(() => parseMcpToolData({ isError: true, content: [{ type: "text", text: '{"error":{"code":"NOT_FOUND"}}' }] })).toThrow("NOT_FOUND");
    expect(parseMcpToolData({ content: [{ type: "text", text: '{"id":"job"}' }] })).toEqual({ id: "job" });
  });
});
