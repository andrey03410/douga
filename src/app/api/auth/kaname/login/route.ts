import { signIn } from "@/auth";
import { kanameEnabled } from "@/server/kaname";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!kanameEnabled()) return new Response(null, { status: 404 });
  await signIn("keycloak", { redirectTo: "/projects" });
  return new Response(null, { status: 401 });
}
