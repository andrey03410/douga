import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import {
  getTournament,
  recordGroupAnswer,
  nextComparison,
} from "@/server/tournaments";

const MESSAGES: Record<string, string> = {
  GROUP_MISMATCH: "Экран устарел — обновите страницу и ответьте заново",
  NOTHING_TO_ANSWER: "Сравнивать больше нечего",
  INVALID_PAIR: "Некорректные данные сравнения",
};

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * One comparison screen. `ranked` is best-first; `rest` holds the tracks the
 * user declined to separate. A pair screen is just the two-track case, so the
 * classic "left / draw / right" answer travels the same route.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const ranked = body?.ranked;
  const rest = body?.rest ?? [];
  if (!isIdList(ranked) || !isIdList(rest) || ranked.length + rest.length < 2) {
    return badRequest("Некорректные данные сравнения");
  }

  const t = await getTournament(
    auth.userId,
    params.id,
    typeof body?.segmentId === "string"
      ? body.segmentId
      : (new URL(req.url).searchParams.get("segmentId") ?? undefined),
  );
  if (!t) return notFound();

  try {
    await recordGroupAnswer(t, ranked, rest);
  } catch (e) {
    const code = String((e as Error).message);
    return badRequest(MESSAGES[code] ?? code);
  }

  const updated = await getTournament(
    auth.userId,
    params.id,
    typeof body?.segmentId === "string"
      ? body.segmentId
      : (new URL(req.url).searchParams.get("segmentId") ?? undefined),
  );
  const next = updated ? nextComparison(updated) : null;
  return NextResponse.json({
    ok: true,
    isComplete: next?.isComplete ?? false,
    canExtend: next?.canExtend ?? false,
  });
}
