import { createRoot } from "react-dom/client";
import type { CompiledVideo } from "@/video";
import { WatchPlayer } from "./WatchPlayer";

declare global {
  interface Window {
    __DOUGA__?: { plan: CompiledVideo; title: string };
  }
}

const boot = window.__DOUGA__;
const root = document.getElementById("root");
if (boot && root)
  createRoot(root).render(
    <WatchPlayer plan={boot.plan} title={boot.title} />,
  );
