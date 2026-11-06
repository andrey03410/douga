import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import RecipeGallery from "./RecipeGallery";
import "../studio.css";
import "../storyboard.css";
export const dynamic = "force-dynamic";
export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: { project?: string; sourceId?: string };
}) {
  if (!(await currentUser())) redirect("/login");
  return (
    <main className="container storyboard-page">
      <RecipeGallery
        projectId={searchParams?.project}
        sourceId={searchParams?.sourceId}
      />
    </main>
  );
}
