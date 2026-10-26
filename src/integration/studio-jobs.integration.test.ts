import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createVideoDocument } from "@/video";
import * as studio from "@/server/studio";
import { removePath } from "@/lib/storage";

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
