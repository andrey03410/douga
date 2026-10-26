// Test-only isolation for the real legacy fire-and-forget download runner.
// IPC keeps the process owned by its test until the parent drains/kills it.
import { startDownload, type StartDownloadInput } from "@/server/downloads";

process.once("disconnect", () => {
  if (process.platform === "win32") process.exit(0);
  else process.kill(-process.pid, "SIGKILL");
});
process.once(
  "message",
  async (message: { userId: string; input: StartDownloadInput }) => {
    try {
      const job = await startDownload(message.userId, message.input);
      process.send?.({ id: job.id });
    } catch (error) {
      process.send?.({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
