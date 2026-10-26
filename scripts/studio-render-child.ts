import { prisma } from "../src/lib/db";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStudioAttempt } from "../src/server/studio/render";
const terminate = () => {
  if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
  else process.exit(1);
};
process.once("disconnect", terminate);
process.once("message", async (request: any) => {
  if (request.operation === "render")
    setInterval(async () => {
      try {
        const row = await prisma.studioJob.findFirst({
          where: {
            id: request.jobId,
            status: "running",
            leaseToken: request.leaseToken,
            leaseUntil: { gt: new Date() },
          },
        });
        if (!row) terminate();
      } catch {
        terminate();
      }
    }, 5000).unref();
  try {
    let result: unknown;
    if (request.operation === "bundle") {
      await mkdir(request.publicDir, { recursive: true });
      await bundle({
        entryPoint: resolve("src/remotion/index.ts"),
        outDir: request.outDir,
        publicDir: request.publicDir,
        webpackOverride: (config) => ({
          ...config,
          resolve: {
            ...config.resolve,
            alias: { ...config.resolve?.alias, "@": resolve("src") },
          },
        }),
      });
      result = { built: true };
    } else {
      if (
        !(await prisma.studioJob.findFirst({
          where: {
            id: request.jobId,
            status: "running",
            leaseToken: request.leaseToken,
            leaseUntil: { gt: new Date() },
          },
        }))
      )
        throw new Error("LEASE_LOST");
      result = await renderStudioAttempt(request);
    }
    process.send?.({ result });
  } catch (error) {
    process.send?.({
      error:
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : "RENDER_FAILED",
    });
  }
});
