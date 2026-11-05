"use client";

import { useEffect, useState } from "react";
import { pluralRu } from "@/lib/domain/art-usage";
import { useRouter } from "next/navigation";
import { MAX_GROUP_SIZE, plannedScreens } from "@/lib/domain/group-answer";
import { createEngine } from "@/lib/domain/engines";
import type { Scheme } from "@/lib/domain/types";

export interface CreateFormLimits {
  /** Human-readable archive size cap, e.g. "100 МБ". */
  archiveLimitLabel: string;
  /** null = unlimited; otherwise remaining tournament slots. */
  slotsLeft: number | null;
}

export function CreateTournamentForm({ limits }: { limits: CreateFormLimits }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<Scheme>("merge");
  const [groupSize, setGroupSize] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [segmentTitles, setSegmentTitles] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [splitFolders, setSplitFolders] = useState(false);
  useEffect(() => {
    setFolders([]);
    setSplitFolders(false);
    setInspectError("");
    setInspecting(false);
    if (files.length !== 1) return;
    const abort = new AbortController();
    setInspecting(true);
    const body = new FormData();
    body.append("file", files[0]);
    void fetch("/api/tournaments/inspect", {
      method: "POST",
      body,
      signal: abort.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw Error(data.error ?? "Не удалось прочитать папки");
        return data;
      })
      .then((data) => {
        setFolders(data.folders ?? []);
        setSplitFolders((data.folders ?? []).length > 1);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setInspectError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setInspecting(false);
      });
    return () => abort.abort();
  }, [files]);
  const slotFull = limits.slotsLeft !== null && limits.slotsLeft <= 0;

  // The archive is not parsed yet, so the exact screen count is unknown here —
  // two reference field sizes make the trade-off concrete, and the real number
  // shows on the first comparison screen.
  const groupsAllowed = createEngine(scheme).maxGroupSize > 2;
  const effectiveSize = groupsAllowed ? groupSize : 2;
  const estimate = [30, 200]
    .map(
      (n) =>
        `${n} треков — ~${plannedScreens(scheme, n, effectiveSize)} экранов`,
    )
    .join(", ");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = new FormData(e.currentTarget);
      body.set("segmentTitles", JSON.stringify(segmentTitles));
      body.set("splitFolders", String(splitFolders));
      const res = await fetch("/api/tournaments", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      router.push(`/tournaments/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (slotFull) {
    return (
      <div className="panel">
        <h2>Новый топ</h2>
        <p className="muted">
          Достигнут лимит архивов для вашей роли. Удалите существующий в{" "}
          <a href="/account">личном кабинете</a>, чтобы загрузить новый.
        </p>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>Новый топ</h2>
      <label>Название</label>
      <input name="title" placeholder="Лучшие OST 2024" required />

      <label>Схема турнира</label>
      <select
        name="scheme"
        value={scheme}
        onChange={(e) => setScheme(e.target.value as Scheme)}
      >
        <option value="merge">
          Сравнительная сортировка (минимум сравнений)
        </option>
        <option value="swiss">Швейцарка (быстрее, приблизительно)</option>
        <option value="round_robin">Круговая (все пары, точнее всего)</option>
      </select>

      <label>Сравнивать за раз</label>
      <select
        name="groupSize"
        value={effectiveSize}
        disabled={!groupsAllowed}
        onChange={(e) => setGroupSize(Number(e.target.value))}
      >
        {Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, i) => i + 2).map(
          (n) => (
            <option key={n} value={n}>
              {n === 2
                ? "2 — пара, «что лучше»"
                : `${n} — расставить по местам`}
            </option>
          ),
        )}
      </select>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        {groupsAllowed ? (
          <>
            Ранжирование группы даёт больше информации за одно прослушивание:{" "}
            {estimate}. Размер можно менять по ходу турнира. Больше пяти треков
            за раз удержать в голове тяжело.
          </>
        ) : (
          <>
            Сравнительная сортировка спрашивает только парами — она и так
            работает на минимуме сравнений, и группы ей ничего не дают. Для
            групп выберите швейцарку или круговую.
          </>
        )}
      </p>

      <label className="row" style={{ gap: 8, marginTop: 14 }}>
        <input type="checkbox" name="blindMode" />
        <span>
          Слепой режим (скрывать названия — и видеоряд — во время сравнения)
        </span>
      </label>

      <label>ZIP-архивы с треками (аудио и/или видео)</label>
      <input
        name="file"
        type="file"
        accept=".zip,application/zip"
        multiple
        required
        onChange={(e) => {
          const next = Array.from(e.target.files ?? []);
          setFiles(next);
          setSegmentTitles(next.map((f) => f.name.replace(/\.zip$/i, "")));
        }}
      />
      <p className="muted">
        Несколько архивов — отдельный сегмент для каждого. Один архив можно
        разделить по папкам или позже в редакторе.
      </p>
      {files.length > 1 ? (
        <div className="archive-segments">
          <h3>Сегменты из архивов</h3>
          {files.map((f, i) => (
            <label key={`${f.name}:${i}`}>
              {f.name}
              <input
                aria-label={`Название сегмента ${i + 1}`}
                value={segmentTitles[i] ?? ""}
                onChange={(e) =>
                  setSegmentTitles((old) =>
                    old.map((v, j) => (i === j ? e.target.value : v)),
                  )
                }
                required
              />
            </label>
          ))}
        </div>
      ) : null}
      {inspecting ? <p role="status">Проверяем папки архива…</p> : null}
      {inspectError ? (
        <p className="muted">
          {inspectError}. Можно создать турнир и разбить его в редакторе.
        </p>
      ) : null}
      {files.length === 1 && folders.length > 1 ? (
        <div className="folder-suggestion">
          <label className="row">
            <input
              type="checkbox"
              checked={splitFolders}
              onChange={(e) => setSplitFolders(e.target.checked)}
            />
            Разбить по папкам — {folders.length}{" "}
            {pluralRu(folders.length, ["сегмент", "сегмента", "сегментов"])}
          </label>
          <p className="muted">{folders.join(" · ")}</p>
        </div>
      ) : null}

      <details className="hint-details">
        <summary>Как подготовить архив</summary>
        <ul>
          <li>
            Один или несколько ZIP-архивов, внутри — файлы треков (можно во
            вложенных папках). Минимум 2 файла, общий лимит архивов —{" "}
            {limits.archiveLimitLabel}
            {limits.slotsLeft !== null
              ? "; одновременно можно держать один турнир"
              : ""}
            .
          </li>
          <li>
            <b>Аудио:</b> mp3, m4a, aac, flac, wav, ogg, opus. Название и
            исполнитель берутся из тегов (ID3), иначе — из имени файла.
          </li>
          <li>
            <b>Видео:</b> mp4, webm, mov. Рекомендуем MP4 (H.264 + AAC) — он
            гарантированно играет в браузере и в рендере. Название — из имени
            файла. Видео без звука тоже допустимо.
          </li>
          <li>
            Аудио и видео можно смешивать в одном архиве — такие треки будут
            сравниваться друг с другом наравне.
          </li>
          <li>
            В слепом режиме видеоряд скрывается: видео-трек играет как аудио,
            пока не нажмёте «Показать названия».
          </li>
          <li>
            Громкость не нормализуется: если звук видео заметно тише/громче
            музыки, это будет слышно и в сравнении, и в рендере.
          </li>
        </ul>
      </details>

      {error ? <div className="error">{error}</div> : null}
      <button
        className="btn"
        type="submit"
        disabled={busy || inspecting}
        style={{ marginTop: 18 }}
      >
        {busy ? "Загрузка…" : "Создать турнир"}
      </button>
    </form>
  );
}
