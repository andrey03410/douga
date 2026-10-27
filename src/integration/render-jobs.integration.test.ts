import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/server/projects";
import { listRenderJobs } from "@/server/render";
import { STALE_RENDER_JOB_ERROR } from "@/server/render-jobs";
import { deleteRenderJob, listRenderRows } from "@/server/users";

// Integration tests: listing render jobs for the constructor UIs — the list
// the client uses to restore an in-flight/finished render after a reload.

const EMAIL = "integration-render-jobs@test.local";
const EMAIL_OTHER = "integration-render-jobs-other@test.local";

let userId: string;
let otherUserId: string;
let projectId: string;
let tournamentId: string;

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_OTHER] } } });
}

beforeAll(async () => {
  await cleanup();
  userId = (await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } })).id;
  otherUserId = (await prisma.user.create({ data: { email: EMAIL_OTHER, passwordHash: "x" } })).id;

  projectId = (await createProject(userId, "Тест рендер-джобов", "picker")).id;
  tournamentId = (
    await prisma.tournament.create({ data: { userId, title: "Турнир", scheme: "merge" } })
  ).id;
});

afterAll(async () => {
  await cleanup();
});

describe("listRenderJobs", () => {
  it("возвращает джобы проекта новее-первым с downloadUrl для готовых", async () => {
    const t0 = new Date("2026-01-01T10:00:00Z");
    const done = await prisma.renderJob.create({
      data: {
        projectId, status: "done", progress: 1,
        outputPath: "renders/x.mp4", createdAt: t0,
      },
    });
    const running = await prisma.renderJob.create({
      data: {
        projectId, status: "running", progress: 0.4,
        createdAt: new Date(t0.getTime() + 1000),
      },
    });

    const jobs = await listRenderJobs(userId, { projectId });
    expect(jobs.map((j) => j.id)).toEqual([running.id, done.id]);
    expect(jobs[0]).toMatchObject({ status: "running", progress: 0.4, downloadUrl: null });
    expect(jobs[1]).toMatchObject({
      status: "done",
      downloadUrl: `/api/render-jobs/${done.id}/download`,
    });
  });

  it("возвращает джобы турнира и не смешивает владельцев", async () => {
    const tJob = await prisma.renderJob.create({
      data: { tournamentId, status: "failed", error: "boom" },
    });

    const tournamentJobs = await listRenderJobs(userId, { tournamentId });
    expect(tournamentJobs.map((j) => j.id)).toEqual([tJob.id]);
    expect(tournamentJobs[0]).toMatchObject({ status: "failed", error: "boom" });

    const projectJobs = await listRenderJobs(userId, { projectId });
    expect(projectJobs.map((j) => j.id)).not.toContain(tJob.id);
  });

  it("чужому пользователю джобы не видны", async () => {
    expect(await listRenderJobs(otherUserId, { projectId })).toEqual([]);
    expect(await listRenderJobs(otherUserId, { tournamentId })).toEqual([]);
  });
});

describe("зависшие задания после перезапуска сервера", () => {
  const stale = () => new Date(Date.now() - 11 * 60 * 1000);

  it("список конструктора помечает failed задание без обновлений дольше 10 минут", async () => {
    const dead = await prisma.renderJob.create({
      data: { projectId, status: "running", progress: 0.3, updatedAt: stale() },
    });
    const queued = await prisma.renderJob.create({
      data: { projectId, status: "queued", updatedAt: stale() },
    });
    const live = await prisma.renderJob.create({
      data: { projectId, status: "running", progress: 0.5 },
    });

    const jobs = await listRenderJobs(userId, { projectId });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    expect(byId.get(dead.id)).toMatchObject({ status: "failed", error: STALE_RENDER_JOB_ERROR });
    expect(byId.get(queued.id)).toMatchObject({ status: "failed" });
    expect(byId.get(live.id)).toMatchObject({ status: "running", error: null });
  });

  it("чужие зависшие задания не трогает", async () => {
    const otherProject = (await createProject(otherUserId, "Чужой", "picker")).id;
    const foreign = await prisma.renderJob.create({
      data: { projectId: otherProject, status: "running", updatedAt: stale() },
    });
    await listRenderJobs(userId, { projectId });
    expect((await prisma.renderJob.findUnique({ where: { id: foreign.id } }))?.status).toBe(
      "running",
    );
  });

  it("кабинет показывает его failed, и его можно удалить", async () => {
    const dead = await prisma.renderJob.create({
      data: { tournamentId, status: "running", updatedAt: stale() },
    });
    const { rows } = await listRenderRows(userId, { limit: 100 });
    expect(rows.find((r) => r.id === dead.id)?.status).toBe("failed");

    const again = await prisma.renderJob.create({
      data: { tournamentId, status: "running", updatedAt: stale() },
    });
    await deleteRenderJob(userId, again.id);
    expect(await prisma.renderJob.findUnique({ where: { id: again.id } })).toBeNull();
  });

  it("живое задание удалить нельзя", async () => {
    const live = await prisma.renderJob.create({ data: { projectId, status: "running" } });
    await expect(deleteRenderJob(userId, live.id)).rejects.toThrow("JOB_ACTIVE");
  });
});
