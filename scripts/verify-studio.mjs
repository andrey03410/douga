#!/usr/bin/env node
// Public MCP acceptance probe. It never starts an unscoped queue daemon.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: node scripts/verify-studio.mjs --actor EMAIL
  (--project ID | --document FILE) [--kind still|clip|audio|render]
  [--seconds 3] [--output DIR] [--timeout 600]

Requires an existing account and initialized local database. Actor is mandatory;
MCP_ACTOR_EMAIL from .env is never used as the default. --seconds (0 < n <= 15)
limits clip/audio from frame 0; still uses frame 0; render uses the full saved
revision and requires admin. Timeout is total wall time in seconds (max 14400).
Existing projects are read, validated and rendered by saved revision; drafts are
not committed. Source reconciliation on reads may create its normal revision.
The output directory must be new. Keep it private: explicit input/timeline reads
can contain answers. Do not run alongside tests or an unscoped Studio worker.`;

function options() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    process.exit(0);
  }
  const allowed = new Set(["actor", "project", "document", "kind", "seconds", "output", "timeout"]);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed.has(key) || key in values || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`Invalid or duplicate option: ${args[i]}\n${usage}`);
    values[key] = args[i + 1];
  }
  if (!values.actor?.trim() || Boolean(values.project) === Boolean(values.document))
    throw new Error(`Explicit --actor and exactly one input are required.\n${usage}`);
  const kind = values.kind ?? "clip";
  const seconds = Number(values.seconds ?? 3);
  const timeout = Number(values.timeout ?? 600);
  if (!["still", "clip", "audio", "render"].includes(kind) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 15 || !Number.isFinite(timeout) || timeout <= 0 || timeout > 14400)
    throw new Error(`Invalid kind, seconds or timeout.\n${usage}`);
  return { ...values, actor: values.actor.trim(), kind, seconds, timeout };
}

async function main() {
  const input = options();
  const runId = randomUUID();
  const output = path.resolve(input.output ?? path.join(root, "storage", "studio-verification", runId));
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 }); // Exclusive: never overwrite another run.
  const save = (name, data) => writeFile(path.join(output, name), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  const summary = {
    runId, startedAt: new Date().toISOString(), actor: input.actor,
    input: input.project ? { projectId: input.project } : { documentFile: path.resolve(input.document) },
    kind: input.kind, seconds: input.seconds, timeoutSeconds: input.timeout,
    createKey: `verify-studio/create/${runId}`, jobKey: `verify-studio/job/${runId}`,
    downloadVerified: false, status: "running",
  };
  await save("summary.json", summary);
  const abort = new AbortController();
  const deadline = Date.now() + input.timeout * 1000;
  const timer = setTimeout(() => abort.abort(new Error("Acceptance wall-time budget exceeded")), input.timeout * 1000);
  const interrupt = () => abort.abort(new Error("Acceptance interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const requestOptions = () => ({ signal: abort.signal, timeout: Math.max(1, deadline - Date.now()) });
  const env = Object.fromEntries(Object.entries({ ...process.env, MCP_ACTOR_EMAIL: input.actor }).filter(([, v]) => v !== undefined));
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const runtime = [tsx, "--env-file-if-exists=.env", "--tsconfig", "tsconfig.mcp.json"];
  const log = createWriteStream(path.join(output, "process.log"), { flags: "wx", mode: 0o600 });
  const client = new Client({ name: "verify-studio", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [...runtime, "src/mcp/server.ts"], cwd: root, env, stderr: "pipe" });
  transport.stderr?.on("data", (chunk) => log.write(chunk));
  let worker;
  let workerExit;
  let workerFinished = true;
  let jobId;
  const stopWorker = () => {
    if (!worker || workerFinished) return;
    try {
      if (process.platform === "win32") worker.kill("SIGKILL");
      else process.kill(-worker.pid, "SIGKILL");
    } catch { /* The scoped process may already have exited. */ }
  };
  abort.signal.addEventListener("abort", stopWorker);
  const call = async (name, args = {}) => {
    abort.signal.throwIfAborted();
    const response = await client.callTool({ name, arguments: args }, undefined, requestOptions());
    const text = response.content.find((item) => item.type === "text")?.text;
    const data = text ? JSON.parse(text) : response.structuredContent;
    if (response.isError) throw new Error(`${name}: ${JSON.stringify(data)}`);
    if (!data) throw new Error(`${name}: missing structured response`);
    return data;
  };
  const startWorker = () => {
    workerFinished = false;
    worker = spawn(process.execPath, [...runtime, "scripts/studio-worker.ts", "--once", "--job", jobId], {
      cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    worker.stdout.on("data", (chunk) => log.write(chunk));
    worker.stderr.on("data", (chunk) => log.write(chunk));
    workerExit = new Promise((resolve) => {
      worker.once("error", (error) => { workerFinished = true; resolve({ error: error.message }); });
      worker.once("close", (code, signal) => { workerFinished = true; resolve({ code, signal }); });
    });
  };
  try {
    await client.connect(transport, requestOptions());
    const tools = await client.listTools({}, requestOptions());
    await save("tools.json", tools);
    const capabilities = await call("video_capabilities");
    await save("capabilities.json", capabilities);
    if (input.kind === "render" && !capabilities.permissions.render) throw new Error("Final render requires an admin actor");
    for (const name of ["document", "services", "preset"])
      await save(`schema-${name}.json`, await call("video_schema_get", { name }));
    const expected = [
      ...["classic", "minimal", "cinematic"].flatMap((name) => ["wide", "vertical", "square"].map((format) => `top.${name}.${format}`)),
      ...["classic", "portrait", "memory", "arc", "two-groups", "three-groups", "separate-answer"].flatMap((name) => ["wide", "vertical", "square"].map((format) => `picker.${name}.${format}`)),
    ];
    const presets = [];
    let cursor;
    do {
      const page = await call("video_preset_list", { limit: 100, ...(cursor ? { cursor } : {}) });
      presets.push(...page.items);
      if (page.nextCursor === cursor && cursor) throw new Error("Preset pagination did not advance");
      cursor = page.nextCursor;
    } while (cursor && expected.some((id) => !presets.some((p) => p.id === id && p.personal === false)));
    await save("presets.json", { items: presets });
    const missing = expected.filter((id) => !presets.some((p) => p.id === id && p.personal === false));
    if (missing.length) throw new Error(`Missing built-in presets: ${missing.join(", ")}`);
    summary.builtinPresets = expected.length;
    let projectId = input.project;
    if (!projectId) {
      const bytes = await readFile(path.resolve(input.document));
      summary.input.sha256 = createHash("sha256").update(bytes).digest("hex");
      const document = JSON.parse(bytes.toString("utf8"));
      await save("input-document.json", document);
      const created = await call("video_project_create", { document, idempotencyKey: summary.createKey });
      await save("created.json", created);
      projectId = created.id;
    }
    summary.projectId = projectId;
    await save("summary.json", summary);
    const meta = await call("video_project_get", { projectId });
    await save("project.json", meta);
    await save("document.json", await call("video_document_get", { projectId, revision: meta.revision }));
    const validation = await call("video_project_validate", { projectId });
    await save("validation.json", validation);
    if (!validation.ready) throw new Error("Project validation failed; see validation.json");
    const timelines = [];
    cursor = undefined;
    do {
      const page = await call("video_timeline_get", { projectId, revision: meta.revision, limit: 100, ...(cursor ? { cursor } : {}) });
      timelines.push(page);
      if (page.nextCursor === cursor && cursor) throw new Error("Timeline pagination did not advance");
      cursor = page.nextCursor;
    } while (cursor);
    await save("timeline.json", timelines);
    const plan = timelines[0];
    if (!plan.available || !Number.isFinite(plan.fps) || plan.fps <= 0 || !Number.isInteger(plan.durationInFrames) || plan.durationInFrames < 1)
      throw new Error("Saved revision has no usable compiled timeline");
    const request = {
      projectId, kind: input.kind, expectedVersion: meta.version, revision: meta.revision, idempotencyKey: summary.jobKey,
      ...(input.kind === "still" ? { frame: 0 } : input.kind === "render" ? {} : {
        fromFrame: 0, durationFrames: Math.min(plan.durationInFrames, Math.max(1, Math.floor(input.seconds * plan.fps))),
      }),
    };
    await save("job-request.json", request);
    const queued = await call("video_job_start", request);
    jobId = queued.id;
    summary.jobId = jobId;
    summary.revision = queued.revision;
    summary.snapshotHash = queued.snapshotHash;
    await save("queued.json", queued);
    await save("summary.json", summary);
    if (queued.revision !== meta.revision) throw new Error("Queued revision differs from inspected saved revision");
    let job;
    const states = [];
    for (;;) {
      abort.signal.throwIfAborted();
      job = await call("video_job_get", { jobId });
      const state = { status: job.status, progress: job.progress, attempts: job.attempts, error: job.error };
      if (JSON.stringify(states.at(-1)?.state) !== JSON.stringify(state)) {
        states.push({ at: new Date().toISOString(), state });
        await save("job-states.json", states);
        console.log(`${jobId}: ${job.status} ${Math.round(job.progress * 100)}% (attempt ${job.attempts})`);
      }
      await save("job.json", job);
      if (["done", "failed", "canceled"].includes(job.status)) break;
      if (workerFinished) {
        if (workerExit) {
          const exit = await workerExit;
          if (exit.error || exit.code !== 0) throw new Error(`Scoped worker exited: ${JSON.stringify(exit)}`);
        }
        startWorker();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (job.status !== "done") throw new Error(`Job ${job.status}: ${job.error ?? "no error detail"}`);
    if (workerExit) await workerExit;
    const result = job.result;
    if (!result?.resource || result.resource.jobId !== jobId || job.revision !== meta.revision || job.snapshotHash !== queued.snapshotHash)
      throw new Error("Completed job does not match the frozen request");
    summary.result = result;
    summary.durationSeconds = result.durationFrames / result.fps;
    const limit = Math.min(12 * 1024 * 1024, capabilities.limits.inspection.maxInlineBytes);
    if (result.resource.bytes > limit) {
      summary.status = "artifact-download-required";
      summary.downloadRoute = `/api/studio/jobs/${encodeURIComponent(jobId)}/result?download=1`;
      summary.note = "Completed output exceeds MCP read budget. Download through the authenticated website; this run has NOT verified downloaded bytes.";
    } else {
      const resource = await client.readResource({ uri: `video://job/${jobId}` }, requestOptions());
      const item = resource.contents.find((entry) => typeof entry.blob === "string");
      if (!item) throw new Error("MCP resource did not contain binary bytes");
      const bytes = Buffer.from(item.blob, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== result.resource.bytes || hash !== result.resource.hash || item.mimeType !== result.resource.mimeType)
        throw new Error("MCP output bytes/hash/mimeType mismatch");
      const extension = { "image/png": "png", "audio/aac": "aac", "video/mp4": "mp4" }[item.mimeType];
      if (!extension) throw new Error(`Unexpected artifact MIME type: ${item.mimeType}`);
      const filename = `artifact.${extension}`;
      await writeFile(path.join(output, filename), bytes, { flag: "wx", mode: 0o600 });
      summary.artifact = { file: filename, bytes: bytes.length, sha256: hash, mimeType: item.mimeType };
      summary.downloadVerified = true;
      summary.status = "passed";
    }
  } catch (error) {
    summary.status = "failed";
    summary.error = error instanceof Error ? error.message : String(error);
    // Only cancel the job created by this run. The short cleanup request is
    // independent of the expired run signal and cannot affect another job.
    if (jobId) {
      try {
        const canceled = await client.callTool({ name: "video_job_cancel", arguments: { jobId } }, undefined, { timeout: 5000 });
        await save("cleanup-cancel.json", canceled);
      } catch { summary.cleanup = "Could not confirm cancellation; inspect the recorded job ID before resuming."; }
    }
    console.error(summary.error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    stopWorker();
    abort.signal.removeEventListener("abort", stopWorker);
    try { await client.close(); }
    catch { summary.transportCleanup = "MCP transport close could not be confirmed."; }
    log.end();
    summary.finishedAt = new Date().toISOString();
    await save("summary.json", summary);
    console.log(JSON.stringify({ status: summary.status, projectId: summary.projectId, jobId, artifact: summary.artifact, result: summary.result, downloadVerified: summary.downloadVerified, output }, null, 2));
    if (summary.status === "artifact-download-required") process.exitCode = 2;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
