// Pure yt-dlp helpers: argument building and output parsing. The invocation
// pattern follows ytDownloader (aandrew-me/ytdownloader): explicit -f format
// selectors, --no-playlist, --ffmpeg-location, progress from stdout lines.

export type DownloadMode = "video" | "audio";

export const QUALITIES = [480, 720, 1080] as const;
export const DEFAULT_QUALITY = 1080;

export function isQuality(q: number): boolean {
  return (QUALITIES as readonly number[]).includes(q);
}

/**
 * Format selector. Video pins H.264+AAC (avc1/mp4a) so the result plays in
 * the browser preview and renders without transcoding; audio prefers m4a.
 */
export function formatSelector(mode: DownloadMode, quality: number): string {
  if (mode === "audio") return "bestaudio[ext=m4a]/bestaudio/best";
  // The trailing unconditional /best covers sources that don't report height
  // (direct files via the generic extractor); site extractors match earlier
  // alternatives, so the quality cap still applies where it can.
  return (
    `bestvideo[height<=${quality}][vcodec^=avc1]+bestaudio[acodec^=mp4a]` +
    `/best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best`
  );
}

export interface DownloadArgsInput {
  url: string;
  mode: DownloadMode;
  quality: number;
  /** Working dir for the temp output. */
  dir: string;
  /** File yt-dlp writes the final path into (after_move:filepath). */
  markerFile: string;
  ffmpegPath: string;
  /** Hard cap; null = unlimited. */
  maxBytes: number | null;
  /** http(s)/socks5 proxy for the media fetch (YTDLP_PROXY); null = direct. */
  proxy?: string | null;
}

export function buildDownloadArgs(input: DownloadArgsInput): string[] {
  const base = [
    "-f",
    formatSelector(input.mode, input.quality),
    ...(input.mode === "video"
      ? ["--merge-output-format", "mp4"]
      : ["-x", "--audio-format", "m4a"]),
    "--no-playlist",
    "--no-mtime",
    "--newline",
    // fail fast on unreachable CDNs instead of 10 long retry cycles
    "--socket-timeout",
    "15",
    "--retries",
    "3",
    // Node is always present (it runs this app); a JS runtime unlocks the
    // formats YouTube hides behind script challenges
    "--js-runtimes",
    "node",
    "--ffmpeg-location",
    input.ffmpegPath,
    "-P",
    input.dir,
    "-o",
    "dl.%(ext)s",
    "--print-to-file",
    "after_move:filepath",
    input.markerFile,
  ];
  if (input.maxBytes != null) base.push("--max-filesize", String(input.maxBytes));
  if (input.proxy) base.push("--proxy", input.proxy);
  base.push("--", input.url);
  return base;
}

/** Parse a yt-dlp stdout line into progress 0..1 (null when not a progress line). */
export function parseProgressLine(line: string): number | null {
  const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct)) return null;
  return Math.min(1, Math.max(0, pct / 100));
}

export interface ProbeResult {
  title: string | null;
  durationSec: number | null;
  /** Best-effort size estimate of what we'd download; null = unknown. */
  estimatedBytes: number | null;
}

interface RawFormat {
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  ext?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

const size = (f: RawFormat) => f.filesize ?? f.filesize_approx ?? null;

/**
 * Extract title/duration/size estimate from `yt-dlp -J` output for the mode
 * and quality we are about to download. The estimate mirrors formatSelector:
 * best avc1 video within the height cap + best mp4a audio (video mode), or
 * the best audio-only track (audio mode). Unknown sizes stay unknown rather
 * than guessing low.
 */
export function parseProbeJson(
  raw: unknown,
  mode: DownloadMode,
  quality: number,
): ProbeResult {
  const info = raw as {
    title?: unknown;
    duration?: unknown;
    formats?: RawFormat[];
  };
  const title = typeof info.title === "string" ? info.title : null;
  const durationSec = typeof info.duration === "number" ? info.duration : null;
  const formats = Array.isArray(info.formats) ? info.formats : [];

  const audioOnly = formats.filter(
    (f) => (f.vcodec === "none" || !f.vcodec) && f.acodec && f.acodec !== "none",
  );
  const bestAudio = (pref?: (f: RawFormat) => boolean) => {
    const pool = pref ? audioOnly.filter(pref) : audioOnly;
    return pool.reduce<RawFormat | null>(
      (best, f) => (size(f) != null && (best == null || size(f)! > size(best)!) ? f : best),
      null,
    );
  };

  let estimatedBytes: number | null = null;
  if (mode === "audio") {
    const a = bestAudio((f) => f.ext === "m4a") ?? bestAudio();
    estimatedBytes = a ? size(a) : null;
  } else {
    const videos = formats.filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== "none" &&
        f.vcodec.startsWith("avc1") &&
        (f.height ?? 0) <= quality,
    );
    // the selector takes the BEST matching video (highest resolution)
    const best = videos.reduce<RawFormat | null>(
      (bestF, f) =>
        size(f) != null && ((f.height ?? 0) > (bestF?.height ?? -1)) ? f : bestF,
      null,
    );
    const a = bestAudio((f) => f.acodec?.startsWith("mp4a") ?? false) ?? bestAudio();
    if (best) estimatedBytes = size(best)! + (a ? (size(a) ?? 0) : 0);
  }

  return { title, durationSec, estimatedBytes };
}

/**
 * YouTube regularly breaks old yt-dlp versions; these stderr shapes mean
 * "update the binary and retry", not "the URL is bad".
 */
export function looksLikeExtractorBreakage(stderr: string): boolean {
  return /Precondition check failed|Unable to extract|Sign in to confirm|nsig extraction failed|HTTP Error 403/i.test(
    stderr,
  );
}

/** Human-readable failure for the job card (last meaningful stderr line). */
export function describeDownloadError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith("ERROR") ||
        l.includes("max-filesize") ||
        l.includes("Got error"),
    );
  const last = lines[lines.length - 1];
  if (!last) return "Не удалось скачать по этой ссылке";
  if (/max-filesize/i.test(last)) {
    return "Файл больше остатка квоты пула — выберите качество ниже или освободите место";
  }
  if (/Unsupported URL|is not a valid URL/i.test(last)) {
    return "Ссылка не распознана — поддерживаются YouTube и другие видео-сайты";
  }
  if (/Video unavailable|Private video|members-only/i.test(last)) {
    return "Видео недоступно (удалено, приватное или с ограничением доступа)";
  }
  if (/handshake operation timed out|Connection (?:refused|reset)|timed out|Unable to connect/i.test(last)) {
    return (
      "Сеть сервера не дотянулась до видео-CDN (googlevideo.com заблокирован " +
      "или недоступен). Если есть VPN/прокси — задайте его в YTDLP_PROXY в .env " +
      "и перезапустите сервер"
    );
  }
  return last.replace(/^ERROR:\s*/i, "").slice(0, 300);
}
