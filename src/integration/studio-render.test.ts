import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { expect, it } from "vitest";
import type { CompiledVideo } from "../video/types";

// A helper-only frame test misses Remotion timeline clamping, trim offsets,
// native audio loop handling and encoder output. Exercise the real boundary.
it("renders late-scene video source offsets and continuous audio policy across source loops", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-render-"));
  const publicDir = join(directory, "public");
  await mkdir(publicDir);
  const run = (args: string[]) =>
    execFileSync(ffmpeg!, ["-y", "-v", "error", ...args], {
      maxBuffer: 8 * 1024 * 1024,
    });
  try {
    run([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=30:d=1",
      "-vf",
      "drawbox=color=green:t=fill:enable='between(n,10,19)',drawbox=color=blue:t=fill:enable='gte(n,20)'",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(publicDir, "colors.mp4"),
    ]);
    run([
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.125*sin(2*PI*if(lt(t\\,0.5)\\,220\\,880)*t):s=48000:d=1",
      join(publicDir, "tone.wav"),
    ]);
    const plan: CompiledVideo = {
      schemaVersion: 1,
      compilerVersion: "1.0.0",
      seed: 1,
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 60,
      scenes: [
        {
          id: "loops",
          kind: "custom",
          from: 0,
          durationInFrames: 58,
          background: "#010101",
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
          nodes: [
            {
              id: "loop",
              type: "video",
              rect: { x: 0, y: 0, width: 160, height: 180 },
              layer: 0,
              from: 0,
              durationInFrames: 58,
              visible: [{ from: 0, to: 58 }],
              style: {},
              opacity: 1,
              rotate: 0,
              scale: 1,
              animation: [],
              media: {
                asset: {
                  id: "colors",
                  kind: "video",
                  src: "colors.mp4",
                  width: 64,
                  height: 64,
                  durationSec: 1,
                },
                offsetFrames: 15,
                loopFrames: 15,
                freezeAtFrame: 29,
                fit: "fill",
              },
            },
            {
              id: "hold",
              type: "video",
              rect: { x: 160, y: 0, width: 160, height: 180 },
              layer: 0,
              from: 0,
              durationInFrames: 58,
              visible: [{ from: 0, to: 58 }],
              style: {},
              opacity: 1,
              rotate: 0,
              scale: 1,
              animation: [],
              media: {
                asset: {
                  id: "colors",
                  kind: "video",
                  src: "colors.mp4",
                  width: 64,
                  height: 64,
                  durationSec: 1,
                },
                offsetFrames: 24,
                loopFrames: null,
                freezeAtFrame: 29,
                fit: "fill",
              },
            },
          ],
        },
        {
          id: "late",
          kind: "custom",
          from: 58,
          durationInFrames: 2,
          background: "#010101",
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
          nodes: [
            {
              id: "video",
              type: "video",
              rect: { x: 0, y: 0, width: 320, height: 180 },
              layer: 0,
              from: 0,
              durationInFrames: 2,
              visible: [{ from: 0, to: 2 }],
              style: {},
              opacity: 1,
              rotate: 0,
              scale: 1,
              animation: [],
              media: {
                asset: {
                  id: "colors",
                  kind: "video",
                  src: "colors.mp4",
                  width: 64,
                  height: 64,
                  durationSec: 1,
                },
                offsetFrames: 24,
                loopFrames: null,
                freezeAtFrame: 29,
                fit: "fill",
              },
            },
          ],
        },
      ],
      audio: [
        {
          id: "music",
          role: "music",
          asset: { id: "tone", kind: "audio", src: "tone.wav", durationSec: 1 },
          from: 3,
          durationInFrames: 50,
          offsetFrames: 15,
          loopFrames: 15,
          volume: 0.8,
          fadeInFrames: 6,
          fadeOutFrames: 6,
          duckVolume: 0.25,
          duckWindows: [{ from: 15, to: 21 }],
          muteWindows: [{ from: 30, to: 36 }],
        },
      ],
    };
    const inputProps = { plan, assetMode: "static" };
    const serveUrl = await bundle({
      entryPoint: resolve("src/remotion/index.ts"),
      publicDir,
      outDir: join(directory, "bundle"),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: { ...config.resolve?.alias, "@": resolve("src") },
        },
      }),
    });
    const macChrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const browserExecutable =
      process.env.REMOTION_BROWSER_EXECUTABLE ||
      (existsSync(macChrome) ? macChrome : undefined);
    const composition = await selectComposition({
      serveUrl,
      id: "Studio",
      inputProps,
      browserExecutable,
    });
    expect([
      composition.width,
      composition.height,
      composition.fps,
      composition.durationInFrames,
    ]).toEqual([320, 180, 30, 60]);
    const still = join(directory, "late.png");
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      frame: 59,
      output: still,
    });
    const rgb = run([
      "-i",
      still,
      "-vf",
      "crop=1:1:160:90,format=rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    expect(rgb[2]).toBeGreaterThan(230); // source frame 25 is blue; output-local frame 1 is red
    expect(rgb[0]).toBeLessThan(20);
    const loopStill = join(directory, "loop-hold.png");
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      frame: 30,
      output: loopStill,
    });
    const loopPixel = run([
      "-i",
      loopStill,
      "-vf",
      "crop=1:1:80:90,format=rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    const holdPixel = run([
      "-i",
      loopStill,
      "-vf",
      "crop=1:1:240:90,format=rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    expect(loopPixel[1]).toBeGreaterThan(110); // loop restarts at source 15 (green), not source 0 (red)
    expect(loopPixel[0]).toBeLessThan(20);
    expect(holdPixel[2]).toBeGreaterThan(230); // hold remains at source 29, with no black tail
    const output = join(directory, "policy.mp4");
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: output,
      concurrency: 2,
    });
    const pcm = run([
      "-i",
      output,
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-f",
      "f32le",
      "pipe:1",
    ]);
    const samples = new Float32Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
    const rms = (at: number) => {
      const region = samples.slice(
        Math.round(at * 48000),
        Math.round((at + 0.04) * 48000),
      );
      return Math.sqrt(
        region.reduce((sum, value) => sum + value * value, 0) / region.length,
      );
    };
    const normal = rms(0.42);
    expect(normal).toBeGreaterThan(0.03);
    expect(rms(0.61)).toBeGreaterThan(normal * 0.15);
    expect(rms(0.61)).toBeLessThan(normal * 0.35);
    expect(rms(1.1)).toBeLessThan(normal * 0.03);
    expect(rms(1.4)).toBeGreaterThan(normal * 0.8);
    expect(rms(1.9)).toBeLessThan(normal * 0.03);
    // The selected half of the source contains 880 Hz; its discarded prefix is 220 Hz.
    const frequency = (at: number) => {
      const region = samples.slice(
        Math.round(at * 48000),
        Math.round((at + 0.04) * 48000),
      );
      let crossings = 0;
      for (let i = 1; i < region.length; i++)
        if (region[i - 1] <= 0 && region[i] > 0) crossings++;
      return crossings / 0.04;
    };
    expect(frequency(0.42)).toBeGreaterThan(800);
    expect(frequency(1.4)).toBeGreaterThan(800);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
