import { afterAll, beforeAll, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";
import * as audio from "./audio";
import { captureMediaProbe } from "./media-probe";

let directory: string, noisy: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "audio-probe-"));
  noisy = join(directory, "metadata.m4a");
  const metadata = join(directory, "metadata.txt");
  await writeFile(
    metadata,
    `;FFMETADATA1\n${Array.from({ length: 8000 }, (_, i) => `tag${i}=${"x".repeat(200)}`).join("\n")}\n`,
  );
  execFileSync(ffmpeg!, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.1",
    "-f",
    "ffmetadata",
    "-i",
    metadata,
    "-map",
    "0:a",
    "-map_metadata",
    "1",
    "-c:a",
    "aac",
    "-movflags",
    "use_metadata_tags",
    noisy,
  ]);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function checkTerminated(
  child: ChildProcess,
  code: string,
  timeoutMs: number,
  maxDiagnosticBytes: number,
) {
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  let closeObserved = false;
  child.once("close", () => {
    closeObserved = true;
  });
  try {
    await expect(
      captureMediaProbe(child, {
        timeoutMs,
        maxDiagnosticBytes,
        killGraceMs: 50,
      }),
    ).rejects.toMatchObject({ code });
    expect(closeObserved).toBe(true);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  }
}

it.skipIf(process.platform === "win32")(
  "kills and reaps an actual stalled FFmpeg probe at its deadline",
  async () => {
    const fifo = join(directory, "stall.fifo");
    execFileSync("mkfifo", [fifo]);
    const child = spawn(ffmpeg!, ["-i", fifo], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    await checkTerminated(child, "MEDIA_PROBE_TIMEOUT", 150, 16 * 1024);
  },
);

it("kills and reaps an actual noisy FFmpeg probe when diagnostics exceed the byte cap", async () => {
  const child = spawn(ffmpeg!, ["-i", noisy], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  await checkTerminated(child, "MEDIA_PROBE_OUTPUT_LIMIT", 2000, 16 * 1024);
});

it.skipIf(process.platform === "win32")(
  "escalates a deadline to SIGKILL and waits when a real probe child ignores SIGTERM",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{}); process.stderr.write('ready\\n'); setInterval(()=>{},1000)",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    await new Promise<void>((resolve) =>
      child.stderr.once("data", () => resolve()),
    );
    await checkTerminated(child, "MEDIA_PROBE_TIMEOUT", 50, 16 * 1024);
    expect(child.signalCode).toBe("SIGKILL");
  },
);

it("preserves valid real audio metadata and legacy missing-input fallback", async () => {
  const file = join(directory, "valid.wav");
  execFileSync(ffmpeg!, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=0.25",
    file,
  ]);
  expect(await audio.probeMediaInfo(file)).toMatchObject({
    durationSec: 0.25,
    hasAudio: true,
    hasVideo: false,
  });
  expect(await audio.probeMediaInfo(join(directory, "missing.wav"))).toEqual({
    durationSec: null,
    hasAudio: false,
    hasVideo: false,
  });
});
