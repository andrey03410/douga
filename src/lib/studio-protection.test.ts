import { it, expect } from "vitest";
import { studioProtectionResponse } from "./studio-protection";
it("returns a useful conflict for a cover or poster still used by a tournament", async () => {
  const result = studioProtectionResponse(new Error("TOURNAMENT_ASSET_IN_USE"));
  expect(result?.status).toBe(409);
  expect(await result?.json()).toMatchObject({
    code: "TOURNAMENT_ASSET_IN_USE",
    error: expect.stringContaining("турнир"),
  });
});
