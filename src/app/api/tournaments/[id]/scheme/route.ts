import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { setSegmentScheme } from "@/server/tournaments";
import { segmentIdOf, tournamentErrorMessage } from "@/lib/tournament-errors";

/**
 * Task 33: choose the algorithm of a segment, or of all segments at once.
 * `{scheme, settings?, segmentId?, allSegments?}`. Answers are kept.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (typeof body?.scheme !== "string") return badRequest("Укажите алгоритм");
  try {
    const result = await setSegmentScheme(auth.userId, params.id, {
      scheme: body.scheme,
      settings: body.settings,
      segmentId: segmentIdOf(req, body),
      allSegments: body.allSegments === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const code = String((e as Error).message);
    if (code === "NOT_FOUND") return notFound();
    return badRequest(tournamentErrorMessage(code));
  }
}
