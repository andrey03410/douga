import { runStudioWorkerOnce } from "../src/server/studio/worker";
import { prisma } from "../src/lib/db";
const once = process.argv.includes("--once");
const jobIndex = process.argv.indexOf("--job");
const jobId = jobIndex >= 0 ? process.argv[jobIndex + 1] : undefined;
if (jobIndex >= 0 && !jobId) throw new Error("--job requires an ID");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
do {
  const result = await runStudioWorkerOnce({
    jobId,
    workerId: `node-${process.pid}`,
  });
  if (result) process.stdout.write(JSON.stringify(result) + "\n");
  if (!once && !stopping)
    await new Promise((r) => setTimeout(r, result ? 100 : 1000));
} while (!once && !stopping);
await prisma.$disconnect();
