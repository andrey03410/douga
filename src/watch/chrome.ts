export const WATCH_CHROME = "x-douga-chrome";

/** Request header that tells the root layout to skip the site header. */
export function withWatchChrome(headers: Headers, pathname: string): Headers {
  const next = new Headers(headers);
  if (pathname === "/watch" || pathname.startsWith("/watch/"))
    next.set(WATCH_CHROME, "bare");
  else next.delete(WATCH_CHROME);
  return next;
}
