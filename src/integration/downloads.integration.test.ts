import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { startDownload, cancelDownload, listDownloads } from "@/server/downloads";

// Integration tests for URL imports. yt-dlp's generic extractor downloads
// from a LOCAL http server (no external network), the rest of the pipeline
// (job -> pool art with probe/poster/quota) is the real thing.
// Requires the fresh binary at storage/bin/yt-dlp (ensureYtDlp downloads it
// on first use; CI/dev machines with network get it automatically).

const EMAIL = "integration-downloads@test.local";
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
        : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-300)}`)),
    );
  });
}

let userId: string;
let server: Server;
let base: string;
let clipMp4: Buffer;
let toneMp3: Buffer;

async function waitForJob(jobId: string, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    const job = await prisma.downloadJob.findUniqueOrThrow({ where: { id: jobId } });
    if (["done", "failed", "canceled"].includes(job.status)) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job stuck in ${job.status}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  // A developer may proxy external video sites in .env. These fixtures are
  // loopback-only and must never be routed through that external proxy.
  vi.stubEnv("YTDLP_PROXY", undefined);
  const dir = await mkdtemp(path.join(tmpdir(), "dl-it-"));
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    path.join(dir, "clip.mp4"),
  ]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", path.join(dir, "tone.mp3")]);
  clipMp4 = await readFile(path.join(dir, "clip.mp4"));
  toneMp3 = await readFile(path.join(dir, "tone.mp3"));

  server = createServer((req, res) => {
    const file = req.url?.includes("tone") ? toneMp3 : req.url?.includes("clip") ? clipMp4 : null;
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": req.url!.includes("tone") ? "audio/mpeg" : "video/mp4",
      "Content-Length": file.length,
    });
    res.end(file);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;

  await cleanup();
  userId = (await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } })).id;
}, 60000);

afterAll(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  vi.unstubAllEnvs();
});

describe("url import pipeline", () => {
  it("downloads a direct mp4 into the pool as a probed video", async () => {
    const job = await startDownload(userId, {
      url: `${base}/clip.mp4`,
      mode: "video",
      quality: 1080,
      maxPoolBytes: null,
    });
    const done = await waitForJob(job.id);
    expect(done.status).toBe("done");
    expect(done.artId).toBeTruthy();

    const art = await prisma.art.findUniqueOrThrow({ where: { id: done.artId! } });
    expect(art.userId).toBe(userId);
    expect(art.kind).toBe("video");
    expect(art.hasAudio).toBe(true);
    expect(art.durationSec).toBeGreaterThan(1.5);
    expect(art.sizeBytes).toBeGreaterThan(1000);
    expect(art.posterPath).toBeTruthy();
    expect(existsSync(absPath(art.filePath))).toBe(true);
    // temp dir cleaned up
    expect(existsSync(absPath(path.join("downloads", "tmp", job.id)))).toBe(false);
  }, 90000);

  it("audio mode lands an m4a audio in the pool", async () => {
    const job = await startDownload(userId, {
      url: `${base}/tone.mp3`,
      mode: "audio",
      maxPoolBytes: null,
    });
    const done = await waitForJob(job.id);
    expect(done.status).toBe("done");
    const art = await prisma.art.findUniqueOrThrow({ where: { id: done.artId! } });
    expect(art.kind).toBe("audio");
    expect(art.hasAudio).toBe(true);
    expect(art.filePath.endsWith(".m4a")).toBe(true);
  }, 90000);

  it("rejects garbage urls upfront", async () => {
    await expect(
      startDownload(userId, { url: "not a url", mode: "video", maxPoolBytes: null }),
    ).rejects.toThrow("BAD_URL");
    await expect(
      startDownload(userId, { url: "ftp://x/y", mode: "video", maxPoolBytes: null }),
    ).rejects.toThrow("BAD_URL");
    await expect(
      startDownload(userId, { url: `${base}/x`, mode: "video", quality: 333, maxPoolBytes: null }),
    ).rejects.toThrow("BAD_QUALITY");
  });

  it("a dead link fails with a human-readable error", async () => {
    const job = await startDownload(userId, {
      url: `${base}/missing.mp4`,
      mode: "video",
      quality: 1080,
      maxPoolBytes: null,
    });
    const done = await waitForJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBeTruthy();
  }, 60000);

  it("tiny pool quota blocks the download (estimate or hard cap)", async () => {
    const artsBefore = await prisma.art.count({ where: { userId } });
    const job = await startDownload(userId, {
      url: `${base}/clip.mp4`,
      mode: "video",
      quality: 1080,
      maxPoolBytes: 5000, // clip is way bigger
    });
    const done = await waitForJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/квот|места|max-filesize|не влезает/i);
    // nothing leaked into the pool
    expect(await prisma.art.count({ where: { userId } })).toBe(artsBefore);
  }, 60000);

  it("caps parallel jobs at 2 per user", async () => {
    await prisma.downloadJob.createMany({
      data: [
        { userId, url: "http://x/1", status: "running" },
        { userId, url: "http://x/2", status: "queued" },
      ],
    });
    await expect(
      startDownload(userId, { url: `${base}/clip.mp4`, mode: "video", maxPoolBytes: null }),
    ).rejects.toThrow("TOO_MANY_ACTIVE");
    await prisma.downloadJob.deleteMany({ where: { userId, url: { startsWith: "http://x/" } } });
  });

  it("cancel marks an active job canceled; delete removes a finished one", async () => {
    const fake = await prisma.downloadJob.create({
      data: { userId, url: "http://x/slow", status: "running" },
    });
    await cancelDownload(userId, fake.id);
    expect(
      (await prisma.downloadJob.findUniqueOrThrow({ where: { id: fake.id } })).status,
    ).toBe("canceled");

    await cancelDownload(userId, fake.id); // second call removes the record
    expect(await prisma.downloadJob.findUnique({ where: { id: fake.id } })).toBeNull();

    const other = await prisma.user.create({
      data: { email: "dl-other@test.local", passwordHash: "x" },
    });
    const mine = await prisma.downloadJob.create({
      data: { userId, url: "http://x/own", status: "done" },
    });
    await expect(cancelDownload(other.id, mine.id)).rejects.toThrow("NOT_FOUND");
    await prisma.downloadJob.delete({ where: { id: mine.id } });
    await prisma.user.delete({ where: { id: other.id } });

    const list = await listDownloads(userId);
    expect(list.every((j) => j.userId === userId)).toBe(true);
  });
});
