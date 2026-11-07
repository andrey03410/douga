import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { getTournament, undoLastAnswer } from "@/server/tournaments";
import { tournamentErrorMessage } from "@/lib/tournament-errors";

const MESSAGES: Record<string, string> = {
  ALREADY_FINALIZED: "Турнир уже завершён",
};

/** Undo the last comparison screen — the whole group, not one of its pairs. */
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
    const { removed } = await undoLastAnswer(t);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    const code = String((e as Error).message);
    return badRequest(MESSAGES[code] ?? tournamentErrorMessage(code));
  }
}
