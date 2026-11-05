import { NextResponse } from "next/server";
import { userOr401, notFound, badRequest } from "@/lib/api";
import {
  trackMetadataSchema,
  updateTrackMetadata,
} from "@/server/track-metadata";
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
    return NextResponse.json(
      await updateTrackMetadata(auth.userId, params.id, parsed.data),
    );
  } catch (e) {
    const code = (e as Error).message;
    if (code === "NOT_FOUND") return notFound();
    return badRequest(code);
  }
}
