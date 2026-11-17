import { expect, it, vi } from "vitest";
vi.mock("./shared", () => ({ actor: async () => ({ id: "u", role: "user" }) }));
import { selectStudioRecipes } from "./recipes";
it.each([
  ["top", "characters", "composition.top.portrait.wide"],
  ["top", "music", "composition.top.music.wide"],
  ["picker", "characters", "composition.picker.wide"],
  ["tier-list", "characters", "composition.tier-list.wide"],
] as const)("selects by type and content before graphic style: %s/%s", async(kind,subject,id)=>{
 const result=await selectStudioRecipes("u",{kind,subject,format:"wide"});
 expect(result.recommended).toBe(id);
 expect(result.items.length).toBeLessThanOrEqual(3);
 expect(result.items.every(r=>r.id.startsWith("composition."))).toBe(true);
 expect(result.designGuide?.decisionOrder[0]).toBe("type");
});
