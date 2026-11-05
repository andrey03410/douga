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
import { pluralRu } from "@/lib/domain/art-usage";
import { SegmentEditor } from "../SegmentEditor";

export default async function TournamentOverview({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { segmentId?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const t = await getTournament(
    session.user.id,
    params.id,
    searchParams.segmentId,
  );
  if (!t) notFound();
  const { screens, coverage, isComplete, groupSize } = nextComparison(t);
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  let ranking: RankRow[] = [];
  if (t.status === "completed" && t.rankings.length > 0)
    ranking = t.rankings.map((r) => {
      const tr = byId.get(r.trackId)!;
      return {
        trackId: r.trackId,
        rank: r.rank,
        title: tr.title,
        artist: tr.artist,
        score: r.score,
        track: tr,
      };
    });
  else if (isComplete && t.tracks.length)
    ranking = createEngine(t.scheme as Scheme)
      .ranking(
        t.tracks.map((tr) => tr.id),
        toDomainComparisons(t.comparisons),
      )
      .map((r) => {
        const tr = byId.get(r.id)!;
        return {
          trackId: r.id,
          rank: r.rank,
          title: tr.title,
          artist: tr.artist,
          score: r.score,
          track: tr,
        };
      });
  const segment = t.segments.find((s) => s.id === t.activeSegmentId);
  const pct = screens.estimatedTotal
    ? Math.min(
        100,
        Math.round((screens.completed / screens.estimatedTotal) * 100),
      )
    : 0;
  const query = `?segmentId=${encodeURIComponent(t.activeSegmentId)}`;
  return (
    <div className="container tournament-page">
      <div className="row spread">
        <h1>{t.title}</h1>
        <a href="/tournaments" className="muted">
          ← Все топы
        </a>
      </div>
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="tag">
          {t.segments.reduce((n, s) => n + s.tracks.length, 0)} треков
        </span>
        <span className="tag">{t.segments.length} сегм.</span>
        {t.blindMode ? <span className="tag">Слепой режим</span> : null}
      </div>
      <nav className="segment-nav" aria-label="Сегменты турнира">
        {t.segments.map((s, i) => (
          <a
            key={s.id}
            href={`/tournaments/${t.id}?segmentId=${encodeURIComponent(s.id)}`}
            className={`segment-tab${s.id === t.activeSegmentId ? " active" : ""}`}
            aria-current={s.id === t.activeSegmentId ? "page" : undefined}
          >
            <b>
              {i + 1}. {s.title}
            </b>
            <small>
              {s.tracks.length}{" "}
              {pluralRu(s.tracks.length, ["трек", "трека", "треков"])} ·{" "}
              {s.status === "completed"
                ? "Топ готов"
                : s.tracks.length === 0
                  ? "Добавьте треки"
                  : `${s.answeredScreens} ${pluralRu(s.answeredScreens, ["ответ", "ответа", "ответов"])}`}
            </small>
          </a>
        ))}
      </nav>
      {t.segments.length > 1 ? (
        <div className="segment-heading">
          {segment?.posterArtId ? (
            <img
              className="segment-poster"
              src={`/api/arts/${segment.posterArtId}`}
              alt=""
            />
          ) : null}
          <div>
            <h2>{segment?.title}</h2>
            {segment?.subtitle ? (
              <p className="muted">{segment.subtitle}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {!t.tracks.length ? (
        <div className="panel">
          <p>
            В этом сегменте пока нет треков. Добавьте их в редакторе разбивки
            ниже.
          </p>
        </div>
      ) : !isComplete ? (
        <section className="panel">
          <h2>Сравнения</h2>
          <div className="progressbar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            Сделано {screens.completed} из ~{screens.estimatedTotal} экранов
            {groupSize > 2 ? ` (по ${groupSize} трека за раз)` : ""} ·
            расставлено {coverage.orderedPct}% пар.
          </p>
          <a className="btn" href={`/tournaments/${t.id}/compare${query}`}>
            Продолжить сравнения →
          </a>
        </section>
      ) : (
        <ResultsPanel
          key={t.activeSegmentId}
          tournamentId={t.id}
          segmentId={t.activeSegmentId}
          ranking={ranking}
          total={t.tracks.length}
          initialTopSize={t.topSize ?? Math.min(10, t.tracks.length)}
          completed={t.status === "completed"}
        />
      )}
      <SegmentEditor
        tournamentId={t.id}
        activeSegmentId={t.activeSegmentId}
        initialSegments={t.segments.map((s) => ({
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          posterArtId: s.posterArtId,
          tracks: s.tracks,
        }))}
      />
    </div>
  );
}
