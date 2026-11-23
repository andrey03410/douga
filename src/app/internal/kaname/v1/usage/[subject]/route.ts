import { reportAuthorized } from "@/server/kaname";
import { usageForSubject } from "@/server/kaname-usage";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: { subject: string } }) {
  if (!reportAuthorized(req.headers.get("authorization"))) return new Response(null, { status: 401 });
  return Response.json(await usageForSubject(params.subject), { headers: { "Cache-Control": "no-store" } });
}
