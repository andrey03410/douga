import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
vi.mock("@/server/studio/shared", async (original) => ({
  ...(await original<object>()),
  actor: vi.fn(async () => ({ id: "u", role: "admin" })),
}));
import { registerTypographyTools } from "./typography-tools";
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES } from "./instructions";
const handlers = new Map<string, (input: object) => Promise<any>>();
registerTypographyTools(
  {
    registerTool: (name: string, _config: unknown, handler: any) =>
      handlers.set(name, handler),
  } as unknown as McpServer,
  { userId: "u", email: "typography@test.local", role: "admin" },
);
async function call(name: string, input: object = {}) {
  return handlers.get(name)!(input);
}
describe("typography discovery", () => {
  it("provides seven real font summaries and bounded filtered pages", async () => {
    const all = (await call("video_font_list", {})).structuredContent;
    expect(all.total).toBe(7);
    expect(all.items).toHaveLength(7);
    const first = (await call("video_font_list", { limit: 2 }))
      .structuredContent;
    const next = (
      await call("video_font_list", { limit: 2, cursor: first.nextCursor })
    ).structuredContent;
    expect(first.items[0].id).not.toBe(next.items[0].id);
    const jp = (await call("video_font_list", { language: "ja" }))
      .structuredContent;
    expect(jp.items.map((f: any) => f.id)).toContain("noto-sans-jp");
    expect((await call("video_font_list", { limit: 101 })).isError).toBe(true);
    expect(
      (await call("video_font_list", { cursor: "not-a-font" })).isError,
    ).toBe(true);
  });
  it("has six themes, twelve styles and explicit authoring fragments", async () => {
    expect(
      (await call("video_typography_list", { category: "theme" }))
        .structuredContent.total,
    ).toBe(6);
    expect(
      (await call("video_typography_list", { category: "style" }))
        .structuredContent.total,
    ).toBe(12);
    expect(
      (
        await call("video_typography_get", {
          category: "theme",
          id: "cinematic",
        })
      ).structuredContent.fragment.settings.typography,
    ).toEqual({ version: 1, theme: "cinematic" });
    expect(
      (
        await call("video_typography_get", {
          category: "style",
          id: "manga-impact",
        })
      ).structuredContent.fragment.typography,
    ).toEqual({ preset: "manga-impact" });
    expect(
      (await call("video_font_get", { id: "noto-sans-jp" })).structuredContent
        .faces.length,
    ).toBe(2);
    expect(
      (await call("video_font_get", { id: "https://fonts.example/file" }))
        .isError,
    ).toBe(true);
  });
  it("advertises the workflow within initialize's byte budget", () => {
    for (const name of handlers.keys()) expect(MCP_TOOL_NAMES).toContain(name);
    expect(MCP_INSTRUCTIONS).toContain("video_text_inspect");
    expect(Buffer.byteLength(MCP_INSTRUCTIONS)).toBeLessThanOrEqual(3072);
  });
});
