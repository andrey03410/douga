#!/usr/bin/env node
/** Reproducible local acceptance: npx tsx --env-file-if-exists=.env --tsconfig tsconfig.mcp.json scripts/verify-storyboard.ts */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import ffmpeg from "ffmpeg-static";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "../src/lib/db";
import { runStudioWorkerOnce } from "../src/server/studio/worker";
import { visualFixtureMedia } from "../src/video/visual-fixtures";
import { encodeVisualPng } from "./visual-regression";
import { ownedScenarioContent, measurePcm16, parseMcpToolData } from "./storyboard-verification-helpers";
import type { VideoContentInput } from "../src/video/content";
import type { VideoDocument } from "../src/video/types";

const root = process.cwd(), run = promisify(execFile), digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
type Connection = { client: Client; transport: StdioClientTransport; actorId: string };
interface Scenario { kind: "top" | "picker" | "board"; format: "wide" | "vertical"; projectId: string; version: number; presetId: string; content: VideoContentInput; storyboardJobId: string }
export async function verifyStoryboard() {
  const runId = randomUUID(), directory = path.join(root, "storage/verification/32-storyboard", `live-${runId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const save = async (name: string, value: unknown) => { const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };
  const summary: any = { runId, status: "running", startedAt: new Date().toISOString(), directory, scenarios: [], assertions: [], artifacts: [], steps: [], limitations: ["This scripted acceptance validates advertised forms and tools; it is not a controlled comparison of weak-agent models or an artistic rating."] };
  await save("summary.json", summary);
  const connections: Connection[] = [];
  let requestNumber = 0;
  const check = async (condition: unknown, name: string, evidence?: unknown) => { assert(condition, name); summary.assertions.push({ name, passed: true, evidence }); await save("summary.json", summary); };
  const snapshot = async (projectId: string) => ({ row: await prisma.studioProject.findUniqueOrThrow({ where: { id: projectId } }), revisions: await prisma.studioRevision.count({ where: { projectId } }), snapshots: await prisma.studioSnapshot.count({ where: { projectId } }) });
  const unchanged = async (projectId: string, before: unknown, name: string) => { const after = await snapshot(projectId); await save(`states/${name}.json`, { before, after }); await check(JSON.stringify(before) === JSON.stringify(after), name, { projectId }); };
  const open = async (actor: { id: string; email: string }): Promise<Connection> => {
    const client = new Client({ name: "verify-storyboard", version: "1.0.0" });
    const env = Object.fromEntries(Object.entries({ ...process.env, MCP_ACTOR_EMAIL: actor.email }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), "--env-file-if-exists=.env", "--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"], cwd: root, env, stderr: "pipe" });
    transport.stderr?.on("data", () => { /* MCP diagnostics cannot pollute machine-readable stdout. */ });
    await client.connect(transport, { timeout: 120_000 }); const connection = { client, transport, actorId: actor.id }; connections.push(connection); return connection;
  };
  const call = async (connection: Connection, name: string, args: Record<string, unknown>, expectedError?: string) => {
    const number = ++requestNumber;
    const response = await connection.client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 });
    const blocks = response.content as any[];
    const compact = { ...response, content: blocks.map((b) => b.type === "image" || b.type === "audio" ? { type: b.type, mimeType: b.mimeType, bytes: Buffer.from(b.data, "base64").length } : b) };
    await save(`calls/${String(number).padStart(3, "0")}-${name}.json`, { actorId: connection.actorId, request: args, response: compact });
    summary.steps.push({ number, tool: name, actorId: connection.actorId, expectedError: expectedError ?? null, isError: !!response.isError });
    if (expectedError) {
      const data = response.structuredContent ?? JSON.parse(blocks.find((b) => b.type === "text")?.text ?? "null");
      await check(!!response.isError && data?.error?.code === expectedError, `${name} rejects ${expectedError}`, data);
      return { data, response };
    }
    return { data: parseMcpToolData(response), response };
  };
  const download = async (connection: Connection, jobId: string, name: string) => {
    const inspected = await call(connection, "video_job_inspect", { jobId });
    const resource = await connection.client.readResource({ uri: `video://job/${jobId}` }, { timeout: 120_000 });
    const item = resource.contents.find((c) => "blob" in c) as { blob: string; mimeType: string } | undefined;
    assert(item, `Binary resource absent: ${jobId}`);
    const bytes = Buffer.from(item.blob, "base64"), extension = item.mimeType === "image/png" ? "png" : item.mimeType === "video/mp4" ? "mp4" : "aac";
    await check(bytes.length === inspected.data.bytes && digest(bytes) === inspected.data.hash, `resource hash ${name}`, { mimeType: item.mimeType, bytes: bytes.length });
    const file = path.join(directory, "artifacts", `${name}.${extension}`); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { mode: 0o600 });
    if (item.mimeType === "image/png") await check((inspected.response.content as any[]).some((c) => c.type === "image" && c.mimeType === "image/png"), `native PNG image block ${name}`);
    summary.artifacts.push({ name, jobId, file: path.relative(directory, file), mimeType: item.mimeType, bytes: bytes.length, sha256: digest(bytes) });
    return { file, mimeType: item.mimeType };
  };
  const finish = async (connection: Connection, initial: any, name: string) => {
    let job = initial;
    for (let attempt = 0; attempt < 5 && ["queued", "running"].includes(job.status); attempt++) {
      if (job.status === "queued") {
        const result = await runStudioWorkerOnce({ jobId: job.id, workerId: `verify-storyboard-${runId}` });
        assert(result, `Targeted worker did not claim ${job.id}; stop other heavy worker before retrying`);
        await save(`workers/${name}-${attempt}.json`, result);
      }
      job = (await call(connection, "video_job_get", { jobId: job.id })).data;
      if (job.status === "running") await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await save(`jobs/${name}.json`, job);
    await check(job.status === "done", `completed ${name}`, { id: job.id, status: job.status, error: job.error });
    const artifact = await download(connection, job.id, name);
    if (job.kind === "storyboard") {
      const inspected = await call(connection, "video_job_inspect", { jobId: job.id, frameId: "0" });
      const tile = (inspected.response.content as any[]).find((c) => c.type === "image");
      assert(tile, `Storyboard tile missing image block: ${name}`);
      const data = Buffer.from(tile.data, "base64");
      await check(data.length === inspected.data.bytes && digest(data) === inspected.data.hash, `storyboard frameId hash ${name}`);
      await writeFile(path.join(directory, "artifacts", `${name}-tile-0.png`), data, { mode: 0o600 });
    }
    return { job, artifact };
  };
  try {
    const credentials: any = { runId, directory, createdAt: new Date().toISOString() };
    for (const role of ["admin", "user"] as const) {
      const password = randomUUID() + randomUUID(), email = `verify32-${role}-${runId}@test.local`;
      const account = await prisma.user.create({ data: { email, role, passwordHash: await bcrypt.hash(password, 10) } });
      credentials[role] = { id: account.id, email, password };
    }
    await save("credentials.json", credentials); // Only this private storage file contains passwords.
    summary.accounts = { admin: { id: credentials.admin.id, email: credentials.admin.email }, user: { id: credentials.user.id, email: credentials.user.email } };
    const mediaDirectory = path.join(directory, "media"); await mkdir(mediaDirectory, { recursive: true });
    const visualAssetIds: string[] = [];
    for (const [i, color] of [[232, 91, 100], [76, 192, 222], [159, 214, 105], [172, 118, 223]].entries()) {
      const data = new Uint8Array(640 * 800 * 4);
      for (let y = 0; y < 800; y++) for (let x = 0; x < 640; x++) { const offset = (y * 640 + x) * 4, disk = (x - 320) ** 2 + (y - 270) ** 2 < 160 ** 2; for (let channel = 0; channel < 3; channel++) data[offset + channel] = disk || y > 500 && Math.abs(x - 320) < (y - 400) / 2 ? color[channel] : [16, 31, 52][channel]; data[offset + 3] = 255; }
      const file = path.join(mediaDirectory, `art-${i}.png`); await encodeVisualPng(file, { width: 640, height: 800, data });
      const art = await prisma.art.create({ data: { userId: credentials.admin.id, filePath: path.relative(path.join(root, "storage"), file), kind: "image", label: `Проверка32 / 光 ${i + 1}`, sizeBytes: (await readFile(file)).length } }); visualAssetIds.push(art.id);
    }
    const localMedia = visualFixtureMedia();
    for (const media of localMedia.filter((m) => m.filename.endsWith("svg"))) await writeFile(path.join(mediaDirectory, media.filename), media.data);
    const tone = localMedia.find((m) => m.id === "tone")!, audioPath = path.join(mediaDirectory, tone.filename); await writeFile(audioPath, tone.data);
    const audio = await prisma.art.create({ data: { userId: credentials.admin.id, filePath: path.relative(path.join(root, "storage"), audioPath), kind: "audio", label: "Проверка32 / 440 Hz", durationSec: 2, hasAudio: true, sizeBytes: tone.data.length } });
    const media = { visualAssetIds, audioAssetId: audio.id }; await save("media.json", media);
    const admin = await open(credentials.admin), user = await open(credentials.user);
    const tools = await admin.client.listTools(); await save("tools.json", tools);
    await check(tools.tools.length === 61, "exactly 61 real stdio MCP tool names", tools.tools.map((tool) => tool.name));
    for (const name of ["video_content_set", "video_storyboard", "video_review", "video_review_apply"]) await check(tools.tools.some((t) => t.name === name), `registered ${name}`);
    const scenarios: Scenario[] = [];
    for (const kind of ["top", "picker", "board"] as const) for (const format of ["wide", "vertical"] as const) {
      const name = `${kind}-${format}`; console.log(JSON.stringify({ progress: "scenario", name }));
      const list = (await call(admin, "video_preset_list", { recipes: true, kind, format, limit: 3, preview: false })).data;
      assert(list.items?.length > 0, `No recipes for ${name}`); const recommended = list.items.find((r: any) => r.recommended) ?? list.items[0];
      const presetId = recommended.id, advertised = (await call(admin, "video_preset_get", { presetId, preview: false })).data;
      assert(advertised.recipe?.contentForm?.example, `Missing content form for ${presetId}`);
      const content = ownedScenarioContent(advertised.recipe.contentForm.example, media, `Проверка32 ${name} / 光`);
      const created = (await call(admin, "video_project_create", { presetId, title: content.title, idempotencyKey: `${runId}:create:${name}` })).data;
      const filled = (await call(admin, "video_content_set", { projectId: created.id, expectedVersion: created.version, content, idempotencyKey: `${runId}:content:${name}` })).data;
      await check(filled.missingInputs?.length === 0, `filled ${name} without missing inputs`, filled.missingInputs);
      const before = await snapshot(created.id);
      const request = { projectId: created.id, expectedVersion: filled.version, pageSize: 12 };
      const queued = (await call(admin, "video_storyboard", request)).data;
      const completed = await finish(admin, queued, name);
      const repeated = await call(admin, "video_storyboard", request);
      await check(repeated.data.id === queued.id && repeated.data.status === "done", `cached same storyboard job ${name}`);
      await check((repeated.response.content as any[]).some((c) => c.type === "image"), `ready storyboard native image ${name}`);
      await unchanged(created.id, before, `readonly-${name}`);
      const scenario: Scenario = { kind, format, projectId: created.id, version: filled.version, presetId, content, storyboardJobId: completed.job.id };
      scenarios.push(scenario); summary.scenarios.push({ ...scenario, content: undefined, origin: completed.job.inspection?.origin, coverage: completed.job.inspection?.selection }); await save("summary.json", summary);
    }
    const picker = scenarios.find((s) => s.kind === "picker" && s.format === "wide")!;
    await call(admin, "video_storyboard", { projectId: picker.projectId, expectedVersion: picker.version + 100 }, "VERSION_CONFLICT");
    await call(user, "video_storyboard", { projectId: picker.projectId }, "NOT_FOUND");
    await call(user, "video_job_get", { jobId: picker.storyboardJobId }, "NOT_FOUND");
    await call(user, "video_job_inspect", { jobId: picker.storyboardJobId }, "NOT_FOUND");
    await call(user, "video_content_set", { projectId: picker.projectId, expectedVersion: picker.version, content: picker.content }, "NOT_FOUND");
    const old = (await call(admin, "video_job_get", { jobId: picker.storyboardJobId })).data;
    const tile = old.inspection.selection.tiles[0], beforeScene = await snapshot(picker.projectId);
    await finish(admin, (await call(admin, "video_storyboard", { projectId: picker.projectId, expectedVersion: picker.version, mode: "scene", sceneId: tile.sceneId, ...(tile.segmentId ? { segmentId: tile.segmentId } : {}) })).data, "scene-detail");
    await unchanged(picker.projectId, beforeScene, "readonly-scene-detail");
    const changed = (await call(admin, "video_content_set", { projectId: picker.projectId, expectedVersion: picker.version, content: { kind: "picker", mode: "merge", participants: [{ id: picker.content.participants![0].id, label: "Новое имя / 朝" }] } })).data;
    const beforeCompare = await snapshot(picker.projectId);
    const comparison = await finish(admin, (await call(admin, "video_storyboard", { projectId: picker.projectId, expectedVersion: changed.version, mode: "compare", compareJobId: picker.storyboardJobId, pageSize: 12 })).data, "content-comparison");
    await check(comparison.job.inspection.origin.version === changed.version && comparison.job.inspection.compareOrigin.version === picker.version && comparison.job.inspection.origin.documentHash !== comparison.job.inspection.compareOrigin.documentHash, "comparison pins distinct current/previous content origins");
    await unchanged(picker.projectId, beforeCompare, "readonly-compare");
    const longCreated = (await call(admin, "video_project_create", { presetId: picker.presetId, title: "Длинная проверка32" })).data;
    const longContent = structuredClone(picker.content); assert(longContent.kind === "picker", "Picker form required");
    longContent.rounds = Array.from({ length: 26 }, (_, i) => ({ ...structuredClone(longContent.rounds![0]), id: `long-round-${i + 1}`, prompt: `Раунд ${i + 1} / 光` }));
    const longFilled = (await call(admin, "video_content_set", { projectId: longCreated.id, expectedVersion: longCreated.version, content: longContent })).data;
    const beforeLong = await snapshot(longCreated.id), seen = new Set<string>(); let totalPages = 1, totalScenes = 0;
    for (let page = 0; page < totalPages; page++) {
      const completed = await finish(admin, (await call(admin, "video_storyboard", { projectId: longCreated.id, expectedVersion: longFilled.version, page, pageSize: 24 })).data, `long-page-${page}`);
      const selection = completed.job.inspection.selection; totalPages = selection.totalPages; totalScenes = selection.totalScenes;
      await check(selection.tiles.length <= 24, `long page ${page} respects max24`);
      for (const selected of selection.tiles) { const key = JSON.stringify([selected.segmentId, selected.sceneId]); assert(!seen.has(key), `Overview repeats scene across pages: ${key}`); seen.add(key); }
    }
    await check(totalScenes >= 25 && totalPages >= 2 && seen.size === totalScenes, "long overview covers every scene through explicit pages", { totalPages, totalScenes, scenesCovered: seen.size });
    await unchanged(longCreated.id, beforeLong, "readonly-long-pages");
    summary.longProjectId = longCreated.id;
    const invalid = scenarios.find((s) => s.kind === "top" && s.format === "vertical")!;
    const savedInvalid = (await call(admin, "video_draft_replace", { projectId: invalid.projectId, expectedVersion: invalid.version, text: "{" })).data;
    const invalidBefore = await snapshot(invalid.projectId), countBefore = await prisma.studioJob.count({ where: { projectId: invalid.projectId } });
    assert(invalidBefore.row.previewJson, "Invalid-draft control requires an existing last-good preview");
    await call(admin, "video_storyboard", { projectId: invalid.projectId, expectedVersion: savedInvalid.version }, "VALIDATION_FAILED");
    await check(await prisma.studioJob.count({ where: { projectId: invalid.projectId } }) === countBefore, "invalid draft does not enqueue last-good preview");
    await unchanged(invalid.projectId, invalidBefore, "readonly-invalid-draft");
    const custom: VideoDocument = { schemaVersion: 1, id: `review-control-${runId}`, title: "Контроль исправления подписи", kind: "top", seed: 32, output: { format: "wide", fps: 30 }, source: { kind: "manual", participants: [], rounds: [] }, bindings: {}, settings: { typography: { theme: "clean" } }, scenes: [{ id: "review-scene", block: "custom", duration: { sec: 5 }, nodes: [{ id: "review-label", type: "text", text: "Длинная подпись персонажа для проверки", units: "px", rect: { x: 100, y: 100, width: 240, height: 65 }, typography: { role: "label", font: "arimo", fontSize: 36, minFontSize: 20, fit: "fixed", maxLines: 1 } }] }] };
    const originalLabel = custom.scenes[0].nodes[0]; assert(originalLabel.type === "text", "Review control requires text");
    const reviewProject = (await call(admin, "video_project_create", { document: custom })).data;
    const beforeReview = await snapshot(reviewProject.id), review = (await call(admin, "video_review", { projectId: reviewProject.id, expectedVersion: reviewProject.version })).data;
    await check(review.issues.some((i: any) => i.code === "TEXT_OVERFLOW") && review.suggestions.length > 0, "review finds measured overflow and real authoring suggestion");
    const overflowSuggestion = review.suggestions.find((s: any) => s.kind === "compact-label") ?? review.suggestions[0];
    const reviewBefore = await finish(admin, (await call(admin, "video_storyboard", { projectId: reviewProject.id, expectedVersion: reviewProject.version })).data, "review-before");
    await unchanged(reviewProject.id, beforeReview, "readonly-review-before-apply");
    await call(admin, "video_review_apply", { projectId: reviewProject.id, expectedVersion: reviewProject.version + 1, reportId: review.reportId, suggestionIds: [overflowSuggestion.id] }, "VERSION_CONFLICT");
    const applied = (await call(admin, "video_review_apply", { projectId: reviewProject.id, expectedVersion: reviewProject.version, reportId: review.reportId, suggestionIds: [overflowSuggestion.id], idempotencyKey: `${runId}:review-apply` })).data;
    const afterReview = (await call(admin, "video_review", { projectId: reviewProject.id, expectedVersion: applied.version })).data;
    await check(!afterReview.issues.some((i: any) => i.code === "TEXT_OVERFLOW"), "supported review apply removes measured overflow");
    const afterDocument = (await call(admin, "video_document_get", { projectId: reviewProject.id, section: "draft" })).data.document;
    await check(afterDocument.scenes[0].nodes[0].text === originalLabel.text && JSON.stringify(afterDocument.source) === JSON.stringify(custom.source) && JSON.stringify(afterDocument.bindings) === JSON.stringify(custom.bindings), "review apply preserves text/source/media");
    await finish(admin, (await call(admin, "video_storyboard", { projectId: reviewProject.id, expectedVersion: applied.version, mode: "compare", compareJobId: reviewBefore.job.id })).data, "review-comparison"); summary.reviewProjectId = reviewProject.id;
    const deepCase = scenarios.find((s) => s.kind === "top" && s.format === "wide")!, beforeDeep = await snapshot(deepCase.projectId);
    const deep = (await call(admin, "video_review", { projectId: deepCase.projectId, expectedVersion: deepCase.version, mode: "deep" })).data;
    await check(deep.deep.jobs.length > 0, "deep review enqueues bounded actual preview clips");
    const measurements = [];
    for (const [index, request] of deep.deep.jobs.entries()) {
      const done = await finish(admin, (await call(admin, "video_job_get", { jobId: request.id })).data, `deep-${index}`);
      assert(done.artifact.mimeType === "video/mp4", "Deep review expected clip with audio");
      const decoded = await run(ffmpeg!, ["-v", "error", "-i", done.artifact.file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
      const pcm = Buffer.from(decoded.stdout), measurement = measurePcm16(pcm, 48000);
      await writeFile(path.join(directory, "artifacts", `deep-${index}.pcm`), pcm, { mode: 0o600 });
      await run(ffmpeg!, ["-v", "error", "-y", "-i", done.artifact.file, "-vf", "select=eq(n\\,15)", "-frames:v", "1", path.join(directory, "artifacts", `deep-${index}-frame.png`)]);
      measurements.push({ jobId: request.id, ...measurement, serverMeasurements: done.job.result?.measurements });
      await check(!measurement.silent && measurement.sampleCount > 0, `deep clip ${index} contains decoded non-silent PCM`, measurement);
    }
    await save("audio-measurements.json", measurements); await unchanged(deepCase.projectId, beforeDeep, "readonly-deep-review-and-render");
    const repeatedDeep = (await call(admin, "video_review", { projectId: deepCase.projectId, expectedVersion: deepCase.version, mode: "deep" })).data;
    await check(repeatedDeep.deep.jobs.every((j: any) => j.status === "done") && repeatedDeep.deep.jobs.map((j: any) => j.id).join() === deep.deep.jobs.map((j: any) => j.id).join(), "deep preview cache returns same completed jobs");
    summary.status = "passed";
  } catch (error) {
    summary.status = "failed"; summary.error = error instanceof Error ? error.message : String(error); summary.stack = error instanceof Error ? error.stack : undefined; process.exitCode = 1;
  } finally {
    for (const connection of connections) try { await connection.client.close(); } catch {}
    summary.finishedAt = new Date().toISOString(); await save("summary.json", summary); await prisma.$disconnect();
    console.log(JSON.stringify({ status: summary.status, directory, scenarios: summary.scenarios.length, assertions: summary.assertions.length, artifacts: summary.artifacts.length, error: summary.error ?? null }));
  }
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyStoryboard().catch((error) => { console.error(error instanceof Error ? error.message : "LIVE_VERIFICATION_FAILED"); process.exitCode = 1; });
