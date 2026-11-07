import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTournament, nextComparison } from "@/server/tournaments";
import { ResultsPanel, type RankRow, type UnplacedRow } from "./ResultsPanel";
import { pluralRu } from "@/lib/domain/art-usage";
import { SegmentEditor } from "../SegmentEditor";
import { SchemeChooser } from "../SchemeChooser";
import { ParticipantGrid } from "../ParticipantGrid";
import { TierBoard } from "../TierBoard";
import { participantDto } from "@/lib/participant-dto";
import { unplacedReason } from "../compare-state";
import { SCHEME_INFO } from "@/lib/domain/scheme-settings";

/** "трек" for listening tournaments, "участник" once pictures are in (task 33). */
function word(kinds: Set<string>): [string, string, string] {
  return [...kinds].some((k) => k === "image")
    ? ["участник", "участника", "участников"]
    : ["трек", "трека", "треков"];
}

export default async function TournamentOverview({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { segmentId?: string; skipped?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const t = await getTournament(session.user.id, params.id, searchParams.segmentId);
  if (!t) notFound();
  const step = nextComparison(t);
  const { screens, coverage, isComplete, groupSize, scheme, settings, result, tiers } = step;
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  const dto = new Map(t.tracks.map((tr) => [tr.id, participantDto(tr)]));
  const segment = t.segments.find((s) => s.id === t.activeSegmentId);
  const completed = t.status === "completed";
  const allKinds = new Set(t.segments.flatMap((s) => s.tracks.map((tr) => tr.kind)));
  const forms = word(allKinds);
  const tierNames = scheme === "tiers" ? (settings.tiers ?? []) : null;

  const row = (id: string, rank: number, score: number): RankRow => {
    const tr = byId.get(id)!;
    return {
      trackId: id,
      rank,
      title: tr.title,
      artist: tr.artist,
      score,
      track: tr,
      thumbUrl: dto.get(id)?.thumbUrl ?? null,
      subtitle: tr.subtitle,
    };
  };
  // A saved result keeps the person's manual order; otherwise the engine's.
  const ranking: RankRow[] =
    completed && t.rankings.length
      ? t.rankings.filter((r) => byId.has(r.trackId)).map((r) => row(r.trackId, r.rank, r.score))
      : isComplete
        ? result.placed.map((r) => row(r.id, r.rank, r.score))
        : [];
  const placedIds = new Set(ranking.map((r) => r.trackId));
  const unplaced: UnplacedRow[] = result.unplaced
    .filter((u) => !placedIds.has(u.id) && byId.has(u.id))
    .map((u) => ({
      trackId: u.id,
      title: byId.get(u.id)!.title,
      thumbUrl: dto.get(u.id)?.thumbUrl ?? null,
      reason: unplacedReason(u, tierNames, scheme),
    }));
  const tierList = scheme === "tiers" && (settings.rankTop ?? 0) === 0;
  const pct = screens.estimatedTotal
    ? Math.min(100, Math.round((screens.completed / screens.estimatedTotal) * 100))
    : 0;
  const query = `?segmentId=${encodeURIComponent(t.activeSegmentId)}`;
  const skipped = Number(searchParams.skipped ?? 0);
  const activeTracks = t.tracks.filter((tr) => !tr.excluded);

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
          {(() => {
            const n = t.segments.reduce((sum, s) => sum + s.activeCount, 0);
            return `${n} ${pluralRu(n, forms)}`;
          })()}
        </span>
        <span className="tag">{t.segments.length} сегм.</span>
        {t.blindMode ? <span className="tag">Слепой режим</span> : null}
      </div>
      {skipped > 0 ? (
        <p className="notice" role="status">
          Из Shikimori не загрузились {skipped} {pluralRu(skipped, ["участник", "участника", "участников"])} (нет
          картинки или Shikimori не ответил). Остальные на месте — добавить можно в «Составе».
        </p>
      ) : null}
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
              {s.activeCount} {pluralRu(s.activeCount, forms)} ·{" "}
              {s.effectiveScheme ? SCHEME_INFO[s.effectiveScheme].label : "алгоритм не выбран"} ·{" "}
              {s.status === "completed"
                ? "Готово"
                : s.tracks.length === 0
                  ? "Добавьте участников"
                  : `${s.answeredScreens} ${pluralRu(s.answeredScreens, ["ответ", "ответа", "ответов"])}`}
            </small>
          </a>
        ))}
      </nav>
      {t.segments.length > 1 ? (
        <div className="segment-heading">
          {segment?.posterArtId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="segment-poster" src={`/api/arts/${segment.posterArtId}`} alt="" />
          ) : null}
          <div>
            <h2>{segment?.title}</h2>
            {segment?.subtitle ? <p className="muted">{segment.subtitle}</p> : null}
          </div>
        </div>
      ) : null}

      {activeTracks.length ? (
        <SchemeChooser
          key={`${t.activeSegmentId}:${scheme}:${JSON.stringify(settings)}`}
          tournamentId={t.id}
          segmentId={t.activeSegmentId}
          segmentCount={t.segments.length}
          itemCount={activeTracks.length}
          current={scheme}
          currentSettings={settings}
          groupSize={groupSize}
          segmentCompleted={completed}
        />
      ) : null}

      {!activeTracks.length ? (
        <div className="panel">
          <p>В этом сегменте пока нет участников. Добавьте их в «Составе» или в редакторе разбивки ниже.</p>
        </div>
      ) : !completed && !scheme ? null : !completed && !isComplete ? (
        <section className="panel">
          <h2>Сравнения</h2>
          <div className="progressbar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            Сделано {screens.completed} из ~{screens.estimatedTotal} экранов
            {groupSize > 2 && scheme !== "tiers" ? ` (до ${groupSize} за раз)` : ""}
            {scheme === "tiers" ? "" : ` · расставлено ${coverage.orderedPct}% пар`}.
          </p>
          <a className="btn" href={`/tournaments/${t.id}/compare${query}`}>
            {screens.completed ? "Продолжить сравнения →" : "Начать сравнения →"}
          </a>
        </section>
      ) : (
        <ResultsPanel
          key={t.activeSegmentId}
          tournamentId={t.id}
          segmentId={t.activeSegmentId}
          ranking={ranking}
          total={Math.max(1, ranking.length)}
          initialTopSize={Math.min(t.topSize ?? 10, Math.max(1, ranking.length))}
          completed={completed}
          unplaced={unplaced}
          tierList={tierList}
        />
      )}

      {scheme === "tiers" && tierNames && (tiers.size > 0 || t.tracks.some((tr) => tr.excluded)) ? (
        <TierBoard
          tournamentId={t.id}
          segmentId={t.activeSegmentId}
          tierNames={tierNames}
          items={t.tracks.map((tr) => ({
            id: tr.id,
            title: tr.title,
            thumbUrl: dto.get(tr.id)?.thumbUrl ?? null,
            kind: tr.kind,
            tier: tiers.get(tr.id) ?? null,
            excluded: tr.excluded,
          }))}
        />
      ) : null}

      {t.tracks.length ? (
        <ParticipantGrid
          tournamentId={t.id}
          segmentId={t.activeSegmentId}
          defaultOpen={screens.completed === 0 && allKinds.has("image")}
          participants={t.tracks.map((tr) => {
            const d = dto.get(tr.id)!;
            return {
              id: tr.id,
              title: tr.title,
              artist: tr.artist,
              kind: d.kind,
              subtitle: tr.subtitle,
              note: tr.note,
              sourceUrl: tr.sourceUrl,
              coverArtId: tr.coverArtId,
              excluded: tr.excluded,
              thumbUrl: d.thumbUrl,
            };
          })}
        />
      ) : null}

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
