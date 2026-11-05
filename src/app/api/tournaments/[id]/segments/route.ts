import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { getTournament, updateTournamentSegments } from "@/server/tournaments";
import { segmentsUpdateSchema } from "@/server/tournament-segments";
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const t = await getTournament(
    auth.userId,
    params.id,
    new URL(req.url).searchParams.get("segmentId") ?? undefined,
  );
  if (!t) return notFound();
  return NextResponse.json({
    segments: t.segments,
    activeSegmentId: t.activeSegmentId,
  });
}
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const parsed = segmentsUpdateSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest("Некорректная разбивка сегментов");
  try {
    const result = await updateTournamentSegments(
      auth.userId,
      params.id,
      parsed.data,
    );
    const t = await getTournament(auth.userId, params.id);
    return NextResponse.json({
      ...result,
      segments: t?.segments,
      activeSegmentId: t?.activeSegmentId,
    });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "NOT_FOUND") return notFound();
    return badRequest(code);
  }
}
