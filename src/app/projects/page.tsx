import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { listProjects } from "@/server/projects";
import { listStudioProjectSummaries } from "@/server/studio";
import { StudioProjectList } from "../studio/ProjectList";
import { StudioSetup } from "../studio/Setup";
import "../studio/studio.css";
import { DeleteProjectButton } from "./DeleteProjectButton";

const KIND_LABEL: Record<string, string> = {
  top: "Ручной топ",
  picker: "Выбор (пикер)",
};

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  const [projects, studio] = await Promise.all([
    listProjects(user.id),
    listStudioProjectSummaries(user.id),
  ]);

  return (
    <div className="container">
      <h1>Мои видео</h1>
      <div className="panel">
        <h2>SDK-проекты</h2>
        <p className="muted">
          Новые видео создаются через JSON SDK или внешний MCP. Содержимое и
          превью открываются только по вашему действию.
        </p>
        <a className="btn" href="/studio/new">
          Создать через SDK
        </a>
        <StudioProjectList
          initial={{
            items: studio.items.map(({ id, kind, version, revision }) => ({
              id,
              kind,
              version,
              revision,
            })),
            nextCursor: studio.nextCursor,
          }}
        />
      </div>
      <StudioSetup email={user.email} />

      <div className="panel">
        <h2>Ранее созданные проекты</h2>
        {projects.length === 0 ? (
          <p className="muted">
            Ранее созданных проектов нет. Создайте SDK-проект выше или соберите
            топ через <a href="/tournaments">турнир сравнений</a>.
          </p>
        ) : (
          projects.map((p) => (
            <div className="list-item" key={p.id}>
              <div>
                <a
                  href={`/projects/${p.id}`}
                  style={{ fontWeight: 600, fontSize: 16 }}
                >
                  {p.title}
                </a>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {KIND_LABEL[p.kind] ?? p.kind} ·{" "}
                  {p.kind === "picker"
                    ? `${p._count.rounds} раундов`
                    : `${p.renderConfig?._count.items ?? 0} позиций`}
                  {p._count.renderJobs > 0
                    ? ` · ${p._count.renderJobs} рендеров`
                    : ""}
                </div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="tag">{KIND_LABEL[p.kind] ?? p.kind}</span>
                <DeleteProjectButton id={p.id} title={p.title} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
