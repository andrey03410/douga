"use client";
import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { readLoadedJobWindow } from "./job-feed";
import type { CompiledVideo } from "@/video";
import type { StudioJobView } from "@/server/studio/job-types";
import type { StudioProjectView } from "@/server/studio/types";
import { formatBytes } from "@/lib/domain/permissions";
import type { studioProjectMetadata } from "@/server/studio/queries";
import {
  acceptRemote,
  acceptActionResult,
  editBuffer,
  openBuffer,
  type EditorBuffer,
} from "./editor-state";
const Preview = dynamic(() => import("./StudioPreview"), {
  ssr: false,
  loading: () => <p>Загрузка Player…</p>,
});
type Metadata = ReturnType<typeof studioProjectMetadata>;
type History = {
  id: string;
  revision: number;
  reason: string;
  createdAt: string;
};
type Snapshot = {
  id: string;
  revision: number;
  jobs: number;
  createdAt: string;
};
type Preset = { id: string; name: string; personal: boolean; kind?: string };
type Asset = {
  id: string;
  label: string | null;
  kind: string;
  durationSec: number | null;
  sizeBytes: number | null;
};
type Page<T> = { items: T[]; nextCursor: string | null };
export async function studioRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/studio/${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? "Ошибка запроса");
  return value;
}
function metadata(p: StudioProjectView): Metadata {
  return {
    id: p.id,
    kind: p.kind,
    version: p.version,
    revision: p.revision,
    hasDraft: p.draft !== null,
    previewStale: p.previewStale,
    previewRevision: p.previewRevision,
    previewVersion: p.previewVersion,
    sourceVersion: p.sourceVersion,
    validation: {
      ready: p.validation.ready,
      errors: p.validation.diagnostics.filter((d) => d.severity === "error")
        .length,
      warnings: p.validation.diagnostics.filter((d) => d.severity === "warning")
        .length,
    },
  };
}
export function StudioWorkspace({
  initial,
  isAdmin,
}: {
  initial: Metadata;
  isAdmin: boolean;
}) {
  const id = initial.id,
    base = `projects/${id}`;
  const [meta, setMeta] = useState(initial),
    [buffer, setBuffer] = useState<EditorBuffer | null>(null),
    [validation, setValidation] = useState<
      StudioProjectView["validation"] | null
    >(null);
  const [preview, setPreview] = useState<{
    plan: CompiledVideo | null;
    previewVersion: number | null;
    previewRevision: number | null;
  } | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<Page<Snapshot> | null>(null);
  const [history, setHistory] = useState<Page<History> | null>(null),
    [historical, setHistorical] = useState<{
      revision: number;
      document: unknown;
      head: unknown;
    } | null>(null);
  const [presets, setPresets] = useState<Page<Preset> | null>(null),
    [presetName, setPresetName] = useState(""),
    [presetCode, setPresetCode] = useState<unknown>(null);
  const [assets, setAssets] = useState<Page<Asset> | null>(null),
    [assetQuery, setAssetQuery] = useState(""),
    [inspected, setInspected] = useState<Asset | null>(null),
    [assetInfo, setAssetInfo] = useState<unknown>(null);
  const [jobs, setJobs] = useState<Page<StudioJobView>>({
      items: [],
      nextCursor: null,
    });
  const [publication, setPublication] = useState<{
    token: string;
    revision: number;
    bytes: number;
  } | null>(null);
  const [exportInfo, setExportInfo] = useState<{
    bytes: number;
    warning: boolean;
  } | null>(null);
  const [exportNote, setExportNote] = useState("");
  const [result, setResult] = useState<StudioJobView | null>(null);
  const [fromFrame, setFromFrame] = useState(0),
    [durationFrames, setDurationFrames] = useState(90);
  const jobWindowCount = useRef(20);
  async function readJobs() {
    return readLoadedJobWindow(
      ({ limit, cursor }) =>
        studioRequest(
          `${base}/jobs?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      jobWindowCount.current,
    );
  }
  const editor = useRef<HTMLTextAreaElement>(null);
  const editorOpen = buffer !== null;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message === "VERSION_CONFLICT"
          ? "Конфликт версий. Ваш текст сохранён в редакторе. Откройте серверную версию для сравнения или явно загрузите её."
          : message,
      );
      if (message === "VERSION_CONFLICT")
        setBuffer((b) => (b ? { ...b, conflict: true } : b));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await studioRequest<{
          token: string;
          revision: number;
          bytes: number;
        }>(`${base}/publication`);
        if (!cancelled) setPublication(row);
      } catch (e) {
        if (!cancelled && (e as Error).message === "NOT_FOUND")
          setPublication(null);
      }
      try {
        const estimate = await studioRequest<{
          bytes: number;
          warning: boolean;
        }>(`${base}/export.html?estimate=1`);
        if (!cancelled) {
          setExportInfo(estimate);
          setExportNote("");
        }
      } catch (e) {
        if (!cancelled) setExportNote((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, meta.revision]);
  useEffect(() => {
    if (busy) return;
    let active = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [p, j] = await Promise.all([
          studioRequest<StudioProjectView | Metadata>(
            `${base}${editorOpen ? "?content=code" : ""}`,
          ),
          readJobs(),
        ]);
        if (!active) return;
        const m = "document" in p ? metadata(p) : p;
        setMeta((old) => (m.version >= old.version ? m : old));
        setJobs(j);
        if ("document" in p) {
          setBuffer((b) => (b ? acceptRemote(b, p) : b));
          setValidation(p.validation);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(poll, 4000);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, editorOpen, busy]);
  useEffect(() => {
    if (!buffer?.dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [buffer?.dirty]);
  function applyProject(p: StudioProjectView) {
    setMeta(metadata(p));
    setValidation(p.validation);
    setBuffer((b) => acceptActionResult(b, p));
  }
  async function loadEditor() {
    const p = await studioRequest<StudioProjectView>(`${base}?content=code`);
    setMeta(metadata(p));
    setBuffer(openBuffer(p));
    setValidation(p.validation);
  }
  async function save() {
    if (!buffer) return;
    const submitted = buffer;
    const p = await studioRequest<StudioProjectView>(`${base}/draft`, "PUT", {
      expectedVersion: submitted.baseVersion,
      text: submitted.text,
      idempotencyKey: crypto.randomUUID(),
    });
    setMeta(metadata(p));
    setValidation(p.validation);
    setBuffer((current) =>
      current?.text === submitted.text
        ? openBuffer(p)
        : current
          ? { ...current, baseVersion: p.version, conflict: false }
          : null,
    );
    setNotice(
      p.validation.ready
        ? "Черновик сохранён и проверен. Можно зафиксировать версию."
        : "Черновик сохранён. Исправьте диагностику перед фиксацией или рендером.",
    );
  }
  async function revealPreview() {
    const p = await studioRequest<Metadata & { plan: CompiledVideo | null }>(
      `${base}?content=preview`,
    );
    setMeta(p);
    setPreview({
      plan: p.plan,
      previewVersion: p.previewVersion,
      previewRevision: p.previewRevision,
    });
  }
  async function loadSnapshots(cursor?: string) {
    const p = await studioRequest<Page<Snapshot>>(
      `${base}/snapshots${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setSnapshots((old) =>
      cursor && old ? { ...p, items: [...old.items, ...p.items] } : p,
    );
  }
  async function reloadHistory(cursor?: string) {
    if (!cursor) await loadSnapshots();
    const p = await studioRequest<Page<History>>(
      `${base}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setHistory((old) =>
      cursor && old ? { ...p, items: [...old.items, ...p.items] } : p,
    );
  }
  async function loadPresets(cursor?: string) {
    const p = await studioRequest<Page<Preset>>(
      `presets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setPresets((old) =>
      cursor && old ? { ...p, items: [...old.items, ...p.items] } : p,
    );
  }
  async function loadAssets(cursor?: string) {
    const p = await studioRequest<Page<Asset>>(
      `assets?q=${encodeURIComponent(assetQuery)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setAssets((old) =>
      cursor && old ? { ...p, items: [...old.items, ...p.items] } : p,
    );
  }
  const unsafe = busy || !!buffer?.dirty || !!buffer?.conflict;
  function focusDiagnostic(path?: string, nodeId?: string) {
    const el = editor.current;
    if (!el) return;
    const needle = nodeId
      ? JSON.stringify(nodeId)
      : JSON.stringify(path?.split(".").at(-1) ?? "");
    const at = el.value.indexOf(needle);
    el.focus();
    if (at >= 0) {
      el.setSelectionRange(at, at + needle.length);
      const line = el.value.slice(0, at).split("\n").length;
      el.scrollTop = Math.max(0, (line - 5) * 22);
    }
  }
  return (
    <>
      <a href="/projects">← Мои видео</a>
      <h1 style={{ marginTop: 16 }}>
        SDK · {meta.kind === "top" ? "Топ" : "Пикер"}
      </h1>
      <p className="muted">
        Проект <code>{id}</code>. Код, ответы, медиа и звук скрыты до вашего
        действия.
      </p>
      <section className="panel" aria-label="Статус проекта">
        <div className="studio-status">
          <div>
            <small>Версия редактирования</small>v{meta.version}
          </div>
          <div>
            <small>Сохранённая ревизия</small>r{meta.revision}
          </div>
          <div>
            <small>Проверка</small>
            {meta.validation.ready
              ? "Готово"
              : `Ошибок: ${meta.validation.errors}`}
          </div>
          <div>
            <small>Черновик</small>
            {meta.hasDraft ? "Сохранён" : "Нет"}
          </div>
        </div>
        <div className="studio-toolbar">
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(loadEditor)}
          >
            {editorOpen ? "Загрузить серверную версию" : "Открыть SDK"}
          </button>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => void run(revealPreview)}
          >
            Показать превью
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => void run(() => reloadHistory())}
          >
            История и различия
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => void run(() => loadPresets())}
          >
            Каталог пресетов
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => void run(() => loadAssets())}
          >
            Открыть медиа
          </button>
        </div>
        {buffer?.dirty ? (
          <p className="studio-notice">
            Есть несохранённый текст. «Загрузить серверную версию» заменит его.
            Для слияния сначала откройте сравнение с сервером ниже.
          </p>
        ) : null}
      </section>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="studio-notice" role="status">
          {notice}
        </p>
      ) : null}
      {buffer ? (
        <section className="panel">
          <h2>Канонический JSON</h2>
          <p className="muted">
            База редактора v{buffer.baseVersion} ·{" "}
            {buffer.dirty ? "есть локальные изменения" : "текст сохранён"}.
            Сохранение проверяет JSON и медиа; фиксация добавляет ревизию
            истории.
          </p>
          {buffer.conflict ? (
            <p className="error">
              На сервере появилась другая версия. Локальный текст и старый
              CAS-токен сохранены. Скопируйте нужные изменения, загрузите
              серверную версию и объедините код.
            </p>
          ) : null}
          <label htmlFor="studio-json">Документ VideoDocument</label>
          <textarea
            ref={editor}
            id="studio-json"
            className="studio-editor"
            spellCheck={false}
            value={buffer.text}
            onChange={(e) =>
              setBuffer((b) => (b ? editBuffer(b, e.target.value) : b))
            }
          />
          <div className="studio-toolbar">
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(save)}
            >
              Сохранить и проверить
            </button>
            <button
              className="btn secondary"
              disabled={unsafe || !meta.validation.ready || !meta.hasDraft}
              onClick={() =>
                void run(async () => {
                  applyProject(
                    await studioRequest(`${base}/commit`, "POST", {
                      expectedVersion: buffer.baseVersion,
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  );
                  setNotice("Ревизия зафиксирована.");
                  if (history) await reloadHistory();
                })
              }
            >
              Зафиксировать ревизию
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = await studioRequest<StudioProjectView>(
                    `${base}?content=code`,
                  );
                  setHistorical({
                    revision: p.revision,
                    document: p.draft?.document ?? p.document,
                    head: tryJson(buffer.text),
                  });
                })
              }
            >
              Сравнить с сервером
            </button>
            <button
              className="btn ghost"
              disabled={buffer.dirty || busy}
              onClick={() => {
                setBuffer(null);
                setValidation(null);
              }}
            >
              Скрыть SDK
            </button>
          </div>
          {buffer.dirty ? (
            <p className="muted">
              Диагностика ниже относится к последнему сохранению; локальные
              изменения ещё не проверены.
            </p>
          ) : null}
          {validation ? (
            <div aria-label="Диагностика">
              {validation.diagnostics.length === 0 ? (
                <p>Ошибок не найдено.</p>
              ) : (
                <ul>
                  {validation.diagnostics.map((d, i) => (
                    <li
                      key={i}
                      className={
                        d.severity === "error" ? "studio-error" : "muted"
                      }
                    >
                      <button
                        className="btn ghost"
                        onClick={() => focusDiagnostic(d.path, d.nodeId)}
                      >
                        {d.nodeId ?? d.path ?? "Документ"}
                      </button>{" "}
                      {d.code}: {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
      {preview ? (
        <section className="panel">
          <div className="studio-toolbar">
            <h2>Превью</h2>
            <button className="btn ghost" onClick={() => setPreview(null)}>
              Скрыть превью
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void run(revealPreview)}
            >
              Обновить превью
            </button>
          </div>
          <p className="studio-notice">
            Источник: v{preview.previewVersion ?? "—"},{" "}
            {preview.previewRevision === null
              ? "сохранённый черновик"
              : `ревизия r${preview.previewRevision}`}
            .
            {buffer?.dirty || preview.previewVersion !== meta.version
              ? " Это последнее корректное превью; текущий код отличается или содержит ошибки."
              : " Соответствует последнему сохранённому коду."}
          </p>
          {preview.plan ? (
            <Preview plan={preview.plan} />
          ) : (
            <p>
              Корректное превью пока отсутствует. Откройте SDK и исправьте
              диагностику.
            </p>
          )}
        </section>
      ) : null}
      {history ? (
        <section className="panel">
          <div className="studio-toolbar">
            <h2>История</h2>
            <button
              className="btn ghost"
              onClick={() => {
                setHistory(null);
                setHistorical(null);
              }}
            >
              Скрыть историю
            </button>
          </div>
          <ul className="studio-list">
            {history.items.map((r) => (
              <li key={r.id}>
                <b>r{r.revision}</b> · {r.reason} ·{" "}
                {new Date(r.createdAt).toLocaleString("ru-RU")}
                <div className="studio-toolbar">
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const [saved, p] = await Promise.all([
                          studioRequest<{ document: unknown }>(
                            `${base}/history/${r.revision}`,
                          ),
                          studioRequest<StudioProjectView>(
                            `${base}?content=code`,
                          ),
                        ]);
                        setHistorical({
                          revision: r.revision,
                          document: saved.document,
                          head: buffer
                            ? tryJson(buffer.text)
                            : (p.draft?.document ?? p.document),
                        });
                      })
                    }
                  >
                    Показать JSON и различия r{r.revision}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={unsafe}
                    onClick={() =>
                      void run(async () => {
                        applyProject(
                          await studioRequest(`${base}/restore`, "POST", {
                            expectedVersion:
                              buffer?.baseVersion ?? meta.version,
                            revision: r.revision,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        );
                        await reloadHistory();
                        setNotice(
                          "Создана новая ревизия из истории с актуальным источником.",
                        );
                      })
                    }
                  >
                    Восстановить r{r.revision}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={unsafe}
                    onClick={() =>
                      void run(async () => {
                        await studioRequest(
                          `${base}/history/${r.revision}`,
                          "DELETE",
                          {
                            expectedVersion:
                              buffer?.baseVersion ?? meta.version,
                          },
                        );
                        await reloadHistory();
                      })
                    }
                  >
                    Удалить r{r.revision}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <h3>Замороженные снимки</h3>
          <p className="muted">
            Снимки удерживают ревизии для неизменяемых заданий. Сначала удалите
            связанные задания, затем освободите ненужный снимок.
          </p>
          <ul className="studio-list">
            {snapshots?.items.map((s) => (
              <li key={s.id}>
                r{s.revision} · заданий: {s.jobs} · <code>{s.id}</code>
                <button
                  className="btn ghost"
                  disabled={busy || s.jobs > 0}
                  onClick={() =>
                    void run(async () => {
                      await studioRequest(`snapshots/${s.id}`, "DELETE");
                      await loadSnapshots();
                    })
                  }
                >
                  Освободить снимок
                </button>
              </li>
            ))}
          </ul>
          {snapshots?.nextCursor ? (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run(() => loadSnapshots(snapshots.nextCursor!))
              }
            >
              Ещё снимки
            </button>
          ) : null}
          {history.nextCursor ? (
            <button
              className="btn ghost"
              onClick={() => void run(() => reloadHistory(history.nextCursor!))}
            >
              Ещё ревизии
            </button>
          ) : null}
        </section>
      ) : null}
      {historical ? (
        <section className="panel">
          <div className="studio-toolbar">
            <h2>JSON / сравнение r{historical.revision}</h2>
            <button className="btn ghost" onClick={() => setHistorical(null)}>
              Закрыть сравнение
            </button>
          </div>
          <p className="muted">
            Слева выбранная версия сервера/истории, справа текущий текст
            редактора или сохранённый документ. Сравнение не изменяет редактор.
          </p>
          <JsonDiff before={historical.document} after={historical.head} />
          <details>
            <summary>Полный JSON выбранной версии</summary>
            <pre className="studio-code">
              {JSON.stringify(historical.document, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}
      {presets ? (
        <section className="panel">
          <div className="studio-toolbar">
            <h2>Пресеты</h2>
            <button
              className="btn ghost"
              onClick={() => {
                setPresets(null);
                setPresetCode(null);
              }}
            >
              Скрыть пресеты
            </button>
          </div>
          <p className="muted">
            Пресет хранит оформление и абстрактные слоты. Медиа, участники,
            вопросы и ответы в личный пресет не попадают.
          </p>
          <ul className="studio-list">
            {presets.items.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b> · {p.personal ? "личный" : "встроенный"}
                <div className="studio-toolbar">
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setPresetCode(await studioRequest(`presets/${p.id}`));
                      })
                    }
                  >
                    Показать код пресета
                  </button>
                  <button
                    className="btn ghost"
                    disabled={unsafe}
                    onClick={() =>
                      void run(async () => {
                        applyProject(
                          await studioRequest(`${base}/preset`, "POST", {
                            expectedVersion:
                              buffer?.baseVersion ?? meta.version,
                            presetId: p.id,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        );
                        setNotice(
                          "Пресет применён к черновику. Проверьте и зафиксируйте ревизию.",
                        );
                      })
                    }
                  >
                    Применить пресет
                  </button>
                  <button
                    className="btn ghost"
                    disabled={unsafe}
                    onClick={() =>
                      void run(async () => {
                        const created = await studioRequest<{ id: string }>(
                          "projects",
                          "POST",
                          {
                            presetId: p.id,
                            idempotencyKey: crypto.randomUUID(),
                          },
                        );
                        window.location.assign(`/studio/${created.id}`);
                      })
                    }
                  >
                    Новый проект с пресетом
                  </button>
                  {p.personal ? (
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await studioRequest(`presets/${p.id}`, "DELETE");
                          await loadPresets();
                        })
                      }
                    >
                      Удалить пресет
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {presets.nextCursor ? (
            <button
              className="btn ghost"
              onClick={() => void run(() => loadPresets(presets.nextCursor!))}
            >
              Ещё пресеты
            </button>
          ) : null}
          {presetCode ? (
            <pre className="studio-code">
              {JSON.stringify(presetCode, null, 2)}
            </pre>
          ) : null}
          <label htmlFor="preset-name">Название личного пресета</label>
          <input
            id="preset-name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            maxLength={200}
          />
          <button
            className="btn secondary"
            disabled={busy || !buffer || !presetName.trim()}
            onClick={() =>
              void run(async () => {
                await studioRequest("presets", "POST", {
                  name: presetName,
                  document: JSON.parse(buffer!.text),
                  idempotencyKey: crypto.randomUUID(),
                });
                await loadPresets();
                setNotice("Личный пресет сохранён без привязок к контенту.");
              })
            }
          >
            Сохранить оформление из SDK
          </button>
        </section>
      ) : null}
      {assets ? (
        <section className="panel">
          <div className="studio-toolbar">
            <h2>Медиа</h2>
            <button
              className="btn ghost"
              onClick={() => {
                setAssets(null);
                setInspected(null);
                setAssetInfo(null);
              }}
            >
              Скрыть медиа
            </button>
          </div>
          <a href="/account">Загрузить файлы в личном кабинете →</a>
          <label htmlFor="asset-search">Поиск в пуле</label>
          <input
            id="asset-search"
            value={assetQuery}
            onChange={(e) => setAssetQuery(e.target.value)}
          />
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => void run(() => loadAssets())}
          >
            Найти медиа
          </button>
          <ul className="studio-list">
            {assets.items.map((a) => (
              <li key={a.id}>
                <b>{a.label ?? a.id}</b> · {a.kind} · {a.durationSec ?? "—"} с{" "}
                <code>{a.id}</code>
                <div className="studio-toolbar">
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setAssetInfo(await studioRequest(`assets/${a.id}`));
                        setInspected(a);
                      })
                    }
                  >
                    Осмотреть медиа
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(
                          JSON.stringify(
                            { kind: "pool", assetId: a.id },
                            null,
                            2,
                          ),
                        );
                        setNotice(
                          "Привязка скопирована. Вставьте её в bindings JSON-документа.",
                        );
                      })
                    }
                  >
                    Копировать привязку
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {assets.nextCursor ? (
            <button
              className="btn ghost"
              onClick={() => void run(() => loadAssets(assets.nextCursor!))}
            >
              Ещё медиа
            </button>
          ) : null}
          {inspected ? (
            <div>
              <h3>{inspected.label ?? inspected.id}</h3>
              {inspected.kind === "image" ? (
                <img
                  alt={inspected.label ?? "Медиа из пула"}
                  src={`/api/arts/${inspected.id}`}
                  style={{ maxWidth: "100%", maxHeight: 400 }}
                />
              ) : inspected.kind === "audio" ? (
                <audio controls src={`/api/arts/${inspected.id}`} />
              ) : (
                <video
                  controls
                  preload="metadata"
                  src={`/api/arts/${inspected.id}`}
                  style={{ width: "100%", maxHeight: 400 }}
                />
              )}
              <pre className="studio-code">
                {JSON.stringify(assetInfo, null, 2)}
              </pre>
              <button
                className="btn ghost"
                onClick={() => {
                  setInspected(null);
                  setAssetInfo(null);
                }}
              >
                Закрыть медиа
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="panel">
        <h2>Задания</h2>
        <p className="muted">
          Устойчивая очередь. Каждое задание закрепляет свою ревизию. Для
          выполнения нужен отдельный <code>npm run studio:worker</code>.
        </p>
        <div className="studio-toolbar">
          <h3 style={{ margin: 0 }}>Ролик без рендера</h3>
        </div>
        {buffer?.dirty || buffer?.conflict || meta.hasDraft ? (
          <p className="muted">
            Несохранённые правки в ролик не попадут. Публикуется последняя
            сохранённая ревизия.
          </p>
        ) : null}
        <div className="studio-toolbar">
          {publication ? (
            <>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const url = `${window.location.origin}/watch/${publication.token}`;
                    await navigator.clipboard.writeText(url);
                    setNotice("Ссылка скопирована");
                  })
                }
              >
                Копировать ссылку
              </button>
              <a
                className="btn ghost"
                href={`/watch/${publication.token}`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть
              </a>
              {publication.revision < meta.revision ? (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const row = await studioRequest<{
                        token: string;
                        revision: number;
                        bytes: number;
                      }>(`${base}/publication`, "POST", {
                        expectedVersion: meta.version,
                        idempotencyKey: crypto.randomUUID(),
                      });
                      setPublication(row);
                      setNotice("Публикация обновлена");
                    })
                  }
                >
                  Обновить публикацию
                </button>
              ) : null}
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await studioRequest(`${base}/publication`, "DELETE", {
                      idempotencyKey: crypto.randomUUID(),
                    });
                    setPublication(null);
                    setNotice("Ролик снят с публикации");
                  })
                }
              >
                Снять с публикации
              </button>
            </>
          ) : (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const row = await studioRequest<{
                    token: string;
                    revision: number;
                    bytes: number;
                  }>(`${base}/publication`, "POST", {
                    expectedVersion: meta.version,
                    idempotencyKey: crypto.randomUUID(),
                  });
                  setPublication(row);
                  setNotice("Ссылка готова");
                })
              }
            >
              Опубликовать
            </button>
          )}
          {exportInfo ? (
            <a className="btn" href={`/api/studio/${base}/export.html`}>
              Скачать .html · {formatBytes(exportInfo.bytes)}
              {exportInfo.warning ? " · большой файл" : ""}
            </a>
          ) : (
            <span className="muted">
              {exportNote || "Считаем размер .html…"}
            </span>
          )}
        </div>
        {publication ? (
          <p className="muted">
            /watch/{publication.token} · ревизия {publication.revision}
          </p>
        ) : null}
        <details>
          <summary>Создать задание из сохранённого кода</summary>
          <p className="muted">
            Сначала сохраните локальные изменения. Задание фиксирует корректный
            черновик; финальный рендер доступен администратору.
          </p>
          <div className="studio-toolbar">
            <label>
              Начальный кадр
              <input
                type="number"
                min={0}
                step={1}
                value={fromFrame}
                onChange={(e) => setFromFrame(Number(e.target.value))}
              />
            </label>
            <label>
              Длительность в кадрах
              <input
                type="number"
                min={1}
                step={1}
                value={durationFrames}
                onChange={(e) => setDurationFrames(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="studio-toolbar">
            {(["still", "clip", "audio", "render"] as const).map((kind) => (
              <button
                key={kind}
                className="btn secondary"
                disabled={
                  unsafe ||
                  !meta.validation.ready ||
                  (kind === "render" && !isAdmin)
                }
                onClick={() =>
                  void run(async () => {
                    await studioRequest(`${base}/jobs`, "POST", {
                      kind,
                      expectedVersion: buffer?.baseVersion ?? meta.version,
                      idempotencyKey: crypto.randomUUID(),
                      ...(kind === "still"
                        ? { frame: fromFrame }
                        : kind !== "render"
                          ? { fromFrame, durationFrames }
                          : {}),
                    });
                    setJobs(await readJobs());
                    const p = await studioRequest<StudioProjectView>(
                      `${base}?content=code`,
                    );
                    applyProject(p);
                    setNotice(
                      "Задание поставлено в очередь. Запустите worker отдельно.",
                    );
                  })
                }
              >
                {
                  {
                    still: "Кадр PNG",
                    clip: "Фрагмент MP4",
                    audio: "Аудиофрагмент",
                    render: "Финальный MP4",
                  }[kind]
                }
              </button>
            ))}
          </div>
        </details>
        <ul className="studio-list">
          {jobs.items.length === 0 ? (
            <li className="muted">Заданий пока нет.</li>
          ) : (
            jobs.items.map((j) => (
              <li key={j.id}>
                <b>{j.kind}</b> · r{j.revision ?? "—"} · {j.status} ·{" "}
                {Math.round(j.progress * 100)}%{" "}
                <small className="muted">{j.id}</small>
                {j.error ? <p className="error">{j.error}</p> : null}
                <div className="studio-toolbar">
                  {["queued", "running"].includes(j.status) ? (
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await studioRequest(`jobs/${j.id}/cancel`, "POST");
                          setJobs(await readJobs());
                        })
                      }
                    >
                      Отменить задание
                    </button>
                  ) : (
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await studioRequest(`jobs/${j.id}`, "DELETE");
                          setJobs(await readJobs());
                          if (result?.id === j.id) setResult(null);
                        })
                      }
                    >
                      Удалить задание
                    </button>
                  )}
                  {j.status === "done" ? (
                    <>
                      <a
                        className="btn secondary"
                        href={`/api/studio/jobs/${j.id}/result?download=1`}
                      >
                        Скачать результат
                      </a>
                      <button
                        className="btn ghost"
                        onClick={() => setResult(j)}
                      >
                        Показать результат
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
        {jobs.nextCursor ? (
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                jobWindowCount.current += 20;
                setJobs(await readJobs());
              })
            }
          >
            Ещё задания
          </button>
        ) : null}
        {result ? (
          <div>
            <h3>Результат · r{result.revision}</h3>
            <button className="btn ghost" onClick={() => setResult(null)}>
              Скрыть результат
            </button>
            {result.kind === "still" ? (
              <img
                alt="Кадр результата"
                src={`/api/studio/jobs/${result.id}/result`}
                style={{ maxWidth: "100%", maxHeight: 550 }}
              />
            ) : result.kind === "audio" ? (
              <audio controls src={`/api/studio/jobs/${result.id}/result`} />
            ) : (
              <video
                controls
                preload="metadata"
                src={`/api/studio/jobs/${result.id}/result`}
                style={{ width: "100%", maxHeight: 550 }}
              />
            )}
          </div>
        ) : null}
      </section>
      <details className="panel">
        <summary>Удаление SDK-проекта</summary>
        <p className="muted">
          Удаление освобождает его историю и привязки медиа. Сначала отмените и
          удалите все задания проекта.
        </p>
        <button
          className="btn ghost"
          disabled={unsafe || jobs.items.length > 0}
          onClick={() => {
            if (
              window.confirm(
                "Удалить SDK-проект со всей историей? Действие необратимо.",
              )
            )
              void run(async () => {
                await studioRequest(base, "DELETE", {
                  expectedVersion: buffer?.baseVersion ?? meta.version,
                  idempotencyKey: crypto.randomUUID(),
                });
                window.location.assign("/projects");
              });
          }}
        >
          Удалить SDK-проект и историю
        </button>
      </details>
    </>
  );
}
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows: { path: string; before: unknown; after: unknown }[] = [];
  function visit(a: unknown, b: unknown, path: string) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      const left = a as Record<string, unknown>,
        right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        visit(left[key], right[key], `${path}/${key}`);
    } else rows.push({ path, before: a, after: b });
  }
  visit(before, after, "");
  return rows.length ? (
    <div style={{ overflowX: "auto" }}>
      <table className="studio-diff">
        <thead>
          <tr>
            <th>Путь</th>
            <th>Выбранная версия</th>
            <th>Текущий документ</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r) => (
            <tr key={r.path}>
              <td>{r.path || "/"}</td>
              <td>{JSON.stringify(r.before) ?? "отсутствует"}</td>
              <td>{JSON.stringify(r.after) ?? "отсутствует"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 ? (
        <p>Показаны первые 500 изменений. Полный JSON доступен ниже.</p>
      ) : null}
    </div>
  ) : (
    <p>Различий нет.</p>
  );
}
