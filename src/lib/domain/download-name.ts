/** Longest title part of a downloaded file name, in characters (before the extension). */
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
