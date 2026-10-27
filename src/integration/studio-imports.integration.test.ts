import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
  vi,
  onTestFinished,
} from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { probeMediaInfo } from "@/lib/audio";
import { fileHash } from "@/server/studio/assets";
import { quotasFor } from "@/lib/domain/permissions";
import * as studio from "@/server/studio";
import * as importsInternal from "@/server/studio/imports";
import { createVideoDocument } from "@/video";
import { deleteArt } from "@/server/arts";
import { studioHttpError as importsHttpError } from "@/server/studio/http";
import {
  nativeWorkMs,
  nativeTestMs,
  importCleanupMs,
} from "@/test/native-import-budget";
import { PRIVATE_NAME, UNRESOLVED_NAME } from "@/test/private-dns";

vi.mock("node:dns/promises", async (importOriginal) =>
  (await import("@/test/private-dns")).fakeDns(await importOriginal()),
);
// Only for studioHttpError's module graph; no request here is authenticated.
vi.mock("@/auth", () => ({ requireUser: async () => ({ id: "" }) }));

let owner: string, other: string, server: Server, url: string, bytes: Buffer;
let requests = 0;
let onRequest: (() => void) | undefined;
const fixture = `studio-import-fixture-${randomUUID()}`;
const proxy = process.env.YTDLP_PROXY;
const ytDlpPath = process.env.YTDLP_PATH;
const allowPrivate = process.env.MEDIA_URL_ALLOW_PRIVATE;
beforeAll(async () => {
  // The fixture is on loopback: lift the SSRF guard for this process and its
  // worker children; the guard tests below drop it again.
  process.env.MEDIA_URL_ALLOW_PRIVATE = "1";
  process.env.YTDLP_PATH = absPath("bin/yt-dlp"); // Require the installed real binary, never fetch a test dependency.
  process.env.YTDLP_PROXY = ""; // ONLY this test process and its loopback worker children.
  await mkdir(absPath(fixture), { recursive: true });
  await promisify(execFile)(ffmpeg!, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-t",
    "0.6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    absPath(`${fixture}/sample.mp4`),
  ]);
  bytes = await readFile(absPath(`${fixture}/sample.mp4`));
  server = createServer((req, res) => {
    requests++;
    onRequest?.();
    if (req.url?.startsWith("/missing")) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": bytes.length,
    });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/PRIVATE-IMPORT-TITLE-8426.mp4`;
  owner = (
    await prisma.user.create({
      data: { email: `imports-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `imports-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
}, 30_000);
afterAll(async () => {
  if (allowPrivate === undefined) delete process.env.MEDIA_URL_ALLOW_PRIVATE;
  else process.env.MEDIA_URL_ALLOW_PRIVATE = allowPrivate;
  if (ytDlpPath === undefined) delete process.env.YTDLP_PATH;
  else process.env.YTDLP_PATH = ytDlpPath;
  if (proxy === undefined) delete process.env.YTDLP_PROXY;
  else process.env.YTDLP_PROXY = proxy;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const userId of [owner, other].filter(Boolean)) {
    await prisma.user.update({ where: { id: userId }, data: { role: "user" } });
    for (const j of await prisma.studioJob.findMany({ where: { userId } })) {
      await studio.cancelStudioJob(userId, j.id);
      await studio.deleteStudioJob(userId, j.id);
    }
    for (const p of await studio.listStudioProjects(userId))
      await studio.deleteStudioProject(userId, p.id);
    await prisma.user.delete({ where: { id: userId } });
    await removePath(`arts/${userId}`);
    await removePath(`studio/${userId}`);
    await removePath(`studio-jobs/${userId}`);
  }
  await removePath(fixture);
});
const start = (overrides = {}) =>
  studio.startStudioImport(owner, { url, mode: "video", ...overrides });

function managedWorker(jobId: string) {
  let working: ReturnType<typeof studio.runStudioWorkerOnce> | undefined;
  let cleaning = false;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      cleaning = true;
      onRequest = undefined;
      const row = await prisma.studioJob.findFirst({
        where: { id: jobId, userId: owner },
      });
      if (row && ["queued", "running"].includes(row.status))
        await studio.cancelStudioJob(owner, jobId);
      // Await the independent worker, never the test promise that calls cleanup.
      await working?.catch(() => undefined);
    })());
  onTestFinished(cleanup, importCleanupMs); // Before any real native work.
  return {
    cleanup,
    get cleaning() {
      return cleaning;
    },
    run() {
      if (cleaning) throw new Error("Test worker is already draining");
      working = studio.runStudioWorkerOnce({ jobId });
      return working;
    },
  };
}

describe("durable standalone imports", () => {
  it("queues without network/project/engine work, replays once and validates strict inputs", async () => {
    const before = requests;
    const input = { url, mode: "video" as const, idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([
      studio.startStudioImport(owner, input),
      studio.startStudioImport(owner, input),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      kind: "import",
      status: "queued",
      projectId: null,
      snapshotId: null,
      attempts: 0,
      result: null,
    });
    expect(requests).toBe(before);
    expect(await prisma.art.count({ where: { userId: owner } })).toBe(0);
    await expect(
      studio.startStudioImport(owner, { ...input, mode: "audio" }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(start({ maxPoolBytes: null })).rejects.toThrow();
    await expect(start({ url: "file:///etc/passwd" })).rejects.toThrow();
    await expect(start({ url: "not a URL" })).rejects.toMatchObject({
      name: "ZodError",
    });
    await expect(start({ quality: 999 })).rejects.toThrow();
    await expect(studio.getStudioJob(other, a.id)).rejects.toThrow("NOT_FOUND");
    await expect(studio.cancelStudioJob(other, a.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(studio.deleteStudioJob(owner, a.id)).rejects.toThrow(
      "JOB_ACTIVE",
    );
    await studio.cancelStudioJob(owner, a.id);
    expect(await studio.runStudioWorkerOnce({ jobId: a.id })).toBeNull();
    await studio.deleteStudioJob(owner, a.id);
  });
  it(
    "downloads actual streams in scoped child and publishes one complete owned pool asset",
    async () => {
      const j = await start();
      const worker = managedWorker(j.id);
      const result = await worker.run();
      expect(result).toMatchObject({
        status: "done",
        attempts: 1,
        result: { kind: "import", asset: { kind: "video", hasAudio: true } },
      });
      if (result?.result?.kind !== "import")
        throw new Error(JSON.stringify(result));
      const art = await prisma.art.findUniqueOrThrow({
        where: { id: result.result.asset.id },
      });
      expect(art.userId).toBe(owner);
      expect(art.label).toContain("PRIVATE-IMPORT-TITLE-8426");
      expect(JSON.stringify(result)).not.toContain("PRIVATE-IMPORT-TITLE-8426");
      expect(result.result.asset).not.toHaveProperty("label");
      expect(
        JSON.stringify(await studio.getStudioJob(owner, j.id)),
      ).not.toContain("PRIVATE-IMPORT-TITLE-8426");
      expect(
        JSON.stringify(await studio.cancelStudioJob(owner, j.id)),
      ).not.toContain("PRIVATE-IMPORT-TITLE-8426");
      expect(art.filePath).not.toBe("");
      expect(await fileHash(absPath(art.filePath))).toBe(
        result.result.asset.hash,
      );
      expect(await probeMediaInfo(absPath(art.filePath))).toMatchObject({
        hasVideo: true,
        hasAudio: true,
      });
      expect(art.durationSec).toBeGreaterThan(0);
      expect(art.posterPath).toBeTruthy();
      expect(await studio.runStudioWorkerOnce({ jobId: j.id })).toBeNull();
      expect(await prisma.art.count({ where: { userId: owner } })).toBe(1);
      expect(
        (await prisma.studioJob.findUniqueOrThrow({ where: { id: j.id } }))
          .outputBytes,
      ).toBe(0);
      const artifact = await studio.getStudioJobArtifact(owner, j.id);
      expect(artifact.path).toBe(absPath(art.filePath));
      await expect(studio.getStudioJobArtifact(other, j.id)).rejects.toThrow(
        "NOT_FOUND",
      );
      const document = createVideoDocument({
        kind: "top",
        participants: [{ id: "one", label: "Imported" }],
      });
      document.bindings.imported = { kind: "pool", assetId: art.id };
      const project = await studio.createStudioProject(owner, { document });
      expect(await studio.deleteStudioJob(owner, j.id)).toMatchObject({
        deleted: true,
        preservedAssetId: art.id,
      });
      await expect(deleteArt(owner, art.id)).rejects.toThrow(
        "STUDIO_ASSET_IN_USE",
      );
      await studio.deleteStudioProject(owner, project.id);
      expect(await readFile(absPath(art.filePath))).toHaveLength(
        art.sizeBytes!,
      );
      await deleteArt(owner, art.id);
    },
    nativeTestMs(2),
  );
  it("checks fresh roles and pool quota before executing", async () => {
    const j = await start();
    await prisma.user.update({ where: { id: owner }, data: { role: "guest" } });
    const result = await studio.runStudioWorkerOnce({ jobId: j.id });
    expect(result).toMatchObject({ status: "failed", error: "FORBIDDEN" });
    await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
    await studio.deleteStudioJob(owner, j.id);
    const filler = await prisma.art.create({
      data: {
        userId: owner,
        filePath: "not-a-file",
        sizeBytes: quotasFor("user").maxPoolBytes,
      },
    });
    await expect(start()).rejects.toThrow("POOL_QUOTA");
    await prisma.art.delete({ where: { id: filler.id } });
    const queued = await start();
    const fill = await prisma.art.create({
      data: {
        userId: owner,
        filePath: "not-a-file",
        sizeBytes: quotasFor("user").maxPoolBytes,
      },
    });
    expect(
      await studio.runStudioWorkerOnce({ jobId: queued.id }),
    ).toMatchObject({ status: "failed", error: "POOL_QUOTA" });
    await prisma.art.delete({ where: { id: fill.id } });
    await studio.deleteStudioJob(owner, queued.id);
  });
  it.skipIf(process.platform === "win32")(
    "recovers after actual worker SIGKILL and retains exactly one audio result",
    async () => {
      const j = await start({ mode: "audio" });
      let reached!: () => void;
      const network = new Promise<void>((resolve) => {
        reached = resolve;
      });
      onRequest = () => reached();
      const cli = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/studio-worker.ts",
          "--once",
          "--job",
          j.id,
        ],
        {
          env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.mcp.json" },
          stdio: "ignore",
        },
      );
      try {
        await network;
        const childPid = Number(
          (await promisify(execFile)("pgrep", ["-P", String(cli.pid)])).stdout
            .trim()
            .split("\n")[0],
        );
        const exited = new Promise<void>((resolve) =>
          cli.once("close", () => resolve()),
        );
        cli.kill("SIGKILL");
        await exited;
        // IPC disconnect must kill the import child and its yt-dlp/ffmpeg group.
        for (let tries = 0; tries < 100; tries++) {
          let alive = false;
          try {
            process.kill(childPid, 0);
            alive = true;
          } catch {}
          if (!alive) break;
          if (tries === 99)
            throw new Error("Orphan import child survived worker SIGKILL");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(await prisma.art.count({ where: { userId: owner } })).toBe(0);
        const crashed = await prisma.studioJob.findUniqueOrThrow({
          where: { id: j.id },
        });
        expect(crashed.status).toBe("running");
        await prisma.studioJob.update({
          where: { id: j.id },
          data: { leaseUntil: new Date(0) },
        });
        await prisma.studioWorkerLease.updateMany({
          where: { token: crashed.leaseToken },
          data: { until: new Date(0) },
        });
      } finally {
        onRequest = undefined;
        cli.kill("SIGKILL");
      }
      const orphan = `${importsInternal.importPoolDirectory(owner, j.id)}/old-attempt`;
      await mkdir(absPath(orphan), { recursive: true });
      await writeFile(absPath(`${orphan}/media.mp4`), bytes);
      // Fresh CLI process recovers the durable row, no web-process promise.
      await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/studio-worker.ts",
          "--once",
          "--job",
          j.id,
        ],
        {
          env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.mcp.json" },
          timeout: nativeWorkMs(2),
        },
      );
      const result = await studio.getStudioJob(owner, j.id);
      await expect(readFile(absPath(`${orphan}/media.mp4`))).rejects.toThrow();
      expect(result).toMatchObject({
        status: "done",
        attempts: 2,
        result: { kind: "import", asset: { kind: "audio", hasAudio: true } },
      });
      if (result?.result?.kind !== "import")
        throw new Error(JSON.stringify(result));
      const art = await prisma.art.findUniqueOrThrow({
        where: { id: result.result.asset.id },
      });
      expect(await probeMediaInfo(absPath(art.filePath))).toMatchObject({
        hasVideo: false,
        hasAudio: true,
      });
      // Pool deletion remains explicit; a job's historical result cannot serve
      // deleted pool bytes or another account's replacement resource.
      await deleteArt(owner, art.id);
      await expect(studio.getStudioJobArtifact(owner, j.id)).rejects.toThrow(
        "ASSET_NOT_FOUND",
      );
      expect(await studio.deleteStudioJob(owner, j.id)).toMatchObject({
        preservedAssetId: null,
      });
    },
    nativeTestMs(3), // Interrupted metadata invocation plus metadata + download.
  );
  it(
    "bounds transient retries without publishing incomplete Art rows",
    async () => {
      const j = await start({ url: url.replace(/[^/]+$/, "missing.mp4") });
      const worker = managedWorker(j.id);
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (worker.cleaning) return;
          await prisma.studioJob.update({
            where: { id: j.id },
            data: { availableAt: new Date(0) },
          });
          const result = await worker.run();
          if (worker.cleaning) return; // A framework timeout must not start another attempt.
          expect(result).toMatchObject({
            status: attempt === 3 ? "failed" : "queued",
            attempts: attempt,
            error: "IMPORT_FAILED",
          });
          expect(await prisma.art.count({ where: { userId: owner } })).toBe(0);
        }
      } finally {
        await worker.cleanup();
      }
      await studio.deleteStudioJob(owner, j.id);
    },
    nativeTestMs(3),
  ); // Three separate failed metadata processes, not one attempt.

  it(
    "cancels an active child with no pool publication",
    async () => {
      const j = await start();
      const worker = managedWorker(j.id);
      let reached!: () => void;
      const network = new Promise<void>((resolve) => {
        reached = resolve;
      });
      onRequest = () => reached();
      const working = worker.run();
      try {
        await network;
        await worker.cleanup();
        expect(await working).toMatchObject({
          status: "canceled",
          result: null,
        });
        expect(
          (await prisma.studioJob.findUniqueOrThrow({ where: { id: j.id } }))
            .leaseUntil,
        ).toBeNull();
        expect(() => worker.run()).toThrow("already draining");
        expect(await prisma.art.count({ where: { userId: owner } })).toBe(0);
        await studio.deleteStudioJob(owner, j.id);
      } finally {
        await worker.cleanup();
      }
    },
    nativeTestMs(1),
  );
  it.each(["role", "quota", "cancel", "lease"] as const)(
    "fences %s changes at publication and cleans only its attempt",
    async (change) => {
      const j = await start();
      let filler: string | undefined;
      let cleaning = false;
      let working: ReturnType<typeof studio.runStudioWorkerOnce> | undefined;
      let cleanupPromise: Promise<void> | undefined;
      const original = importsInternal.stageImportPublication;
      const hook = vi
        .spyOn(importsInternal, "stageImportPublication")
        .mockImplementationOnce(async (job, prepared) => {
          const staged = await original(job, prepared);
          // A timed-out test can finish while the real child is still working.
          // Its cleanup must not be followed by late fixture mutations.
          if (cleaning) return staged;
          if (change === "role")
            await prisma.user.update({
              where: { id: owner },
              data: { role: "guest" },
            });
          if (change === "quota")
            filler = (
              await prisma.art.create({
                data: {
                  userId: owner,
                  filePath: "quota-fixture",
                  sizeBytes: quotasFor("user").maxPoolBytes,
                },
              })
            ).id;
          if (change === "cancel") await studio.cancelStudioJob(owner, j.id);
          if (change === "lease")
            await prisma.studioJob.update({
              where: { id: j.id },
              data: { leaseUntil: new Date(0) },
            });
          return staged;
        });
      const cleanup = () =>
        (cleanupPromise ??= (async () => {
          cleaning = true;
          hook.mockRestore();
          await prisma.user.update({
            where: { id: owner },
            data: { role: "user" },
          });
          try {
            await studio.cancelStudioJob(owner, j.id);
          } catch (error) {
            // An already-running role hook may have completed after the first reset.
            if (
              !(error instanceof studio.StudioError) ||
              error.code !== "FORBIDDEN"
            )
              throw error;
            await prisma.user.update({
              where: { id: owner },
              data: { role: "user" },
            });
            await studio.cancelStudioJob(owner, j.id);
          }
          // Await the independent worker promise, never the test promise whose
          // finally/onTestFinished is awaiting this idempotent cleanup.
          await working?.catch(() => undefined);
          await prisma.user.update({
            where: { id: owner },
            data: { role: "user" },
          });
          if (filler)
            await prisma.art.deleteMany({
              where: { id: filler, userId: owner },
            });
          await studio.deleteStudioJob(owner, j.id);
        })());
      onTestFinished(cleanup, importCleanupMs);
      try {
        working = studio.runStudioWorkerOnce({ jobId: j.id });
        const result = await working;
        expect(result?.result).toBeNull();
        expect(result?.status).not.toBe("done");
        expect(
          await prisma.art.count({
            where: {
              userId: owner,
              ...(filler ? { id: { not: filler } } : {}),
            },
          }),
        ).toBe(0);
      } finally {
        await cleanup();
      }
    },
    nativeTestMs(2),
  );
});

describe("ssrf guard", () => {
  const PRIVATE_URLS = [
    "http://127.0.0.1/a.mp4",
    "http://10.0.0.5/a.mp4",
    "http://localhost/a.mp4",
    "http://[::1]/a.mp4",
    `http://${PRIVATE_NAME}/a.mp4`,
  ];
  const jobCount = () => prisma.studioJob.count({ where: { userId: owner } });
  const withoutAllowance = async <T>(fn: () => Promise<T>) => {
    delete process.env.MEDIA_URL_ALLOW_PRIVATE;
    try {
      return await fn();
    } finally {
      process.env.MEDIA_URL_ALLOW_PRIVATE = "1";
    }
  };

  it("refuses private targets at start with no job row", async () => {
    await withoutAllowance(async () => {
      const before = await jobCount();
      for (const target of PRIVATE_URLS)
        await expect(start({ url: target }), target).rejects.toMatchObject({
          name: "StudioError",
          code: "BLOCKED_HOST",
        });
      expect(await jobCount()).toBe(before);
    });
    const response = importsHttpError(new studio.StudioError("BLOCKED_HOST"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "BLOCKED_HOST" });
  });

  it("leaves an unresolvable host to the worker's retries", async () => {
    const j = await withoutAllowance(() =>
      start({ url: `http://${UNRESOLVED_NAME}/a.mp4` }),
    );
    expect(j).toMatchObject({ status: "queued" });
    await studio.cancelStudioJob(owner, j.id);
    await studio.deleteStudioJob(owner, j.id);
  });

  it("MEDIA_URL_ALLOW_PRIVATE=1 enqueues the same targets", async () => {
    for (const target of PRIVATE_URLS) {
      const j = await start({ url: target });
      expect(j, target).toMatchObject({ status: "queued" });
      await studio.cancelStudioJob(owner, j.id);
      await studio.deleteStudioJob(owner, j.id);
    }
  });

  it(
    "the worker re-checks right before yt-dlp and fails terminally",
    async () => {
      const j = await start(); // accepted while the allowance is on
      const worker = managedWorker(j.id);
      const before = requests;
      const result = await withoutAllowance(() => worker.run());
      expect(result).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "BLOCKED_HOST",
        result: null,
      });
      expect(requests).toBe(before);
      expect(await prisma.art.count({ where: { userId: owner } })).toBe(0);
      await studio.deleteStudioJob(owner, j.id);
    },
    nativeTestMs(1),
  );
});
