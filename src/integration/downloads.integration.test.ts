import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  onTestFinished,
} from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import {
  startDownload,
  cancelDownload,
  listDownloads,
} from "@/server/downloads";
import {
  startIsolatedDownload,
  processGroupAlive,
} from "@/test/download-job-harness";
import {
  nativeWorkMs,
  nativeTestMs,
  importCleanupMs,
} from "@/test/native-import-budget";
import { PRIVATE_NAME, UNRESOLVED_NAME } from "@/test/private-dns";

// Integration tests for URL imports. yt-dlp's generic extractor downloads
// from a LOCAL http server (no external network), the rest of the pipeline
// (job -> pool art with probe/poster/quota) is the real thing.
// Require the installed binary; the tests never fetch an external dependency.
// The fixture lives on loopback, so the SSRF guard is lifted with
// MEDIA_URL_ALLOW_PRIVATE=1 for the whole file and dropped where it is tested.

vi.mock("node:dns/promises", async (importOriginal) =>
  (await import("@/test/private-dns")).fakeDns(await importOriginal()),
);
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({
  requireUser: async () => ({ id: session.id, email: "dl@test.local", role: "user" }),
}));

const EMAIL = `integration-downloads-${randomUUID()}@test.local`;
const FFMPEG = ffmpegPath as unknown as string;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const err: Buffer[] = [];
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-300)}`,
            ),
          ),
    );
  });
}

let userId: string;
let server: Server;
let base: string;
let clipMp4: Buffer;
let toneMp3: Buffer;
let fixtureDir: string;
let onRequest: ((url: string) => void) | undefined;

async function waitForJob(jobId: string, timeoutMs = nativeWorkMs(2)) {
  const start = Date.now();
  for (;;) {
    const job = await prisma.downloadJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    if (["done", "failed", "canceled"].includes(job.status)) return job;
    if (Date.now() - start > timeoutMs)
      throw new Error(`job stuck in ${job.status}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function cleanup() {
  if (!userId) return;
  const user = await prisma.user.findFirst({
    where: { id: userId, email: EMAIL },
  });
  if (!user) return;
  const jobs = await prisma.downloadJob.findMany({ where: { userId } });
  for (const job of jobs) await removePath(`downloads/tmp/${job.id}`);
  await prisma.downloadJob.deleteMany({ where: { userId } });
  await removePath(`arts/${userId}`);
  await prisma.user.delete({ where: { id: userId } });
}

beforeAll(async () => {
  // A developer may proxy external video sites in .env. These fixtures are
  // loopback-only and must never be routed through that external proxy.
  vi.stubEnv("YTDLP_PROXY", undefined);
  vi.stubEnv("YTDLP_PATH", absPath("bin/yt-dlp"));
  vi.stubEnv("MEDIA_URL_ALLOW_PRIVATE", "1"); // restored by unstubAllEnvs
  const dir = await mkdtemp(path.join(tmpdir(), "dl-it-"));
  fixtureDir = dir;
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=10:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path.join(dir, "clip.mp4"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=2",
    path.join(dir, "tone.mp3"),
  ]);
  clipMp4 = await readFile(path.join(dir, "clip.mp4"));
  toneMp3 = await readFile(path.join(dir, "tone.mp3"));

  server = createServer((req, res) => {
    onRequest?.(req.url ?? "");
    const file = req.url?.includes("tone")
      ? toneMp3
      : req.url?.includes("clip")
        ? clipMp4
        : null;
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

  userId = (
    await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } })
  ).id;
  session.id = userId;
}, 60000);

afterAll(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  await rm(fixtureDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
}, importCleanupMs);

