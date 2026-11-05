import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { getTournament, extendPlan } from "@/server/tournaments";

/** "One more round": every track gets a group's worth of extra opponents. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const t = await getTournament(
    auth.userId,
    params.id,
    typeof body?.segmentId === "string"
      ? body.segmentId
      : (new URL(req.url).searchParams.get("segmentId") ?? undefined),
  );
  if (!t) return notFound();

  try {
    const bonusOpponents = await extendPlan(t);
    return NextResponse.json({ ok: true, bonusOpponents });
  } catch (e) {
    const code = String((e as Error).message);
    if (code === "NOTHING_MORE_TO_ASK") {
      return badRequest("Все возможные сравнения уже сделаны");
    }
    return badRequest(code);
  }
}
