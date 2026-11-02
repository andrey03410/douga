"use client";

import { useEffect, useRef } from "react";
import { describeUsage, pluralRu } from "@/lib/domain/art-usage";
import { RenameField } from "@/app/components/RenameField";
import type { MediaPool, PoolArt, PoolKind } from "@/app/components/useMediaPool";

// The cabinet's view over the pool: compact rows with search, filter, rename,
// selection and delete (phase 17).

const MB = 1024 * 1024;
export function fmtBytes(n: number | null): string {
  if (n == null) return "";
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(1)} ГБ`;
  if (n >= MB) return `${(n / MB).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${Math.round(n)} Б`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const KIND_TABS: [("" | PoolKind), string][] = [
  ["", "Все"],
  ["image", "Картинки"],
  ["video", "Видео"],
  ["audio", "Аудио"],
];

/** Thumbnail of a pool media: poster frame for video, note for audio. */
function MediaThumb({ art, className }: { art: PoolArt; className: string }) {
  if (art.kind === "audio") return <div className={`${className} audio-thumb`}>🎵</div>;
  if (art.kind === "video" && !art.posterUrl)
    return <video className={className} src={art.url} muted preload="metadata" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={art.kind === "video" ? art.posterUrl! : art.url}
      alt={art.label ?? "медиа"}
      loading="lazy"
    />
  );
}

export function MediaBrowser({
  pool,
  emptyText = "Пул пуст.",
}: {
  pool: MediaPool;
  emptyText?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll: the sentinel below the list asks for the next page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void pool.loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [pool.loadMore, pool]);

  function row(art: PoolArt, index: number) {
    return (
      <div key={art.id} className={`media-row${pool.selected.has(art.id) ? " picked" : ""}`}>
        <input
          type="checkbox"
          className="row-pick"
          title="Выбрать (Shift — диапазон)"
          checked={pool.selected.has(art.id)}
          readOnly
          onClick={(e) => pool.toggleSelected(index, art.id, e.shiftKey)}
        />
        <MediaThumb art={art} className="row-thumb" />
        <span className="row-main">
          <RenameField value={art.label} onSave={(next) => pool.rename(art, next)} />
          <span className="muted row-facts">
            {fmtBytes(art.sizeBytes)}
            {art.durationSec != null ? ` · ${fmtDuration(art.durationSec)}` : ""} ·{" "}
            {describeUsage(art.usage)}
          </span>
        </span>
        <button className="btn ghost" onClick={() => void pool.remove(art)}>
          Удалить
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input
          placeholder="🔍 Поиск по названию…"
          value={pool.query}
          onChange={(e) => pool.setQuery(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <div className="kind-tabs">
          {KIND_TABS.map(([value, label]) => (
            <button
              key={value}
              className={`btn ghost${pool.kind === value ? " active" : ""}`}
              onClick={() => pool.setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {pool.selected.size > 0 ? (
        <div className="select-bar">
          <span>
            Выбрано {pool.selected.size} {pluralRu(pool.selected.size, ["файл", "файла", "файлов"])}
          </span>
          <button className="btn secondary" onClick={() => void pool.removeSelected()}>
            Удалить выбранные
          </button>
          <button className="btn ghost" onClick={pool.clearSelection}>
            Снять выделение
          </button>
        </div>
      ) : null}
      {pool.error ? <div className="error" style={{ marginBottom: 10 }}>{pool.error}</div> : null}

      {pool.arts.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {pool.query || pool.kind ? "Ничего не найдено." : emptyText}
        </p>
      ) : (
        <div className="media-rows">{pool.arts.map((a, i) => row(a, i))}</div>
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </>
  );
}
