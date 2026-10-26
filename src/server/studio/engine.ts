import "server-only";
import path from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { VERSION } from "remotion/version";
import { absPath } from "@/lib/storage";
import { hash } from "./shared";
import { fileHash } from "./assets";
import { StudioError } from "./errors";
import { studioJobLimits } from "./job-types";

export async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort();
}
async function sourceId() {
  const files = [
    "package-lock.json",
    ...(await filesUnder("src/remotion")),
    ...(await filesUnder("src/video")),
    ...(await filesUnder("src/lib")),
  ].filter((f) => !f.endsWith(".test.ts"));
  return hash(
    JSON.stringify(
      await Promise.all(files.map(async (f) => [f, await fileHash(f)])),
    ),
  );
}
export function engineDirectory(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new StudioError("ENGINE_INVALID");
  return absPath(`studio-engines/${id}`);
}
export interface EngineManifest {
  version: string;
  files: Record<string, string>;
}
export async function verifyEngine(id: string) {
  const dir = engineDirectory(id);
  const manifest = JSON.parse(
    await readFile(path.join(dir, "engine.json"), "utf8"),
  ) as EngineManifest;
  if (manifest.version !== VERSION)
    throw new StudioError("ENGINE_RUNTIME_MISMATCH");
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (
      file.includes("..") ||
      path.isAbsolute(file) ||
      (await fileHash(path.join(dir, "bundle", file))) !== digest
    )
      throw new StudioError("ENGINE_HASH_MISMATCH");
  }
  return path.join(dir, "bundle");
}
/** Child is killable; Node memory and wall time do not depend on the web process. */
export function runStudioChild<T>(
  request: unknown,
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    onProgress?: (n: number) => void;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve("scripts/studio-render-child.ts"), [], {
      execArgv: [
        "--import",
        "tsx",
        `--max-old-space-size=${studioJobLimits.childHeapMiB}`,
      ],
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.resolve("tsconfig.mcp.json"),
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      detached: process.platform !== "win32",
    });
    let settled = false;
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const complete = () => {
        if (error) reject(error);
        else resolve(result!);
      };
      // Wait for process termination before the worker removes its attempt files.
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        kill();
        complete();
      } else {
        child.once("close", complete);
        kill();
      }
    };
    const abort = () => finish(new StudioError("JOB_CANCELED"));
    const timer = setTimeout(
      () => finish(new StudioError("JOB_TIMEOUT")),
      options.timeoutMs,
    );
    child.stderr?.resume();
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled)
        finish(
          new StudioError(
            code === 0 ? "WORKER_NO_RESULT" : "WORKER_PROCESS_FAILED",
          ),
        );
    });
    child.on("message", (message: any) => {
      if (message.progress !== undefined)
        options.onProgress?.(message.progress);
      if (message.error) finish(new StudioError(message.error));
      if (message.result !== undefined) finish(undefined, message.result);
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    else child.send(request as Parameters<typeof child.send>[0]);
  });
}
const preparing = new Map<string, Promise<string>>();
export async function prepareStudioEngine(): Promise<string> {
  const id = await sourceId();
  try {
    await verifyEngine(id);
    return id;
  } catch {}
  const current = preparing.get(id);
  if (current) return current;
  const pending = (async () => {
    const stage = absPath(`studio-engines/.build-${randomUUID()}`);
    await mkdir(stage, { recursive: true });
    try {
      await runStudioChild(
        {
          operation: "bundle",
          outDir: path.join(stage, "bundle"),
          publicDir: path.join(stage, "public"),
        },
        { timeoutMs: 120_000 },
      );
      if ((await sourceId()) !== id)
        throw new StudioError("ENGINE_CHANGED_DURING_BUILD");
      const files: Record<string, string> = {};
      for (const file of await filesUnder(path.join(stage, "bundle")))
        files[path.relative(path.join(stage, "bundle"), file)] =
          await fileHash(file);
      await writeFile(
        path.join(stage, "engine.json"),
        JSON.stringify({ version: VERSION, files }),
      );
      try {
        await rename(stage, engineDirectory(id));
      } catch {
        await verifyEngine(id);
      }
      return id;
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  })();
  preparing.set(id, pending);
  try {
    return await pending;
  } finally {
    preparing.delete(id);
  }
}
