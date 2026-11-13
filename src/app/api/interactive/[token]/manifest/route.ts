import { interactiveManifestResponse } from "@/server/studio/interactive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: { token: string } }) {
  return interactiveManifestResponse(context.params.token);
}
