"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { finalizeResultsBeforeNavigation } from "./results-actions";
import { moveItem } from "../segment-editor-state";
import { TrackControls, type EditableTrack } from "../TrackControls";
export interface RankRow {
  trackId: string;
  rank: number;
  title: string;
  artist: string | null;
  score: number;
  track?: EditableTrack;
}
export function ResultsPanel({
  tournamentId,
  segmentId,
  ranking,
  total,
  initialTopSize,
  completed,
}: {
  tournamentId: string;
  segmentId?: string;
  ranking: RankRow[];
  total: number;
  initialTopSize: number;
  completed: boolean;
}) {
  const router = useRouter();
  const [topSize, setTopSize] = useState(initialTopSize);
  const [rows, setRows] = useState(ranking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => setRows(ranking), [ranking]);
  useEffect(() => setTopSize(initialTopSize), [initialTopSize]);
  async function save(destination: "stay" | "studio") {
    if (!Number.isInteger(topSize) || topSize < 1 || topSize > total) {
      setError(`Укажите размер топа от 1 до ${total}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await finalizeResultsBeforeNavigation(
        tournamentId,
        topSize,
        () => {
          if (destination === "studio")
            router.push(
              `/studio/new?sourceId=${encodeURIComponent(tournamentId)}`,
            );
          else {
            setNotice("Размер топа сохранён");
            router.refresh();
          }
        },
        segmentId,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(from: number, to: number) {
    if (busy || from === to || !completed) return;
    const previous = rows;
    const next = moveItem(rows, from, to).map((r, i) => ({
      ...r,
      rank: i + 1,
    }));
    setRows(next);
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((r) => r.trackId), segmentId }),
      });
      if (!res.ok)
        throw Error((await res.json()).error ?? "Не удалось сохранить порядок");
      setNotice("Порядок сохранён");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setRows(previous);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>
        {completed ? "Итоговый топ" : "Сравнения завершены — сохраните топ"}
      </h2>
      <label>Размер топа (из {total} треков)</label>
      <div className="row">
        <input
          type="number"
          aria-label="Размер топа"
          min={1}
          max={total}
          value={topSize}
          onChange={(e) => setTopSize(Number(e.target.value))}
          style={{ maxWidth: 120 }}
        />
        <button
          className="btn secondary"
          onClick={() => void save("stay")}
          disabled={busy}
        >
          Сохранить топ
        </button>
        <button
          className="btn"
          onClick={() => void save("studio")}
          disabled={busy}
        >
          Создать видео через SDK →
        </button>
      </div>
      <p className="muted">
        Видео оформляет агент. Можно начать монтаж по готовым сегментам —
        остальные появятся в проекте после завершения.
      </p>
      {completed ? (
        <p className="muted">
          Перетащите позицию за ⠿ или воспользуйтесь стрелками. Изменённый
          порядок сохраняется сразу.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p role="status" className="muted">
        {notice}
      </p>
      <div className="ranking-list">
        {rows.map((r, i) => (
          <div
            key={r.trackId}
            className={`result-track${r.rank > topSize ? " outside-top" : ""}`}
            onDragOver={(e) => {
              if (dragged !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged !== null) void move(dragged, i);
              setDragged(null);
            }}
          >
            <div className="rank-row">
              {completed ? (
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Перетащить место ${r.rank}`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    setDragged(i);
                    e.dataTransfer.setData("text/plain", r.trackId);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragged(null)}
                >
                  ⠿
                </button>
              ) : null}
              <span className="rank-num">{r.rank}</span>
              {r.track?.coverArtId || r.track?.coverPath ? (
                <img
                  className="rank-cover"
                  src={`/api/tracks/${r.trackId}/cover?art=${encodeURIComponent(r.track.coverArtId ?? "embedded")}`}
                  alt=""
                />
              ) : null}
              <div className="track-name">
                <b>{r.title}</b>
                {r.artist ? <small>{r.artist}</small> : null}
                {r.track?.comment ? (
                  <small className="track-comment">{r.track.comment}</small>
                ) : null}
              </div>
              <span className="muted">{r.score} очк.</span>
              {completed ? (
                <div className="row rank-arrows">
                  <button
                    className="btn ghost"
                    title="Выше"
                    aria-label={`${r.title}: выше`}
                    onClick={() => void move(i, i - 1)}
                    disabled={busy || i === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="btn ghost"
                    title="Ниже"
                    aria-label={`${r.title}: ниже`}
                    onClick={() => void move(i, i + 1)}
                    disabled={busy || i === rows.length - 1}
                  >
                    ↓
                  </button>
                </div>
              ) : null}
            </div>
            <TrackControls
              track={
                r.track ?? { id: r.trackId, title: r.title, artist: r.artist }
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
