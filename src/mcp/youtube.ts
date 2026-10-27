import { prisma } from "@/lib/db";
import { describeStartRefusal, startDownload } from "@/server/downloads";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 1_000;

/** Poll a DownloadJob to completion; resolves with the produced pool artId. */
export async function pollDownload(
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ artId: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Задача загрузки исчезла");
    if (job.status === "done" && job.artId) return { artId: job.artId };
    if (job.status === "failed") throw new Error(job.error || "Загрузка не удалась");
    if (job.status === "canceled") throw new Error("Загрузка отменена");
    if (Date.now() > deadline) throw new Error("Тайм-аут загрузки — попробуйте позже или другое качество");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ImportYoutubeAudioInput {
  url: string;
  maxPoolBytes: number | null;
  timeoutMs?: number;
}

/** Start a yt-dlp audio download and wait until it lands in the pool. */
export async function importYoutubeAudio(
  userId: string,
  input: ImportYoutubeAudioInput,
): Promise<{ artId: string }> {
  const job = await startDownload(userId, {
    url: input.url,
    mode: "audio",
    maxPoolBytes: input.maxPoolBytes,
  }).catch((e: Error) => {
    // the MCP client sees the message as is: give it words, not a code
    throw new Error(describeStartRefusal(e.message) ?? e.message);
  });
  return pollDownload(job.id, { timeoutMs: input.timeoutMs });
}
