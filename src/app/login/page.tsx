import { signIn } from "@/auth";
import { kanameEnabled } from "@/server/kaname";
import LegacyLogin from "./LegacyLogin";

export const dynamic = "force-dynamic";
export default function LoginPage() {
  if (!kanameEnabled()) return <LegacyLogin />;
  return <main className="container"><h1>Вход в Douga</h1><form action={async () => {
    "use server";
    await signIn("keycloak", { redirectTo: "/projects" });
  }}><button className="btn">Войти через Kaname</button></form></main>;
}
