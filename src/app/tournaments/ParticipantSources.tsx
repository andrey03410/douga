"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { pluralRu } from "@/lib/domain/art-usage";
import { addToDraft, draftGroups, draftKey, draftSources, type DraftItem } from "./participant-draft";

/**
 * Task 33 (P08): where participants come from on the site — files and
 * archives, the media pool, Shikimori. Pool and Shikimori picks collect in a
 * draft with previews; nothing is downloaded until the form is sent.
 */

type Tab = "files" | "pool" | "shikimori";

interface PoolArt {
  id: string;
  label: string | null;
  kind: string;
  url: string;
  posterUrl: string | null;
}

interface ShkResult {
  id: number;
  type: "anime" | "character";
  label: string | null;
  thumbUrl: string | null;
  facts: string | null;
}

const ACCEPT =
  ".zip,application/zip,image/*,.png,.jpg,.jpeg,.webp,.gif,audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,video/*,.mp4,.webm,.mov";

export function ParticipantSources({
  draft,
  onDraft,
  files,
  onFiles,
  splitByTitle,
  onSplitByTitle,
}: {
  draft: DraftItem[];
  onDraft: (next: DraftItem[]) => void;
  files: File[];
  onFiles: (next: File[]) => void;
  /** Omit to hide the "каждый тайтл — свой сегмент" switch (adding to one segment). */
  splitByTitle?: boolean;
  onSplitByTitle?: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const groups = draftGroups(draft);
  // What will actually be created: duplicates merge unless every title is a segment.
  const total = draftSources(draft, Boolean(splitByTitle)).length;
  const merged = draft.length - total;
  const add = (items: DraftItem[]) => onDraft(addToDraft(draft, items));
  return (
    <div className="participant-sources">
      <div className="kind-tabs source-tabs" role="tablist" aria-label="Откуда участники">
        {(
          [
            ["files", "Файлы и архивы"],
            ["pool", "Пул"],
            ["shikimori", "Shikimori"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`btn ghost${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "files" ? (
        <FileSource files={files} onFiles={onFiles} />
      ) : tab === "pool" ? (
        <PoolSource onAdd={add} />
      ) : (
        <ShikimoriSource onAdd={add} />
      )}
      {draft.length ? (
        <div className="draft">
          <div className="row spread">
            <b>
              Черновик: {total} {pluralRu(total, ["участник", "участника", "участников"])}
              {merged > 0 ? (
                <small className="muted"> · {merged} {pluralRu(merged, ["повтор склеится", "повтора склеятся", "повторов склеятся"])}</small>
              ) : null}
            </b>
            <button type="button" className="btn ghost" onClick={() => onDraft([])}>
              Очистить
            </button>
          </div>
          {onSplitByTitle && groups.length > 1 ? (
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(splitByTitle)}
                onChange={(e) => onSplitByTitle(e.target.checked)}
              />
              Каждый тайтл — свой сегмент ({groups.length})
            </label>
          ) : null}
          <p className="muted draft-hint">
            {splitByTitle
              ? "Персонаж из нескольких тайтлов попадёт в каждый их сегмент."
              : "Персонаж из нескольких тайтлов войдёт один раз; подпись — первый тайтл."}
          </p>
          <div className="draft-grid">
            {draft.map((d) => (
              <div className="draft-card" key={draftKey(d)}>
                {d.thumbUrl ? <img src={d.thumbUrl} alt="" loading="lazy" /> : <div className="draft-empty">?</div>}
                <span title={d.label}>{d.label}</span>
                {d.group ? <small>{d.group}</small> : null}
                <button
                  type="button"
                  className="draft-remove"
                  aria-label={`Убрать ${d.label}`}
                  onClick={() => onDraft(draft.filter((x) => draftKey(x) !== draftKey(d)))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileSource({ files, onFiles }: { files: File[]; onFiles: (f: File[]) => void }) {
  return (
    <div className="source-panel">
      <input
        type="file"
        multiple
        accept={ACCEPT}
        aria-label="Файлы и архивы"
        onChange={(e) => onFiles([...files, ...Array.from(e.target.files ?? [])])}
      />
      <p className="muted">
        ZIP-архивы треков или картинок и отдельные файлы. Архив, где есть звук или видео, остаётся
        архивом треков: картинки в нём — обложки. Архив одних картинок даёт участников-картинок с
        именами по файлам.
      </p>
      {files.length ? (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}:${i}`}>
              {f.name}{" "}
              <button
                type="button"
                className="btn ghost"
                aria-label={`Убрать ${f.name}`}
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PoolSource({ onAdd }: { onAdd: (items: DraftItem[]) => void }) {
  const [arts, setArts] = useState<PoolArt[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(
    async (after?: string) => {
      try {
        const q = new URLSearchParams({ limit: "60", q: query });
        if (after) q.set("cursor", after);
        const res = await fetch(`/api/arts?${q}`, { cache: "no-store" });
        if (!res.ok) throw Error("Не удалось загрузить пул");
        const data = await res.json();
        setArts((old) => (after ? [...old, ...data.arts] : data.arts));
        setCursor(data.nextCursor);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [query],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  const preview = (a: PoolArt) => (a.kind === "image" ? a.url : a.posterUrl);
  const toggle = (id: string) =>
    setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  return (
    <div className="source-panel">
      <input placeholder="Поиск в пуле…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error ? <p className="error">{error}</p> : null}
      <div className="pool-pick">
        {arts.map((a) => (
          <button
            type="button"
            key={a.id}
            className={selected.includes(a.id) ? "selected" : ""}
            aria-pressed={selected.includes(a.id)}
            onClick={() => toggle(a.id)}
          >
            {preview(a) ? (
              <img src={preview(a)!} alt="" loading="lazy" />
            ) : (
              <span className="draft-empty">{a.kind === "audio" ? "♪" : "▶"}</span>
            )}
            <span>{a.label ?? "без названия"}</span>
          </button>
        ))}
      </div>
      {!arts.length && !error ? <p className="muted">В пуле ничего не найдено.</p> : null}
      <div className="row">
        {cursor ? (
          <button type="button" className="btn ghost" onClick={() => void load(cursor)}>
            Ещё
          </button>
        ) : null}
        <button
          type="button"
          className="btn secondary"
          disabled={!selected.length}
          onClick={() => {
            onAdd(
              arts
                .filter((a) => selected.includes(a.id))
                .map((a) => ({
                  sourceKey: `art:${a.id}`,
                  source: { assetId: a.id },
                  label: a.label ?? "без названия",
                  thumbUrl: preview(a),
                  group: null,
                })),
            );
            setSelected([]);
          }}
        >
          В турнир{selected.length ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}

function ShikimoriSource({ onAdd }: { onAdd: (items: DraftItem[]) => void }) {
  const [type, setType] = useState<"anime" | "character">("anime");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setError("");
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/shikimori/search?type=${type}&q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw Error(data.error ?? "Ошибка поиска");
        setResults(data.results);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, type]);

  const item = (r: ShkResult, group: string | null): DraftItem => ({
    sourceKey: `shikimori:${r.type}:${r.id}`,
    source: { shikimori: { type: r.type, id: r.id } },
    label: r.label ?? `#${r.id}`,
    thumbUrl: r.thumbUrl,
    group,
    subtitle: group,
  });

  async function addCharacters(anime: ShkResult, role: "Main" | "all") {
    const key = `${anime.id}:${role}`;
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/shikimori/characters?animeId=${anime.id}&role=${role}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw Error(data.error ?? "Shikimori недоступен");
      const title = anime.label ?? `#${anime.id}`;
      const chars = (data.results as ShkResult[]).map((c) => item({ ...c, type: "character" }, title));
      onAdd(chars);
      setNotice(
        chars.length
          ? `${title}: ${chars.length} ${pluralRu(chars.length, ["персонаж", "персонажа", "персонажей"])} в черновике`
          : `${title}: персонажей не нашлось`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="source-panel">
      <div className="row shk-search" style={{ gap: 8 }}>
        <div className="kind-tabs">
          <button
            type="button"
            className={`btn ghost${type === "anime" ? " active" : ""}`}
            onClick={() => setType("anime")}
          >
            Аниме
          </button>
          <button
            type="button"
            className={`btn ghost${type === "character" ? " active" : ""}`}
            onClick={() => setType("character")}
          >
            Персонажи
          </button>
        </div>
        <input
          placeholder="Поиск в Shikimori…"
          aria-label="Поиск в Shikimori"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 0 }}
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <p className="muted">Ищем…</p> : null}
      <div className="shk-results">
        {results.map((r) => (
          <div className="shk-result" key={`${r.type}-${r.id}`}>
            {r.thumbUrl ? (
              <img src={r.thumbUrl} alt="" className="shk-thumb" loading="lazy" />
            ) : (
              <div className="shk-thumb shk-thumb-empty">?</div>
            )}
            <span className="shk-label">
              <b>{r.label ?? "без названия"}</b>
              {r.facts ? <small className="muted">{r.facts}</small> : null}
            </span>
            <span className="shk-actions">
              {r.type === "anime" ? (
                <>
                  <button type="button" className="btn ghost" onClick={() => onAdd([item(r, null)])}>
                    + аниме
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={Boolean(busyKey)}
                    onClick={() => void addCharacters(r, "Main")}
                  >
                    {busyKey === `${r.id}:Main` ? "…" : "+ главные персонажи"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={Boolean(busyKey)}
                    onClick={() => void addCharacters(r, "all")}
                  >
                    {busyKey === `${r.id}:all` ? "…" : "+ все персонажи"}
                  </button>
                </>
              ) : (
                <button type="button" className="btn secondary" onClick={() => onAdd([item(r, null)])}>
                  + персонаж
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
