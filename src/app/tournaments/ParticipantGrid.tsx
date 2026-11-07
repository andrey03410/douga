"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pluralRu } from "@/lib/domain/art-usage";
import { ImageChoice } from "./ImageChoice";
import { ParticipantSources } from "./ParticipantSources";
import { draftSources, type DraftItem } from "./participant-draft";

export interface GridParticipant {
  id: string;
  title: string;
  artist: string | null;
  kind: "audio" | "video" | "image";
  subtitle: string | null;
  note: string | null;
  sourceUrl: string | null;
  coverArtId: string | null;
  excluded: boolean;
  thumbUrl: string | null;
}

/**
 * Task 33 (P12–P14): «Состав» — check and fix a base before comparing:
 * search, exclude (reversible) and return, delete for good, captions and
 * picture, add more from the same sources as the create form.
 */
export function ParticipantGrid({
  tournamentId,
  segmentId,
  participants,
  defaultOpen,
}: {
  tournamentId: string;
  segmentId: string;
  participants: GridParticipant[];
  defaultOpen: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const q = query.trim().toLowerCase();
  const matches = (p: GridParticipant) =>
    !q || [p.title, p.artist, p.subtitle, p.note].some((v) => v?.toLowerCase().includes(q));
  const active = participants.filter((p) => !p.excluded && matches(p));
  const excluded = participants.filter((p) => p.excluded && matches(p));
  const activeCount = participants.filter((p) => !p.excluded).length;

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/tracks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw Error((await res.json().catch(() => ({}))).error ?? "Не удалось сохранить");
  };

  const setExcluded = (ids: string[], value: boolean) =>
    run(async () => {
      for (const id of ids) await patch(id, { excluded: value });
      setSelected([]);
      return value
        ? `Исключено: ${ids.length}. Ответы с ними сохранены — вернуть можно в любой момент.`
        : `Возвращено: ${ids.length}.`;
    });

  const remove = (ids: string[]) =>
    run(async () => {
      const call = (confirmReset: boolean) =>
        fetch(`/api/tournaments/${tournamentId}/items`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackIds: ids, confirmReset }),
        }).then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw Error(data.error ?? "Не удалось удалить");
          return data as { requiresConfirmation: boolean; answersToReset: number };
        });
      let result = await call(false);
      if (result.requiresConfirmation) {
        const n = result.answersToReset;
        if (
          !window.confirm(
            `С ${ids.length > 1 ? "этими участниками" : "этим участником"} уже ${n} ${pluralRu(n, ["экран", "экрана", "экранов"])} ответов — они будут сняты. Удалить насовсем? Исключение ответы сохраняет.`,
          )
        )
          return "Удаление отменено";
        result = await call(true);
      }
      setSelected([]);
      return `Удалено: ${ids.length}.`;
    });

  const addParticipants = () =>
    run(async () => {
      const body = new FormData();
      for (const f of files) body.append("file", f);
      body.set("sources", JSON.stringify(draftSources(draft, false)));
      body.set("segmentId", segmentId);
      const res = await fetch(`/api/tournaments/${tournamentId}/items`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(data.error ?? "Не удалось добавить");
      setDraft([]);
      setFiles([]);
      setAdding(false);
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      return `Добавлено: ${data.added?.length ?? 0}${skipped ? `, не загрузились из Shikimori: ${skipped}` : ""}.`;
    });

  const toggle = (id: string) =>
    setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));

  return (
    <details className="panel composition" open={defaultOpen}>
      <summary>
        <h2>
          Состав · {activeCount}{" "}
          {pluralRu(
            activeCount,
            participants.some((p) => p.kind === "image")
              ? ["участник", "участника", "участников"]
              : ["трек", "трека", "треков"],
          )}
          {participants.length > activeCount ? ` · исключено ${participants.length - activeCount}` : ""}
        </h2>
      </summary>
      <div className="row composition-tools">
        <input
          placeholder="Поиск по имени, подписи, основанию…"
          aria-label="Поиск участников"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? "Скрыть добавление" : "+ Добавить участников"}
        </button>
      </div>
      {adding ? (
        <div className="composition-add">
          <ParticipantSources draft={draft} onDraft={setDraft} files={files} onFiles={setFiles} />
          <p className="muted">
            В готовом сегменте новички встанут в прежний порядок за несколько экранов; ручной порядок старых мест
            не меняется.
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy || (!draft.length && !files.length)}
            onClick={() => void addParticipants()}
          >
            {busy ? "Добавляем…" : "Добавить в сегмент"}
          </button>
        </div>
      ) : null}
      {selected.length ? (
        <div className="selection-toolbar">
          <b>Выбрано: {selected.length}</b>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void setExcluded(selected, true)}>
            Исключить
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove(selected)}>
            Удалить насовсем
          </button>
          <button type="button" className="btn ghost" onClick={() => setSelected([])}>
            Снять выбор
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted" role="status">
        {notice}
      </p>
      <div className="participant-grid">
        {active.map((p) =>
          editing === p.id ? (
            <EditCard key={p.id} p={p} onDone={() => setEditing(null)} />
          ) : (
            <div key={p.id} className={`participant-card${selected.includes(p.id) ? " selected" : ""}`}>
              <label className="participant-select">
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${p.title}`}
                  checked={selected.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
              </label>
              <Thumb p={p} />
              <b className="participant-title">{p.title}</b>
              {p.subtitle || p.artist ? <small>{p.subtitle ?? p.artist}</small> : null}
              {p.note ? <small className="participant-note">{p.note}</small> : null}
              {p.sourceUrl ? (
                <a className="participant-link" href={p.sourceUrl} target="_blank" rel="noreferrer">
                  Shikimori ↗
                </a>
              ) : null}
              <div className="participant-actions">
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void setExcluded([p.id], true)}>
                  Исключить
                </button>
                <button type="button" className="btn ghost" onClick={() => setEditing(p.id)}>
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`Удалить ${p.title}`}
                  disabled={busy}
                  onClick={() => void remove([p.id])}
                >
                  Удалить
                </button>
              </div>
            </div>
          ),
        )}
      </div>
      {!active.length ? <p className="muted">{q ? "Никого не нашлось." : "Активных участников нет."}</p> : null}
      {excluded.length ? (
        <details className="excluded-list">
          <summary>Исключены ({excluded.length})</summary>
          <div className="participant-grid">
            {excluded.map((p) => (
              <div key={p.id} className="participant-card excluded">
                <Thumb p={p} />
                <b className="participant-title">{p.title}</b>
                {p.subtitle ? <small>{p.subtitle}</small> : null}
                <div className="participant-actions">
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void setExcluded([p.id], false)}>
                    Вернуть
                  </button>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove([p.id])}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </details>
  );
}

function Thumb({ p }: { p: GridParticipant }) {
  return p.thumbUrl ? (
    <img className="participant-thumb" src={p.thumbUrl} alt="" loading="lazy" />
  ) : (
    <span className="participant-thumb participant-icon">{p.kind === "video" ? "▶" : "♪"}</span>
  );
}

function EditCard({ p, onDone }: { p: GridParticipant; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(p.title);
  const [subtitle, setSubtitle] = useState(p.subtitle ?? "");
  const [note, setNote] = useState(p.note ?? "");
  const [cover, setCover] = useState<string | null>(p.coverArtId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tracks/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || p.title,
          subtitle: subtitle.trim() || null,
          note: note.trim() || null,
          coverArtId: cover,
        }),
      });
      if (!res.ok) throw Error((await res.json().catch(() => ({}))).error ?? "Не удалось сохранить");
      onDone();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="participant-card editing">
      {cover ? (
        <img className="participant-thumb" src={`/api/arts/${cover}`} alt="" />
      ) : (
        <Thumb p={{ ...p, thumbUrl: p.coverArtId ? null : p.thumbUrl }} />
      )}
      <label>
        Имя
        <input value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Подпись
        <input value={subtitle} maxLength={500} onChange={(e) => setSubtitle(e.target.value)} />
      </label>
      <label>
        Основание
        <textarea value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ImageChoice label="Картинка из пула" value={cover} onChange={setCover} />
      {error ? <p className="error">{error}</p> : null}
      <div className="participant-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          Сохранить
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Отмена
        </button>
      </div>
    </div>
  );
}
