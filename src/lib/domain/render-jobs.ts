// Render job DTO shared by the job-status API routes and the constructor UIs.

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

/** Longest title part of a downloaded file name, in characters (before ".mp4"). */
export const DOWNLOAD_TITLE_MAX = 100;

/**
 * A video title cleaned into a file name stem: characters forbidden in file
 * names (`/\:*?"<>|`) and control codes become spaces, whitespace collapses,
 * edge dots and spaces go, and the stem is capped at DOWNLOAD_TITLE_MAX code
 * points (never splitting an emoji). Returns "" when nothing usable is left.
 */
export function downloadTitleStem(title: string | null | undefined): string {
  const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  const stem = clean((title ?? "").replace(/[/\\:*?"<>|\u0000-\u001f\u007f-\u009f]/g, " "));
  return clean(Array.from(stem).slice(0, DOWNLOAD_TITLE_MAX).join(""));
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
