import { describe, expect, it } from "vitest";
import { compileVideo, getBuiltinPreset, type AssetManifest } from "@/video";
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES } from "./instructions";
import { videoExamples } from "./studio-tools";

describe("MCP instructions", () => {
  it("fits in 3 KB and names the tournament and manual paths", () => {
    expect(Buffer.byteLength(MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
      3072,
    );
    expect(MCP_INSTRUCTIONS).toContain("video_source_list");
    // sourceId is a factory option: video_project_create refuses it without presetId
    expect(MCP_INSTRUCTIONS).toMatch(/presetId[^\n]*sourceId/);
    expect(getBuiltinPreset("top.classic.wide")?.kind).toBe("top");
    expect(MCP_INSTRUCTIONS).toContain('source.kind:"manual"');
    expect(MCP_INSTRUCTIONS).toContain("picker.*");
    expect(new Set(MCP_TOOL_NAMES).size).toBe(61);
  });
});

describe("top-manual example", () => {
  it("passes the document schema and compiles with a stand-in manifest", () => {
    const example = videoExamples().items.find(
      (item) => item.id === "top-manual",
    );
    expect(example).toBeTruthy();
    const doc = example!.document;
    expect(doc.source.kind).toBe("manual");
    expect(doc.source.participants).toHaveLength(3);
    expect(doc.settings.top?.snippet?.mode).toBe("active");
    expect(
      doc.source.participants.every(
        (p) => p.rank && p.media?.audio && p.media.visual,
      ),
    ).toBe(true);
    const manifest: AssetManifest = {};
    for (const [id, binding] of Object.entries(doc.bindings)) {
      expect(binding).toMatchObject({ kind: "pool" });
      const audio = id.startsWith("audio-");
      manifest[id] = {
        id,
        kind: audio ? "audio" : "image",
        src: `${id}.${audio ? "mp3" : "png"}`,
        ...(audio ? { durationSec: 30, hasAudio: true } : {}),
      };
    }
    const compiled = compileVideo(doc, manifest);
    expect(compiled.plan.scenes.length).toBeGreaterThan(0);
  });
});

describe("segment recipes", () => {
  it.each(["rank-reveal", "segment-intro", "participant-summary", "staircase"])(
    "compiles the %s recipe as a ready v2 video",
    (id) => {
      const recipe = videoExamples().items.find((item) => item.id === id);
      expect(recipe).toBeTruthy();
      const manifest: AssetManifest = {};
      for (const [key, binding] of Object.entries(recipe!.document.bindings)) {
        manifest[key] = {
          id: binding.kind === "pool" ? binding.assetId : key,
          kind: key.startsWith("audio") ? "audio" : "image",
          src: `${key}.bin`,
          ...(key.startsWith("audio") ? { durationSec: 60 } : {}),
        };
      }
      const compiled = compileVideo(recipe!.document, manifest);
      expect(
        compiled.diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([]);
      expect(recipe!.document.schemaVersion).toBe(2);
      expect(compiled.plan.segments?.length).toBeGreaterThan(0);
      expect(compiled.ready).toBe(true);
    },
  );
});

it.each([
  { id: "rank-reveal", count: 3, starts: [30, 150, 270] },
  { id: "participant-summary", count: 0, starts: [] },
  { id: "staircase", count: 0, starts: [] },
])(
  "keeps $id participant sound intentional without overlapping card tracks",
  ({ id, count, starts }) => {
    const recipe = videoExamples().items.find(
      (item) => item.id === id,
    )!.document;
    const manifest: AssetManifest = Object.fromEntries(
      Object.entries(recipe.bindings).map(([key, binding]) => [
        key,
        {
          id: binding.kind === "pool" ? binding.assetId : key,
          kind: key.startsWith("audio") ? "audio" : "image",
          src: key,
          durationSec: 60,
        },
      ]),
    );
    const result = compileVideo(recipe, manifest);
    expect(result.ready).toBe(true);
    expect(result.plan.audio).toHaveLength(count);
    expect(result.plan.audio.map((cue) => cue.from)).toEqual(starts);
  },
);
