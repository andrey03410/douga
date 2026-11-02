"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyMediaUrl } from "@/lib/domain/media-url";
import { pickPastedImageUrl, pasteLabel, isGenericPasteName } from "@/lib/domain/clipboard";

// Every way media gets into the pool, behind one row of tabs: local files
// (click/drag&drop), a link (picture — imported here and now; video/audio — the
// background yt-dlp job), and Shikimori search. Before phase 17 all three lived
// unfolded in the modal, which had turned into a long scroll above the grid.

type Source = "files" | "url" | "shikimori";

const SOURCES: [Source, string][] = [
  ["files", "Файлы"],
  ["url", "Ссылка"],
  ["shikimori", "Shikimori"],
];

const UPLOAD_ACCEPT =
  "image/*,video/mp4,video/webm,video/quicktime,audio/*,.mp4,.webm,.mov,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus";

const isMediaFile = (f: File) =>
  f.type.startsWith("image/") ||
  f.type.startsWith("video/") ||
  f.type.startsWith("audio/") ||
  // .mov/.m4a often arrive with an empty MIME type
  /\.(mp4|webm|mov|mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f.name);

/** Upload files to the pool, reporting how many made it and what went wrong. */
export async function uploadPoolFiles(
  files: File[],
  labels?: Map<File, string>,
): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  await Promise.all(
    files.map(async (f) => {
      const fd = new FormData();
      fd.append("file", f);
      const label = labels?.get(f);
      if (label) fd.append("label", label);
      try {
        const res = await fetch("/api/arts", { method: "POST", body: fd });
        if (res.ok) {
          ok += 1;
          return;
        }
        const data = await res.json().catch(() => ({}));
        errors.push(`${f.name}: ${data.error ?? `ошибка ${res.status}`}`);
      } catch {
        errors.push(`${f.name}: сеть недоступна`);
      }
    }),
  );
  return { ok, errors };
}

interface DownloadJobDto {
  id: string;
  url: string;
  mode: "video" | "audio";
  quality: number;
  title: string | null;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  error: string | null;
  artId: string | null;
}

/**
 * One link field for every source. `classifyMediaUrl` decides where the URL
 * goes; the quality select only appears when it is not a picture. A NOT_IMAGE
 * answer from the server turns into an offer to try the downloader instead.
 */
