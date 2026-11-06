"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface BoardItem {
  id: string;
  title: string;
  thumbUrl: string | null;
  kind: string;
  /** null: not in a tier yet. */
  tier: number | null;
  excluded: boolean;
}

/**
 * Task 33 (P21): every participant by tier; drag between rows (desktop) or
 * tap a participant and then a row (phone). "Не участвует" is the exclusion
 * of P13. Moves inside strictly ordered top tiers reopen a finished segment.
 */
export function TierBoard({
  tournamentId,
  segmentId,
  tierNames,
  items,
}: {
  tournamentId: string;
  segmentId: string;
  tierNames: string[];
  items: BoardItem[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function move(itemId: string, tier: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item || busy) return;
    if ((tier === -1 && item.excluded) || (!item.excluded && item.tier === tier)) {
      setPicked(null);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, tier, segmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(data.error ?? "Не удалось переложить");
      setNotice(
        data.reopened
          ? "Сегмент снова открыт: порядок внутри упорядоченных корзин нужно достроить."
          : `«${item.title}» → ${tier === -1 ? "не участвует" : tierNames[tier]}`,
      );
      setPicked(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows: { key: string; label: string; tier: number | null; members: BoardItem[] }[] = [
    ...tierNames.map((name, i) => ({
      key: `t${i}`,
      label: name,
      tier: i,
      members: items.filter((x) => !x.excluded && x.tier === i),
    })),
    { key: "none", label: "Без корзины", tier: null, members: items.filter((x) => !x.excluded && x.tier === null) },
    { key: "out", label: "Не участвует", tier: -1, members: items.filter((x) => x.excluded) },
  ];

  return (
    <section className="panel tier-board">
      <h2>Корзины</h2>
      <p className="muted">
        Перетащите участника в другую корзину или нажмите на него, а потом на название корзины.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted" role="status">
        {notice}
      </p>
      {rows.map((row) =>
        row.tier === null && !row.members.length ? null : (
          <div
            key={row.key}
            className={`tier-row${picked && row.tier !== null ? " target" : ""}`}
            onDragOver={(e) => {
              if (dragged && row.tier !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged && row.tier !== null) void move(dragged, row.tier);
              setDragged(null);
            }}
          >
            <button
              type="button"
              className="tier-label"
              disabled={row.tier === null || !picked || busy}
              onClick={() => picked && row.tier !== null && void move(picked, row.tier)}
              aria-label={picked ? `Переложить в «${row.label}»` : row.label}
            >
              {row.label}
              <small>{row.members.length}</small>
            </button>
            <div className="tier-members">
              {row.members.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`tier-item${picked === m.id ? " picked" : ""}`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    setDragged(m.id);
                    e.dataTransfer.setData("text/plain", m.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragged(null)}
                  onClick={() => setPicked((p) => (p === m.id ? null : m.id))}
                  title={m.title}
                  aria-pressed={picked === m.id}
                >
                  {m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" /> : <span>{m.kind === "video" ? "▶" : "♪"}</span>}
                  <small>{m.title}</small>
                </button>
              ))}
            </div>
          </div>
        ),
      )}
    </section>
  );
}
