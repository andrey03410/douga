import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { importYoutubeAudio, pollDownload } from "@/mcp/youtube";
import { PRIVATE_NAME, UNRESOLVED_NAME } from "@/test/private-dns";

vi.mock("node:dns/promises", async (importOriginal) =>
  (await import("@/test/private-dns")).fakeDns(await importOriginal()),
);

const EMAIL = "integration-mcp-youtube@test.local";
let userId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.downloadJob.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("pollDownload", () => {
  it("resolves with artId when the job completes", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "running" },
    });
    setTimeout(() => {
      // .catch keeps a live handler on the promise: an unhandled, unreferenced
      // fire-and-forget update here was observed to sometimes never land
      // (Prisma's library query engine appears to drop it) under Vitest,
      // stalling this test until pollDownload's own timeout. Harmless no-op
      // handler avoids that without changing the test's intent.
      void prisma.downloadJob
        .update({ where: { id: job.id }, data: { status: "done", artId: "art-xyz" } })
        .catch(() => {});
    }, 150);
    const res = await pollDownload(job.id, { timeoutMs: 5000, intervalMs: 50 });
    expect(res.artId).toBe("art-xyz");
  });

  it("throws with the job error when the job fails", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "failed", error: "boom" },
    });
    await expect(pollDownload(job.id, { timeoutMs: 1000, intervalMs: 50 })).rejects.toThrow("boom");
  });

  it("throws on timeout while still running", async () => {
    const job = await prisma.downloadJob.create({
      data: { userId, url: "https://x/y", mode: "audio", quality: 0, status: "running" },
    });
    await expect(pollDownload(job.id, { timeoutMs: 120, intervalMs: 40 })).rejects.toThrow(/Тайм-аут/);
  });
});

describe("importYoutubeAudio refusals", () => {
  const PRIVATE_URLS = [
    "http://127.0.0.1/a",
    "http://10.0.0.5/a",
    "http://localhost/a",
    "http://[::1]/a",
    `http://${PRIVATE_NAME}/a`,
  ];
  const jobCount = () => prisma.downloadJob.count({ where: { userId } });

  it("explains a private target in plain Russian and queues nothing", async () => {
    vi.stubEnv("MEDIA_URL_ALLOW_PRIVATE", undefined);
    try {
      const before = await jobCount();
      for (const url of PRIVATE_URLS)
        await expect(
          importYoutubeAudio(userId, { url, maxPoolBytes: null }),
          url,
        ).rejects.toThrow(/^По этому адресу ходить нельзя/);
      await expect(
        importYoutubeAudio(userId, { url: `http://${UNRESOLVED_NAME}/a`, maxPoolBytes: null }),
      ).rejects.toThrow(/не найден/);
      await expect(
        importYoutubeAudio(userId, { url: "ftp://x/a", maxPoolBytes: null }),
      ).rejects.toThrow(/http\(s\)/);
      expect(await jobCount()).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("MEDIA_URL_ALLOW_PRIVATE=1 passes the guard (next refusal is the job cap)", async () => {
    vi.stubEnv("MEDIA_URL_ALLOW_PRIVATE", "1");
    await prisma.downloadJob.createMany({
      data: [
        { userId, url: "http://x/busy-1", status: "running" },
        { userId, url: "http://x/busy-2", status: "queued" },
      ],
    });
    try {
      for (const url of PRIVATE_URLS)
        await expect(
          importYoutubeAudio(userId, { url, maxPoolBytes: null }),
          url,
        ).rejects.toThrow(/Не больше двух одновременных загрузок/);
    } finally {
      vi.unstubAllEnvs();
      await prisma.downloadJob.deleteMany({
        where: { userId, url: { startsWith: "http://x/busy-" } },
      });
    }
  });
});