describe("url import pipeline", () => {
  it(
    "downloads a direct mp4 into the pool as a probed video",
    async () => {
      const job = await startIsolatedDownload(userId, {
        url: `${base}/clip.mp4`,
        mode: "video",
        quality: 1080,
        maxPoolBytes: null,
      });
      const done = await waitForJob(job.id);
      expect(done.status).toBe("done");
      expect(done.artId).toBeTruthy();

      const art = await prisma.art.findUniqueOrThrow({
        where: { id: done.artId! },
      });
      expect(art.userId).toBe(userId);
      expect(art.kind).toBe("video");
      expect(art.hasAudio).toBe(true);
      expect(art.durationSec).toBeGreaterThan(1.5);
      expect(art.sizeBytes).toBeGreaterThan(1000);
      expect(art.posterPath).toBeTruthy();
      expect(existsSync(absPath(art.filePath))).toBe(true);
      // temp dir cleaned up
      expect(existsSync(absPath(path.join("downloads", "tmp", job.id)))).toBe(
        false,
      );
    },
    nativeTestMs(2),
  );

  it(
    "audio mode lands an m4a audio in the pool",
    async () => {
      const job = await startIsolatedDownload(userId, {
        url: `${base}/tone.mp3`,
        mode: "audio",
        maxPoolBytes: null,
      });
      const done = await waitForJob(job.id);
      expect(done.status).toBe("done");
      const art = await prisma.art.findUniqueOrThrow({
        where: { id: done.artId! },
      });
      expect(art.kind).toBe("audio");
      expect(art.hasAudio).toBe(true);
      expect(art.filePath.endsWith(".m4a")).toBe(true);
    },
    nativeTestMs(2),
  );

  it("rejects garbage urls upfront", async () => {
    await expect(
      startDownload(userId, {
        url: "not a url",
        mode: "video",
        maxPoolBytes: null,
      }),
    ).rejects.toThrow("BAD_URL");
    await expect(
      startDownload(userId, {
        url: "ftp://x/y",
        mode: "video",
        maxPoolBytes: null,
      }),
    ).rejects.toThrow("BAD_URL");
    await expect(
      startDownload(userId, {
        url: `${base}/x`,
        mode: "video",
        quality: 333,
        maxPoolBytes: null,
      }),
    ).rejects.toThrow("BAD_QUALITY");
  });

  it(
    "a dead link fails with a human-readable error",
    async () => {
      const job = await startIsolatedDownload(userId, {
        url: `${base}/missing.mp4`,
        mode: "video",
        quality: 1080,
        maxPoolBytes: null,
      });
      const done = await waitForJob(job.id, nativeWorkMs(1));
      expect(done.status).toBe("failed");
      expect(done.error).toBeTruthy();
    },
    nativeTestMs(1),
  );

  it(
    "tiny pool quota blocks the download (estimate or hard cap)",
    async () => {
      const artsBefore = await prisma.art.count({ where: { userId } });
      const job = await startIsolatedDownload(userId, {
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
    },
    nativeTestMs(2),
  );

  it(
    "drains a test-owned metadata child on cleanup without late pool publication",
    async () => {
      let reached!: () => void;
      const requested = new Promise<void>((resolve) => {
        reached = resolve;
      });
      onRequest = (url) => {
        if (url === "/cancel-clip.mp4") reached();
      };
      onTestFinished(() => {
        onRequest = undefined;
      });
      const count = await prisma.art.count({ where: { userId } });
      const job = await startIsolatedDownload(userId, {
        url: `${base}/cancel-clip.mp4`,
        mode: "video",
        maxPoolBytes: null,
      });
      await requested;
      await job.stop(); // Same idempotent callback used by onTestFinished on timeout.
      await job.stop();
      expect(processGroupAlive(job.processId)).toBe(false);
      expect(
        (await prisma.downloadJob.findUniqueOrThrow({ where: { id: job.id } }))
          .status,
      ).toBe("canceled");
      expect(await prisma.art.count({ where: { userId } })).toBe(count);
      expect(existsSync(absPath(`downloads/tmp/${job.id}`))).toBe(false);
    },
    nativeTestMs(1),
  );

  it("caps parallel jobs at 2 per user", async () => {
    await prisma.downloadJob.createMany({
      data: [
        { userId, url: "http://x/1", status: "running" },
        { userId, url: "http://x/2", status: "queued" },
      ],
    });
    await expect(
      startDownload(userId, {
        url: `${base}/clip.mp4`,
        mode: "video",
        maxPoolBytes: null,
      }),
    ).rejects.toThrow("TOO_MANY_ACTIVE");
    await prisma.downloadJob.deleteMany({
      where: { userId, url: { startsWith: "http://x/" } },
    });
  });

  it("cancel marks an active job canceled; delete removes a finished one", async () => {
    const fake = await prisma.downloadJob.create({
      data: { userId, url: "http://x/slow", status: "running" },
    });
    await cancelDownload(userId, fake.id);
    expect(
      (await prisma.downloadJob.findUniqueOrThrow({ where: { id: fake.id } }))
        .status,
    ).toBe("canceled");

    await cancelDownload(userId, fake.id); // second call removes the record
    expect(
      await prisma.downloadJob.findUnique({ where: { id: fake.id } }),
    ).toBeNull();

    const other = await prisma.user.create({
      data: { email: `dl-other-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    const mine = await prisma.downloadJob.create({
      data: { userId, url: "http://x/own", status: "done" },
    });
    await expect(cancelDownload(other.id, mine.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    await prisma.downloadJob.delete({ where: { id: mine.id } });
    await prisma.user.delete({ where: { id: other.id } });

    const list = await listDownloads(userId);
    expect(list.every((j) => j.userId === userId)).toBe(true);
  });
});

describe("ssrf guard for yt-dlp links", () => {
  // Loopback, LAN, a machine-local name, IPv6 loopback and a public-looking
  // name that resolves into the LAN.
  const PRIVATE_URLS = [
    "http://127.0.0.1/clip.mp4",
    "http://10.0.0.5/clip.mp4",
    "http://localhost/clip.mp4",
    "http://[::1]/clip.mp4",
    `http://${PRIVATE_NAME}/clip.mp4`,
  ];
  const jobCount = () => prisma.downloadJob.count({ where: { userId } });
  const withoutAllowance = async (fn: () => Promise<void>) => {
    vi.stubEnv("MEDIA_URL_ALLOW_PRIVATE", undefined);
    try {
      await fn();
    } finally {
      vi.stubEnv("MEDIA_URL_ALLOW_PRIVATE", "1");
    }
  };

  it("refuses private targets and unresolvable hosts before a job row exists", async () => {
    await withoutAllowance(async () => {
      const before = await jobCount();
      for (const url of PRIVATE_URLS)
        await expect(
          startDownload(userId, { url, mode: "audio", maxPoolBytes: null }),
          url,
        ).rejects.toThrow("BLOCKED_HOST");
      await expect(
        startDownload(userId, {
          url: `http://${UNRESOLVED_NAME}/clip.mp4`,
          mode: "audio",
          maxPoolBytes: null,
        }),
      ).rejects.toThrow("HOST_UNRESOLVED");
      expect(await jobCount()).toBe(before);
    });
  });

  it("MEDIA_URL_ALLOW_PRIVATE=1 lets the same targets past the guard", async () => {
    // Two active jobs make the next check refuse, so passing the guard is
    // observable without ever starting yt-dlp against these addresses.
    await prisma.downloadJob.createMany({
      data: [
        { userId, url: "http://x/busy-1", status: "running" },
        { userId, url: "http://x/busy-2", status: "queued" },
      ],
    });
    try {
      for (const url of PRIVATE_URLS)
        await expect(
          startDownload(userId, { url, mode: "audio", maxPoolBytes: null }),
          url,
        ).rejects.toThrow("TOO_MANY_ACTIVE");
    } finally {
      await prisma.downloadJob.deleteMany({
        where: { userId, url: { startsWith: "http://x/busy-" } },
      });
    }
  });

  it("POST /api/downloads answers 400 with a readable reason", async () => {
    const { POST } = await import("@/app/api/downloads/route");
    const post = (url: string) =>
      POST(
        new Request("http://localhost/api/downloads", {
          method: "POST",
          body: JSON.stringify({ url, mode: "video" }),
        }),
      );
    await withoutAllowance(async () => {
      const before = await jobCount();
      const blocked = await post("http://10.0.0.5/clip.mp4");
      expect(blocked.status).toBe(400);
      expect((await blocked.json()).error).toMatch(/^По этому адресу ходить нельзя/);
      const missing = await post(`http://${UNRESOLVED_NAME}/clip.mp4`);
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toMatch(/не найден/);
      expect(await jobCount()).toBe(before);
    });
  });
});
