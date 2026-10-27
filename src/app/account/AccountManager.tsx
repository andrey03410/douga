"use client";

import { useCallback, useEffect, useState } from "react";
import { pluralRu } from "@/lib/domain/art-usage";
import { MediaBrowser, fmtBytes } from "@/app/components/MediaBrowser";
import { useMediaPool } from "@/app/components/useMediaPool";

// The cabinet used to render every archive, every pool media and every render in
// three unbounded lists — with a pool of 1300 posters that is 1300 rows and a
// query per file. Since phase 17 the panels show aggregates and load their list
// only when asked (phase-17 spec).

interface ArchiveRow {
  id: string;
  title: string;
  status: string;
  trackCount: number;
  sizeBytes: number;
}
interface RenderRow {
  id: string;
  ownerId: string;
  title: string;
  status: string;
  sizeBytes: number;
  hasOutput: boolean;
}
interface KindTotals {
  count: number;
  bytes: number;
}
interface UsageDto {
  email: string;
  role: string;
  quotas: {
    maxTournaments: number | null;
    maxArchiveBytes: number;
    maxPoolBytes: number | null;
  };
  pool: KindTotals & { byKind: Record<"image" | "video" | "audio", KindTotals> };
  archives: KindTotals;
  renders: KindTotals & { ready: number };
  archiveBytes: number;
  poolBytes: number;
  renderBytes: number;
  /** AI Video SDK: projects with their revision media, and queue jobs with results. */
  studio: {
    projects: number;
    revisions: number;
    snapshots: number;
    bytes: number;
    jobs: number;
    resultBytes: number;
  };
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  in_progress: "В процессе",
  completed: "Завершён",
  queued: "В очереди",
  running: "Рендерится",
  done: "Готов",
  failed: "Ошибка",
};

