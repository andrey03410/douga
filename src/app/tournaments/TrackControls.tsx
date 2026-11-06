"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MediaPlayer } from "./MediaPlayer";
import { ImageChoice } from "./ImageChoice";

export interface EditableTrack {
  id: string;
  title: string;
  artist: string | null;
  kind?: string;
  album?: string | null;
  sourceFolder?: string | null;
  comment?: string | null;
  bestMomentSec?: number | null;
  coverArtId?: string | null;
  coverPath?: string | null;
  durationSec?: number | null;
  subtitle?: string | null;
  excluded?: boolean;
}
export function pauseOtherMedia(event: React.SyntheticEvent<HTMLMediaElement>) {
  document.querySelectorAll<HTMLMediaElement>("audio,video").forEach((m) => {
    if (m !== event.currentTarget) m.pause();
  });
}
export function TrackControls({
  track,
  compact = false,
}: {
  track: EditableTrack;
  compact?: boolean;
}) {
  const router = useRouter();
  const media = useRef<HTMLMediaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    title: track.title,
    artist: track.artist ?? "",
    comment: track.comment ?? "",
    bestMomentSec:
      track.bestMomentSec == null ? "" : String(track.bestMomentSec),
    coverArtId: track.coverArtId ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [coverVersion, setCoverVersion] = useState(0);
  // Task 33: a picture participant has nothing to listen to and no best moment.
  const picture = track.kind === "image";
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          artist: draft.artist || null,
          comment: draft.comment || null,
          bestMomentSec:
            draft.bestMomentSec === "" ? null : Number(draft.bestMomentSec),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error ?? "Не удалось сохранить трек");
      setNotice("Сохранено");
      setCoverVersion((v) => v + 1);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`track-controls${compact ? " compact" : ""}`}>
      <div className="row track-listen">
        {picture ? null : (
          <MediaPlayer
            key={track.id}
            src={`/api/tracks/${track.id}/audio`}
            title={track.title}
            durationSec={track.durationSec}
            kind={track.kind === "video" ? "video" : "audio"}
            mediaRef={(el) => {
              media.current = el;
            }}
            onPlay={pauseOtherMedia}
          />
        )}

        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setExpanded(!expanded);
            setNotice("");
          }}
          aria-expanded={expanded}
        >
          {expanded ? "Скрыть настройки" : picture ? "Изменить участника" : "Изменить трек"}
        </button>
      </div>
      {expanded ? (
        <div className="track-edit">
          <div className="track-edit-fields">
            <label>
              Название
              <input
                value={draft.title}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Исполнитель
              <input
                value={draft.artist}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              />
            </label>
            <label>
              Комментарий к позиции
              <textarea
                value={draft.comment}
                maxLength={2000}
                rows={2}
                onChange={(e) =>
                  setDraft({ ...draft, comment: e.target.value })
                }
              />
            </label>
            {picture ? null : (
              <>
                <label>
                  Лучший момент, секунды
                  <input
                    type="number"
                    min={0}
                    max={track.durationSec ?? undefined}
                    step={0.1}
                    value={draft.bestMomentSec}
                    onChange={(e) =>
                      setDraft({ ...draft, bestMomentSec: e.target.value })
                    }
                    placeholder="Автоматически"
                  />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      bestMomentSec: String(
                        Math.round((media.current?.currentTime ?? 0) * 10) / 10,
                      ),
                    });
                    setNotice("Момент выбран — сохраните изменения");
                  }}
                >
                  Отметить текущее время
                </button>
                <p className="muted">
                  С этой секунды начнётся фрагмент в ролике. Пустое поле —
                  автоматический выбор.
                </p>
              </>
            )}
          </div>
          <div>
            {draft.coverArtId || track.coverPath ? (
              <img
                className="track-cover"
                src={
                  draft.coverArtId
                    ? `/api/arts/${draft.coverArtId}`
                    : `/api/tracks/${track.id}/cover?v=${coverVersion}`
                }
                alt="Обложка трека"
              />
            ) : null}
            <ImageChoice
              value={draft.coverArtId}
              onChange={(id) => setDraft({ ...draft, coverArtId: id })}
            />
            {draft.coverArtId ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setDraft({ ...draft, coverArtId: null })}
              >
                {picture ? "Вернуть свою картинку" : "Вернуть из тегов"}
              </button>
            ) : null}
            {track.album ? (
              <p className="muted">Альбом: {track.album}</p>
            ) : null}
            {track.sourceFolder ? (
              <p className="muted">Папка: {track.sourceFolder}</p>
            ) : null}
          </div>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={busy || !draft.title.trim()}
              onClick={() => void save()}
            >
              {busy ? "Сохранение…" : picture ? "Сохранить" : "Сохранить трек"}
            </button>
            <span role="status">{notice}</span>
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
