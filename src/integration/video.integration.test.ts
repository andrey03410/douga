import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { extractTracksFromZip } from "@/lib/upload";
import { probeMediaInfo, findActiveSnippet } from "@/lib/audio";
import { createArt, deleteArt, listArts } from "@/server/arts";

// Integration tests for video support (spec 04) on the real Prisma schema:
// pool uploads with probing/posters, per-position audio-source and footage
// rules, preview-plan wiring, and mixed-ZIP extraction. Media fixtures are
// generated with the bundled ffmpeg.

const EMAIL = "integration-video@test.local";

const FFMPEG = ffmpegPath as unknown as string;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-400)}`)),
    );
  });
}

let dir: string;
let userId: string;
let videoWithAudio: Buffer; // 4s clip with a sine audio stream
let videoSilent: Buffer; // 2s clip without any audio stream
let mp3: Buffer;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  const tournaments = await prisma.tournament.findMany({
    where: { user: { email: EMAIL } },
  });
  for (const t of tournaments) await removePath(`tournaments/${t.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "video-it-"));
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    path.join(dir, "with-audio.mp4"),
  ]);
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    path.join(dir, "silent.mp4"),
  ]);
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    path.join(dir, "tone.mp3"),
  ]);
  videoWithAudio = await readFile(path.join(dir, "with-audio.mp4"));
  videoSilent = await readFile(path.join(dir, "silent.mp4"));
  mp3 = await readFile(path.join(dir, "tone.mp3"));

  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  userId = user.id;

}, 120_000);

afterAll(async () => {
  await cleanup();
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("pool uploads", () => {
  it("stores a video with kind, duration, audio flag and a poster frame", async () => {
    const art = await createArt(userId, { fileName: "Opening.mp4", data: videoWithAudio });
    expect(art.kind).toBe("video");
    expect(art.hasAudio).toBe(true);
    expect(art.durationSec).toBeGreaterThan(3.5);
    expect(art.posterPath).toBeTruthy();
    expect(existsSync(absPath(art.filePath))).toBe(true);
    expect(existsSync(absPath(art.posterPath!))).toBe(true);
  });

  it("marks a soundless video as hasAudio=false", async () => {
    const art = await createArt(userId, { fileName: "Ambient.mp4", data: videoSilent });
    expect(art.kind).toBe("video");
    expect(art.hasAudio).toBe(false);
  });

  it("rejects unsupported video containers", async () => {
    await expect(
      createArt(userId, { fileName: "movie.mkv", data: videoSilent }),
    ).rejects.toThrow("BAD_EXT");
  });

  it("filters the pool by kind", async () => {
    await createArt(userId, {
      fileName: "poster.png",
      data: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    const videos = await listArts(userId, { kind: "video" });
    expect(videos.arts.length).toBeGreaterThanOrEqual(2);
    expect(videos.arts.every((a) => a.kind === "video")).toBe(true);
    const images = await listArts(userId, { kind: "image" });
    expect(images.arts.every((a) => a.kind === "image")).toBe(true);
  });
});

describe("media probing and extraction", () => {
  it("probeMediaInfo reports streams correctly", async () => {
    expect(await probeMediaInfo(path.join(dir, "with-audio.mp4"))).toMatchObject({
      hasAudio: true,
      hasVideo: true,
    });
    expect(await probeMediaInfo(path.join(dir, "silent.mp4"))).toMatchObject({
      hasAudio: false,
      hasVideo: true,
    });
    const audio = await probeMediaInfo(path.join(dir, "tone.mp3"));
    expect(audio.hasAudio).toBe(true);
    expect(audio.hasVideo).toBe(false);
  });

  it("RMS snippet search fails gracefully on a soundless video", async () => {
    await expect(findActiveSnippet(path.join(dir, "silent.mp4"), 1)).rejects.toThrow();
  });

  it("extracts a mixed ZIP with per-file kinds and filename titles for video", async () => {
    const zip = new AdmZip();
    zip.addFile("music/tone.mp3", mp3);
    zip.addFile("videos/Opening 1.mp4", videoWithAudio);
    zip.addFile("videos/ignored.mkv", videoSilent);
    zip.addFile("__MACOSX/._junk.mp4", Buffer.from("junk"));
    const tracks = await extractTracksFromZip(zip.toBuffer());

    // stable order by archive path: music/ before videos/
    expect(tracks.map((t) => [t.title, t.kind])).toEqual([
      ["tone", "audio"],
      ["Opening 1", "video"],
    ]);
    const video = tracks.find((t) => t.kind === "video")!;
    expect(video.durationSec).toBeGreaterThan(3);
  });
});
