import type { Metadata } from "next";
import { loadPublicWatch } from "@/server/studio/watch-public";
import { WatchPlayer } from "@/watch/WatchPlayer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ролик",
  robots: { index: false, follow: false },
};

export default async function WatchPage({
  params,
}: {
  params: { token: string };
}) {
  const watch = await loadPublicWatch(params.token);
  if (!watch.ok) {
    return (
      <main className="watch-page">
        <p>Ролик снят с публикации</p>
      </main>
    );
  }
  return (
    <main className="watch-page">
      <WatchPlayer plan={watch.plan} title={watch.title} />
    </main>
  );
}
