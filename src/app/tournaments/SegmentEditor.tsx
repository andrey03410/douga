"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  groupTracksByAlbum,
  moveItem,
  moveSelectedTracks,
  type SegmentDraft,
} from "./segment-editor-state";
import { TrackControls, type EditableTrack } from "./TrackControls";
import { pluralRu } from "@/lib/domain/art-usage";
import { ImageChoice } from "./ImageChoice";

export interface EditorSegment {
  id: string;
  title: string;
  subtitle?: string | null;
  posterArtId?: string | null;
  tracks: EditableTrack[];
}
export function SegmentEditor({
  tournamentId,
  initialSegments,
  activeSegmentId,
}: {
  tournamentId: string;
  initialSegments: EditorSegment[];
  activeSegmentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<SegmentDraft[]>(() =>
    initialSegments.map((s) => ({ ...s, trackIds: s.tracks.map((t) => t.id) })),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const tracks = initialSegments.flatMap((s) => s.tracks);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  useEffect(() => {
    if (!dirty)
      setSegments(
        initialSegments.map((s) => ({
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          posterArtId: s.posterArtId,
          trackIds: s.tracks.map((t) => t.id),
        })),
      );
  }, [initialSegments, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function change(next: SegmentDraft[]) {
    setSegments(next);
    setDirty(true);
    setNotice("");
    setError("");
  }
  function patch(index: number, value: Partial<SegmentDraft>) {
    change(segments.map((s, i) => (i === index ? { ...s, ...value } : s)));
  }
  function move(ids: string[], to: string) {
    change(moveSelectedTracks(segments, ids, to));
    setSelected([]);
  }
  function remove(index: number) {
    if (segments.length === 1) return;
    const destination = segments[index === 0 ? 1 : 0].id!;
    change(
      moveSelectedTracks(
        segments,
        segments[index].trackIds,
        destination,
      ).filter((_, i) => i !== index),
    );
    setSelected([]);
  }
  async function save(confirmReset = false) {
    setBusy(true);
    setError("");
    try {
      const payload = segments.map((s) => ({
        id: s.id?.startsWith("new:") ? undefined : s.id,
        title: s.title.trim(),
        subtitle: s.subtitle || null,
        posterArtId: s.posterArtId || null,
        trackIds: s.trackIds,
      }));
      const res = await fetch(`/api/tournaments/${tournamentId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: payload, confirmReset }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error ?? "Не удалось сохранить разбивку");
      if (data.requiresConfirmation) {
        const reopen: { title: string }[] = data.segmentsToReopen ?? [];
        const parts = [
          data.answersToReset
            ? `Будет снято ${data.answersToReset} ${pluralRu(data.answersToReset, ["ответ", "ответа", "ответов"])} на сравнения в изменённых сегментах. Их результаты нужно будет определить заново.`
            : "",
          reopen.length
            ? `Готовый топ ${reopen.map((s) => `«${s.title}»`).join(", ")} снова откроется: места нужно будет сохранить заново.`
            : "",
        ].filter(Boolean);
        if (window.confirm(`${parts.join(" ")} Сохранить разбивку?`)) await save(true);
        return;
      }
      setDirty(false);
      setSelected([]);
      setNotice("Разбивка сохранена");
      if (
        activeSegmentId &&
        !data.segments?.some((s: { id: string }) => s.id === activeSegmentId)
      )
        router.replace(
          `/tournaments/${tournamentId}?segmentId=${encodeURIComponent(data.activeSegmentId)}`,
        );
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const albums = new Set(tracks.map((t) => t.album?.trim()).filter(Boolean));
  return (
    <section className="panel segment-editor">
      <button
        type="button"
        className="btn secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Скрыть редактор" : "Разбить на сегменты / изменить разбивку"}
      </button>
      {open ? (
        <>
          <h2>Разбивка турнира</h2>
          <p className="muted">
            Перетащите трек в нужный сегмент или выберите несколько галочками.
            Каждый сегмент сравнивается отдельно. Изменения вступят в силу после
            сохранения.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                change([
                  ...segments,
                  {
                    id: `new:${crypto.randomUUID()}`,
                    title: `Сегмент ${segments.length + 1}`,
                    trackIds: [],
                  },
                ])
              }
            >
              + Сегмент
            </button>
            {albums.size > 1 ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  change(groupTracksByAlbum(tracks));
                  setSelected([]);
                }}
              >
                Разбить по альбомам ({albums.size})
              </button>
            ) : null}
          </div>
          {selected.length ? (
            <div className="selection-toolbar" role="status">
              <span>Выбрано треков: {selected.length}</span>
              <select
                aria-label="Куда перенести выбранные треки"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Выберите сегмент</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || "Без названия"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!segments.some((s) => s.id === target)}
                onClick={() => move(selected, target)}
              >
                Перенести
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSelected([])}
              >
                Снять выбор
              </button>
            </div>
          ) : null}
          <div className="segment-columns">
            {segments.map((s, i) => (
              <section
                key={s.id}
                className="segment-box"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("text/douga-tracks"))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const ids = JSON.parse(
                      e.dataTransfer.getData("text/douga-tracks"),
                    );
                    if (Array.isArray(ids)) move(ids, s.id!);
                  } catch {}
                }}
              >
                <div className="row spread">
                  <b>
                    Сегмент {i + 1} · {s.trackIds.length}{" "}
                    {pluralRu(s.trackIds.length, ["трек", "трека", "треков"])}
                  </b>
                  <div className="row">
                    <button
                      type="button"
                      className="btn ghost"
                      aria-label={`Сегмент ${i + 1} выше`}
                      disabled={i === 0}
                      onClick={() => change(moveItem(segments, i, i - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      aria-label={`Сегмент ${i + 1} ниже`}
                      disabled={i === segments.length - 1}
                      onClick={() => change(moveItem(segments, i, i + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={segments.length === 1}
                      onClick={() => remove(i)}
                      title="Треки перейдут в соседний сегмент"
                    >
                      Удалить сегмент
                    </button>
                  </div>
                </div>
                <label>
                  Название сегмента
                  <input
                    value={s.title}
                    maxLength={300}
                    onChange={(e) => patch(i, { title: e.target.value })}
                  />
                </label>
                <label>
                  Подзаголовок
                  <input
                    value={s.subtitle ?? ""}
                    maxLength={1000}
                    onChange={(e) => patch(i, { subtitle: e.target.value })}
                  />
                </label>
                <div className="row">
                  {s.posterArtId ? (
                    <img
                      className="segment-poster"
                      src={`/api/arts/${s.posterArtId}`}
                      alt="Постер сегмента"
                    />
                  ) : null}
                  <ImageChoice
                    label="Постер"
                    value={s.posterArtId}
                    onChange={(id) => patch(i, { posterArtId: id })}
                  />
                </div>
                <label className="row select-all">
                  <input
                    type="checkbox"
                    checked={
                      s.trackIds.length > 0 &&
                      s.trackIds.every((id) => selected.includes(id))
                    }
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...new Set([...old, ...s.trackIds])]
                          : old.filter((id) => !s.trackIds.includes(id)),
                      )
                    }
                  />
                  Выбрать все треки сегмента
                </label>
                {s.trackIds.length === 0 ? (
                  <p className="empty-drop">Перенесите сюда треки</p>
                ) : null}
                {s.trackIds.map((id) => {
                  const t = byId.get(id);
                  if (!t) return null;
                  return (
                    <div
                      className={`segment-track${selected.includes(id) ? " selected" : ""}`}
                      key={id}
                    >
                      <div className="row">
                        <input
                          aria-label={`Выбрать ${t.title}`}
                          type="checkbox"
                          checked={selected.includes(id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, id]
                                : old.filter((x) => x !== id),
                            )
                          }
                        />
                        <button
                          className="drag-handle"
                          type="button"
                          draggable
                          aria-label={`Перетащить ${t.title}`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "text/douga-tracks",
                              JSON.stringify(
                                selected.includes(id) ? selected : [id],
                              ),
                            );
                            e.dataTransfer.effectAllowed = "move";
                          }}
                        >
                          ⠿
                        </button>
                        {t.coverArtId || t.coverPath ? (
                          // Task 33: pictures are what identifies a participant.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="rank-cover"
                            src={`/api/tracks/${t.id}/cover?art=${encodeURIComponent(t.coverArtId ?? "own")}&size=thumb`}
                            alt=""
                            loading="lazy"
                          />
                        ) : null}
                        <span className="track-name">
                          <b>{t.title}</b>
                          {t.subtitle || t.artist ? <small>{t.subtitle ?? t.artist}</small> : null}
                          {t.excluded ? <small>исключён</small> : null}
                        </span>
                      </div>
                      {t.kind !== "image" && (t.album || t.sourceFolder) ? (
                        <p className="track-origin muted">
                          {[t.album, t.sourceFolder]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      <TrackControls track={t} compact />
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="row editor-save">
            <button
              type="button"
              className="btn"
              disabled={busy || !dirty || segments.some((s) => !s.title.trim())}
              onClick={() => void save()}
            >
              {busy ? "Сохранение…" : "Сохранить разбивку"}
            </button>
            {dirty ? (
              <span className="muted">Есть несохранённые изменения</span>
            ) : null}
            <span role="status">{notice}</span>
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
