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
      <h1>Создать видео</h1>
      <p className="muted">
        Сначала выберите тип ролика и состав. Затем настройте оформление
        и проверьте кадры — через студию или внешнего агента.
      </p>
      <p>
        <a href="/studio/motion">Посмотреть моушен-кит →</a>
        <a href="/studio/typography">Шрифты и типографика →</a>
      </p>
      <section className="panel">
        <h2>Начать с готового рецепта</h2>
        <p className="muted">
          Топы, пикеры и тир-листы с живыми примерами, формой заполнения и
          оформлением для трёх форматов.
        </p>
        <a
          className="btn"
          href={`/studio/recipes${searchParams.sourceId ? `?sourceId=${encodeURIComponent(searchParams.sourceId)}` : ""}`}
        >
          Выбрать рецепт →
        </a>
      </section>
      <NewStudioProject sourceId={searchParams.sourceId} />
      <StudioSetup email={user.email} />
    </main>
  );
}