function UrlSource({ onImported }: { onImported: () => void }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"1080" | "720" | "480" | "audio">("1080");
  const [jobs, setJobs] = useState<DownloadJobDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doneIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const kind = classifyMediaUrl(url);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/downloads", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list: DownloadJobDto[] = data.jobs;
    setJobs(list);
    // a job finishing while we watch -> refresh the pool grid
    for (const j of list) {
      if (j.status === "done" && !doneIdsRef.current.has(j.id)) {
        doneIdsRef.current.add(j.id);
        onImported();
      }
    }
    return list;
  }, [onImported]);

  useEffect(() => {
    void refresh().then((list) => {
      for (const j of list ?? []) if (j.status === "done") doneIdsRef.current.add(j.id);
    });
    timerRef.current = setInterval(() => void refresh(), 1500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  async function startDownload(target: string) {
    const res = await fetch("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: target,
        mode: mode === "audio" ? "audio" : "video",
        quality: mode === "audio" ? undefined : Number(mode),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Не удалось начать загрузку");
    setUrl("");
    setFallbackUrl(null);
    await refresh();
  }

  async function importImage(target: string) {
    const res = await fetch("/api/arts/from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setUrl("");
      setNotice(`Картинка «${data.label ?? "без названия"}» в пуле`);
      onImported();
      return;
    }
    if (data.code === "NOT_IMAGE") {
      // keep the URL: the user may want the downloader instead of a picture
      setFallbackUrl(target);
      setError(data.error ?? "По ссылке не картинка");
      return;
    }
    throw new Error(data.error ?? "Не удалось импортировать");
  }

  async function submit() {
    const target = url.trim();
    setError(null);
    setNotice(null);
    setFallbackUrl(null);
    if (!target) return;
    if (!kind) {
      setError("Это не похоже на ссылку http(s)");
      return;
    }
    setBusy(true);
    try {
      if (kind === "image") await importImage(target);
      else await startDownload(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function useDownloader() {
    if (!fallbackUrl) return;
    setBusy(true);
    setError(null);
    try {
      await startDownload(fallbackUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(job: DownloadJobDto) {
    await fetch(`/api/downloads/${job.id}`, { method: "DELETE" });
    await refresh();
  }

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const finished = jobs.filter((j) => j.status !== "queued" && j.status !== "running");

  return (
    <div className="url-import">
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          placeholder="🔗 Ссылка на картинку, видео или аудио…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          style={{ flex: 1, marginBottom: 0 }}
        />
        {kind === "image" ? null : (
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            style={{ width: 170, marginBottom: 0 }}
          >
            <option value="1080">Видео до 1080p</option>
            <option value="720">Видео до 720p</option>
            <option value="480">Видео до 480p</option>
            <option value="audio">Только звук (m4a)</option>
          </select>
        )}
        <button className="btn secondary" disabled={busy || !url.trim()} onClick={() => void submit()}>
          {kind === "image" ? "⬇ В пул" : "⬇ Скачать"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        {kind === "image"
          ? "Картинка сохранится в пул сразу."
          : "Видео и аудио скачиваются в фоне — окно можно закрыть."}
      </p>
      {notice ? (
        <div style={{ marginTop: 8, fontSize: 13, color: "#7be29a" }}>{notice}</div>
      ) : null}
      {error ? (
        <div className="error" style={{ marginTop: 8 }}>
          {error}
          {fallbackUrl ? (
            <button
              className="btn ghost"
              style={{ marginLeft: 10 }}
              disabled={busy}
              onClick={() => void useDownloader()}
            >
              Скачать как видео/аудио
            </button>
          ) : null}
        </div>
      ) : null}

      {active.length + finished.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          {[...active, ...finished.slice(0, 4)].map((j) => (
            <div className="row" key={j.id} style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                }}
              >
                {j.mode === "audio" ? "🎵" : "🎬"} {j.title ?? j.url}
              </span>
              {j.status === "running" || j.status === "queued" ? (
                <>
                  <div className="progressbar" style={{ width: 140, margin: 0 }}>
                    <div style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                  <span className="muted" style={{ fontSize: 12, width: 38 }}>
                    {Math.round(j.progress * 100)}%
                  </span>
                </>
              ) : j.status === "done" ? (
                <span style={{ fontSize: 12, color: "#7be29a" }}>готово — в пуле</span>
              ) : j.status === "canceled" ? (
                <span className="muted" style={{ fontSize: 12 }}>отменено</span>
              ) : (
                <span className="error-text" style={{ fontSize: 12, maxWidth: 280 }} title={j.error ?? ""}>
                  {j.error ?? "ошибка"}
                </span>
              )}
              <button
                className="btn ghost"
                title={j.status === "running" || j.status === "queued" ? "Отменить" : "Убрать из списка"}
                onClick={() => void cancel(j)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ShkResult {
  id: number;
  type: "anime" | "character";
  label: string | null;
  thumbUrl: string | null;
  posterPath: string | null;
  facts: string | null;
}

/** Search Shikimori (anime/character) and import a poster into the pool. */
function ShikimoriSource({ onImported }: { onImported: () => void }) {
  const [type, setType] = useState<"anime" | "character">("anime");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setError(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/shikimori/search?type=${type}&q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка поиска");
        setResults(data.results as ShkResult[]);
        setLoading(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, type]);

  async function importOne(r: ShkResult) {
    if (!r.posterPath) return;
    const key = `${r.type}-${r.id}`;
    setImportingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/shikimori/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: r.type, id: r.id, posterPath: r.posterPath, label: r.label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось импортировать");
      setDoneKeys((prev) => new Set(prev).add(key));
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportingKey(null);
    }
  }

  return (
    <div className="shikimori-panel">
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <div className="kind-tabs">
          <button className={`btn ghost${type === "anime" ? " active" : ""}`} onClick={() => setType("anime")}>
            Аниме
          </button>
          <button
            className={`btn ghost${type === "character" ? " active" : ""}`}
            onClick={() => setType("character")}
          >
            Персонажи
          </button>
        </div>
        <input
          placeholder="🎴 Поиск в Shikimori…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
      </div>
      {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}
      {loading ? <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Ищем…</p> : null}
      {results.length > 0 ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {results.map((r) => (
            <div className="shk-result row" key={`${r.type}-${r.id}`} style={{ gap: 8, alignItems: "center" }}>
              {r.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.thumbUrl} alt={r.label ?? ""} className="shk-thumb" loading="lazy" />
              ) : (
                <div className="shk-thumb shk-thumb-empty">🎴</div>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.label ?? "без названия"}
                </span>
                {r.facts ? <span className="muted" style={{ fontSize: 12 }}>{r.facts}</span> : null}
              </span>
              {doneKeys.has(`${r.type}-${r.id}`) ? (
                <span style={{ fontSize: 12, color: "#7be29a" }}>в пуле</span>
              ) : (
                <button
                  className="btn secondary"
                  disabled={importingKey === `${r.type}-${r.id}` || !r.posterPath}
                  onClick={() => void importOne(r)}
                >
                  {importingKey === `${r.type}-${r.id}` ? "…" : "⬇ В пул"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** True while the caret sits in a field, where Ctrl+V means "paste text". */
function typingSomewhere(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) ?? document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true;
}

export function ImportSources({ onImported }: { onImported: () => void }) {
  const [source, setSource] = useState<Source>("files");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(
    async (files: FileList | File[], labels?: Map<File, string>) => {
      const media = Array.from(files).filter(isMediaFile);
      if (!media.length) {
        setError("Среди файлов нет картинок, видео или аудио");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { ok, errors } = await uploadPoolFiles(media, labels);
        if (ok) onImported();
        setError(errors.length ? `Не загружено: ${errors.slice(0, 3).join("; ")}` : null);
        return ok;
      } finally {
        setBusy(false);
      }
    },
    [onImported],
  );

  /**
   * Ctrl+V anywhere on the page that shows the import. A screenshot arrives as a file with a
   * placeholder name (`image.png`) and gets a "Вставка ДД.ММ ЧЧ:ММ" label; a
   * picture copied in a browser arrives as HTML/text and goes through the
   * by-link import. Pastes into a text field are left alone.
   */
  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      if (typingSomewhere(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;

      const files = Array.from(data.files ?? []).filter(isMediaFile);
      if (files.length) {
        event.preventDefault();
        const labels = new Map<File, string>();
        const stamp = pasteLabel(new Date());
        for (const f of files) if (isGenericPasteName(f.name)) labels.set(f, stamp);
        setPasted(null);
        const ok = await upload(files, labels);
        if (ok) setPasted(files.length === 1 ? `Вставлено: ${labels.get(files[0]) ?? files[0].name}` : `Вставлено файлов: ${ok}`);
        return;
      }

      const url = pickPastedImageUrl({
        text: data.getData("text/plain"),
        html: data.getData("text/html"),
      });
      if (!url) return;
      event.preventDefault();
      setBusy(true);
      setError(null);
      setPasted(null);
      try {
        const res = await fetch("/api/arts/from-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Не удалось импортировать вставленную ссылку");
        setPasted(`Вставлено: ${body.label ?? "без названия"}`);
        onImported();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload, onImported]);

  return (
    <div
      className="import-sources"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
        setSource("files");
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="kind-tabs" style={{ marginBottom: 8 }}>
        {SOURCES.map(([value, label]) => (
          <button
            key={value}
            className={`btn ghost${source === value ? " active" : ""}`}
            onClick={() => setSource(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {pasted ? (
        <div className="paste-note" style={{ fontSize: 13, color: "#7be29a", marginBottom: 8 }}>
          {pasted}
        </div>
      ) : null}

      {source === "files" ? (
        <>
          <div
            className={`dropzone${drag ? " drag" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy
              ? "Загрузка…"
              : "Перетащите картинки, видео или аудио сюда, нажмите, чтобы выбрать, или вставьте из буфера (Ctrl+V)"}
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}
        </>
      ) : source === "url" ? (
        <UrlSource onImported={onImported} />
      ) : (
        <ShikimoriSource onImported={onImported} />
      )}
    </div>
  );
}
