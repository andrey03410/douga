import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument, getBuiltinPreset } from "@/video";
import * as studio from "@/server/studio";

const root = resolve(__dirname, "../..");
const email = `studio-mcp-${randomUUID()}@test.local`;
let owner: string,
  other: string,
  imageId: string,
  audioId: string,
  sourceId: string;
let videoId: string;
let client: Client, transport: StdioClientTransport;
async function raw(name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args });
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await raw(name, args);
  const content = result.content as { type: string; text?: string }[];
  const data = JSON.parse(content.find((c) => c.type === "text")!.text!);
  if (result.isError) throw new Error(JSON.stringify(data));
  return data;
}
async function error(
  name: string,
  args: Record<string, unknown>,
  code: string,
) {
  const result = await raw(name, args);
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain(code);
}
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email, passwordHash: "x", role: "admin" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `other-${email}`, passwordHash: "x", role: "admin" },
    })
  ).id;
  await mkdir(absPath(`arts/${owner}`), { recursive: true });
  for (const kind of ["image", "audio"] as const) {
    const path = `arts/${owner}/${kind}.${kind === "image" ? "png" : "wav"}`;
    execFileSync(ffmpeg!, [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      kind === "image" ? "color=red:s=64x64" : "sine=frequency=440:duration=1",
      ...(kind === "image" ? ["-frames:v", "1"] : []),
      absPath(path),
    ]);
    const art = await prisma.art.create({
      data: {
        userId: owner,
        kind,
        filePath: path,
        label: kind,
        sizeBytes: (await readFile(absPath(path))).length,
        hasAudio: kind === "audio",
        durationSec: kind === "audio" ? 1 : null,
      },
    });
    if (kind === "image") imageId = art.id;
    else audioId = art.id;
  }
  const videoPath = `arts/${owner}/changing.mp4`;
  execFileSync(ffmpeg!, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x64:r=30:d=1.2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1.2",
    "-vf",
    "drawbox=color=blue:t=fill:enable='gte(t,0.5)'",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    absPath(videoPath),
  ]);
  videoId = (
    await prisma.art.create({
      data: {
        userId: owner,
        kind: "video",
        filePath: videoPath,
        hasAudio: true,
        durationSec: 1.2,
        sizeBytes: (await readFile(absPath(videoPath))).length,
      },
    })
  ).id;
  const tournament = await prisma.tournament.create({
    data: {
      userId: owner,
      title: "My ranked top",
      scheme: "round_robin",
      status: "completed",
      topSize: 1,
    },
  });
  sourceId = tournament.id;
  const track = await prisma.track.create({
    data: {
      tournamentId: sourceId,
      title: "Ranked tone",
      filePath: `arts/${owner}/audio.wav`,
      kind: "audio",
      order: 0,
      durationSec: 1,
    },
  });
  await prisma.ranking.create({
    data: { tournamentId: sourceId, trackId: track.id, rank: 1, score: 10 },
  });
  transport = new StdioClientTransport({
    command: resolve(root, "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL!,
      MCP_ACTOR_EMAIL: email,
    },
    stderr: "inherit",
  });
  client = new Client({ name: "studio-acceptance", version: "1" });
  await client.connect(transport);
}, 60_000);
afterAll(async () => {
  await transport?.close();
  for (const uid of [owner, other]) {
    if (!uid) continue;
    await prisma.user.update({ where: { id: uid }, data: { role: "admin" } });
    for (const job of await prisma.studioJob.findMany({
      where: { userId: uid },
    })) {
      await studio.cancelStudioJob(uid, job.id);
      await studio.deleteStudioJob(uid, job.id);
    }
    for (const p of await studio.listStudioProjects(uid))
      await studio.deleteStudioProject(uid, p.id);
    await prisma.user.delete({ where: { id: uid } });
    for (const path of [`arts/${uid}`, `studio/${uid}`, `studio-jobs/${uid}`])
      await removePath(path);
  }
});

