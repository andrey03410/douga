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
    // Captions first: a refused cover must not leave the exclusion applied.
    const updated = Object.keys(fields).length
      ? await updateTrackMetadata(auth.userId, params.id, fields)
      : null;
    // Task 33: exclusion has side effects (places close up, return inserts back).
    if (excluded !== undefined) await setExcluded(auth.userId, params.id, excluded);
    return NextResponse.json(updated ? { ...updated, excluded: excluded ?? updated.excluded } : { id: params.id, excluded });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "NOT_FOUND") return notFound();
    return badRequest(code);
  }
}
