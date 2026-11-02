// Render job DTO shared by the job-status API routes and the constructor UIs.

import { downloadTitleStem } from "./download-name";

export interface RenderJobDto {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
}

/** A job the UI should keep polling (render still in flight). */
export function isActiveRenderJob(status: string): boolean {
  return status === "queued" || status === "running";
}

export function renderJobDto(job: {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  outputPath: string | null;
}): RenderJobDto {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    downloadUrl: job.outputPath ? `/api/render-jobs/${job.id}/download` : null,
  };
}

/** RFC 5987 ext-value encoding: percent-encode everything outside attr-char. */
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Content-Disposition of a finished render (RFC 6266): an ASCII fallback
 * `douga-<ownerId>.mp4` for old clients, plus the video title as
 * `filename*=UTF-8''…`. Without a usable title only the fallback is sent.
 * The whole value stays ASCII, as HTTP headers require.
 */
export function renderDownloadDisposition(
  ownerId: string,
  title: string | null | undefined,
): string {
  const id = ownerId.replace(/[^A-Za-z0-9_-]/g, "");
  const fallback = `attachment; filename="${id ? `douga-${id}` : "douga"}.mp4"`;
  const stem = downloadTitleStem(title);
  return stem ? `${fallback}; filename*=UTF-8''${encodeExtValue(`${stem}.mp4`)}` : fallback;
}
