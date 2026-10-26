import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import * as studio from "@/server/studio";
import { studioHttp } from "@/server/studio/http";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({
  requireUser: async () => {
    if (!session.id) throw Error("UNAUTHENTICATED");
    return { id: session.id, email: "test@example.com", role: "admin" };
  },
}));
let owner: string, other: string, id: string;
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  studioHttp(
    new Request(`http://localhost/api/studio/${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
beforeAll(async () => {
  for (const assign of [
    (id: string) => (owner = id),
    (id: string) => (other = id),
  ])
    assign(
      (
        await prisma.user.create({
          data: {
            email: `http-${randomUUID()}@test.local`,
            passwordHash: "x",
            role: "admin",
          },
        })
      ).id,
    );
  id = (
    await studio.createStudioProject(owner, {
      document: createVideoDocument({
        kind: "top",
        participants: [{ id: "secret-answer", label: "Secret answer" }],
      }),
    })
  ).id;
});
afterAll(async () => {
  await studio.deleteStudioProject(owner, id);
  await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await removePath(`studio/${owner}`);
});
it("requires authentication and fresh ownership for metadata and content", async () => {
  session.id = "";
  expect((await request(`projects/${id}`)).status).toBe(401);
  session.id = other;
  expect((await request(`projects/${id}?content=code`)).status).toBe(404);
  session.id = owner;
  const response = await request(`projects/${id}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("secret-answer");
  expect(text).not.toContain("document");
  expect(text).not.toContain("plan");
});
it("saves malformed raw JSON, keeps last good preview and rejects stale CAS without overwriting", async () => {
  session.id = owner;
  const project = await studio.getStudioProject(owner, id);
  const saved = await request(`projects/${id}/draft`, "PUT", {
    expectedVersion: project.version,
    text: '{"broken"',
  });
  expect(saved.status).toBe(200);
  const value = await saved.json();
  expect(value.validation.ready).toBe(false);
  expect(value.draft.text).toBe('{"broken"');
  const conflict = await request(`projects/${id}/draft`, "PUT", {
    expectedVersion: project.version,
    text: "local dirty buffer",
  });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).error).toBe("VERSION_CONFLICT");
  const preview = await request(`projects/${id}?content=preview`);
  const data = await preview.json();
  expect(data.plan).not.toBeNull();
  expect(data.previewStale).toBe(true);
  expect(data.previewVersion).toBe(project.version);
  expect(
    (
      await request(`projects/${id}/commit`, "POST", {
        expectedVersion: value.version,
      })
    ).status,
  ).toBe(422);
  const malformed = await studioHttp(
    new Request("http://localhost/api/studio/projects", {
      method: "POST",
      body: "{",
    }),
    ["projects"],
  );
  expect(malformed.status).toBe(400);
});
it("serves only persisted owned media using strict streamed suffix/open/invalid Range semantics", async () => {
  const relative = `studio/${owner}/${id}/versions/http-test/data.mp4`;
  await mkdir(absPath(`studio/${owner}/${id}/versions/http-test`), {
    recursive: true,
  });
  await writeFile(absPath(relative), "0123456789");
  const rev = await prisma.studioRevision.findFirstOrThrow({
    where: { projectId: id },
  });
  const before = rev.assetsJson;
  await prisma.studioRevision.update({
    where: { id: rev.id },
    data: {
      assetsJson: JSON.stringify({
        files: { asset: { path: relative, hash: "x", bytes: 10 } },
      }),
    },
  });
  try {
    session.id = other;
    expect(
      (await request(`media?path=${encodeURIComponent(relative)}`)).status,
    ).toBe(404);
    session.id = owner;
    const suffix = await request(
      `media?path=${encodeURIComponent(relative)}`,
      "GET",
      undefined,
      { range: "bytes=-3" },
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffix.text()).toBe("789");
    const open = await request(
      `media?path=${encodeURIComponent(relative)}`,
      "GET",
      undefined,
      { range: "bytes=2-" },
    );
    expect(await open.text()).toBe("23456789");
    expect(
      (
        await request(
          `media?path=${encodeURIComponent(relative)}`,
          "GET",
          undefined,
          { range: "bytes=99-" },
        )
      ).status,
    ).toBe(416);
    expect(
      (
        await request(
          `media?path=${encodeURIComponent(relative)}`,
          "GET",
          undefined,
          { range: "bytes=0-1,4-5" },
        )
      ).status,
    ).toBe(416);
    expect(
      (
        await request(
          `media?path=${encodeURIComponent(`studio/${owner}/invented.mp4`)}`,
        )
      ).status,
    ).toBe(404);
  } finally {
    await prisma.studioRevision.update({
      where: { id: rev.id },
      data: { assetsJson: before },
    });
  }
});
it("rechecks roles from the database even when the session adapter claims admin", async () => {
  session.id = other;
  await prisma.user.update({ where: { id: other }, data: { role: "guest" } });
  try {
    expect((await request("projects")).status).toBe(403);
  } finally {
    await prisma.user.update({ where: { id: other }, data: { role: "admin" } });
  }
});
it("returns actionable owner-safe 409 responses for protected single/bulk pool and tournament cleanup", async () => {
  session.id = owner;
  const art = await prisma.art.create({
    data: { userId: owner, kind: "image", filePath: "unused-protected.png" },
  });
  const source = await prisma.tournament.create({
    data: { userId: owner, title: "Protected", scheme: "swiss" },
  });
  await prisma.studioAssetReference.createMany({
    data: [
      { projectId: id, scope: "http-test", artId: art.id },
      { projectId: id, scope: "http-test", tournamentId: source.id },
    ],
  });
  try {
    const { DELETE: single } = await import("@/app/api/arts/[id]/route");
    const one = await single(new Request("http://localhost"), {
      params: { id: art.id },
    });
    expect(one.status).toBe(409);
    expect((await one.json()).error).toContain("истор");
    const { DELETE: bulk } = await import("@/app/api/arts/route");
    const many = await bulk(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ ids: [art.id] }),
      }),
    );
    expect(many.status).toBe(409);
    expect((await many.json()).failed[0]).toMatchObject({
      id: art.id,
      reason: "STUDIO_ASSET_IN_USE",
    });
    const { DELETE: tournament } =
      await import("@/app/api/tournaments/[id]/route");
    const t = await tournament(new Request("http://localhost"), {
      params: { id: source.id },
    });
    expect(t.status).toBe(409);
  } finally {
    await prisma.studioAssetReference.deleteMany({
      where: { projectId: id, scope: "http-test" },
    });
    await prisma.art.delete({ where: { id: art.id } });
    await prisma.tournament.delete({ where: { id: source.id } });
  }
});
it("streams authenticated completed job results above the MCP 12 MiB cap, including HEAD and suffix ranges", async () => {
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 128, 7),
    hash = createHash("sha256").update(bytes).digest("hex"),
    leaseToken = randomUUID();
  const job = await prisma.studioJob.create({
    data: {
      userId: owner,
      projectId: id,
      kind: "render",
      engineId: "http-test",
      inputJson: "{}",
      status: "done",
      leaseToken,
      outputBytes: bytes.length,
    },
  });
  const dir = `studio-jobs/${owner}/${job.id}/attempts/${leaseToken}`;
  await mkdir(absPath(dir), { recursive: true });
  await writeFile(absPath(`${dir}/large.mp4`), bytes);
  await prisma.studioJob.update({
    where: { id: job.id },
    data: {
      resultJson: JSON.stringify({
        kind: "render",
        resource: {
          jobId: job.id,
          name: "large.mp4",
          mimeType: "video/mp4",
          bytes: bytes.length,
          hash,
        },
        width: 1920,
        height: 1080,
        fps: 30,
        fromFrame: 0,
        durationFrames: 90,
        videoCodec: "h264",
        audioCodec: "aac",
      }),
    },
  });
  try {
    session.id = "";
    expect((await request(`jobs/${job.id}/result`)).status).toBe(401);
    session.id = other;
    expect((await request(`jobs/${job.id}/result`)).status).toBe(404);
    session.id = owner;
    const response = await request(
      `jobs/${job.id}/result?download=1`,
      "GET",
      undefined,
      { range: "bytes=-16" },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-range")).toBe(
      `bytes ${bytes.length - 16}-${bytes.length - 1}/${bytes.length}`,
    );
    expect((await response.arrayBuffer()).byteLength).toBe(16);
    const head = await request(`jobs/${job.id}/result`, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const neutral = await request(`jobs/${job.id}`);
    expect(await neutral.text()).not.toContain("attempts/");
    session.id = owner;
    const { DELETE: deleteAccount } =
      await import("@/app/api/admin/users/[id]/route");
    session.id = other;
    const cleanup = await deleteAccount(
      new Request("http://localhost", { method: "DELETE" }),
      { params: { id: owner } },
    );
    expect(cleanup.status).toBe(409);
    expect((await cleanup.json()).code).toBe("JOB_IN_USE");
  } finally {
    await studio.deleteStudioJob(owner, job.id);
    await removePath(`studio-jobs/${owner}`);
  }
});
it("rejects cross-origin mutation attempts before any draft write", async () => {
  session.id = owner;
  const p = await studio.getStudioProject(owner, id);
  const response = await request(
    `projects/${id}/draft`,
    "PUT",
    { expectedVersion: p.version, text: "{}" },
    { origin: "https://foreign.example" },
  );
  expect(response.status).toBe(403);
  expect((await studio.getStudioProject(owner, id)).version).toBe(p.version);
});
it("uses canonical personal presets through HTTP without catalog metadata or content bindings", async () => {
  session.id = owner;
  let p = await studio.getStudioProject(owner, id);
  p = await studio.saveStudioDraft(owner, id, {
    expectedVersion: p.version,
    document: p.document,
  });
  const saved = await request("presets", "POST", {
    name: "HTTP design",
    document: p.document,
  });
  expect(saved.status).toBe(201);
  const preset = await saved.json();
  try {
    const canonical = await request(`presets/${preset.id}`);
    const code = await canonical.json();
    expect(code.personal).toBeUndefined();
    expect(JSON.stringify(code)).not.toContain("secret-answer");
    const applied = await request(`projects/${id}/preset`, "POST", {
      expectedVersion: p.version,
      presetId: preset.id,
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).validation.ready).toBe(true);
  } finally {
    await studio.deleteStudioPreset(owner, preset.id);
  }
});
it("lists neutral owned snapshot references and releases a standalone freeze for history cleanup", async () => {
  const frozen = await studio.freezeStudioProject(owner, id, { revision: 1 });
  try {
    session.id = other;
    expect((await request(`projects/${id}/snapshots`)).status).toBe(404);
    session.id = owner;
    const response = await request(`projects/${id}/snapshots`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("document");
    expect(text).not.toContain("files");
    expect(
      JSON.parse(text).items.some(
        (s: { id: string }) => s.id === frozen.snapshotId,
      ),
    ).toBe(true);
    expect(
      (await request(`snapshots/${frozen.snapshotId}`, "DELETE")).status,
    ).toBe(200);
  } finally {
    await prisma.studioSnapshot.deleteMany({
      where: { id: frozen.snapshotId },
    });
  }
});
it("saves a malformed draft from the actual loopback browser origin despite NextRequest URL normalization", async () => {
  const { NextRequest } = await import("next/server");
  session.id = owner;
  const p = await studio.getStudioProject(owner, id);
  const req = new NextRequest(
    `http://127.0.0.1:3000/api/studio/projects/${id}/draft`,
    {
      method: "PUT",
      headers: {
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedVersion: p.version,
        text: '{"schemaVersion":',
      }),
    },
  );
  expect(new URL(req.url).hostname).toBe("localhost");
  const response = await studioHttp(req);
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.draft.text).toBe('{"schemaVersion":');
  expect(saved.validation.ready).toBe(false);
  expect(saved.version).toBe(p.version + 1);
  const foreign = new NextRequest(
    `http://127.0.0.1:3000/api/studio/projects/${id}/draft`,
    {
      method: "PUT",
      headers: {
        origin: "https://foreign.example",
        host: "127.0.0.1:3000",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
      },
      body: JSON.stringify({ expectedVersion: saved.version, text: "{}" }),
    },
  );
  expect((await studioHttp(foreign)).status).toBe(403);
  expect((await studio.getStudioProject(owner, id)).version).toBe(
    saved.version,
  );
});
it("persists first-completion rankings and the current top N before SDK navigation, then retains manual ranking on N changes", async () => {
  session.id = owner;
  const tournament = await prisma.tournament.create({
    data: {
      userId: owner,
      title: "SDK result entry",
      scheme: "round_robin",
      status: "in_progress",
    },
  });
  const tracks = await Promise.all(
    ["First", "Second"].map((title, order) =>
      prisma.track.create({
        data: {
          tournamentId: tournament.id,
          title,
          order,
          filePath: `unused-${order}.mp3`,
        },
      }),
    ),
  );
  await prisma.comparison.create({
    data: {
      tournamentId: tournament.id,
      trackAId: tracks[0].id,
      trackBId: tracks[1].id,
      result: "a",
    },
  });
  const { POST } = await import("@/app/api/tournaments/[id]/finalize/route");
  const { finalizeResultsBeforeNavigation } =
    await import("@/app/tournaments/[id]/results-actions");
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
    POST(new Request(`http://localhost${url}`, init), {
      params: { id: tournament.id },
    }),
  );
  try {
    expect(
      await prisma.ranking.count({ where: { tournamentId: tournament.id } }),
    ).toBe(0);
    await finalizeResultsBeforeNavigation(tournament.id, 1, async () => {
      const source = await studio.getStudioSource(owner, tournament.id);
      expect(source.items).toHaveLength(1);
      expect(source.items[0].id).toBe(tracks[0].id);
      expect(
        await prisma.ranking.count({ where: { tournamentId: tournament.id } }),
      ).toBe(2);
      expect(
        (
          await prisma.tournament.findUniqueOrThrow({
            where: { id: tournament.id },
          })
        ).topSize,
      ).toBe(1);
    });
    await prisma.ranking.updateMany({
      where: { tournamentId: tournament.id, trackId: tracks[0].id },
      data: { rank: 2 },
    });
    await prisma.ranking.updateMany({
      where: { tournamentId: tournament.id, trackId: tracks[1].id },
      data: { rank: 1 },
    });
    await finalizeResultsBeforeNavigation(tournament.id, 2, async () => {
      const source = await studio.getStudioSource(owner, tournament.id);
      expect(source.items.map((p) => p.id)).toEqual([
        tracks[1].id,
        tracks[0].id,
      ]);
      expect(
        (
          await prisma.tournament.findUniqueOrThrow({
            where: { id: tournament.id },
          })
        ).topSize,
      ).toBe(2);
    });
  } finally {
    vi.stubGlobal("fetch", originalFetch);
    await prisma.tournament.delete({ where: { id: tournament.id } });
  }
});
