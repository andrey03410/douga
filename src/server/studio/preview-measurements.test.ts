import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { measureInspectionPreview } from "./preview-measurements";
const directory = path.resolve(`storage/verification/32-storyboard/audio-test-${randomUUID()}`);
beforeAll(async () => { await mkdir(directory, { recursive: true }); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
it("decodes actual preview samples and distinguishes a tone from silence", async () => {
  const files = ["tone", "silence"].map(name => path.join(directory, `${name}.wav`));
  for (const [i, file] of files.entries()) execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", i ? "anullsrc=r=48000:cl=mono" : "sine=frequency=440:duration=0.2", "-t", "0.2", file]);
  const tone = await measureInspectionPreview(files[0]);
  const silent = await measureInspectionPreview(files[1]);
  expect(tone.decoded).toBe(true); expect(tone.audio?.silent).toBe(false);
  expect(silent.audio?.silent).toBe(true);
  expect(tone.audio!.peakDb!).toBeGreaterThan(silent.audio!.peakDb!);
});