function QuotaLine({ used, max, label }: { used: number; max: number | null; label: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
        <span>{label}</span>
        <span className="muted">
          {fmtBytes(used)}
          {max !== null ? ` из ${fmtBytes(max)}` : " (без лимита)"}
        </span>
      </div>
      {max !== null ? (
        <div className="progressbar" style={{ marginTop: 4 }}>
          <div style={{ width: `${Math.min(100, Math.round((used / max) * 100))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** Panel head: a one-line summary and the button that reveals the list. */
function PanelHead({
  title,
  summary,
  open,
  disabled,
  onToggle,
}: {
  title: string;
  summary: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {summary}
        </span>
        <button className="btn ghost" disabled={disabled} onClick={onToggle}>
          {open ? "Свернуть" : "Показать все"}
        </button>
      </div>
    </div>
  );
}

export function AccountManager() {
  const [data, setData] = useState<UsageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [poolOpen, setPoolOpen] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [rendersOpen, setRendersOpen] = useState(false);
  const [archives, setArchives] = useState<ArchiveRow[] | null>(null);
  const [renders, setRenders] = useState<RenderRow[] | null>(null);
  const [rendersCursor, setRendersCursor] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/account/usage", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "Не удалось загрузить данные");
      return;
    }
    setData(d);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The pool list lives in the shared browser (same component as the manager).
  const pool = useMediaPool({ enabled: poolOpen, onChange: reload });

  const loadArchives = useCallback(async () => {
    const res = await fetch("/api/account/archives", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    setArchives(res.ok ? (d.archives ?? []) : []);
    if (!res.ok) setError(d.error ?? "Не удалось загрузить архивы");
  }, []);

  const loadRenders = useCallback(async (cursor?: string) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`/api/account/renders${qs}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error ?? "Не удалось загрузить рендеры");
      return;
    }
    setRenders((prev) => (cursor ? [...(prev ?? []), ...d.renders] : d.renders));
    setRendersCursor(d.nextCursor ?? null);
  }, []);

  useEffect(() => {
    if (archivesOpen && archives === null) void loadArchives();
  }, [archivesOpen, archives, loadArchives]);

  useEffect(() => {
    if (rendersOpen && renders === null) void loadRenders();
  }, [rendersOpen, renders, loadRenders]);

  async function remove(kind: "tournament" | "render", id: string, title: string) {
    const what =
      kind === "tournament"
        ? `архив «${title}» со всеми треками, сравнениями и рендерами`
        : `рендер «${title}»`;
    if (!confirm(`Удалить ${what}? Файлы будут стёрты с сервера.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const url = kind === "tournament" ? `/api/tournaments/${id}` : `/api/render-jobs/${id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Не удалось удалить");
      }
      if (kind === "tournament") {
        setArchives((prev) => prev?.filter((a) => a.id !== id) ?? null);
        setRenders(null); // its renders went with it
      } else {
        setRenders((prev) => prev?.filter((r) => r.id !== id) ?? null);
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!data) {
    return <div className="panel">{error ? <div className="error">{error}</div> : "Загрузка…"}</div>;
  }

  const poolSummary = `${data.pool.count} ${pluralRu(data.pool.count, [
    "файл",
    "файла",
    "файлов",
  ])} · ${fmtBytes(data.pool.bytes)} · картинки ${data.pool.byKind.image.count} · видео ${
    data.pool.byKind.video.count
  } · аудио ${data.pool.byKind.audio.count}`;

  const { studio } = data;
  const studioSummary = `${studio.projects} ${pluralRu(studio.projects, [
    "проект",
    "проекта",
    "проектов",
  ])} · ${studio.jobs} ${pluralRu(studio.jobs, ["задание", "задания", "заданий"])} · ${fmtBytes(
    studio.resultBytes,
  )}`;

  return (
    <>
      <div className="panel">
        <h2>Профиль</h2>
        <p className="muted" style={{ margin: 0 }}>
          {data.email}
        </p>
        <QuotaLine
          used={data.archiveBytes}
          max={data.quotas.maxArchiveBytes}
          label="Архивы (треки турниров)"
        />
        <QuotaLine used={data.poolBytes} max={data.quotas.maxPoolBytes} label="Пул медиа" />
        {data.quotas.maxTournaments !== null ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Одновременно можно держать {data.quotas.maxTournaments} загруженный
            архив: занято {data.archives.count} из {data.quotas.maxTournaments}.
          </p>
        ) : null}
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="panel">
        <PanelHead
          title="Архивы"
          summary={`${data.archives.count} · ${fmtBytes(data.archives.bytes)}`}
          open={archivesOpen}
          disabled={data.archives.count === 0}
          onToggle={() => setArchivesOpen((v) => !v)}
        />
        {data.archives.count === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Нет загруженных архивов.</p>
        ) : archivesOpen ? (
          <div style={{ marginTop: 10 }}>
            {archives === null ? (
              <p className="muted">Загрузка…</p>
            ) : (
              archives.map((t) => (
                <div className="list-item" key={t.id}>
                  <div>
                    <a href={`/tournaments/${t.id}`} style={{ fontWeight: 600 }}>
                      {t.title}
                    </a>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {t.trackCount} треков · {fmtBytes(t.sizeBytes)} ·{" "}
                      {STATUS_LABEL[t.status] ?? t.status}
                    </div>
                  </div>
                  <button
                    className="btn ghost"
                    disabled={busyId === t.id}
                    onClick={() => void remove("tournament", t.id, t.title)}
                  >
                    Удалить
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <PanelHead
          title="Пул медиа"
          summary={poolSummary}
          open={poolOpen}
          disabled={data.pool.count === 0}
          onToggle={() => setPoolOpen((v) => !v)}
        />
        {data.pool.count === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Пул пуст.</p>
        ) : poolOpen ? (
          <div style={{ marginTop: 12 }}>
            <MediaBrowser pool={pool} view="rows" emptyText="Пул пуст." />
          </div>
        ) : null}
      </div>

      <div className="panel">
        <PanelHead
          title="Рендеры"
          summary={`${data.renders.count} · готовых ${data.renders.ready} · ${fmtBytes(
            data.renders.bytes,
          )}`}
          open={rendersOpen}
          disabled={data.renders.count === 0}
          onToggle={() => setRendersOpen((v) => !v)}
        />
        {data.renders.count === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Готовых рендеров нет.</p>
        ) : rendersOpen ? (
          <div style={{ marginTop: 10 }}>
            {renders === null ? (
              <p className="muted">Загрузка…</p>
            ) : (
              <>
                {renders.map((r) => (
                  <div className="list-item" key={r.id}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{r.title}</span>
                      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                        {r.hasOutput ? ` · ${fmtBytes(r.sizeBytes)}` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {r.hasOutput ? (
                        <a className="btn ghost" href={`/api/render-jobs/${r.id}/download`}>
                          ⬇ Скачать
                        </a>
                      ) : null}
                      <button
                        className="btn ghost"
                        disabled={busyId === r.id}
                        onClick={() => void remove("render", r.id, r.title)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
                {rendersCursor ? (
                  <button className="btn ghost" onClick={() => void loadRenders(rendersCursor)}>
                    Показать ещё
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Студия</h2>
          <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {studioSummary}
            </span>
            <a className="btn ghost" href="/projects">
              Открыть проекты
            </a>
          </div>
        </div>
        {studio.projects === 0 && studio.jobs === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Проектов студии нет.</p>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Проекты: {studio.projects}, ревизий {studio.revisions}, медиа ревизий{" "}
            {fmtBytes(studio.bytes)}. Задания: {studio.jobs}, снимков {studio.snapshots},
            результаты {fmtBytes(studio.resultBytes)}.
          </p>
        )}
      </div>
    </>
  );
}
