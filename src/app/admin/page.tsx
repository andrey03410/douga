import { KanameAdmin } from "./KanameAdmin";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { kanameEnabled } from "@/server/kaname";
import { can } from "@/lib/domain/permissions";
import { AdminUsers } from "./AdminUsers";

export default async function AdminPage() {
  const user = await requireUser().catch((error: unknown) => {
    if (kanameEnabled() && error instanceof Error && error.message === "UNAUTHENTICATED")
      redirect("/api/auth/kaname/login?next=/admin");
    return null;
  });
  if (user && can(user.role, "site:moderate")) return <KanameAdmin actorId={user.id} />;
  // 404 (not 403/redirect) so the page's existence isn't advertised.
  if (!user || !can(user.role, "admin:users")) notFound();

  return (
    <div className="container">
      <h1>Админка — пользователи</h1>
      <AdminUsers selfId={user.id} />
    </div>
  );
}
