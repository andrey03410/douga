"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImportSources } from "@/app/components/ImportSources";

interface ImageArt {
  id: string;
  label: string | null;
  url: string;
}
/** Native dialog keeps Escape and focus return consistent with the browser. */
export function ImageChoice({
  value,
  onChange,
  label = "Обложка",
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<ImageArt[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    async (after?: string) => {
      try {
        const q = new URLSearchParams({ kind: "image", limit: "40", q: query });
        if (after) q.set("cursor", after);
        const res = await fetch(`/api/arts?${q}`, { cache: "no-store" });
        if (!res.ok) throw Error("Не удалось загрузить картинки");
        const data = await res.json();
        setImages((old) => (after ? [...old, ...data.arts] : data.arts));
        setCursor(data.nextCursor);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [query],
  );
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [open, load]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="btn secondary"
        onClick={() => setOpen(true)}
      >
        {value ? "Изменить" : "Выбрать"}{" "}
        {label === "Обложка" ? "обложку" : label.toLowerCase()}
      </button>
      <dialog
        ref={dialog}
        className="image-dialog"
        onClose={() => setOpen(false)}
        aria-label={`Выбрать: ${label.toLowerCase()}`}
      >
        <div className="row spread">
          <h2>{label}</h2>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setOpen(false)}
          >
            Закрыть
          </button>
        </div>
        <p className="muted">
          Выберите картинку из пула или сначала добавьте её.
        </p>
        <ImportSources onImported={() => void load()} />
        <label>
          Поиск картинок
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название картинки"
          />
        </label>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <div className="image-choices">
          {images.map((a) => (
            <button
              type="button"
              key={a.id}
              className={a.id === value ? "selected" : ""}
              onClick={() => choose(a.id)}
              title={a.label ?? "Картинка"}
            >
              <img src={a.url} alt={a.label ?? "Картинка"} />
              <span>{a.label ?? "Без названия"}</span>
            </button>
          ))}
        </div>
        {!images.length ? (
          <p className="muted">
            Картинок пока нет. Добавьте файл, ссылку или постер из Shikimori
            выше.
          </p>
        ) : null}
        <div className="row">
          {cursor ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => void load(cursor)}
            >
              Ещё картинки
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            onClick={() => choose(null)}
          >
            Без картинки
          </button>
        </div>
      </dialog>
    </>
  );
}
