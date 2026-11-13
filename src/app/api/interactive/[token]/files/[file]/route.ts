import { interactiveFileResponse } from "@/server/studio/interactive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request, context: { params: { token: string; file: string } }) {
  return interactiveFileResponse(context.params.token, context.params.file, req);
}

export const GET = handle;
export const HEAD = handle;
