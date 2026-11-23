import { signIn } from "@/auth";
import { kanameEnabled } from "@/server/kaname";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!kanameEnabled()) return new Response(null, { status: 404 });
  const next = new URL(req.url).searchParams.get("next");
  await signIn("keycloak", { redirectTo: next === "/admin" ? "/admin" : "/projects" });
  return new Response(null, { status: 401 });
}
