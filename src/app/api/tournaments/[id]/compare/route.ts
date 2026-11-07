import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import {
  getTournament,
  recordAnswer,
  nextComparison,
  type Answer,
} from "@/server/tournaments";
import { segmentIdOf, tournamentErrorMessage } from "@/lib/tournament-errors";

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** The three screen answers (task 33); a pair screen is just the two-item rank. */
function parseAnswer(body: Record<string, unknown> | null): Answer | null {
  if (!body) return null;
  if (typeof body.pick === "string") return { kind: "pick", winner: body.pick };
  if (typeof body.itemId === "string" && typeof body.tier === "number")
    return { kind: "tier", itemId: body.itemId, tier: body.tier };
  const ranked = body.ranked;
  const rest = body.rest ?? [];
  if (!isIdList(ranked) || !isIdList(rest) || ranked.length + rest.length < 2) return null;
  return { kind: "rank", ranked, rest };
}

/**
 * One comparison screen: `{ranked, rest}` orders a group (rest = roughly equal),
 * `{pick}` chooses the best, `{itemId, tier}` puts one participant into a tier
 * (-1 = "не участвует").
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const answer = parseAnswer(body);
  if (!answer) return badRequest("Некорректные данные сравнения");

  const segmentId = segmentIdOf(req, body);
  const t = await getTournament(auth.userId, params.id, segmentId);
  if (!t) return notFound();

  try {
    await recordAnswer(t, answer);
  } catch (e) {
    return badRequest(tournamentErrorMessage(String((e as Error).message)));
  }

  const updated = await getTournament(auth.userId, params.id, segmentId);
  const next = updated ? nextComparison(updated) : null;
  return NextResponse.json({
    ok: true,
    isComplete: next?.isComplete ?? false,
    canExtend: next?.canExtend ?? false,
  });
}
