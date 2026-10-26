"use client";
import { useState } from "react";
import { studioRequest } from "./StudioWorkspace";
type Item = { id: string; kind: string; version: number; revision: number };
type Page = { items: Item[]; nextCursor: string | null };
export function StudioProjectList({ initial }: { initial: Page }) {
  const [page, setPage] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      {page.items.length === 0 ? (
        <p className="muted">SDK-проектов пока нет.</p>
      ) : (
        page.items.map((p) => (
          <div className="list-item" key={p.id}>
            <div>
              <a href={`/studio/${p.id}`}>
                SDK · {p.kind === "top" ? "Топ" : "Пикер"}
              </a>
              <div className="muted">
                <code>{p.id}</code> · v{p.version} · r{p.revision}
              </div>
            </div>
            <a className="btn secondary" href={`/studio/${p.id}`}>
              Открыть проект
            </a>
          </div>
        ))
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {page.nextCursor ? (
        <button
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const more = await studioRequest<Page>(
                `projects?cursor=${encodeURIComponent(page.nextCursor!)}`,
              );
              setPage((old) => ({
                ...more,
                items: [...old.items, ...more.items],
              }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Ещё SDK-проекты
        </button>
      ) : null}
    </>
  );
}
