// Which filenames the pool accepts, as plain data: shared by the ZIP import
// (lib/upload.ts), the pool service (server/arts.ts) and the local-disk import
// (lib/domain/local-media.ts), so the three never drift apart.

/** Picture kinds the pool stores. Audio is a separate pool kind, not a MediaKind. */
export type MediaKind = "image" | "video";

export const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"];
// Browser-compatible containers only (no transcode on upload — agreed in spec 04).
export const VIDEO_EXT = [".mp4", ".webm", ".mov"];
export const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Lowercased extension with its dot, or "" when there is none. Browser-safe
 * stand-in for path.extname: the URL and clipboard policies run on the client
 * too, where node:path is not available.
 */
export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** File name without its directory and extension (browser-safe path.basename). */
export function baseOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const ext = extOf(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/** Pure: macOS resource forks and dotfiles are never media, whatever the extension. */
export function isJunkName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("__macosx") || (lower.split("/").pop()?.startsWith(".") ?? false);
}
