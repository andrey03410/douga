import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ffmpeg from "ffmpeg-static";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createArt } from "@/server/arts";
import { createVideoDocument } from "@/video";
import * as studio from "@/server/studio";
import { studioHttp } from "@/server/studio/http";
import { fileHash } from "@/server/studio/assets";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({ requireUser: async () => ({ id: auth.id }) }));
let owner: string;
let client: Client;
let imageId: string, videoId: string, audioId: string;
const email = `studio-final-${randomUUID()}@test.local`;
const fixture = `studio-final-${randomUUID()}`;
const privateTitle = "PRIVATE-ANSWER-NEBULA-7164";
const http = (path: string, method = "GET", body?: unknown) =>
  studioHttp(
    new Request(`http://localhost/api/studio/${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw Error(JSON.stringify(response));
  return JSON.parse(
    (response.content as { type: string; text: string }[]).find(
      (x) => x.type === "text",
    )!.text,
  );
}
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email, passwordHash: "x", role: "admin" },
    })
  ).id;
  auth.id = owner;
  await mkdir(absPath(fixture), { recursive: true });
  for (const kind of ["image", "video", "audio"] as const) {
    const fileName =
      kind === "image"
        ? "sample.png"
        : kind === "video"
          ? "sample.mp4"
          : "sample.wav";
    execFileSync(ffmpeg!, [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      kind === "audio"
        ? "sine=frequency=660:duration=1"
        : "color=red:s=64x64:r=30:d=1",
      ...(kind === "image"
        ? ["-frames:v", "1"]
        : kind === "video"
          ? ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
          : []),
      absPath(`${fixture}/${fileName}`),
    ]);
    const art = await createArt(owner, {
      fileName,
      data: await readFile(absPath(`${fixture}/${fileName}`)),
    });
    if (kind === "image") imageId = art.id;
    if (kind === "video") videoId = art.id;
    if (kind === "audio") audioId = art.id;
  }
  client = new Client({ name: "final-fix-regression", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp/server.ts"],
      cwd: resolve(__dirname, "../.."),
      env: {
        ...getDefaultEnvironment(),
        DATABASE_URL: process.env.DATABASE_URL!,
        MCP_ACTOR_EMAIL: email,
        TSX_TSCONFIG_PATH: resolve("tsconfig.mcp.json"),
      },
    }),
  );
}, 30_000);
afterAll(async () => {
  await client?.close();
  if (owner) {
    for (const job of await prisma.studioJob.findMany({
      where: { userId: owner },
    })) {
      await studio.cancelStudioJob(owner, job.id);
      await studio.deleteStudioJob(owner, job.id);
    }
    for (const project of await studio.listStudioProjects(owner))
      await studio.deleteStudioProject(owner, project.id);
    await prisma.user.delete({ where: { id: owner } });
    for (const base of ["studio", "arts", "studio-jobs"])
      await removePath(`${base}/${owner}`);
  }
  await removePath(fixture);
});

it("MCP personal preset save/apply/commit preserves real custom media in frozen composition", async () => {
  const d = createVideoDocument({
    kind: "picker",
    roundCount: 2,
    cardsPerRound: 2,
  });
  d.source.rounds[0].answer = { cardIds: [d.source.rounds[0].cards[0].id] };
  d.source.participants[0].settings = { card: { volume: 0.4 } };
  d.bindings = {
    poster: { kind: "pool", assetId: imageId },
    footage: { kind: "pool", assetId: videoId },
    music: { kind: "pool", assetId: audioId },
  };
  d.scenes.push({
    id: "custom",
    block: "custom",
    duration: { sec: 1 },
    nodes: [
      { id: "poster", type: "image", asset: "poster", required: true },
      {
        id: "nested",
        type: "container",
        children: [
          { id: "footage", type: "video", asset: "footage", required: true },
          { id: "music", type: "audio", asset: "music", role: "music" },
        ],
      },
    ],
  });
  const p = await call("video_project_create", { document: d });
  const saved = await call("video_preset_save", {
    document: d,
    name: "Round trip",
  });
  const preset = await call("video_preset_get", { presetId: saved.id });
  for (const id of [imageId, videoId, audioId])
    expect(JSON.stringify(preset)).not.toContain(id);
  const applied = await call("video_preset_apply", {
    projectId: p.id,
    expectedVersion: p.version,
    presetId: saved.id,
  });
  expect(applied.validation.ready).toBe(true);
  const committed = await call("video_draft_commit", {
    projectId: p.id,
    expectedVersion: applied.version,
  });
  const frozen = await studio.freezeStudioProject(owner, p.id, {
    expectedVersion: committed.version,
  });
  expect(frozen.document.source).toEqual(d.source);
  expect(
    frozen.plan.scenes
      .flatMap((s) => s.nodes)
      .filter((n) => n.media)
      .map((n) => n.media!.asset.id),
  ).toEqual([imageId, videoId]);
  expect(frozen.plan.audio.map((c) => c.asset.id)).toEqual([audioId]);
  for (const media of Object.values(frozen.files))
    expect(await fileHash(absPath(media.path))).toBe(media.hash);
  const before = await studio.getStudioProject(owner, p.id);
  const incompatible = await http(`projects/${p.id}/preset`, "POST", {
    expectedVersion: before.version,
    presetId: "picker.classic.wide",
  });
  expect(incompatible.status).toBe(400);
  expect(await incompatible.json()).toMatchObject({
    error: "PRESET_INCOMPATIBLE",
    diagnostics: [
      expect.objectContaining({
        path: expect.any(String),
        message: expect.stringMatching(/retain|remove|transfer/i),
      }),
    ],
  });
  expect((await studio.getStudioProject(owner, p.id)).version).toBe(
    before.version,
  );
});

for (const type of ["image", "video"] as const)
  for (const asset of ["missing", `slot:${type}:1`])
    it.each([true, false])(
      `current ${type} ${asset} required=%s gates commit/freeze/final job`,
      async (required) => {
        const p = await studio.createStudioProject(owner, {
          document: createVideoDocument({
            kind: "top",
            participants: [{ id: "plain", label: "No media" }],
          }),
        });
        const d = structuredClone(p.document);
        d.scenes.push({
          id: "custom",
          block: "custom",
          duration: { sec: 1 },
          nodes: [{ id: "visual", type, asset, required }],
        });
        const saved = await studio.saveStudioDraft(owner, p.id, {
          expectedVersion: p.version,
          document: d,
        });
        expect(saved.validation.ready).toBe(!required);
        if (required) {
          await expect(
            studio.commitStudioDraft(owner, p.id, {
              expectedVersion: saved.version,
            }),
          ).rejects.toThrow("VALIDATION_FAILED");
          await expect(
            studio.freezeStudioProject(owner, p.id, {
              expectedVersion: saved.version,
            }),
          ).rejects.toThrow("VALIDATION_FAILED");
          await expect(
            studio.startStudioJob(owner, p.id, {
              expectedVersion: saved.version,
              kind: "render",
            }),
          ).rejects.toThrow("VALIDATION_FAILED");
          expect(
            await prisma.studioJob.count({ where: { projectId: p.id } }),
          ).toBe(0);
          expect(
            (await studio.freezeStudioProject(owner, p.id, { revision: 1 }))
              .revision,
          ).toBe(1);
        } else {
          const committed = await studio.commitStudioDraft(owner, p.id, {
            expectedVersion: saved.version,
          });
          expect((await studio.freezeStudioProject(owner, p.id)).revision).toBe(
            committed.revision,
          );
          const job = await studio.startStudioJob(owner, p.id, {
            expectedVersion: committed.version,
            kind: "render",
          });
          expect(job.status).toBe("queued");
          await studio.cancelStudioJob(owner, job.id);
        }
      },
      120_000,
    );

it.each(["HTTP", "MCP"])(
  "completed import get/cancel stay neutral over %s while explicit inspection retains title",
  async (transport) => {
    await prisma.art.update({
      where: { id: videoId },
      data: { label: privateTitle },
    });
    const art = await prisma.art.findUniqueOrThrow({ where: { id: videoId } });
    const input = {
      url: "https://example.com/opaque",
      mode: "video",
      idempotencyKey: randomUUID(),
    };
    const started = await call("video_import_start", input);
    expect(JSON.stringify(started)).not.toContain(privateTitle);
    const hash = await fileHash(absPath(art.filePath));
    // Persist the pre-fix completion shape: existing jobs must be safe too.
    await prisma.studioJob.update({
      where: { id: started.id },
      data: {
        status: "done",
        progress: 1,
        leaseToken: "complete",
        resultJson: JSON.stringify({
          kind: "import",
          asset: {
            id: videoId,
            kind: "video",
            label: privateTitle,
            bytes: art.sizeBytes,
            hash,
            mimeType: "video/mp4",
            durationSec: 1,
            hasAudio: false,
            hasVideo: true,
            poster: false,
          },
        }),
      },
    });
    if (transport === "HTTP")
      for (const method of ["GET", "DELETE"]) {
        const response = await http(
          `jobs/${started.id}${method === "DELETE" ? "/cancel" : ""}`,
          method === "DELETE" ? "POST" : method,
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain(privateTitle);
        expect(body.result.asset).toMatchObject({
          id: videoId,
          kind: "video",
          hash,
          bytes: art.sizeBytes,
        });
        expect(body.result.asset).not.toHaveProperty("label");
      }
    if (transport === "MCP")
      for (const name of ["video_job_get", "video_job_cancel"]) {
        const response = await client.callTool({
          name,
          arguments: { jobId: started.id },
        });
        expect(response.isError).not.toBe(true);
        expect(JSON.stringify(response)).not.toContain(privateTitle);
        expect(response.structuredContent).toMatchObject({
          status: "done",
          result: { kind: "import", asset: { id: videoId, hash } },
        });
      }
    expect(
      JSON.stringify(await call("video_import_start", input)),
    ).not.toContain(privateTitle);
    expect(
      await call("video_asset_inspect", { assetId: videoId, content: false }),
    ).toMatchObject({ label: privateTitle });
    expect((await studio.getStudioJobArtifact(owner, started.id)).hash).toBe(
      hash,
    );
    expect(
      (await prisma.art.findUniqueOrThrow({ where: { id: videoId } })).label,
    ).toBe(privateTitle);
  },
);
