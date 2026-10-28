import { publicWatchMedia } from "@/server/studio/watch-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  req: Request,
  context: { params: { token: string; file: string } },
) {
  return publicWatchMedia(context.params.token, context.params.file, req);
}

export const GET = handle;
export const HEAD = handle;
