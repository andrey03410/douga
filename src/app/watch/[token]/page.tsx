import type { Metadata } from "next";
import { cache } from "react";
import { loadPublicWatch } from "@/server/studio/watch-public";
import { WatchPlayer, WatchShell } from "@/watch/WatchPlayer";

export const dynamic = "force-dynamic";

/** One lookup per request: the page and its metadata share it. */
const publicWatch = cache(loadPublicWatch);

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const watch = await publicWatch(params.token);
  return {
    title: watch.ok ? watch.title : "Ролик снят с публикации",
    robots: { index: false, follow: false },
  };
}

export default async function WatchPage({
  params,
}: {
  params: { token: string };
}) {
  const watch = await publicWatch(params.token);
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
