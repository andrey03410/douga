import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  getTournament,
  nextComparison,
  toDomainComparisons,
} from "@/server/tournaments";
import { createEngine } from "@/lib/domain/engines";
import type { Scheme } from "@/lib/domain/types";
import { ResultsPanel, type RankRow } from "./ResultsPanel";

export default async function TournamentOverview({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const t = await getTournament(session.user.id, params.id);
  if (!t) notFound();

  const { screens, coverage, isComplete, groupSize } = nextComparison(t);
  const titleById = new Map(t.tracks.map((tr) => [tr.id, tr]));

  // Build ranking rows for display when complete. For a finalized tournament use
  // the persisted Ranking (which reflects any manual reordering); otherwise derive
  // a preview order straight from the engine.
  let ranking: RankRow[] = [];
  if (t.status === "completed" && t.rankings.length > 0) {
    ranking = t.rankings.map((r) => {
      const tr = titleById.get(r.trackId)!;
      return { trackId: r.trackId, rank: r.rank, title: tr.title, artist: tr.artist, score: r.score };
    });
  } else if (isComplete) {
    const engine = createEngine(t.scheme as Scheme);
    const ranked = engine.ranking(
      t.tracks.map((tr) => tr.id),
      toDomainComparisons(t.comparisons),
    );
    ranking = ranked.map((r) => {
      const tr = titleById.get(r.id)!;
      return { trackId: r.id, rank: r.rank, title: tr.title, artist: tr.artist, score: r.score };
    });
  }

  const pct = screens.estimatedTotal
    ? Math.min(100, Math.round((screens.completed / screens.estimatedTotal) * 100))
    : 0;

  return (
    <div className="container">
      <h1>{t.title}</h1>
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="tag">{t.tracks.length} OST</span>
        <span className="tag">
          {t.status === "completed" ? "Завершён" : "В процессе"}
        </span>
        {t.blindMode ? <span className="tag">Слепой режим</span> : null}
        <a href="/tournaments" className="muted">← ко всем топам</a>
      </div>

      {!isComplete ? (
        <div className="panel">
          <h2>Сравнения</h2>
          <div className="progressbar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Сделано {screens.completed} из ~{screens.estimatedTotal} экранов
            {groupSize > 2 ? ` (по ${groupSize} трека за раз)` : ""} · расставлено{" "}
            {coverage.orderedPct}% пар.
          </p>
          <a className="btn" href={`/tournaments/${t.id}/compare`}>
            Продолжить сравнения →
          </a>
        </div>
      ) : (
        <>
          <ResultsPanel
            tournamentId={t.id}
            ranking={ranking}
            total={t.tracks.length}
            initialTopSize={t.topSize ?? Math.min(10, t.tracks.length)}
            completed={t.status === "completed"}
          />
        </>
      )}
    </div>
  );
}
