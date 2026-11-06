import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { listStudioProjectSummaries } from "@/server/studio";
import { StudioProjectList } from "../studio/ProjectList";
import { StudioSetup } from "../studio/Setup";
import "../studio/studio.css";

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  const studio = await listStudioProjectSummaries(user.id);

  return (
    <div className="container">
      <h1>Мои видео</h1>
      <div className="panel">
        <h2>SDK-проекты</h2>
        <p className="muted">
          Видео собирает агент через MCP. Здесь тот же документ: превью, история
          и финальный ролик.
        </p>
        <a className="btn" href="/studio/new">
          Создать через SDK
        </a>
        <p>
          <a href="/studio/motion">Посмотреть моушен-кит →</a>
        </p>
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
    </div>
  );
}
