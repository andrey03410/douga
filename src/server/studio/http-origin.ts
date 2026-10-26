import "server-only";
/**
 * NextRequest normalizes loopback URLs to localhost, so Request.url is not the
 * browser-facing authority. Next populates forwarded host/proto from the socket
 * request; a deployment proxy must replace these headers with its public origin.
 * Reject ambiguous forwarding values instead of widening the allowed origins.
 */
export function isStudioMutationOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  try {
    const internal = new URL(req.url);
    const authority =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      internal.host;
    const protocol =
      req.headers.get("x-forwarded-proto") ?? internal.protocol.slice(0, -1);
    if (
      !authority ||
      /[\s,\/@?#\\]/.test(authority) ||
      !/^https?$/.test(protocol)
    )
      return false;
    const external = new URL(`${protocol}://${authority}`),
      incoming = new URL(origin);
    if (
      incoming.username ||
      incoming.password ||
      incoming.pathname !== "/" ||
      incoming.search ||
      incoming.hash
    )
      return false;
    return incoming.origin === external.origin;
  } catch {
    return false;
  }
}
