"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createVideoDocument, type VideoDocument } from "@/video";
import { studioRequest } from "../StudioWorkspace";
function example(kind: "top" | "picker", sourceId?: string): VideoDocument {
  const document = createVideoDocument({ kind });
  if (kind === "top" && sourceId) {
    document.source = {
      kind: "tournament",
      tournamentId: sourceId,
      participants: [],
      rounds: [],
    };
    document.schemaVersion = 2;
    document.scenes = [];
    document.segments = [];
  }
  return document;
}
export function NewStudioProject({ sourceId }: { sourceId?: string }) {
  const router = useRouter();
  const [text, setText] = useState(() =>
      JSON.stringify(example("top", sourceId), null, 2),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <div className="studio-toolbar">
        <button
          className="btn secondary"
          onClick={() =>
            setText(JSON.stringify(example("top", sourceId), null, 2))
          }
        >
          Пример топа
        </button>
        <button
          className="btn secondary"
          onClick={() => setText(JSON.stringify(example("picker"), null, 2))}
        >
          Пример пикера
        </button>
      </div>
      {sourceId ? (
        <p className="studio-notice">
          Готовые сегменты вашего турнира появятся в видео. Порядок участников
          обновляется из рейтинга каждого сегмента, оформление сохраняется.
        </p>
      ) : null}
      <label htmlFor="new-studio-json">Документ VideoDocument</label>
      <textarea
        id="new-studio-json"
        className="studio-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const created = await studioRequest<{ id: string }>(
              "projects",
              "POST",
              {
                document: JSON.parse(text),
                idempotencyKey: crypto.randomUUID(),
              },
            );
            router.push(`/studio/${created.id}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Создать SDK-проект
      </button>
    </section>
  );
}
