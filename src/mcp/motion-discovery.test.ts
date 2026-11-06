import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as sdk from "@/video";
import * as timeline from "@/server/studio/timeline";
import { registerStudioTools, videoExamples } from "./studio-tools";
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES } from "./instructions";
vi.mock("@/server/studio/shared", async (original) => ({
  ...(await original<object>()),
  actor: vi.fn(async () => ({ id: "u", role: "admin" })),
}));
const handlers = new Map<string, (args: object) => Promise<any>>();
const server = {
  registerTool: (name: string, _config: unknown, handler: any) =>
    handlers.set(name, handler),
  registerResource: () => {},
} as unknown as McpServer;
registerStudioTools(server, {
  userId: "u",
  email: "test@local",
  role: "admin",
});
const call = async (name: string, args = {}) => {
  expect(handlers.has(name), `registered ${name}`).toBe(true);
  const result = await handlers.get(name)!(args);
  return { ...result.structuredContent, isError: result.isError };
};
describe("motion discovery", () => {
  it("lists bounded filtered summaries and paginates without fragments", async () => {
    const first = await call("video_motion_list", {
      category: "effect",
      limit: 3,
    });
    expect(first.version).toBe(1);
    expect(first.total).toBe(40);
    expect(first.items).toHaveLength(3);
    expect(
      first.items.every((x: any) => x.category === "effect" && !x.example),
    ).toBe(true);
    const next = await call("video_motion_list", {
      category: "effect",
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(next.items[0].name).not.toBe(first.items[0].name);
    expect((await call("video_motion_list", { limit: 1000 })).isError).toBe(
      true,
    );
    expect(
      (await call("video_motion_list", { cursor: "missing" })).isError,
    ).toBe(true);
  });
  it("disambiguates names and returns explicit fragments and variant metadata", async () => {
    expect((await call("video_motion_get", { name: "flash" })).error.code).toBe(
      "MOTION_CATEGORY_REQUIRED",
    );
    for (const category of ["effect", "transition"])
      expect(
        (await call("video_motion_get", { name: "flash", category })).entry
          .category,
      ).toBe(category);
    expect((await call("video_motion_get", { name: "flip" })).entry.name).toBe(
      "flip-y",
    );
    expect(
      (await call("video_motion_get", { name: "missing" })).error.code,
    ).toBe("NOT_FOUND");
    expect(
      (await call("video_motion_get", { name: "timer" })).entry.variants,
    ).toEqual(["digits", "ring", "segments", "bar"]);
  });
  it("advertises motion and keeps initialize instructions within 3KB", async () => {
    expect((await call("video_capabilities")).motion.catalogVersion).toBe(1);
    expect(MCP_TOOL_NAMES).toContain("video_motion_list");
    expect(MCP_INSTRUCTIONS).toContain("video_motion_get");
    expect(Buffer.byteLength(MCP_INSTRUCTIONS)).toBeLessThanOrEqual(3072);
  });
  it("publishes complete schema-valid compile-ready motion examples with explicit stand-in manifests", () => {
    const examples = videoExamples().items.filter((e) =>
      e.id.startsWith("motion-"),
    );
    expect(examples).toHaveLength(12);
    for (const example of examples) {
      expect(
        sdk.videoDocumentSchema.safeParse(example.document).success,
        example.id,
      ).toBe(true);
      const compiled = sdk.compileVideo(
        example.document,
        (example as any).standInManifest,
      );
      expect(
        compiled.diagnostics.filter((d) => d.severity === "error"),
        example.id,
      ).toEqual([]);
      expect(compiled.ready, example.id).toBe(true);
    }
  });
  it("compiles all gallery entries under every profile/intensity and widget variant", () => {
    for (const entry of sdk.motionCatalog.entries) {
      for (const profile of [
        "smooth",
        "snappy",
        "bouncy",
        "cinematic",
      ] as const) {
        for (const intensity of ["subtle", "normal", "bold"] as const) {
          const example = sdk.createMotionExample(entry, {
            profile,
            intensity,
          });
          const result = sdk.compileVideo(
            example.document,
            example.standInManifest,
          );
          expect(
            result.diagnostics.filter((d) => d.severity === "error"),
            `${entry.category}/${entry.name}/${profile}/${intensity}`,
          ).toEqual([]);
          expect(result.ready).toBe(true);
        }
      }
      for (const variant of (entry as sdk.MotionCatalogEntry).variants ?? []) {
        const e = sdk.createMotionExample(entry, { variant });
        expect(sdk.compileVideo(e.document, e.standInManifest).ready).toBe(
          true,
        );
      }
    }
  });
  it("shows the chosen technique in compiled gallery IR rather than an empty demo", () => {
    for (const entry of sdk.motionCatalog.entries) {
      const example = sdk.createMotionExample(entry);
      const plan = sdk.compileVideo(
        example.document,
        example.standInManifest,
      ).plan;
      const clips = plan.scenes.flatMap((scene) =>
        scene.nodes.flatMap((node) => node.motion ?? []),
      );
      if (entry.category === "effect")
        expect(
          clips.some((clip) => clip.name === entry.name),
          entry.name,
        ).toBe(true);
      if (entry.category === "choreography")
        expect(clips.length, entry.name).toBeGreaterThan(0);
      if (entry.category === "transition") {
        expect(plan.scenes).toHaveLength(2);
        expect(plan.scenes[1].transition.type).toBe(entry.name);
      }
      if (entry.category === "backdrop")
        expect(plan.scenes[0].backdrop?.preset).toBe(entry.name);
      if (entry.category === "widget")
        expect(
          plan.scenes[0].nodes.some((node) => node.type === entry.name),
        ).toBe(true);
    }
  });
  it("retrieves one full example by id and reports unknown IDs", async () => {
    const result = await call("video_examples", {
      id: "motion-effect-text-slam",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("motion-effect-text-slam");
    expect(
      sdk.compileVideo(
        result.items[0].document,
        result.items[0].standInManifest,
      ).ready,
    ).toBe(true);
    expect((await call("video_examples", { id: "missing" })).error.code).toBe(
      "NOT_FOUND",
    );
    for (const entry of sdk.motionCatalog.entries) {
      const detail = await call("video_motion_get", {
        name: entry.name,
        category: entry.category,
      });
      expect(
        videoExamples().items.some(
          (item) => item.id === detail.completeExampleId,
        ),
      ).toBe(true);
    }
  });
  it("recommends actual scene-local motion/transition boundaries as absolute frames", () => {
    const doc = sdk.createVideoDocument({ kind: "top", participants: [] });
    doc.scenes = [
      {
        id: "s",
        block: "custom",
        duration: { frame: 90 },
        transition: { type: "wipe", duration: { frame: 12 } },
        nodes: [
          {
            id: "t",
            type: "text",
            text: "42",
            timing: { at: { frame: 7 } },
            motion: {
              enter: {
                name: "fade",
                delay: { frame: 6 },
                duration: { frame: 9 },
              },
            },
          },
        ],
      },
    ];
    const scene = sdk.compileVideo(doc, {}).plan.scenes[0];
    scene.from = 100;
    const summary = (timeline as any).sceneSummary(scene);
    expect(summary.recommendedFrames).toEqual(
      expect.arrayContaining([100, 111, 112, 113, 121, 122, 189]),
    );
    expect(
      summary.recommendedFrames.every((f: number) => f >= 100 && f < 190),
    ).toBe(true);
  });
});
