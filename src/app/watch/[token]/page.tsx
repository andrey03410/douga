import type { Metadata } from "next";
import { loadPublicWatch } from "@/server/studio/watch-public";
import { WatchPlayer, WatchShell } from "@/watch/WatchPlayer";

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
      <WatchShell>
        <p>Ролик снят с публикации</p>
      </WatchShell>
    );
  }
  return (
    <WatchShell>
      <WatchPlayer plan={watch.plan} title={watch.title} />
    </WatchShell>
  );
}
