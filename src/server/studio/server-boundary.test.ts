import { expect, it, vi } from "vitest";
vi.mock("remotion", () => {
  throw Error("React client runtime imported into server service");
});
it("loads Studio services without the Remotion React client entry point", async () => {
  const studio = await import("./index");
  expect(typeof studio.getStudioProject).toBe("function");
});