it("discovers SDK schemas, protocol, examples, presets and owned sources through stdio", async () => {
  const tools = (await client.listTools()).tools;
  expect(tools.map((t) => t.name)).toContain("video_capabilities");
  const caps = await call("video_capabilities");
  expect((await raw("video_capabilities")).structuredContent).toMatchObject({
    apiVersion: 1,
  });
  expect(caps).toMatchObject({
    apiVersion: 1,
    schemaVersion: 1,
    compilerVersion: "1.0.0",
  });
  expect(caps.clientDisplayLimitation).toContain("client");
  expect((await client.listResources()).resources.map((r) => r.uri)).toContain(
    "video://schema/document",
  );
  const schema = await client.readResource({ uri: "video://schema/document" });
  expect(
    JSON.parse((schema.contents[0] as { text: string }).text)
      .additionalProperties,
  ).toBe(false);
  expect((await call("video_examples")).items.length).toBeGreaterThan(1);
  const presets = await call("video_preset_list", { limit: 2 });
  expect(presets.items).toHaveLength(2);
  expect(presets.nextCursor).toBeTruthy();
  const sources = await call("video_source_list", { limit: 1 });
  expect(sources.items[0]).toMatchObject({
    id: sourceId,
    title: "My ranked top",
  });
  const source = await call("video_source_get", { sourceId, limit: 1 });
  expect(source.items[0]).toMatchObject({ rank: 1, label: "Ranked tone" });
  expect(JSON.stringify(source)).not.toContain("filePath");
  const top = await call("video_project_create", {
    presetId: "top.classic.wide",
    sourceId,
    idempotencyKey: randomUUID(),
  });
  expect(top.validation.ready).toBe(true);
  const ranked = await call("video_document_get", {
    projectId: top.id,
    section: "source",
  });
  expect(ranked.source.participants.map((p: { id: string }) => p.id)).toEqual(
    source.items.map((p: { id: string }) => p.id),
  );
  await error("video_project_create", {}, "SCHEMA_INVALID");
  await error(
    "video_project_create",
    { document: source, presetId: "top.classic.wide" },
    "SCHEMA_INVALID",
  );
});

it("exposes actual repeated timeline offsets and distinguishes stale preview from the frozen historical plan", async () => {
  const document = createVideoDocument({
    kind: "top",
    participants: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
  });
  document.settings.top = { durationSec: 1 };
  const p = await call("video_project_create", { document });
  const first = await call("video_timeline_get", { projectId: p.id, limit: 2 });
  expect(first).toMatchObject({
    available: true,
    fps: 30,
    durationInFrames: 90,
    stale: false,
    origin: { kind: "preview", version: 1, revision: 1 },
  });
  expect(first.items.map((s: { from: number }) => s.from)).toEqual([0, 30]);
  expect(first.items[1].recommendedFrames).toContain(30);
  expect(first.items[1].recommendedFrames).toContain(59);
  const second = await call("video_timeline_get", {
    projectId: p.id,
    limit: 2,
    cursor: first.nextCursor,
  });
  expect(second.items.map((s: { from: number }) => s.from)).toEqual([60]);
  expect(second.nextCursor).toBeNull();
  const job = await call("video_job_start", {
    projectId: p.id,
    kind: "still",
    frame: 30,
  });
  await call("video_job_cancel", { jobId: job.id });
  await call("video_draft_replace", {
    projectId: p.id,
    expectedVersion: 1,
    text: "{",
  });
  const stale = await call("video_timeline_get", { projectId: p.id });
  expect(stale).toMatchObject({
    version: 2,
    stale: true,
    origin: { kind: "preview", version: 1 },
  });
  const frozen = await call("video_timeline_get", {
    projectId: p.id,
    revision: job.revision,
  });
  expect(frozen).toMatchObject({
    stale: false,
    durationInFrames: 90,
    origin: { kind: "revision", revision: 1 },
  });
  expect(frozen.items).toEqual(stale.items);
  document.settings.top.durationSec = 2;
  await call("video_draft_replace", {
    projectId: p.id,
    expectedVersion: 2,
    document,
  });
  const edited = await call("video_timeline_get", { projectId: p.id });
  expect(edited).toMatchObject({
    stale: false,
    durationInFrames: 180,
    origin: { kind: "preview", version: 3, revision: null },
  });
  expect(
    (
      await call("video_timeline_get", {
        projectId: p.id,
        revision: job.revision,
      })
    ).durationInFrames,
  ).toBe(90);
  await error(
    "video_timeline_get",
    { projectId: p.id, cursor: "foreign-scene" },
    "NOT_FOUND",
  );
});

