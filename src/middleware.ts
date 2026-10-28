import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withWatchChrome } from "@/watch/chrome";

export function middleware(request: NextRequest) {
  const requestHeaders = withWatchChrome(
    request.headers,
    request.nextUrl.pathname,
  );
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (
    request.nextUrl.pathname === "/watch" ||
    request.nextUrl.pathname.startsWith("/watch/")
  ) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
}

export const config = {
  matcher: ["/watch/:path*"],
};
