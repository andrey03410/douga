import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { owned } from "@/server/studio/shared";
import { StudioError } from "@/server/studio/errors";
import StoryboardWorkspace from "./StoryboardWorkspace";
import "../../studio.css";
import "../../storyboard.css";
export const dynamic = "force-dynamic";
export default async function StoryboardPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let project;
  try {
    project = await owned(user.id, params.id);
  } catch (error) {
    if (error instanceof StudioError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="container storyboard-page">
      <StoryboardWorkspace
        initial={{
          id: project.id,
          title: project.title,
          version: project.version,
          revision: project.revision,
        }}
      />
    </main>
  );
}
