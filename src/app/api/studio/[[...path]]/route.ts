import { studioHttp } from "@/server/studio/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  return studioHttp(req);
}
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
