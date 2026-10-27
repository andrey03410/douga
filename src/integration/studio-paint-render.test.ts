import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { expect, it } from "vitest";
import { baseNode } from "../video/nodes";
import type { CardStyle, CompiledVideo } from "../video/types";

it("renders actual linear/radial paint and soft shadow pixels through the shared Studio renderer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-paint-"));
  await mkdir(join(dir, "public"));
  try {
    const styles = [
      {
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { color: "#ff0000", at: 0 },
            { color: "#0000ff", at: 1 },
          ],
        },
      },
      {
        gradient: {
          type: "radial",
          stops: [
            { color: "white", at: 0 },
            { color: "black", at: 1 },
          ],
        },
      },
      {
        background: "white",
        shadow: { color: "black", x: 8, y: 0, blur: 10, spread: 0 },
      },
    ] as CardStyle[];
    const rects = [
      { x: 0, y: 0, width: 160, height: 90 },
      { x: 0, y: 90, width: 160, height: 90 },
      { x: 200, y: 50, width: 70, height: 60 },
    ];
    const plan: CompiledVideo = {
      schemaVersion: 1,
      compilerVersion: "1.0.0",
      seed: 1,
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 1,
      audio: [],
      scenes: [
        {
          id: "paint",
          kind: "custom",
          from: 0,
          durationInFrames: 1,
          background: "white",
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
          nodes: styles.map((style, i) =>
            baseNode("p" + i, "container", rects[i], 1, style),
          ),
        },
      ],
    };
    const serveUrl = await bundle({
      entryPoint: resolve("src/remotion/index.ts"),
      publicDir: join(dir, "public"),
      outDir: join(dir, "bundle"),
      webpackOverride: (c) => ({
        ...c,
        resolve: {
          ...c.resolve,
          alias: { ...c.resolve?.alias, "@": resolve("src") },
        },
      }),
    });
    const chrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const browserExecutable =
      process.env.REMOTION_BROWSER_EXECUTABLE ||
      (existsSync(chrome) ? chrome : undefined);
    const inputProps = { plan, assetMode: "static" };
    const composition = await selectComposition({
      serveUrl,
      id: "Studio",
      inputProps,
      browserExecutable,
    });
    const output = join(dir, "paint.png");
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      output,
      frame: 0,
      imageFormat: "png",
      browserExecutable,
    });
    const pixels = execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-i",
      output,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    const rgb = (x: number, y: number) => [
      ...pixels.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3),
    ];
    expect(rgb(8, 45)[0]).toBeGreaterThan(230);
    expect(rgb(8, 45)[2]).toBeLessThan(25);
    expect(rgb(152, 45)[2]).toBeGreaterThan(230);
    expect(rgb(152, 45)[0]).toBeLessThan(25);
    expect(rgb(80, 135)[0]).toBeGreaterThan(240);
    expect(rgb(2, 135)[0]).toBeLessThan(35);
    expect(rgb(277, 80)[0]).toBeLessThan(210);
    expect(rgb(310, 80)).toEqual([255, 255, 255]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
