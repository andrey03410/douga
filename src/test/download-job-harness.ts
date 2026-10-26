import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { onTestFinished } from "vitest";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { cancelDownload, type StartDownloadInput } from "@/server/downloads";
import { importCleanupMs } from "./native-import-budget";

export function processGroupAlive(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/** Keep real service/network/media behavior, but own its entire native lifetime. */
export async function startIsolatedDownload(
  userId: string,
  input: StartDownloadInput,
) {
  const startedAt = new Date();
  let child: ChildProcess | undefined;
  let closed = Promise.resolve();
  let cleanupPromise: Promise<void> | undefined;
  const cancelOwnedRunning = async () => {
    const jobs = await prisma.downloadJob.findMany({
      where: {
        userId,
        url: input.url,
        createdAt: { gte: startedAt },
        status: { in: ["queued", "running"] },
      },
    });
    for (const job of jobs) await cancelDownload(userId, job.id);
  };
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        await cancelOwnedRunning();
      } finally {
        if (child?.pid) {
          try {
            if (process.platform === "win32") child.kill("SIGKILL");
            else process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        await closed;
        if (child?.pid) {
          const deadline = Date.now() + importCleanupMs / 2;
          while (processGroupAlive(child.pid)) {
            if (Date.now() > deadline)
              throw new Error(
                `Test-owned download process group ${child.pid} survived cleanup`,
              );
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        // Catch a row created between the first query and child termination.
        await cancelOwnedRunning();
      }
    })());
  // Register before spawn/start, including framework timeout and failed assertions.
  onTestFinished(cleanup, importCleanupMs);
  child = fork(path.resolve("src/test/download-job-child.ts"), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.resolve("tsconfig.mcp.json"),
      YTDLP_PROXY: "",
      YTDLP_PATH: absPath("bin/yt-dlp"),
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  closed = new Promise<void>((resolve) =>
    child!.once("close", () => resolve()),
  );
  const job = await new Promise<{ id: string }>((resolve, reject) => {
    child!.once("error", reject);
    child!.once("close", () =>
      reject(new Error("Download test child exited before replying")),
    );
    child!.once("message", (message: { id?: string; error?: string }) => {
      if (message.error) reject(new Error(message.error));
      else if (message.id) resolve({ id: message.id });
      else reject(new Error("Invalid download test child reply"));
    });
    child!.send({ userId, input });
  });
  return { ...job, stop: cleanup, processId: child.pid! };
}
