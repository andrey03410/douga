import "server-only";
import path from "node:path";
import { rm } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { createArtFromFile, poolUsageBytes } from "@/server/arts";
import { downloadMedia, probeUrl, updateYtDlp } from "@/lib/ytdlp";
import { assertPublicUrl } from "@/server/media-url";
import {
  describeDownloadError,
  isQuality,
  looksLikeExtractorBreakage,
  DEFAULT_QUALITY,
  type DownloadMode,
} from "@/lib/domain/ytdlp-args";

// Background URL-import jobs (yt-dlp -> media pool). Mirrors the render-job
// pattern: fire-and-forget runner + polling, with an in-memory process
// registry so a job can be canceled by killing its yt-dlp.

const MAX_ACTIVE_PER_USER = 2;
const running = new Map<string, ChildProcess>();

const tmpDir = (jobId: string) => absPath(path.join("downloads", "tmp", jobId));

const START_REFUSALS: Record<string, string> = {
  BAD_URL: "Вставьте корректную http(s)-ссылку на видео",
  BAD_QUALITY: "Качество: 480, 720 или 1080",
  BLOCKED_HOST: "По этому адресу ходить нельзя: локальные и внутренние адреса запрещены",
  HOST_UNRESOLVED: "Сайт по ссылке не найден — проверьте адрес",
  TOO_MANY_ACTIVE: "Не больше двух одновременных загрузок — дождитесь завершения",
};

/** Human text for a startDownload refusal code (HTTP and MCP), null for anything else. */
export function describeStartRefusal(code: string): string | null {
  return START_REFUSALS[code] ?? null;
}

export interface StartDownloadInput {
  url: string;
  mode: string;
  quality?: number;
  /** Pool ceiling for this user; null = unlimited. */
  maxPoolBytes: number | null;
}

/**
 * Queue a yt-dlp import. Refusals before any job exists: BAD_URL, BAD_QUALITY,
 * BLOCKED_HOST, HOST_UNRESOLVED, TOO_MANY_ACTIVE (see describeStartRefusal).
 */
