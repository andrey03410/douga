import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { moderate, moderationDashboard, type ModerationAction } from "@/server/kaname-moderation";

async function apply(target: string, action: ModerationAction, resource: string) {
  "use server";
  await moderate((await requireUser()).id, target, action, resource);
  revalidatePath("/admin");
}
export async function KanameAdmin({ actorId }: { actorId: string }) {
  const rows = await moderationDashboard(actorId);
  const button = (target: string, action: ModerationAction, text: string, resource = "") =>
    <form action={apply.bind(null, target, action, resource)}><button className="btn ghost">{text}</button></form>;
  return <main className="container"><h1>Управление Douga</h1>
    {rows.map(({ userId, login, suspended, user, active, manageable }) => <section className="panel" key={userId}>
      <h2>{login}</h2><p>Проектов {user._count.studioProjects} · {suspended ? "Доступ приостановлен" : active ? "Доступ активен" : "Доступ отозван в Kaname"}</p>
      {manageable && button(userId, suspended ? "restore" : "suspend", suspended ? "Возобновить доступ" : "Приостановить доступ")}
      {user.studioJobs.map(job => <div key={job.id} className="row">{job.kind} · {job.status} {manageable && button(userId, "cancel", "Отменить задание", job.id)}</div>)}
      {[...user.studioPublications.map(p => ({ ...p, action: "unpublish" as const })), ...user.studioInteractivePublications.map(p => ({ ...p, action: "unpublish-interactive" as const }))].map(p =>
        <div key={p.id} className="row">{p.project.title} {manageable && button(userId, p.action, "Снять публикацию", p.id)}</div>)}
    </section>)}
  </main>;
}
