import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { getTournament, setTier } from "@/server/tournaments";
import { segmentIdOf, tournamentErrorMessage } from "@/lib/tournament-errors";

/** Task 33: move a participant on the tier board. `{itemId, tier, segmentId}`. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (typeof body?.itemId !== "string" || typeof body?.tier !== "number")
    return badRequest("Некорректная корзина");
  const t = await getTournament(auth.userId, params.id, segmentIdOf(req, body));
  if (!t) return notFound();
  try {
    return NextResponse.json({ ok: true, ...(await setTier(t, body.itemId, body.tier)) });
  } catch (e) {
    const code = String((e as Error).message);
    if (code === "NOT_FOUND") return notFound();
    return badRequest(tournamentErrorMessage(code));
  }
}
