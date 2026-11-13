import { NextResponse } from "next/server";
import { userOr401 } from "@/lib/api";
import { ApiTokenError, issueApiToken, listApiTokens, revokeApiToken } from "@/server/api-tokens";
import { isStudioMutationOriginAllowed } from "@/server/studio/http-origin";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

function failure(error: unknown) {
  if (error instanceof ApiTokenError)
    return json({ error: error.code }, error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 429);
  if (error instanceof SyntaxError || (error as { name?: string })?.name === "ZodError")
    return json({ error: "INVALID_INPUT" }, 400);
  console.error("API tokens failed", error);
  return json({ error: "INTERNAL_ERROR" }, 500);
}

export async function GET() {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  return json({ tokens: await listApiTokens(auth.userId) });
}

/** POST {name} issues a token; POST {revoke: id} revokes one. */
export async function POST(req: Request) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  if (!isStudioMutationOriginAllowed(req)) return json({ error: "FORBIDDEN_ORIGIN" }, 403);
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof body.revoke === "string")
      return json({ token: await revokeApiToken(auth.userId, body.revoke) });
    return json(await issueApiToken(auth.userId, body), 201);
  } catch (error) {
    return failure(error);
  }
}
