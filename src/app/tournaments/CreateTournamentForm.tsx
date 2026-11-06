"use client";

import { useEffect, useState } from "react";
import { pluralRu } from "@/lib/domain/art-usage";
import { useRouter } from "next/navigation";
import { ParticipantSources } from "./ParticipantSources";
import { draftSources, shikimoriCount, type DraftItem } from "./participant-draft";

export interface CreateFormLimits {
  /** Human-readable archive size cap, e.g. "100 МБ". */
  archiveLimitLabel: string;
  /** null = unlimited; otherwise remaining tournament slots. */
  slotsLeft: number | null;
}

const isZip = (f: File) => /\.zip$/i.test(f.name);
const MAX_SHIKIMORI = 300;

/**
 * Task 33: a tournament is made of participants from archives, files, the pool
 * and Shikimori. The algorithm is not chosen here: the person picks it on the
 * tournament page, seeing the real field size and the screen estimate (P15).
 */
export function CreateTournamentForm({ limits }: { limits: CreateFormLimits }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [splitByTitle, setSplitByTitle] = useState(false);
  const [segmentTitles, setSegmentTitles] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [archiveKind, setArchiveKind] = useState<"media" | "images" | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [splitFolders, setSplitFolders] = useState(false);
  const zips = files.filter(isZip);
  const zipKey = zips.map((f) => `${f.name}:${f.size}`).join("|");

  useEffect(() => {
    setSegmentTitles(zips.map((f) => f.name.replace(/\.zip$/i, "")));
    setFolders([]);
    setArchiveKind(null);
    setSplitFolders(false);
    setInspectError("");
    setInspecting(false);
    if (zips.length !== 1) return;
    const abort = new AbortController();
    setInspecting(true);
    const body = new FormData();
    body.append("file", zips[0]);
    void fetch("/api/tournaments/inspect", { method: "POST", body, signal: abort.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw Error(data.error ?? "Не удалось прочитать папки");
        return data;
      })
      .then((data) => {
        setFolders(data.folders ?? []);
        setArchiveKind(data.kind ?? null);
        setSplitFolders((data.folders ?? []).length > 1);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setInspectError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setInspecting(false);
      });
    return () => abort.abort();
    // zipKey stands for the archive list; the File objects themselves change identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipKey]);

  const slotFull = limits.slotsLeft !== null && limits.slotsLeft <= 0;
  const sources = draftSources(draft, splitByTitle);
  const tooManyShikimori = shikimoriCount(sources) > MAX_SHIKIMORI;
  const empty = !files.length && !sources.length;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = e.currentTarget;
      const body = new FormData();
      body.set("title", String(new FormData(form).get("title") ?? ""));
      if ((form.elements.namedItem("blindMode") as HTMLInputElement | null)?.checked) body.set("blindMode", "on");
      for (const f of files) body.append("file", f);
      body.set("segmentTitles", JSON.stringify(segmentTitles));
      body.set("splitFolders", String(splitFolders));
      body.set("sources", JSON.stringify(sources));
      // Pictures are quick to judge: four on a screen; tracks keep the old three.
      const pictures =
        sources.length > 0 ||
        archiveKind === "images" ||
        (files.length > 0 && files.every((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)));
      body.set("groupSize", String(pictures ? 4 : 3));
      const res = await fetch("/api/tournaments", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      router.push(`/tournaments/${data.id}${skipped ? `?skipped=${skipped}` : ""}`);
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
      <input name="title" placeholder="Лучшие персонажи Umineko" required />

      <label className="row" style={{ gap: 8, marginTop: 14 }}>
        <input type="checkbox" name="blindMode" />
        <span>Слепой режим: прятать названия (и видеоряд) во время сравнения</span>
      </label>

      <label>Участники</label>
      <ParticipantSources
        draft={draft}
        onDraft={setDraft}
        files={files}
        onFiles={setFiles}
        splitByTitle={splitByTitle}
        onSplitByTitle={setSplitByTitle}
      />

      {zips.length > 1 ? (
        <div className="archive-segments">
          <h3>Сегменты из архивов</h3>
          {zips.map((f, i) => (
            <label key={`${f.name}:${i}`}>
              {f.name}
              <input
                aria-label={`Название сегмента ${i + 1}`}
                value={segmentTitles[i] ?? ""}
                onChange={(e) => setSegmentTitles((old) => old.map((v, j) => (i === j ? e.target.value : v)))}
                required
              />
            </label>
          ))}
        </div>
      ) : null}
      {inspecting ? <p role="status">Проверяем папки архива…</p> : null}
      {inspectError ? <p className="muted">{inspectError}. Можно создать турнир и разбить его в редакторе.</p> : null}
      {zips.length === 1 && archiveKind === "images" ? (
        <p className="muted">Архив картинок: каждая картинка станет участником, имя — по файлу.</p>
      ) : null}
      {zips.length === 1 && folders.length > 1 ? (
        <div className="folder-suggestion">
          <label className="row">
            <input type="checkbox" checked={splitFolders} onChange={(e) => setSplitFolders(e.target.checked)} />
            Разбить по папкам — {folders.length} {pluralRu(folders.length, ["сегмент", "сегмента", "сегментов"])}
          </label>
          <p className="muted">{folders.join(" · ")}</p>
        </div>
      ) : null}

      <details className="hint-details">
        <summary>Что можно загрузить</summary>
        <ul>
          <li>
            <b>Картинки:</b> png, jpg, webp, gif до 32 МБ — отдельными файлами, архивом, из пула или
            Shikimori. На экране сравнения они идут без звука.
          </li>
          <li>
            <b>Аудио:</b> mp3, m4a, aac, flac, wav, ogg, opus. Название и исполнитель — из тегов, иначе из
            имени файла. <b>Видео:</b> mp4, webm, mov (лучше MP4 H.264 + AAC).
          </li>
          <li>
            Несколько архивов — отдельный сегмент для каждого; один архив можно разбить по папкам.
            Общий лимит файлов — {limits.archiveLimitLabel}
            {limits.slotsLeft !== null ? "; одновременно можно держать один турнир" : ""}.
          </li>
          <li>
            Shikimori: у тайтла «+ главные персонажи» или «+ все персонажи», у персонажа «+ персонаж».
            Картинку, имя и ссылку сервер скачает сам при создании, до {MAX_SHIKIMORI} за раз.
          </li>
          <li>Алгоритм сравнения выбирается на странице турнира: там видна оценка экранов.</li>
        </ul>
      </details>

      {tooManyShikimori ? (
        <p className="error">
          Из Shikimori за раз — не больше {MAX_SHIKIMORI} участников. Остальных добавьте в «Составе» после
          создания.
        </p>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      <button
        className="btn"
        type="submit"
        disabled={busy || inspecting || empty || tooManyShikimori}
        style={{ marginTop: 18 }}
      >
        {busy ? (sources.some((s) => s.shikimori) ? "Скачиваем картинки…" : "Загрузка…") : "Создать турнир"}
      </button>
    </form>
  );
}