it("supports the JSON text fallback after an older MCP protocol handshake", async () => {
  const legacy = new StdioClientTransport({
    command: resolve(root, "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL!,
      MCP_ACTOR_EMAIL: email,
    },
  });
  type Reply = {
    result?: {
      protocolVersion?: string;
      content?: { type: string; text: string }[];
    };
    error?: unknown;
  };
  const pending = new Map<number, (reply: Reply) => void>();
  legacy.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number")
      pending.get(message.id)?.(message as Reply);
  };
  async function request(
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) {
    const reply = new Promise<Reply>((resolve) => pending.set(id, resolve));
    await legacy.send({ jsonrpc: "2.0", id, method, params });
    return reply;
  }
  try {
    await legacy.start();
    const initialized = await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "legacy-json-reader", version: "1" },
    });
    expect(initialized.result?.protocolVersion).toBe("2024-11-05");
    await legacy.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const response = await request(2, "tools/call", {
      name: "video_capabilities",
      arguments: {},
    });
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.result!.content![0].text).apiVersion).toBe(1);
  } finally {
    await legacy.close();
  }
});

it("creates neutral projects, binds owned media, edits with CAS/idempotency, validates, commits and restores", async () => {
  const document = createVideoDocument({
    kind: "top",
    title: "Secret answer",
    participants: [
      {
        id: "one",
        label: "Spoiler",
        media: { visual: "picture", audio: "tone" },
      },
    ],
  });
  document.bindings = {
    picture: { kind: "pool", assetId: imageId },
    tone: { kind: "pool", assetId: audioId },
  };
  document.settings.top = { durationSec: 1 };
  const key = randomUUID();
  const p = await call("video_project_create", {
    document,
    idempotencyKey: key,
  });
  expect(p).toMatchObject({
    version: 1,
    revision: 1,
    validation: { ready: true },
  });
  expect(
    (await raw("video_project_get", { projectId: p.id, unexpected: true }))
      .isError,
  ).toBe(true);
  expect(JSON.stringify(p)).not.toMatch(
    /Secret answer|Spoiler|document|plan|draftText/,
  );
  expect(
    await call("video_project_create", { document, idempotencyKey: key }),
  ).toEqual(p);
  await error(
    "video_project_create",
    { document: { ...document, title: "Other" }, idempotencyKey: key },
    "IDEMPOTENCY_CONFLICT",
  );
  const edit = {
    projectId: p.id,
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    operations: [
      {
        op: "set",
        target: { type: "participant", id: "one" },
        path: ["caption"],
        value: "New answer",
      },
    ],
  };
  const draft = await call("video_draft_patch", edit);
  expect(draft.version).toBe(2);
  expect(await call("video_draft_patch", edit)).toEqual(draft);
  const intervening = await call("video_draft_patch", {
    projectId: p.id,
    expectedVersion: 2,
    operations: [
      { op: "set", target: { type: "document" }, path: ["seed"], value: 3 },
    ],
  });
  expect(await call("video_draft_patch", edit)).toEqual(draft);
  const concurrentInput = {
    projectId: p.id,
    expectedVersion: intervening.version,
    idempotencyKey: randomUUID(),
    operations: [
      { op: "set", target: { type: "document" }, path: ["seed"], value: 4 },
    ],
  };
  const [a, b] = await Promise.all([
    call("video_draft_patch", concurrentInput),
    call("video_draft_patch", concurrentInput),
  ]);
  expect(a).toEqual(b);
  await error(
    "video_draft_replace",
    { projectId: p.id, expectedVersion: 1, document },
    "VERSION_CONFLICT",
  );
  await error(
    "video_draft_patch",
    {
      projectId: p.id,
      expectedVersion: a.version,
      operations: [
        {
          op: "set",
          target: { type: "participant", id: "missing" },
          path: ["caption"],
          value: "Repair",
        },
      ],
    },
    "PATCH_INVALID",
  );
  expect(
    (await call("video_project_validate", { projectId: p.id })).ready,
  ).toBe(true);
  const content = await raw("video_document_get", {
    projectId: p.id,
    section: "draft",
  });
  expect(JSON.stringify(content)).toContain("New answer");
  expect(
    (content.content as { annotations?: unknown }[])[0].annotations,
  ).toMatchObject({ audience: ["assistant"] });
  const committed = await call("video_draft_commit", {
    projectId: p.id,
    expectedVersion: a.version,
  });
  expect(committed.revision).toBe(2);
  const history = await call("video_history_list", {
    projectId: p.id,
    limit: 1,
  });
  await error(
    "video_document_get",
    { projectId: p.id, section: "draft", revision: 1 },
    "SCHEMA_INVALID",
  );
  expect(history.items).toHaveLength(1);
  expect(JSON.stringify(history)).not.toMatch(/Spoiler|New answer|document/);
  const restored = await call("video_revision_restore", {
    projectId: p.id,
    expectedVersion: committed.version,
    revision: 1,
  });
  expect(restored.revision).toBe(3);
  const page = await call("video_project_list", { limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(JSON.stringify(page)).not.toMatch(/Spoiler|Secret answer/);
  const foreign = await studio.createStudioProject(other, {
    document: createVideoDocument({ kind: "top" }),
  });
  await error("video_project_get", { projectId: foreign.id }, "NOT_FOUND");
  await error("video_project_list", { cursor: foreign.id }, "NOT_FOUND");
  await prisma.user.update({ where: { id: owner }, data: { role: "guest" } });
  await error(
    "video_draft_commit",
    { projectId: p.id, expectedVersion: restored.version },
    "FORBIDDEN",
  );
  const legacy = await raw("create_picker_project", {
    title: "Role downgrade",
  });
  expect(legacy.isError).toBe(true);
  await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
});

it("replays factory creation after preset deletion and makes concurrent identical creates one project", async () => {
  const preset = getBuiltinPreset("picker.two-groups.square")!;
  preset.skeleton.roundCount = 1;
  const saved = await call("video_preset_save", {
    name: "Temporary design",
    preset,
  });
  const input = { presetId: saved.id, idempotencyKey: randomUUID() };
  const [a, b] = await Promise.all([
    call("video_project_create", input),
    call("video_project_create", input),
  ]);
  expect(a).toEqual(b);
  await call("video_draft_replace", {
    projectId: a.id,
    expectedVersion: a.version,
    text: "{",
  });
  await studio.deleteStudioPreset(owner, saved.id);
  expect(await call("video_project_create", input)).toEqual(a);
  expect(
    await prisma.studioProject.count({ where: { id: a.id, userId: owner } }),
  ).toBe(1);
});

it("replays semantic receipts after intervening edits, preserves concurrent retries and requires replacing malformed drafts", async () => {
  const p = await call("video_project_create", {
    presetId: "picker.classic.wide",
    roundCount: 1,
  });
  const input = {
    projectId: p.id,
    expectedVersion: p.version,
    presetId: "picker.arc.vertical",
    idempotencyKey: randomUUID(),
  };
  const applied = await call("video_preset_apply", input);
  const changed = await call("video_draft_patch", {
    projectId: p.id,
    expectedVersion: applied.version,
    operations: [
      {
        op: "set",
        target: { type: "document" },
        path: ["title"],
        value: "Intervening edit",
      },
    ],
  });
  expect(await call("video_preset_apply", input)).toEqual(applied);
  const retry = {
    projectId: p.id,
    expectedVersion: changed.version,
    presetId: "picker.memory.square",
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    call("video_preset_apply", retry),
    call("video_preset_apply", retry),
  ]);
  expect(a).toEqual(b);
  await error(
    "video_draft_patch",
    {
      projectId: p.id,
      expectedVersion: a.version,
      idempotencyKey: retry.idempotencyKey,
      operations: [
        { op: "set", target: { type: "document" }, path: ["seed"], value: 2 },
      ],
    },
    "IDEMPOTENCY_CONFLICT",
  );
  const broken = await call("video_draft_replace", {
    projectId: p.id,
    expectedVersion: a.version,
    text: "{",
  });
  await error(
    "video_draft_patch",
    {
      projectId: p.id,
      expectedVersion: broken.version,
      operations: [
        {
          op: "set",
          target: { type: "document" },
          path: ["title"],
          value: "Should not use head",
        },
      ],
    },
    "DRAFT_REPLACEMENT_REQUIRED",
  );
  await error(
    "video_preset_apply",
    {
      projectId: p.id,
      expectedVersion: broken.version,
      presetId: "picker.classic.wide",
    },
    "DRAFT_REPLACEMENT_REQUIRED",
  );
  await error(
    "video_draft_replace",
    {
      projectId: p.id,
      expectedVersion: broken.version,
      text: "{}",
      document: {},
    },
    "SCHEMA_INVALID",
  );
  const unchanged = await call("video_document_get", {
    projectId: p.id,
    section: "draft",
  });
  expect(unchanged.text).toBe("{");
});

it("reuses personal group skeletons and applies design without changing source content", async () => {
  const preset = getBuiltinPreset("picker.two-groups.vertical")!;
  preset.skeleton = { roundCount: 2, cardsPerRound: 6, groupCount: 3 };
  preset.audio = { volume: 0.4, crossfadeSec: 0.2, loop: true };
  preset.formatSettings = { vertical: { background: "#123456" } };
  preset.scenes[0].nodes.push({
    id: "prompt",
    type: "text",
    text: "Выбери персонажа",
  });
  const saved = await call("video_preset_save", {
    name: "Reusable groups",
    preset,
  });
  expect(saved.personal).toBe(true);
  const p = await call("video_project_create", { presetId: saved.id });
  const content = await call("video_document_get", { projectId: p.id });
  expect(content.document.source.rounds).toHaveLength(2);
  expect(content.document.source.rounds[0].groups).toHaveLength(3);
  expect(content.document.source.rounds[0].cards).toHaveLength(6);
  expect(content.document.scenes[0].nodes[0].text).toBe("Выбери персонажа");
  expect(content.document.audio.playlist).toEqual({
    tracks: [],
    volume: 0.4,
    crossfadeSec: 0.2,
    loop: true,
  });
  expect(content.document.formatSettings).toEqual(preset.formatSettings);
  const extracted = await call("video_preset_save", {
    name: "Extracted",
    document: content.document,
  });
  expect(
    (await call("video_preset_get", { presetId: extracted.id })).preset
      .scenes[0].nodes[0].text,
  ).toBe("Text");
  const applied = await call("video_preset_apply", {
    projectId: p.id,
    presetId: "picker.memory.wide",
    expectedVersion: p.version,
  });
  expect(applied.version).toBe(2);
  const after = await call("video_document_get", {
    projectId: p.id,
    section: "draft",
  });
  expect(after.document.source).toEqual(content.document.source);
  const empty = await call("video_project_create", {
    document: createVideoDocument({ kind: "picker", roundCount: 1 }),
  });
  await call("video_preset_apply", {
    projectId: empty.id,
    presetId: saved.id,
    expectedVersion: empty.version,
  });
  const noPlaylist = await call("video_document_get", {
    projectId: empty.id,
    section: "draft",
  });
  expect(noPlaylist.document.audio.playlist).toEqual(
    content.document.audio.playlist,
  );
  await error(
    "video_preset_save",
    { name: "Both", preset, document: content.document },
    "SCHEMA_INVALID",
  );
  await error(
    "video_preset_save",
    { name: "Catalog is not canonical", preset: { ...preset, personal: true } },
    "SCHEMA_INVALID",
  );
});

it("inspects later original video frames, sound and bounded clips through owned resources", async () => {
  const frame = await raw("video_asset_inspect", {
    assetId: videoId,
    content: true,
    mode: "image",
    fromSec: 0.8,
  });
  const image = (frame.content as { type: string; data: string }[]).find(
    (c) => c.type === "image",
  )!;
  const pixel = execFileSync(
    ffmpeg!,
    [
      "-v",
      "error",
      "-i",
      "pipe:0",
      "-vf",
      "scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { input: Buffer.from(image.data, "base64") },
  );
  expect(pixel[2]).toBeGreaterThan(240);
  expect(pixel[0]).toBeLessThan(20);
  const sound = await raw("video_asset_inspect", {
    assetId: videoId,
    content: true,
    mode: "audio",
    fromSec: 0.5,
    durationSec: 0.25,
  });
  const audio = (sound.content as { type: string; data: string }[]).find(
    (c) => c.type === "audio",
  )!;
  const pcm = execFileSync(
    ffmpeg!,
    [
      "-v",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      "8000",
      "pipe:1",
    ],
    { input: Buffer.from(audio.data, "base64") },
  );
  expect(pcm.length).toBeGreaterThan(1000);
  expect(
    Array.from({ length: pcm.length / 4 }, (_, i) =>
      Math.abs(pcm.readFloatLE(i * 4)),
    ).some((v) => v > 0.05),
  ).toBe(true);
  const clip = await call("video_asset_inspect", {
    assetId: videoId,
    content: true,
    mode: "clip",
    fromSec: 0.8,
    durationSec: 0.25,
  });
  expect(clip).toMatchObject({ mimeType: "video/mp4" });
  expect(clip.uri).toContain("mode=clip");
  const resource = await client.readResource({ uri: clip.uri });
  const mp4 = Buffer.from(
    (resource.contents[0] as { blob: string }).blob,
    "base64",
  );
  expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
  const clipPcm = execFileSync(
    ffmpeg!,
    ["-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "pipe:1"],
    { input: mp4 },
  );
  expect(clipPcm.length).toBeGreaterThan(1000);
  await error(
    "video_asset_inspect",
    { assetId: videoId, content: true, mode: "audio", fromSec: 2 },
    "ASSET_RANGE_INVALID",
  );
  await error(
    "video_asset_inspect",
    { assetId: imageId, content: true, mode: "audio" },
    "ASSET_KIND_MISMATCH",
  );
  const foreign = await prisma.art.create({
    data: {
      userId: other,
      kind: "video",
      filePath: `arts/${owner}/changing.mp4`,
    },
  });
  await error(
    "video_asset_inspect",
    { assetId: foreign.id, content: true, mode: "clip" },
    "NOT_FOUND",
  );
  await expect(
    client.readResource({
      uri: `video://asset/${foreign.id}?mode=clip&fromSec=0&durationSec=0.25`,
    }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    client.readResource({
      uri: `video://asset/${videoId}?mode=clip&fromSec=2&durationSec=0.25`,
    }),
  ).rejects.toThrow("ASSET_RANGE_INVALID");
});

it("returns real image/audio inspection and scoped preview jobs; neutral status never embeds media", async () => {
  const asset = await raw("video_asset_inspect", {
    assetId: imageId,
    content: true,
  });
  const image = (asset.content as { type: string; data: string }[]).find(
    (c) => c.type === "image",
  )!;
  expect(Buffer.from(image.data, "base64").subarray(1, 4).toString()).toBe(
    "PNG",
  );
  const audio = await raw("video_asset_inspect", {
    assetId: audioId,
    content: true,
  });
  expect(
    (audio.content as { type: string }[]).some((c) => c.type === "audio"),
  ).toBe(true);
  const p = await call("video_project_create", {
    document: createVideoDocument({
      kind: "top",
      participants: [{ id: "one", label: "One" }],
    }),
  });
  for (const input of [
    { kind: "still", frame: 0 },
    { kind: "audio", fromFrame: 0, durationFrames: 15 },
    { kind: "clip", fromFrame: 0, durationFrames: 15 },
  ]) {
    const job = await call("video_job_start", {
      projectId: p.id,
      ...input,
      idempotencyKey: randomUUID(),
    });
    expect(job.status).toBe("queued");
    await studio.runStudioWorkerOnce({ jobId: job.id });
    const status = await call("video_job_get", { jobId: job.id });
    expect(status.status).toBe("done");
    expect(JSON.stringify(status)).not.toMatch(/"data"|filePath|\/Users\//);
    const inspection = await raw("video_job_inspect", { jobId: job.id });
    if (input.kind === "clip") {
      expect(inspection.structuredContent).toMatchObject({
        uri: `video://job/${job.id}`,
        mimeType: "video/mp4",
      });
      expect(
        (inspection.content as { type: string }[]).every(
          (c) => c.type === "text",
        ),
      ).toBe(true);
    } else {
      const media = (
        inspection.content as { type: string; data?: string }[]
      ).find((c) => c.type === (input.kind === "still" ? "image" : "audio"))!;
      expect(media.data!.length).toBeGreaterThan(100);
    }
    const resource = await client.readResource({
      uri: `video://job/${job.id}`,
    });
    const blob = (resource.contents[0] as { blob: string }).blob;
    expect(
      createHash("sha256").update(Buffer.from(blob, "base64")).digest("hex"),
    ).toBe(status.result.resource.hash);
    const foreign = await studio.startStudioImport(other, {
      url: "https://example.com/test.mp4",
      mode: "video",
    });
    await error("video_job_get", { jobId: foreign.id }, "NOT_FOUND");
    await error("video_job_cancel", { jobId: foreign.id }, "NOT_FOUND");
  }
  const pending = await call("video_job_start", {
    projectId: p.id,
    kind: "clip",
    fromFrame: 0,
    durationFrames: 15,
  });
  expect((await call("video_job_cancel", { jobId: pending.id })).status).toBe(
    "canceled",
  );
  const imported = await call("video_import_start", {
    url: "https://example.com/test.mp4",
    mode: "video",
    idempotencyKey: randomUUID(),
  });
  expect(imported).toMatchObject({
    kind: "import",
    status: "queued",
    projectId: null,
  });
  expect((await call("video_job_cancel", { jobId: imported.id })).status).toBe(
    "canceled",
  );
  await prisma.user.update({ where: { id: owner }, data: { role: "user" } });
  await error(
    "video_job_start",
    { projectId: p.id, kind: "render" },
    "FORBIDDEN",
  );
  await prisma.user.update({ where: { id: owner }, data: { role: "admin" } });
}, 240_000);
