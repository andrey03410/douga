import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createVideoDocument } from "@/video";
import * as studio from "@/server/studio";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { absPath, removePath } from "@/lib/storage";

let owner: string, other: string;
const document = () =>
  createVideoDocument({
    kind: "top",
    participants: [{ id: "one", label: "Original" }],
  });
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `jobs-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `jobs-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
});
afterAll(async () => {
  for (const userId of [owner, other]) {
    if (prisma.studioJob) {
      const jobs = await prisma.studioJob.findMany({ where: { userId } });
      for (const j of jobs) {
        await studio.cancelStudioJob(userId, j.id);
        await studio.deleteStudioJob(userId, j.id);
      }
    }
    for (const p of await studio.listStudioProjects(userId))
      await studio.deleteStudioProject(userId, p.id);
    await prisma.user.delete({ where: { id: userId } });
    await removePath(`arts/${userId}`);
    await removePath(`studio/${userId}`);
    await removePath(`studio-jobs/${userId}`);
  }
});
describe("durable composition queue", () => {
  it("freezes once for concurrent identical enqueue and rejects conflicting account-wide keys", async () => {
    const p = await studio.createStudioProject(owner, { document: document() });
    const input = {
      kind: "still" as const,
      frame: 0,
      idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      studio.startStudioJob(owner, p.id, input),
      studio.startStudioJob(owner, p.id, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.studioJob.count({ where: { id: a.id } })).toBe(1);
    expect(
      await prisma.studioSnapshot.count({ where: { projectId: p.id } }),
    ).toBe(1);
    await expect(
      studio.startStudioJob(owner, p.id, { ...input, frame: 1 }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await studio.saveStudioDraft(owner, p.id, {
      expectedVersion: p.version,
      document: { ...p.document, title: "Changed" },
    });
    const persisted = await prisma.studioJob.findUniqueOrThrow({
      where: { id: a.id },
      include: { snapshot: true },
    });
    expect(JSON.parse(persisted.snapshot!.payloadJson).document.title).toBe(
      p.document.title,
    );
    expect(a.revision).toBe(1);
    expect(a.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    await studio.cancelStudioJob(owner, a.id);
    await studio.deleteStudioJob(owner, a.id);
  });
  it("checks ownership, final-render permission, preview bounds and deletion protection", async () => {
    const p = await studio.createStudioProject(owner, { document: document() });
    await expect(
      studio.startStudioJob(other, p.id, { kind: "still", frame: 0 }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      studio.startStudioJob(owner, p.id, { kind: "render" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      studio.startStudioJob(owner, p.id, {
        kind: "clip",
        fromFrame: 0,
        durationFrames: 900,
      }),
    ).rejects.toThrow("PREVIEW_BUDGET_EXCEEDED");
    const j = await studio.startStudioJob(owner, p.id, {
      kind: "still",
      frame: 0,
    });
    await expect(studio.getStudioJob(other, j.id)).rejects.toThrow("NOT_FOUND");
    await expect(studio.cancelStudioJob(other, j.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(studio.deleteStudioJob(owner, j.id)).rejects.toThrow(
      "JOB_ACTIVE",
    );
    await expect(studio.deleteStudioProject(owner, p.id)).rejects.toThrow(
      "JOB_IN_USE",
    );
    await expect(
      studio.deleteStudioSnapshot(owner, j.snapshotId!),
    ).rejects.toThrow("JOB_IN_USE");
    expect((await studio.cancelStudioJob(owner, j.id)).status).toBe("canceled");
    expect(await studio.runStudioWorkerOnce({ jobId: j.id })).toBeNull();
    await studio.deleteStudioJob(owner, j.id);
  });
});

it("renders an authorized immutable still and H264/AAC clip in separate worker processes", async () => {
  const { createArt } = await import("@/server/arts");
  const { execFileSync } = await import("node:child_process");
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { absPath } = await import("@/lib/storage");
  const ffmpeg = (await import("ffmpeg-static")).default!;
  const directory = absPath(`studio-jobs/${owner}/fixture`);
  await mkdir(directory, { recursive: true });
  execFileSync(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    `${directory}/original.mp4`,
  ]);
  const art = await createArt(owner, {
    fileName: "fixture.mp4",
    data: await readFile(`${directory}/original.mp4`),
  });
  const d = document();
  d.settings.top = { durationSec: 1 };
  d.bindings.media = { kind: "pool", assetId: art.id };
  d.source.participants[0].media = { visual: "media", audio: "media" };
  const p = await studio.createStudioProject(owner, { document: d });
  const still = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 10,
  });
  const clip = await studio.startStudioJob(owner, p.id, {
    kind: "clip",
    fromFrame: 0,
    durationFrames: 30,
  });
  const audio = await studio.startStudioJob(owner, p.id, {
    kind: "audio",
    fromFrame: 0,
    durationFrames: 30,
  });
  await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
  const render = await studio.startStudioJob(owner, p.id, { kind: "render" });
  await writeFile(absPath(art.filePath), "original overwritten after enqueue");
  await studio.saveStudioDraft(owner, p.id, {
    expectedVersion: p.version,
    document: { ...p.document, title: "Future" },
  });
  const { promisify } = await import("node:util");
  const exec = promisify((await import("node:child_process")).execFile);
  for (const job of [still, clip, audio, render]) {
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/studio-worker.ts",
        "--once",
        "--job",
        job.id,
      ],
      {
        env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.mcp.json" },
        timeout: 120_000,
      },
    );
    const result = await studio.getStudioJob(owner, job.id);
    expect(result.status, result.error ?? undefined).toBe("done");
    expect(result.revision).toBe(1);
    expect(result.snapshotHash).toBe(job.snapshotHash);
    if (result.result?.kind === "import") throw new Error("Unexpected import result");
    expect(result.result?.resource.bytes).toBeGreaterThan(100);
    expect(JSON.stringify(result)).not.toContain("/Users/");
    await expect(studio.getStudioJobArtifact(other, job.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    const artifact = await studio.getStudioJobArtifact(owner, job.id);
    if (job.kind !== "audio") {
      const pixels = execFileSync(
        ffmpeg,
        [
          "-v",
          "error",
          "-i",
          artifact.path,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      expect(pixels.length).toBe(
        job.kind === "render" ? 1920 * 1080 * 3 : 704 * 396 * 3,
      );
      expect(
        pixels.some(
          (v, i) =>
            i % 3 === 0 && v > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60,
        ),
      ).toBe(true);
    }
    if (job.kind !== "still") {
      const pcm = execFileSync(
        ffmpeg,
        ["-v", "error", "-i", artifact.path, "-vn", "-f", "s16le", "pipe:1"],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      expect(pcm.length).toBeGreaterThan(90_000);
      expect(pcm.some((v) => v !== 0)).toBe(true);
    }
    await mkdir(absPath("studio-worker-proof"), { recursive: true });
    await writeFile(
      absPath(
        `studio-worker-proof/${job.kind === "still" ? "frame.png" : job.kind === "audio" ? "audio.aac" : `${job.kind}.mp4`}`,
      ),
      await readFile(artifact.path),
    );
    await writeFile(
      absPath(`studio-worker-proof/${job.kind}.json`),
      JSON.stringify(result, null, 2),
    );
  }
  await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
}, 120_000);

it("fences claims, recovers expired attempts and stops after three interrupted attempts", async () => {
  const { claimStudioJob, heartbeatStudioJob } =
    await import("@/server/studio/worker");
  const p = await studio.createStudioProject(owner, { document: document() });
  const j = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 0,
  });
  const [a, b] = await Promise.all([
    claimStudioJob({ jobId: j.id, workerId: "a" }),
    claimStudioJob({ jobId: j.id, workerId: "b" }),
  ]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
  let claimed = (a ?? b)!;
  expect(await heartbeatStudioJob(j.id, "wrong-token")).toBe(false);
  for (let attempt = 2; attempt <= 3; attempt++) {
    await prisma.studioJob.update({
      where: { id: j.id },
      data: { leaseUntil: new Date(0) },
    });
    await prisma.studioWorkerLease.updateMany({
      where: { token: claimed.leaseToken },
      data: { until: new Date(0) },
    });
    const oldToken = claimed.leaseToken!;
    claimed = (await claimStudioJob({ jobId: j.id }))!;
    expect(claimed.attempts).toBe(attempt);
    expect(claimed.leaseToken).not.toBe(oldToken);
    expect(await heartbeatStudioJob(j.id, oldToken)).toBe(false);
  }
  await prisma.studioJob.update({
    where: { id: j.id },
    data: { leaseUntil: new Date(0) },
  });
  await prisma.studioWorkerLease.updateMany({
    where: { token: claimed.leaseToken },
    data: { until: new Date(0) },
  });
  expect(await claimStudioJob({ jobId: j.id })).toBeNull();
  expect((await studio.getStudioJob(owner, j.id)).status).toBe("failed");
  await studio.deleteStudioJob(owner, j.id);
});
it("cancellation during execution cannot publish a completed result", async () => {
  const p = await studio.createStudioProject(owner, { document: document() });
  const j = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 0,
  });
  const running = studio.runStudioWorkerOnce({ jobId: j.id });
  for (let i = 0; i < 100; i++) {
    if ((await studio.getStudioJob(owner, j.id)).status === "running") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await studio.cancelStudioJob(owner, j.id);
  const result = await running;
  expect(result?.status).toBe("canceled");
  expect(result?.result).toBeNull();
  await studio.deleteStudioJob(owner, j.id);
}, 30_000);
it("rechecks revoked final-render role and active queue quota", async () => {
  const p = await studio.createStudioProject(owner, { document: document() });
  await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
  const j = await studio.startStudioJob(owner, p.id, { kind: "render" });
  await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
  expect((await studio.runStudioWorkerOnce({ jobId: j.id }))?.error).toBe(
    "FORBIDDEN",
  );
  await studio.deleteStudioJob(owner, j.id);
  const jobs = [];
  for (let i = 0; i < 4; i++)
    jobs.push(
      await studio.startStudioJob(owner, p.id, { kind: "still", frame: 0 }),
    );
  await expect(
    studio.startStudioJob(owner, p.id, { kind: "still", frame: 0 }),
  ).rejects.toThrow("JOB_QUOTA_EXCEEDED");
  for (const job of jobs) {
    await studio.cancelStudioJob(owner, job.id);
    await studio.deleteStudioJob(owner, job.id);
  }
});
it("accounts for results and guards account deletion before any file cleanup", async () => {
  const { usageSummary, deleteUser } = await import("@/server/users");
  const p = await studio.createStudioProject(owner, { document: document() });
  const j = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 0,
  });
  await prisma.user.update({ where: { id: other }, data: { role: "admin" } });
  await expect(deleteUser(other, owner)).rejects.toThrow("JOB_IN_USE");
  const usage = await usageSummary(owner);
  expect(usage.studio.jobs).toBeGreaterThan(0);
  await studio.cancelStudioJob(owner, j.id);
  await prisma.studioJob.update({
    where: { id: j.id },
    data: { outputBytes: 512 * 1024 * 1024 },
  });
  await expect(
    studio.startStudioJob(owner, p.id, { kind: "still", frame: 0 }),
  ).rejects.toThrow("JOB_QUOTA_EXCEEDED");
  await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
  const adminJob = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 0,
  });
  await studio.cancelStudioJob(owner, adminJob.id);
  await studio.deleteStudioJob(owner, adminJob.id);
  await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
  expect((await usageSummary(owner)).studio.resultBytes).toBe(
    usage.studio.resultBytes + 512 * 1024 * 1024,
  );
  await studio.deleteStudioJob(owner, j.id);
});
it("deletes an account whose Studio jobs are all finished, refusing only while one is active", async () => {
  const { deleteUser } = await import("@/server/users");
  const victim = (
    await prisma.user.create({
      data: { email: `jobs-victim-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  const { role: otherRole } = await prisma.user.findUniqueOrThrow({ where: { id: other } });
  await prisma.user.update({ where: { id: other }, data: { role: "admin" } });
  try {
    const p = await studio.createStudioProject(victim, { document: document() });
    const finished = await studio.startStudioJob(victim, p.id, { kind: "still", frame: 0 });
    const canceled = await studio.startStudioJob(victim, p.id, { kind: "still", frame: 0 });
    await prisma.studioJob.update({
      where: { id: finished.id },
      data: { status: "done", outputBytes: 3 },
    });
    await studio.cancelStudioJob(victim, canceled.id);
    // a canceled attempt whose worker still holds the lease is active
    await prisma.studioJob.update({
      where: { id: canceled.id },
      data: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) },
    });
    const resultDir = `studio-jobs/${victim}/${finished.id}`;
    await mkdir(absPath(resultDir), { recursive: true });
    await writeFile(absPath(`${resultDir}/frame.png`), Buffer.from([1, 2, 3]));
    const engineDir = `studio-engines/${finished.engineId}`;
    const engineExisted = existsSync(absPath(engineDir));

    await expect(deleteUser(other, victim)).rejects.toThrow("JOB_IN_USE");
    expect(await prisma.studioJob.count({ where: { userId: victim } })).toBe(2);
    expect(existsSync(absPath(resultDir))).toBe(true);

    // the lease expired: nothing is active any more
    await prisma.studioJob.update({
      where: { id: canceled.id },
      data: { leaseUntil: new Date(Date.now() - 1_000) },
    });
    await deleteUser(other, victim);

    expect(await prisma.user.findUnique({ where: { id: victim } })).toBeNull();
    expect(await prisma.studioJob.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.studioProject.count({ where: { userId: victim } })).toBe(0);
    expect(
      await prisma.studioSnapshot.count({
        where: { id: { in: [finished.snapshotId!, canceled.snapshotId!] } },
      }),
    ).toBe(0);
    expect(existsSync(absPath(`studio-jobs/${victim}`))).toBe(false);
    expect(existsSync(absPath(`studio/${victim}`))).toBe(false);
    // shared engines are never part of an account
    expect(existsSync(absPath(engineDir))).toBe(engineExisted);
  } finally {
    await prisma.user.update({ where: { id: other }, data: { role: otherRole } });
    if (await prisma.user.findUnique({ where: { id: victim } })) {
      await prisma.studioJob.deleteMany({ where: { userId: victim } });
      for (const project of await studio.listStudioProjects(victim))
        await studio.deleteStudioProject(victim, project.id);
      await prisma.user.delete({ where: { id: victim } });
    }
    await removePath(`studio/${victim}`);
    await removePath(`studio-jobs/${victim}`);
  }
}, 60_000);
it("replays identical concurrent enqueue of a valid draft with one committed revision", async () => {
  const p = await studio.createStudioProject(owner, { document: document() });
  const draft = await studio.saveStudioDraft(owner, p.id, {
    expectedVersion: p.version,
    document: { ...p.document, title: "Draft freeze" },
  });
  const input = {
    kind: "still" as const,
    frame: 0,
    expectedVersion: draft.version,
    idempotencyKey: randomUUID(),
  };
  const jobs = await Promise.all([
    studio.startStudioJob(owner, p.id, input),
    studio.startStudioJob(owner, p.id, input),
  ]);
  expect(jobs[0].id).toBe(jobs[1].id);
  expect(jobs[0].revision).toBe(2);
  expect(
    await prisma.studioSnapshot.count({ where: { projectId: p.id } }),
  ).toBe(1);
  await studio.cancelStudioJob(owner, jobs[0].id);
  await studio.deleteStudioJob(owner, jobs[0].id);
});

it("rejects a corrupted frozen payload without publishing output", async () => {
  const p = await studio.createStudioProject(owner, { document: document() });
  const job = await studio.startStudioJob(owner, p.id, {
    kind: "still",
    frame: 0,
  });
  const snapshot = await prisma.studioSnapshot.findUniqueOrThrow({
    where: { id: job.snapshotId! },
  });
  const payload = JSON.parse(snapshot.payloadJson);
  payload.plan.durationInFrames += 1;
  await prisma.studioSnapshot.update({
    where: { id: snapshot.id },
    data: { payloadJson: JSON.stringify(payload) },
  });
  const result = await studio.runStudioWorkerOnce({ jobId: job.id });
  expect(result?.status).toBe("failed");
  expect(result?.error).toBe("SNAPSHOT_HASH_MISMATCH");
  expect(result?.result).toBeNull();
  await studio.deleteStudioJob(owner, job.id);
});

it("rejects active-snippet anchor multiplication before analysis or retaining resolved copies", async () => {
  const { createArt } = await import("@/server/arts");
  const { evaluate, fileHash, safeFile } =
    await import("@/server/studio/assets");
  const { randomBytes } = await import("node:crypto");
  const samples = randomBytes(16000),
    wav = Buffer.alloc(44 + samples.length);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length, 40);
  samples.copy(wav, 44);
  const art = await createArt(owner, {
    fileName: "anchor-budget.wav",
    data: wav,
  });
  const key = `${await fileHash(await safeFile(art.filePath))}:0.5`;
  expect(await prisma.studioAnalysis.findUnique({ where: { key } })).toBeNull();
  const d = createVideoDocument({
    kind: "top",
    participants: Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      media: { audio: "sound" },
    })),
  });
  d.settings.top = { snippet: { mode: "active", durationSec: 0.5 } };
  d.bindings.sound = { kind: "pool", assetId: art.id };
  d.audio = {
    cues: Array.from({ length: 500 }, (_, i) => ({
      id: `cue${i}`,
      role: "sfx",
      asset: "sound",
      at: { sec: 0 },
      anchor: { event: "scene.start", sceneId: d.scenes[0].id },
    })),
  };
  const result = await evaluate(owner, d);
  const analysis = await prisma.studioAnalysis.findUnique({ where: { key } });
  await prisma.studioAnalysis.deleteMany({ where: { key } });
  expect(
    result.validation.diagnostics.some(
      (d) => d.code === "RESOURCE_BUDGET_EXCEEDED",
    ),
  ).toBe(true);
  expect(result.resolvedDocument === null).toBe(true);
  expect(result.plan).toBeNull();
  expect(analysis).toBeNull();
});

it("recovers the same frozen job after an OS hard kill stops its active render child", async () => {
  const { spawn, execFileSync, execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile } = await import("node:fs/promises");
  const { absPath } = await import("@/lib/storage");
  const { heartbeatStudioJob } = await import("@/server/studio/worker");
  const d = document();
  d.settings.top = { durationSec: 15 };
  const project = await studio.createStudioProject(owner, { document: d });
  const job = await studio.startStudioJob(owner, project.id, {
    kind: "clip",
    fromFrame: 0,
    durationFrames: 450,
  });
  const args = [
    "--import",
    "tsx",
    "scripts/studio-worker.ts",
    "--once",
    "--job",
    job.id,
  ];
  const env = { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.mcp.json" };
  const parent = spawn(process.execPath, args, { env, stdio: "ignore" });
  const parentExit = new Promise<[number | null, NodeJS.Signals | null]>(
    (resolve) => parent.once("exit", (code, signal) => resolve([code, signal])),
  );
  const processes = () =>
    execFileSync("ps", ["-axo", "pid=,ppid=,stat=,comm="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)!;
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          state: match[3],
          name: match[4],
        };
      });
  const waitUntil = async (
    condition: () => Promise<boolean> | boolean,
    timeout = 15_000,
  ) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Timed out waiting for the owned worker process state");
  };
  let childPid: number | undefined,
    firstToken: string | null = null;
  try {
    // Observe Chromium descended from this exact CLI process: work has actually started.
    await waitUntil(() => {
      const rows = processes();
      const child = rows.find(
        (row) => row.ppid === parent.pid && /node/i.test(row.name),
      );
      if (!child) return false;
      const descendants = new Set([child.pid]);
      for (let i = 0; i < 6; i++)
        for (const row of rows)
          if (descendants.has(row.ppid)) descendants.add(row.pid);
      if (
        !rows.some(
          (row) =>
            descendants.has(row.pid) && /chrome|chromium/i.test(row.name),
        )
      )
        return false;
      childPid = child.pid;
      return true;
    });
    const first = await prisma.studioJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    firstToken = first.leaseToken;
    expect(first.status).toBe("running");
    expect(first.attempts).toBe(1);
    expect(first.resultJson).toBeNull();
    parent.kill("SIGKILL");
    const [exitCode, signal] = await parentExit;
    expect(exitCode).toBeNull();
    expect(signal).toBe("SIGKILL");
    await waitUntil(
      () =>
        !processes().some(
          (row) => row.pid === childPid && !row.state.startsWith("Z"),
        ),
    );
    const interrupted = await studio.getStudioJob(owner, job.id);
    expect(interrupted.status).toBe("running");
    expect(interrupted.result).toBeNull();
    // Shorten only this killed attempt's durable lease; never alter other users' slot/token.
    await prisma.$transaction(async (db) => {
      await db.studioJob.updateMany({
        where: { id: job.id, userId: owner, leaseToken: firstToken },
        data: { leaseUntil: new Date(0) },
      });
      await db.studioWorkerLease.updateMany({
        where: { token: firstToken },
        data: { until: new Date(0) },
      });
    });
    await promisify(execFile)(process.execPath, args, { env, timeout: 90_000 });
    const recovered = await studio.getStudioJob(owner, job.id);
    expect(recovered.status, recovered.error ?? undefined).toBe("done");
    expect(recovered.attempts).toBe(2);
    expect(recovered.snapshotId).toBe(job.snapshotId);
    expect(recovered.snapshotHash).toBe(job.snapshotHash);
    expect(recovered.engineId).toBe(job.engineId);
    expect(recovered.revisionId).toBe(job.revisionId);
    expect(await heartbeatStudioJob(job.id, firstToken!)).toBe(false);
    const finalRow = await prisma.studioJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finalRow.leaseToken).not.toBe(firstToken);
    expect(
      (await studio.getStudioJobArtifact(owner, job.id)).bytes,
    ).toBeGreaterThan(100);
    await writeFile(
      absPath("studio-worker-proof/hard-kill.json"),
      JSON.stringify(
        {
          parentPid: parent.pid,
          childPid,
          signal,
          oldAttempt: firstToken,
          newAttempt: finalRow.leaseToken,
          interrupted,
          recovered,
        },
        null,
        2,
      ),
    );
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) {
      parent.kill("SIGKILL");
      await parentExit;
    }
    // Failure cleanup is strictly scoped to this test's job and its owned child group.
    if (childPid) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {}
    }
    const row = await prisma.studioJob.findUnique({ where: { id: job.id } });
    if (row) {
      await studio.cancelStudioJob(owner, job.id);
      await prisma.studioJob.updateMany({
        where: { id: job.id, userId: owner },
        data: { leaseUntil: new Date(0) },
      });
      if (row.leaseToken)
        await prisma.studioWorkerLease.updateMany({
          where: { token: row.leaseToken },
          data: { until: new Date(0) },
        });
      await studio.deleteStudioJob(owner, job.id);
    }
  }
}, 120_000);