export async function startDownload(userId: string, input: StartDownloadInput) {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error("BAD_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("BAD_URL");
  const mode: DownloadMode = input.mode === "audio" ? "audio" : "video";
  const quality = input.quality ?? DEFAULT_QUALITY;
  if (mode === "video" && !isQuality(quality)) throw new Error("BAD_QUALITY");
  // SSRF: yt-dlp must not be pointed at loopback/LAN. Refuse before a job row
  // exists, so a blocked or unresolvable link never shows up as a queued job.
  await assertPublicUrl(url);

  const active = await prisma.downloadJob.count({
    where: { userId, status: { in: ["queued", "running"] } },
  });
  if (active >= MAX_ACTIVE_PER_USER) throw new Error("TOO_MANY_ACTIVE");

  const job = await prisma.downloadJob.create({
    data: { userId, url: url.toString(), mode, quality, status: "queued" },
  });
  void runDownload(job.id, input.maxPoolBytes).catch(async (err) => {
    await prisma.downloadJob
      .update({
        where: { id: job.id },
        data: { status: "failed", error: String((err as Error)?.message ?? err).slice(0, 300) },
      })
      .catch(() => {});
  });
  return job;
}

async function setJob(jobId: string, data: Record<string, unknown>) {
  await prisma.downloadJob.update({ where: { id: jobId }, data });
}

async function runDownload(jobId: string, maxPoolBytes: number | null): Promise<void> {
  const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "queued") return;
  await setJob(jobId, { status: "running", progress: 0.02 });

  const mode = job.mode as DownloadMode;
  const attempt = async () => {
    // 1) metadata: title + honest refusal when the estimate can't fit
    const probe = await probeUrl(job.url, mode, job.quality);
    await setJob(jobId, { title: probe.title, progress: 0.05 });

    let remaining: number | null = null;
    if (maxPoolBytes != null) {
      remaining = Math.max(0, maxPoolBytes - (await poolUsageBytes(job.userId)));
      if (probe.estimatedBytes != null && probe.estimatedBytes > remaining) {
        throw Object.assign(new Error("QUOTA_ESTIMATE"), {
          human: `По оценке файл ~${Math.ceil(probe.estimatedBytes / 1048576)} МБ не влезает в остаток квоты пула (${Math.floor(remaining / 1048576)} МБ) — выберите качество ниже или освободите место`,
        });
      }
    }

    // 2) the download itself (0.05..0.9 of the job progress)
    let lastWrite = 0;
    const { filePath } = await downloadMedia({
      url: job.url,
      mode,
      quality: job.quality,
      dir: tmpDir(jobId),
      maxBytes: remaining,
      register: (proc) => running.set(jobId, proc),
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastWrite > 700) {
          lastWrite = now;
          void setJob(jobId, { progress: 0.05 + 0.85 * p }).catch(() => {});
        }
      },
    });
    running.delete(jobId);

    // canceled while downloading? (the kill may race the process exit)
    const fresh = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (fresh?.status === "canceled") {
      await rm(tmpDir(jobId), { recursive: true, force: true });
      return;
    }

    // 3) absorb into the pool (transactional quota + probe + poster)
    await setJob(jobId, { progress: 0.92 });
    const ext = path.extname(filePath) || (mode === "audio" ? ".m4a" : ".mp4");
    const art = await createArtFromFile(job.userId, {
      sourcePath: filePath,
      fileName: `download${ext}`,
      label: probe.title,
      maxPoolBytes,
    });
    await rm(tmpDir(jobId), { recursive: true, force: true });
    await setJob(jobId, { status: "done", progress: 1, artId: art.id });
  };

  try {
    try {
      await attempt();
    } catch (err) {
      const stderr = String((err as Error & { stderr?: string }).stderr ?? "");
      const canceled = await prisma.downloadJob.findUnique({ where: { id: jobId } });
      if (canceled?.status === "canceled") return;
      if (looksLikeExtractorBreakage(stderr)) {
        // YouTube broke this yt-dlp version: self-update and retry once
        await setJob(jobId, { progress: 0.03, error: null });
        await updateYtDlp();
        await attempt();
        return;
      }
      throw err;
    }
  } catch (err) {
    running.delete(jobId);
    await rm(tmpDir(jobId), { recursive: true, force: true });
    const e = err as Error & { stderr?: string; human?: string };
    const message =
      e.human ??
      (e.message === "POOL_QUOTA"
        ? "Файл не влез в квоту пула — освободите место в личном кабинете"
        : describeDownloadError(e.stderr ?? e.message ?? ""));
    const fresh = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (fresh?.status !== "canceled") {
      await setJob(jobId, { status: "failed", error: message.slice(0, 300) });
    }
  }
}

/** Active + recent jobs for the user's downloads panel. */
export async function listDownloads(userId: string, limit = 15) {
  // A server restart orphans in-flight jobs (the process registry is memory).
  // Live jobs bump updatedAt sub-second via progress writes, so anything
  // "active" but stale for minutes is dead — surface that honestly.
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.downloadJob.updateMany({
    where: {
      userId,
      status: { in: ["queued", "running"] },
      updatedAt: { lt: staleBefore },
    },
    data: { status: "failed", error: "Загрузка прервана перезапуском сервера — повторите" },
  });
  return prisma.downloadJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Cancel a queued/running job (kills yt-dlp) or remove a finished one from
 * the list. The downloaded pool media, if any, stays — it lives in the pool.
 */
export async function cancelDownload(userId: string, jobId: string) {
  const job = await prisma.downloadJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new Error("NOT_FOUND");
  if (job.status === "queued" || job.status === "running") {
    await setJob(jobId, { status: "canceled", error: null });
    const proc = running.get(jobId);
    if (proc) {
      proc.kill("SIGKILL");
      running.delete(jobId);
    }
    await rm(tmpDir(jobId), { recursive: true, force: true });
  } else {
    await prisma.downloadJob.delete({ where: { id: jobId } });
  }
}
