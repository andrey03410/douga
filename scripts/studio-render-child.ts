import { prisma } from "../src/lib/db";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { importStudioAttempt } from "../src/server/studio/import-attempt";
import { renderStudioAttempt } from "../src/server/studio/render";
const terminate = () => {
  if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
  else process.exit(1);
};
process.once("disconnect", terminate);
process.once("message", async (request: any) => {
  const diagnosticLease = async () => !!(await prisma.studioWorkerLease.findFirst({
    where: { id: "heavy", token: request.leaseToken, until: { gt: new Date() } },
  }));
  if (request.operation === "diagnostic")
    setInterval(async () => {
      try { if (!(await diagnosticLease())) terminate(); } catch { terminate(); }
    }, 5000).unref();
  if (request.operation === "render" || request.operation === "import")
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
      await mkdir(resolve(request.publicDir, "fonts"), { recursive: true });
      await cp(resolve("public/fonts/typography-v1"), resolve(request.publicDir, "fonts/typography-v1"), { recursive: true });
      await bundle({
        entryPoint: resolve("src/remotion-entry/index.ts"),
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
    } else if (request.operation === "diagnostic") {
      if (!(await diagnosticLease())) throw new Error("LEASE_LOST");
      result = await renderStudioAttempt({ ...request, operation: "render" });
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
      result =
        request.operation === "import"
          ? await importStudioAttempt(request)
          : await renderStudioAttempt(request);
    }
    process.send?.({ result });
  } catch (error) {
    process.send?.({
      error:
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : request.operation === "import"
            ? "IMPORT_FAILED"
            : "RENDER_FAILED",
    });
  }
});
