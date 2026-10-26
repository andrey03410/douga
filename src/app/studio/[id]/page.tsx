import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import {
  getStudioProject,
  studioProjectMetadata,
  StudioError,
} from "@/server/studio";
import { StudioWorkspace } from "../StudioWorkspace";
import { StudioSetup } from "../Setup";
import "../studio.css";
export const dynamic = "force-dynamic";
export default async function StudioPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let metadata;
  try {
    metadata = studioProjectMetadata(
      await getStudioProject(user.id, params.id),
    );
  } catch (error) {
    if (error instanceof StudioError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="container studio-workspace">
      <StudioWorkspace initial={metadata} isAdmin={user.role === "admin"} />
      <StudioSetup email={user.email} />
    </main>
  );
}
