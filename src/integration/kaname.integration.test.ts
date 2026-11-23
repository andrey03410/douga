import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createVideoDocument } from "@douga/video";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { bindIdentity, freshUser, recordActivity } from "@/server/kaname";
import { usageForSubject } from "@/server/kaname-usage";
import { moderate } from "@/server/kaname-moderation";
import { createArt } from "@/server/arts";
import { issueApiToken, resolveApiToken } from "@/server/api-tokens";
import { createStudioProject, publishStudioProject, startStudioJob, unpublishStudioProject } from "@/server/studio";
import { runStudioWorkerOnce } from "@/server/studio/worker";
import { loadPublicWatch } from "@/server/studio/watch-public";
import { deleteUser } from "@/server/users";

const actors: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const cleanup = await prisma.user.create({ data: { email: randomUUID()+"@test.invalid", role: "admin", passwordHash: "!" } });
  try {
    for (const id of actors.splice(0)) {
      await deleteUser(cleanup.id, id);
      await removePath(`studio/${id}`);
    }
  } finally { await prisma.user.delete({ where: { id: cleanup.id } }); }
});
it("enforces the same live identity, limits and moderation across project, publication, token and worker entry points", async () => {
  vi.stubEnv("KANAME_ENABLED", "1");
  vi.stubEnv("KANAME_URL", "http://kaname.fixture");
  vi.stubEnv("KANAME_SERVICE_TOKEN", "service");
  vi.stubEnv("KANAME_OWNER_SUBJECT", "owner");
  vi.stubEnv("KANAME_OIDC_ISSUER", "https://id.fixture/"+randomUUID());
  let revoked = false, storage = 1_000_000_000, projectCap = 3;
  vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
    const subject = u.pathname.split("/").at(-1)!;
    const role = subject === "moderator" ? "admin" : subject === "owner" ? "overlord" : "user";
    if (revoked && subject === "friend") return new Response(null, { status: 403 });
    return Response.json({ subject, login: "same-name", service: "douga", role, permissions: { html: true, heavy: role === "overlord" },
      limits: { storageBytes: storage, projects: projectCap, publications: 2 } });
  }));
  const user = await bindIdentity("friend"); actors.push(user);
  const admin = await bindIdentity("moderator"); actors.push(admin);
  const owner = await bindIdentity("owner"); actors.push(owner);
  expect(new Set(actors).size).toBe(3);
  const token = await issueApiToken(user, { name: "test" });
  const create = () => createStudioProject(user, { document: createVideoDocument({ kind: "top", title: "HTML", participants: [{ id: "a", label: "A" }] }) });
  const created = await Promise.allSettled(Array.from({ length: 4 }, create));
  const projects = created.flatMap(p => p.status === "fulfilled" ? [p.value] : []);
  expect(projects).toHaveLength(3);
  expect(created.find(p => p.status === "rejected")).toMatchObject({ reason: { message: "PROJECT_LIMIT" } });
  projectCap = 4;
  expect((await create()).id).toBeTruthy();
  await expect(create()).rejects.toThrow("PROJECT_LIMIT");
  const published = await Promise.allSettled(projects.map(p => publishStudioProject(user, p.id)));
  const urls = published.flatMap(p => p.status === "fulfilled" ? [p.value] : []);
  expect(urls).toHaveLength(2);
  expect(published.find(p => p.status === "rejected")).toMatchObject({ reason: { message: "PUBLICATION_LIMIT" } });
  await expect(publishStudioProject(admin, projects[0].id)).rejects.toThrow("NOT_FOUND");
  await expect(startStudioJob(user, projects[0].id, { kind: "still", frame: 0 })).rejects.toThrow("FORBIDDEN");
  await expect(moderate(admin, owner, "suspend", "")).rejects.toThrow("FORBIDDEN");
  await expect(moderate(user, admin, "suspend", "")).rejects.toThrow("FORBIDDEN");
  await unpublishStudioProject(user, urls[0].projectId);
  expect((await usageForSubject("friend")).counts.publications).toBe(1);
  const used = await usageForSubject("friend");
  expect(used.storageBytes).toBeGreaterThan(0);
  storage = used.storageBytes + 10;
  const uploads = await Promise.allSettled([1,2].map(() => createArt(user, { fileName: "one.png", data: Buffer.alloc(10) })));
  expect(uploads.filter(p => p.status === "fulfilled")).toHaveLength(1);
  expect(uploads.find(p => p.status === "rejected")).toMatchObject({ reason: { message: "POOL_QUOTA" } });
  storage = 0;
  await expect(unpublishStudioProject(user, urls[1].projectId, { idempotencyKey: "cleanup-over-limit" })).resolves.toMatchObject({ removed: true });
  storage = 1_000_000_000;
  const currentLink = await publishStudioProject(user, urls[1].projectId);
  await recordActivity(user);
  expect((await usageForSubject("friend")).activeDays30).toBe(1);
  expect((await usageForSubject("unknown")).activeDays30).toBe(0);
  expect((await resolveApiToken(token.token))?.userId).toBe(user);
  await moderate(admin, user, "suspend", "");
  expect(await resolveApiToken(token.token)).toBeNull();
  expect((await loadPublicWatch(currentLink.token)).ok).toBe(false);
  await moderate(admin, user, "restore", "");
  revoked = true;
  await expect(freshUser(user)).rejects.toThrow("FORBIDDEN");
  expect(await resolveApiToken(token.token)).toBeNull();
  const queued = await prisma.studioJob.create({ data: { userId: user, kind: "still", inputJson: "{}", engineId: "fixture" } });
  expect(await runStudioWorkerOnce({ jobId: queued.id })).toMatchObject({ status: "failed", error: "FORBIDDEN" });
}, 60_000);
