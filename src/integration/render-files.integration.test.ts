import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath, renderOutputPath, saveFile } from "@/lib/storage";
import { createArt } from "@/server/arts";
import { addTile, addTopItem, createProject, getProject } from "@/server/projects";
import { startProjectRenderJob } from "@/server/render";
import { startPickerRenderJob } from "@/server/picker-render";

// Integration tests for task 23: what a classic render leaves on disk (T04) and
// the name of the downloaded file (T05). Remotion is mocked — no headless
// Chrome here — but the asset preparation (ffmpeg, copies) runs for real.

const remotion = vi.hoisted(() => ({
  fail: null as null | "bundle" | "render",
  /** Files of the job's publicDir as seen by bundle(): proves the dir existed. */
  bundled: [] as string[][],
}));

vi.mock("@remotion/bundler", async () => {
  const { readdir } = await import("node:fs/promises");
  return {
    bundle: async ({ publicDir }: { publicDir: string }) => {
      remotion.bundled.push(await readdir(publicDir));
      if (remotion.fail === "bundle") throw new Error("bundle exploded");
      return "http://bundle.test";
    },
  };
});

vi.mock("@remotion/renderer", async () => {
  const { writeFile } = await import("node:fs/promises");
  return {
    selectComposition: async () => ({ id: "mock" }),
    renderMedia: async ({ outputLocation }: { outputLocation: string }) => {
      if (remotion.fail === "render") throw new Error("render exploded");
      await writeFile(outputLocation, Buffer.from("not really an mp4"));
    },
  };
});

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({
  requireUser: async () => {
    if (!session.id) throw new Error("UNAUTHENTICATED");
    return { id: session.id, email: "render-files@test.local", role: "admin" };
  },
}));

const EMAIL = "integration-render-files@test.local";
const EMAIL_OTHER = "integration-render-files-other@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
}

let userId: string;
let otherUserId: string;
let imageArtId: string;
let audioArtId: string;
const jobIds: string[] = [];

const tmpDirOf = (jobId: string) => absPath(path.join("renders", "tmp", jobId));

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Wait until the background render settles and its scratch dir is gone. */
async function settle(jobId: string) {
  let status = "";
  await waitFor(async () => {
    const job = await prisma.renderJob.findUniqueOrThrow({ where: { id: jobId } });
    status = job.status;
    return status === "done" || status === "failed";
  });
  // "done" is written just before the cleanup in `finally`: give it a moment.
  await waitFor(() => !existsSync(tmpDirOf(jobId)), 5_000).catch(() => {});
  return prisma.renderJob.findUniqueOrThrow({ where: { id: jobId } });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
}

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "render-files-it-"));
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", path.join(dir, "tone.mp3")]);

  await cleanup();
  userId = (await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } })).id;
  otherUserId = (await prisma.user.create({ data: { email: EMAIL_OTHER, passwordHash: "x" } })).id;
  imageArtId = (await createArt(userId, { fileName: "pic.png", data: PNG })).id;
  audioArtId = (
    await createArt(userId, { fileName: "tone.mp3", data: await readFile(path.join(dir, "tone.mp3")) })
  ).id;
}, 60_000);

afterAll(async () => {
  for (const id of jobIds) {
    await removePath(renderOutputPath(id));
    await removePath(path.join("renders", "tmp", id));
  }
  await cleanup();
});

beforeEach(() => {
  remotion.fail = null;
  remotion.bundled = [];
  session.id = "";
});

async function pickerProject(title: string) {
  const p = await createProject(userId, title, "picker");
  const round = (await getProject(userId, p.id))!.rounds[0];
  await addTile(userId, round.id, imageArtId);
  await addTile(userId, round.id, imageArtId);
  return p.id;
}

async function topProject(title: string) {
  const p = await createProject(userId, title, "top");
  await addTopItem(userId, p.id, audioArtId);
  return p.id;
}

