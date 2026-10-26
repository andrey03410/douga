import { studioProtectionResponse } from "@/lib/studio-protection";
import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { deleteTournament, setGroupSize } from "@/server/tournaments";

/** Settings of a running tournament. Today: how many tracks a screen ranks. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (typeof body?.groupSize !== "number") return badRequest("Некорректный размер группы");

  try {
    const groupSize = await setGroupSize(auth.userId, params.id, body.groupSize);
    return NextResponse.json({ ok: true, groupSize });
  } catch (e) {
    const protectedResponse=studioProtectionResponse(e); if(protectedResponse)return protectedResponse;
    if (String((e as Error).message) === "NOT_FOUND") return notFound();
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  try {
    await deleteTournament(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const protectedResponse=studioProtectionResponse(e); if(protectedResponse)return protectedResponse;
    if (String((e as Error).message) === "NOT_FOUND") return notFound();
    throw e;
  }
}
