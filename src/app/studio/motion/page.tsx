import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import MotionGallery from "./MotionGallery";
import "../studio.css";
import "./motion.css";
export default async function MotionGalleryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <main className="container studio-workspace">
      <a href="/projects">← Мои видео</a>
      <header className="motion-heading">
        <p className="motion-eyebrow">DOUGA / MOTION KIT</p>
        <h1>Движение задаёт настроение</h1>
        <p className="muted">
          Примерьте эффекты, хореографии и переходы. Каждый пример собирается
          тем же SDK, что и ваше видео.
        </p>
      </header>
      <MotionGallery />
    </main>
  );
}
