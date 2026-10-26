import { describe, expect, it } from "vitest";
import {
  applyVideoPreset,
  compileVideo,
  createVideoDocument,
  extractVideoPreset,
  type AssetManifest,
} from "./index";

function filled() {
  const d = createVideoDocument({
    kind: "top",
    participants: [{ id: "one", label: "One" }],
  });
  d.bindings = {
    poster: { kind: "pool", assetId: "image-owned" },
    footage: { kind: "pool", assetId: "video-owned" },
    music: { kind: "pool", assetId: "audio-owned" },
  };
  d.scenes = [
    {
      id: "custom",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        { id: "poster", type: "image", asset: "poster" },
        {
          id: "group",
          type: "container",
          children: [
            {
              id: "footage",
              type: "video",
              asset: "footage",
              style: { playSound: true },
            },
            { id: "music", type: "audio", asset: "music", role: "music" },
          ],
        },
      ],
    },
  ];
  return d;
}
const assets: AssetManifest = {
  "image-owned": {
    id: "image-owned",
    kind: "image",
    src: "/poster.png",
    width: 10,
    height: 10,
  },
  "video-owned": {
    id: "video-owned",
    kind: "video",
    src: "/footage.mp4",
    durationSec: 1,
    hasAudio: true,
  },
  "audio-owned": {
    id: "audio-owned",
    kind: "audio",
    src: "/music.wav",
    durationSec: 1,
  },
};
function compile(d: ReturnType<typeof filled>) {
  return compileVideo(
    d,
    Object.fromEntries(
      Object.entries(d.bindings).flatMap(([key, binding]) => {
        const asset = assets[binding.kind === "pool" ? binding.assetId : ""];
        return asset ? [[key, asset]] : [];
      }),
    ),
  );
}
describe("personal preset custom media correspondence", () => {
  it("keeps rendered image, nested footage and both sounds after extraction and reapplication", () => {
    const d = filled();
    const preset = extractVideoPreset(d, { id: "mine", name: "Design" });
    expect(JSON.stringify(preset)).not.toMatch(
      /image-owned|video-owned|audio-owned|poster|footage|"asset":"music"/,
    );
    const applied = applyVideoPreset(d, preset);
    const compiled = compile(applied);
    expect(compiled.ready).toBe(true);
    expect(
      compiled.plan.scenes[0].nodes
        .filter((n) => n.media)
        .map((n) => n.media!.asset.id),
    ).toEqual(["image-owned", "video-owned"]);
    expect(compiled.plan.audio.map((cue) => cue.asset.id)).toEqual([
      "video-owned",
      "audio-owned",
    ]);
    expect(applied.source).toEqual(d.source);
  });
  it("retains current corresponding media despite stale target-slot aliases", () => {
    const d = filled();
    const preset = extractVideoPreset(d, { id: "mine", name: "Design" });
    d.bindings["slot:image:1"] = { kind: "pool", assetId: "old-image" };
    expect(
      compile(applyVideoPreset(d, preset)).plan.scenes[0].nodes[0].media?.asset
        .id,
    ).toBe("image-owned");
  });
  it.each(["removed", "retyped", "shared-slot", "reordered"])(
    "rejects %s assigned media instead of losing it or guessing",
    (change) => {
      const d = filled();
      const preset = extractVideoPreset(d, { id: "mine", name: "Design" });
      if (change === "removed") preset.scenes[0].nodes = [];
      if (change === "retyped")
        preset.scenes[0].nodes[0] = {
          id: "replacement",
          type: "video",
          asset: "slot:video:1",
        };
      if (change === "shared-slot") {
        d.bindings.second = { kind: "pool", assetId: "another-image" };
        d.scenes[0].nodes.push({
          id: "second",
          type: "image",
          asset: "second",
        });
        preset.scenes[0].nodes.push({
          id: "second",
          type: "image",
          asset: "slot:image:1",
        });
      }
      if (change === "reordered") preset.scenes[0].nodes.reverse();
      expect(() => applyVideoPreset(d, preset)).toThrow(/PRESET_INCOMPATIBLE/);
    },
  );
  it("retains explicit participant scene context on an extracted round trip", () => {
    const d = filled();
    d.scenes[0].participantId = "one";
    const applied = applyVideoPreset(
      d,
      extractVideoPreset(d, { id: "mine", name: "Design" }),
    );
    expect(applied.scenes[0].participantId).toBe("one");
    expect(applied.scenes[0].repeat).toBeUndefined();
    expect(compile(applied).plan.scenes).toHaveLength(1);
  });
  it("preserves corresponding literal copy and concrete card identity while applying geometry", () => {
    const d = filled();
    d.scenes[0].nodes.push(
      { id: "question", type: "text", text: "Private question" },
      {
        id: "card",
        type: "card",
        participantId: "one",
        label: "Private caption",
      },
    );
    const preset = extractVideoPreset(d, { id: "mine", name: "Design" });
    preset.scenes[0].nodes[2].opacity = 0.5;
    const applied = applyVideoPreset(d, preset);
    expect(applied.scenes[0].nodes[2]).toMatchObject({
      text: "Private question",
      opacity: 0.5,
    });
    expect(applied.scenes[0].nodes[3]).toMatchObject({
      participantId: "one",
      label: "Private caption",
    });
  });
  it("rejects reordered same-kind canonical nodes instead of exchanging their assignments", () => {
    const d = filled();
    d.bindings.second = { kind: "pool", assetId: "another-image" };
    d.scenes[0].nodes = [
      { id: "first", type: "image", asset: "poster" },
      { id: "second", type: "image", asset: "second" },
    ];
    const preset = extractVideoPreset(d, { id: "mine", name: "Design" });
    preset.scenes[0].nodes.reverse();
    expect(() => applyVideoPreset(d, preset)).toThrow(/PRESET_INCOMPATIBLE/);
  });
  it("does not overwrite participant media when a target slot name is already used there", () => {
    const d = filled();
    d.bindings["slot:image:1"] = { kind: "pool", assetId: "participant-image" };
    d.source.participants[0].media = { visual: "slot:image:1" };
    const applied = applyVideoPreset(
      d,
      extractVideoPreset(d, { id: "mine", name: "Design" }),
    );
    expect(applied.bindings["slot:image:1"]).toEqual({
      kind: "pool",
      assetId: "participant-image",
    });
    expect(compile(applied).plan.scenes[0].nodes[0].media?.asset.id).toBe(
      "image-owned",
    );
  });
});
describe("explicit custom visual media requiredness", () => {
  for (const type of ["image", "video"] as const)
    for (const asset of ["missing", `slot:${type}:1`])
      it.each([true, false, undefined])(
        `${type} ${asset} required=%s controls readiness`,
        (required) => {
          const d = createVideoDocument({ kind: "top" });
          d.scenes = [
            {
              id: "custom",
              block: "custom",
              duration: { sec: 1 },
              nodes: [{ id: "media", type, asset, required }],
            },
          ];
          const result = compileVideo(d);
          expect(result.ready).toBe(required === false);
          expect(
            result.diagnostics.find((x) => x.code === "ASSET_NOT_FOUND")
              ?.severity,
          ).toBe(required === false ? "warning" : "error");
        },
      );
});
