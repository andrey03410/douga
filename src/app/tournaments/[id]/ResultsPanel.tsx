"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finalizeResultsBeforeNavigation } from "./results-actions";

export interface RankRow {
  trackId: string;
  rank: number;
  title: string;
  artist: string | null;
  score: number;
}

export function ResultsPanel({
  tournamentId,
  ranking,
  total,
  initialTopSize,
  completed,
}: {
  tournamentId: string;
  ranking: RankRow[];
  total: number;
  initialTopSize: number;
  completed: boolean;
}) {
  const router = useRouter();
  const [topSize, setTopSize] = useState(initialTopSize);
  const [rows, setRows] = useState<RankRow[]>(ranking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(destination: "stay" | "studio" | "legacy") {
    setBusy(true);
    setError(null);
    try {
      await finalizeResultsBeforeNavigation(tournamentId, topSize, () => {
        if (destination === "studio")
          router.push(
            `/studio/new?sourceId=${encodeURIComponent(tournamentId)}`,
          );
        else if (destination === "legacy")
          router.push(`/tournaments/${tournamentId}/render`);
        else router.refresh();
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rows.length || busy) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const reranked = next.map((r, i) => ({ ...r, rank: i + 1 }));
    setRows(reranked);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: reranked.map((r) => r.trackId) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Ошибка");
    } catch (err) {
      setError((err as Error).message);
      setRows(ranking); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        {completed ? "Итоговый топ" : "Турнир завершён — выберите размер топа"}
      </h2>

      <label>Размер топа (top-N из {total})</label>
      <div className="row">
        <input
          type="number"
          min={1}
          max={total}
          value={topSize}
          onChange={(e) => setTopSize(Number(e.target.value))}
          style={{ maxWidth: 120 }}
        />
        <button
          className="btn secondary"
          onClick={() => save("stay")}
          disabled={busy}
        >
          Сохранить N
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void save("studio")}
        >
          Создать видео через SDK →
        </button>
        <button
          className="btn ghost"
          onClick={() => save("legacy")}
          disabled={busy}
        >
          Открыть прежний рендер
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {completed ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Можно вручную переставить позиции стрелками ↑ ↓ перед рендером.
        </p>
      ) : null}

      <div style={{ marginTop: 10 }}>
        {rows.map((r, i) => (
          <div
            className="rank-row"
            key={r.trackId}
            style={{ opacity: r.rank <= topSize ? 1 : 0.4 }}
          >
            <div className="rank-num">{r.rank}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              {r.artist ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  {r.artist}
                </div>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 13, marginRight: 8 }}>
              {r.score} очк.
            </div>
            {completed ? (
              <div className="row" style={{ gap: 4 }}>
                <button
                  className="btn ghost"
                  style={{ padding: "4px 10px" }}
                  onClick={() => move(i, -1)}
                  disabled={busy || i === 0}
                  title="Выше"
                >
                  ↑
                </button>
                <button
                  className="btn ghost"
                  style={{ padding: "4px 10px" }}
                  onClick={() => move(i, 1)}
                  disabled={busy || i === rows.length - 1}
                  title="Ниже"
                >
                  ↓
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
