import { NextResponse } from "next/server";
import { requireUser, type SessionUser } from "@/auth";
import { can, type Permission } from "@/lib/domain/permissions";

export { serverError } from "@/lib/api-errors";

/**
 * Resolve the current user (id + fresh role) or return a 401 response to
 * short-circuit a route.
 */
export async function userOr401(): Promise<
  { userId: string; user: SessionUser } | { response: NextResponse }
> {
  try {
    const user = await requireUser();
    return { userId: user.id, user };
  } catch (error) {
    const code = (error as Error).message;
    if (code === "KANAME_UNAVAILABLE" || code === "FORBIDDEN")
      return { response: NextResponse.json({ error: code }, { status: code === "FORBIDDEN" ? 403 : 503 }) };
    return { response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  }
}

/** Like userOr401, but additionally requires a permission (403 otherwise). */
export async function permissionOr403(
  permission: Permission,
  message = "Недостаточно прав",
): Promise<{ userId: string; user: SessionUser } | { response: NextResponse }> {
  const auth = await userOr401();
  if ("response" in auth) return auth;
  if (!can(auth.user.role, permission)) {
    return { response: NextResponse.json({ error: message }, { status: 403 }) };
  }
  return auth;
}

export function forbidden(message = "Недостаточно прав") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function tooLarge(message: string) {
  return NextResponse.json({ error: message }, { status: 413 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

/**
 * Serve a media buffer honoring HTTP Range requests, so <audio>/<video>
 * elements can seek before the whole file has buffered.
 */
export function mediaResponse(req: Request, data: Buffer, contentType: string): Response {
  const total = data.length;
  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
        });
      }
      const chunk = data.subarray(start, end + 1);
      return new Response(new Uint8Array(chunk), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
