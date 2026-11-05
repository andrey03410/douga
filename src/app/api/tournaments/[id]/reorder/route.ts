import { NextResponse } from "next/server";
import { z } from "zod";
import { userOr401, notFound, badRequest } from "@/lib/api";
import { reorderRanking } from "@/server/tournaments";

const schema = z.object({
  order: z.array(z.string()).min(1),
  segmentId: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Некорректный порядок");

  try {
    await reorderRanking(
      auth.userId,
      params.id,
      parsed.data.order,
      parsed.data.segmentId ??
        new URL(req.url).searchParams.get("segmentId") ??
        undefined,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg === "NOT_FOUND") return notFound();
    return badRequest(msg);
  }
}
