import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { StudioSetup } from "../Setup";
import { NewStudioProject } from "./NewStudioProject";
import "../studio.css";
export default async function NewStudioPage({
  searchParams,
}: {
  searchParams: { sourceId?: string };
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <main className="container studio-workspace">
      <a href="/projects">← Мои видео</a>
      <h1>Создать через SDK</h1>
      <p className="muted">
        Опишите видео каноническим JSON или создайте его через внешний MCP.
        Примеры используют тот же SDK и renderer.
      </p>
      <NewStudioProject sourceId={searchParams.sourceId} />
      <StudioSetup email={user.email} />
    </main>
  );
}