describe("render scratch files (T04)", () => {
  it("picker: a finished render leaves only the MP4, not renders/tmp/<jobId>", async () => {
    const jobId = await startPickerRenderJob(userId, await pickerProject("Пикер ок"));
    jobIds.push(jobId);
    const job = await settle(jobId);

    expect(job.status).toBe("done");
    expect(remotion.bundled[0]).toEqual(expect.arrayContaining(["tick.wav"]));
    expect(existsSync(tmpDirOf(jobId))).toBe(false);
    expect(existsSync(absPath(renderOutputPath(jobId)))).toBe(true);
    expect(job.outputPath).toBe(renderOutputPath(jobId));
  }, 30_000);

  it("picker: a render that fails after preparing assets still removes the tmp dir", async () => {
    remotion.fail = "bundle";
    const jobId = await startPickerRenderJob(userId, await pickerProject("Пикер сбой"));
    jobIds.push(jobId);
    const job = await settle(jobId);

    expect(job.status).toBe("failed");
    expect(job.error).toContain("bundle exploded");
    expect(remotion.bundled[0].length).toBeGreaterThan(1); // assets were really there
    expect(existsSync(tmpDirOf(jobId))).toBe(false);
  }, 30_000);

  it("top: a finished render leaves only the MP4", async () => {
    const jobId = await startProjectRenderJob(userId, await topProject("Топ ок"));
    jobIds.push(jobId);
    const job = await settle(jobId);

    expect(job.status).toBe("done");
    expect(remotion.bundled[0].some((f) => f.endsWith(".aac"))).toBe(true);
    expect(existsSync(tmpDirOf(jobId))).toBe(false);
    expect(existsSync(absPath(renderOutputPath(jobId)))).toBe(true);
  }, 30_000);

  it("top: a failing renderMedia keeps its error and still removes the tmp dir", async () => {
    remotion.fail = "render";
    const jobId = await startProjectRenderJob(userId, await topProject("Топ сбой"));
    jobIds.push(jobId);
    const job = await settle(jobId);

    expect(job.status).toBe("failed");
    expect(job.error).toContain("render exploded");
    expect(existsSync(tmpDirOf(jobId))).toBe(false);
  }, 30_000);
});

describe("download file name (T05)", () => {
  async function download(jobId: string) {
    const { GET } = await import("@/app/api/render-jobs/[id]/download/route");
    return GET(new Request(`http://localhost/api/render-jobs/${jobId}/download`), {
      params: { id: jobId },
    });
  }

  async function finishedJob(owner: { projectId: string } | { tournamentId: string }) {
    const job = await prisma.renderJob.create({
      data: { ...owner, status: "done", progress: 1 },
    });
    jobIds.push(job.id);
    const outputPath = await saveFile(renderOutputPath(job.id), Buffer.from("mp4 bytes"));
    await prisma.renderJob.update({ where: { id: job.id }, data: { outputPath } });
    return job.id;
  }

  it("a project render is named after the project, with an ASCII fallback", async () => {
    const projectId = (await createProject(userId, "Выбери: лучшую вайфу?", "picker")).id;
    const jobId = await finishedJob({ projectId });
    session.id = userId;

    const res = await download(jobId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="douga-${projectId}.mp4"; filename*=UTF-8''` +
        encodeURIComponent("Выбери лучшую вайфу.mp4"),
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("mp4 bytes");
  });

  it("a tournament render is named after the tournament", async () => {
    const tournamentId = (
      await prisma.tournament.create({ data: { userId, title: "OST сезона", scheme: "merge" } })
    ).id;
    const jobId = await finishedJob({ tournamentId });
    session.id = userId;

    const header = (await download(jobId)).headers.get("Content-Disposition");
    expect(header).toBe(
      `attachment; filename="douga-${tournamentId}.mp4"; filename*=UTF-8''OST%20%D1%81%D0%B5%D0%B7%D0%BE%D0%BD%D0%B0.mp4`,
    );
  });

  it("someone else's render is not found", async () => {
    const projectId = (await createProject(userId, "Чужое", "picker")).id;
    const jobId = await finishedJob({ projectId });
    session.id = otherUserId;
    expect((await download(jobId)).status).toBe(404);
  });
});
