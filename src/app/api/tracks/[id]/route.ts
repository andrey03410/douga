import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import {
  trackMetadataSchema,
  updateTrackMetadata,
} from "@/server/track-metadata";
import { setExcluded } from "@/server/tournament-items";
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const parsed = trackMetadataSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest("Некорректные данные трека");
  try {
    const { excluded, ...fields } = parsed.data;
    // Task 33: exclusion has side effects (places close up, return inserts back).
    if (excluded !== undefined) await setExcluded(auth.userId, params.id, excluded);
    if (!Object.keys(fields).length)
      return NextResponse.json({ id: params.id, excluded });
    return NextResponse.json(
      await updateTrackMetadata(auth.userId, params.id, fields),
    );
  } catch (e) {
    const code = (e as Error).message;
    if (code === "NOT_FOUND") return notFound();
    return badRequest(code);
  }
}
