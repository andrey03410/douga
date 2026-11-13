import { describe, expect, it } from "vitest";
import { compileVideo, createVideoDocument } from "./index";
import type { AssetManifest, CardStyle } from "./types";

function croppedDocument(kind: "image" | "video", fit?: CardStyle["fit"]) {
  const document = createVideoDocument({ kind: "top" });
  document.bindings = { asset: { kind: "pool", assetId: "asset" } };
  document.scenes = [
    {
      id: "crop",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        {
          id: "media",
          type: kind,
          asset: "asset",
          rect: { x: 0, y: 0, width: 0.3, height: 0.2 },
          style: {
            crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
            ...(fit ? { fit } : {}),
          },
        },
      ],
    },
  ];
  return document;
}

describe("cropped media dimension prerequisite", () => {
  // Catches the ready path that otherwise stretches a square selected crop to 3:2.
  for (const kind of ["image", "video"] as const) {
    for (const fit of ["contain", "cover", undefined] as const) {
      it(`requires both dimensions for ${kind}/${fit ?? "default-cover"} crops`, () => {
        const document = croppedDocument(kind, fit);
        for (const dimensions of [{}, { width: 200 }, { height: 100 }]) {
          const manifest: AssetManifest = {
            asset: {
              id: "asset",
              kind,
              src: "/media",
              durationSec: 1,
              ...dimensions,
            },
          };
          const result = compileVideo(document, manifest);
          expect(result.ready).toBe(false);
          expect(result.diagnostics).toContainEqual(
            expect.objectContaining({
              severity: "error",
              code: "MEDIA_DIMENSIONS_REQUIRED",
              path: "nodes.media.style.crop",
            }),
          );
        }
        const valid = compileVideo(document, {
          asset: {
            id: "asset",
            kind,
            src: "/media",
            durationSec: 1,
            width: 200,
            height: 100,
          },
        });
        expect(valid.ready).toBe(true);
      });
    }
    it(`retains crop+fill and uncropped ${kind} without dimensions`, () => {
      const manifest: AssetManifest = {
        asset: { id: "asset", kind, src: "/media", durationSec: 1 },
      };
      const document = croppedDocument(kind, "fill");
      expect(compileVideo(document, manifest).ready).toBe(true);
      for (const fit of ["contain", "cover", "fill"] as const) {
        document.scenes[0].nodes[0].style = { fit };
        expect(compileVideo(document, manifest).ready).toBe(true);
      }
    });
  }
  it("enforces dimensions for inherited card crops at the public compiler boundary", () => {
    const document = createVideoDocument({
      kind: "top",
      participants: [{ id: "p", label: "P", media: { visual: "asset" } }],
    });
    document.settings.card = {
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      fit: "contain",
    };
    const result = compileVideo(document, {
      asset: { id: "asset", kind: "image", src: "/media" },
    });
    expect(result.ready).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "MEDIA_DIMENSIONS_REQUIRED",
      ),
    ).toBe(true);
  });
});
