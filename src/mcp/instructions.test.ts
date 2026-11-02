import { describe, expect, it } from "vitest";
import { compileVideo, getBuiltinPreset, type AssetManifest } from "@/video";
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES } from "./instructions";
import { videoExamples } from "./studio-tools";

describe("MCP instructions", () => {
  it("fits in 3 KB and names the tournament and manual paths", () => {
    expect(Buffer.byteLength(MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(3072);
    expect(MCP_INSTRUCTIONS).toContain("video_source_list");
    // sourceId is a factory option: video_project_create refuses it without presetId
    expect(MCP_INSTRUCTIONS).toMatch(/presetId[^\n]*sourceId/);
    expect(getBuiltinPreset("top.classic.wide")?.kind).toBe("top");
    expect(MCP_INSTRUCTIONS).toContain('source.kind:"manual"');
    expect(MCP_INSTRUCTIONS).toContain("picker.*");
    expect(new Set(MCP_TOOL_NAMES).size).toBe(46);
  });
});

describe("top-manual example", () => {
  it("passes the document schema and compiles with a stand-in manifest", () => {
    const example = videoExamples().items.find((item) => item.id === "top-manual");
    expect(example).toBeTruthy();
    const doc = example!.document;
    expect(doc.source.kind).toBe("manual");
    expect(doc.source.participants).toHaveLength(3);
    expect(doc.settings.top?.snippet?.mode).toBe("active");
    expect(doc.source.participants.every((p) => p.rank && p.media?.audio && p.media.visual)).toBe(
      true,
    );
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
