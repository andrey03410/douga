"use client";
import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { AnyZodObject } from "zod";
import { StudioVideo } from "@douga/render/StudioVideo";
import { sharedAudioTagCount } from "@douga/player/model";
import type { CompiledVideo } from "@douga/video";
import type { StoryboardTile } from "@douga/video/storyboard";
import type { StudioJobView } from "@/server/studio/job-types";
import type { InspectionOrigin } from "@/server/studio/storyboard-types";
import type { reviewStudioVideo } from "@/server/studio/review";

type Report = Awaited<ReturnType<typeof reviewStudioVideo>>;
type PlanView = { origin: InspectionOrigin; plan: CompiledVideo };
type Tile = StoryboardTile & { side?: "before" | "after" | "diff"; missing?: boolean };
type Initial = { id: string; title: string; version: number; revision: number };
const active = (job: StudioJobView | null) =>
  !!job && ["queued", "running"].includes(job.status);
const statusText = {
  queued: "В очереди",
  running: "Собирается",
  done: "Готово",
  failed: "Ошибка рендера",
  canceled: "Отменено",
};
const time = (frame: number, fps: number) =>
  `${Math.floor(frame / fps / 60)}:${((frame / fps) % 60).toFixed(2).padStart(5, "0")}`;
const stateText = (state: string) =>
  (
    ({
      revealed: "Арт и подпись раскрыты",
      choice: "Выбор до ответа",
      answer: "Ответ",
      "board-state": "Состояние доски",
      composition: "Композиция",
      start: "Начало",
      end: "Конец",
      reveal: "Раскрытие",
      timer: "Таймер",
      "pixel-diff": "Пиксельные различия",
    }) as Record<string, string>
  )[state] ??
  (state.startsWith("transition")
    ? "Переход"
    : state.startsWith("motion:")
      ? "Движение элемента"
      : state.startsWith("visible:")
        ? "Появление элемента"
        : state.startsWith("board.")
          ? "Событие доски"
          : "Ключевое состояние");
const originText = (origin: InspectionOrigin) =>
  origin.revision !== null
    ? `Ревизия r${origin.revision}`
    : `Черновик v${origin.version}`;
const issueText: Record<string, string> = {
  TEXT_OVERFLOW:
    "Текст не помещается в отведённую область при минимальном читаемом размере.",
  TEXT_CLIPPED: "Часть текста обрезана выбранной политикой отображения.",
  TEXT_TRUNCATED: "Текст сокращён многоточием и виден не полностью.",
  FONT_GLYPH_MISSING: "В доступных шрифтах отсутствуют символы этой подписи.",
  TEXT_LAYOUT_REQUIRED: "Для проверки текста нужны измерения шрифта.",
  TEXT_MEASUREMENT_FAILED: "Не удалось измерить текст в этой сцене.",
};
const errorText: Record<string, string> = {
  VERSION_CONFLICT:
    "Проект изменился в другой вкладке. Обновите версию и повторите запрос.",
  REVIEW_STALE:
    "Замечания относятся к другой версии. Запустите проверку заново.",
  VALIDATION_FAILED:
    "Текущий документ не проходит проверку. Исправьте JSON или недостающие материалы в редакторе.",
  JOB_QUOTA_EXCEEDED:
    "Все доступные места в очереди заняты. Дождитесь результата или отмените ненужную задачу.",
  STORYBOARD_EMPTY:
    "В выбранном разделе нет кадров. Измените фильтр или страницу.",
};
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/studio/${path}`, {
    method,
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) {
    const details = Array.isArray(data.diagnostics)
      ? data.diagnostics
          .slice(0, 3)
          .map((d: { message: string }) => d.message)
          .join(" ")
      : "";
    throw new Error(
      `${errorText[data.error] ?? data.error ?? "Не удалось выполнить запрос"}${details ? ` ${details}` : ""}`,
    );
  }
  return data;
}
export default function StoryboardWorkspace({ initial }: { initial: Initial }) {
  const [version, setVersion] = useState(initial.version),
    [tab, setTab] = useState<"video" | "issues" | "compare">("video");
  const [planView, setPlanView] = useState<PlanView | null>(null),
    [job, setJob] = useState<StudioJobView | null>(null);
  const [report, setReport] = useState<Report | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [segment, setSegment] = useState(""),
    [scene, setScene] = useState(""),
    [pageSize, setPageSize] = useState(12);
  const [revision, setRevision] = useState(""),
    [compareRevision, setCompareRevision] = useState(String(initial.revision));
  const [baselineJob, setBaselineJob] = useState(""),
    [pixelDiff, setPixelDiff] = useState(false),
    [comparisonSource, setComparisonSource] = useState<"revision" | "job">(
      "revision",
    );
  const [busy, setBusy] = useState(false),
    [polling, setPolling] = useState(false),
    [pollNote, setPollNote] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draftBackupId, setDraftBackupId] = useState("");
  const player = useRef<PlayerRef>(null),
    playerSection = useRef<HTMLElement>(null),
    alive = useRef(true),
    requestOptions = useRef<Record<string, unknown> | null>(null),
    planRequest = useRef(0);
  const base = `projects/${encodeURIComponent(initial.id)}`,
    storageKey = `douga:storyboard:${initial.id}`;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function readPlan(targetVersion?: number, targetRevision?: number) {
    const serial = ++planRequest.current;
    const view = await request<PlanView>(
      `${base}/inspection-plan`,
      "POST",
      targetRevision
        ? { revision: targetRevision }
        : targetVersion
          ? { expectedVersion: targetVersion }
          : {},
    );
    if (alive.current && serial === planRequest.current) {
      setPlanView(view);
      if (view.origin.version !== null) setVersion(view.origin.version);
    }
    return view;
  }
  function acceptJob(value: StudioJobView, options?: Record<string, unknown>) {
    requestOptions.current = options ?? null;
    setJob(value);
    setPolling(active(value));
    setPollNote("");
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ id: value.id, options: options ?? null }),
      );
    } catch {
      /* Private browsing may disable storage. */
    }
  }
  useEffect(() => {
    alive.current = true;
    void readPlan(initial.version).catch((e) => {
      if (alive.current) setError(e.message);
    });
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storageKey);
      setDraftBackupId(sessionStorage.getItem(`${storageKey}:review-backup`) ?? "");
    } catch {
      /* Optional resume only. */
    }
    if (saved) {
      let remembered: { id: string; options?: Record<string, unknown> };
      try {
        remembered = JSON.parse(saved);
      } catch {
        remembered = { id: saved };
      }
      if (remembered && typeof remembered.id === "string")
        void request<StudioJobView>(`jobs/${encodeURIComponent(remembered.id)}`)
          .then((value) => {
            if (alive.current && value.projectId === initial.id)
              acceptJob(value, remembered.options);
          })
          .catch(() => {});
    }
    return () => {
      alive.current = false;
    };
    // The server-provided project identity is fixed for this mounted page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);
  useEffect(() => {
    if (!job || !active(job) || !polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      attempts = 0;
    const poll = async () => {
      try {
        const next = await request<StudioJobView>(
          `jobs/${encodeURIComponent(job.id)}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setJob(next);
        if (!active(next)) {
          setPolling(false);
          return;
        }
        attempts++;
        if (attempts >= 26) {
          setPolling(false);
          setPollNote(
            "Задача продолжает работать. Автопроверка приостановлена; продолжите её кнопкой ниже.",
          );
          return;
        }
        timer = setTimeout(
          () => void poll(),
          Math.min(5000, 1000 * 1.5 ** attempts),
        );
      } catch (e) {
        if (!controller.signal.aborted) {
          setPolling(false);
          setPollNote(`Не удалось обновить статус: ${(e as Error).message}`);
        }
      }
    };
    timer = setTimeout(() => void poll(), 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Status changes belong to this polling loop; a new job starts a new bounded loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, polling]);
  const origin = job?.inspection?.origin,
    selection = job?.inspection?.selection;
  const result =
    job?.result && "storyboard" in job.result
      ? job.result.storyboard
      : undefined;
  const tiles = (selection?.tiles ?? []) as Tile[];
  const stale =
    (origin?.version !== null &&
    origin?.version !== undefined &&
    origin.version !== version) || (!!origin && !!planView && origin.contentHash !== planView.origin.contentHash);
  const playerMatches =
    !!planView &&
    (!origin || planView.origin.contentHash === origin.contentHash);
  const scenes =
    planView?.plan.scenes.filter((s) => !segment || s.segmentId === segment) ??
    [];
  const scope = () =>
    revision ? { revision: Number(revision) } : { expectedVersion: version };
  async function storyboard(page = 0, overrides: Record<string, unknown> = {}) {
    const compare = (
      overrides.mode ? overrides.mode === "compare" : tab === "compare"
    )
      ? comparisonSource === "job"
        ? { compareJobId: baselineJob }
        : { compareRevision: Number(compareRevision) }
      : {};
    const options: Record<string, unknown> = {
      ...scope(),
      mode: tab === "compare" ? "compare" : scene ? "scene" : "overview",
      ...(segment ? { segmentId: segment } : {}),
      ...(scene ? { sceneId: scene } : {}),
      page,
      pageSize,
      ...compare,
      ...overrides,
    };
    if (options.sourceJobId) {
      delete options.expectedVersion; delete options.revision;
      delete options.compareJobId; delete options.compareRevision;
    } else if (options.mode === "compare") {
      options.pixelDiff = pixelDiff;
    }
    const value = await request<StudioJobView>(
      `${base}/storyboard`,
      "POST",
      options,
    );
    acceptJob(value, options);
  }
  async function nextPage(page: number) {
    if (!job || !origin)
      throw Error(
        "Соберите первую страницу заново, чтобы закрепить параметры просмотра.",
      );
    const previousOptions: Record<string, unknown> = requestOptions.current ?? { ...job.inspection?.scope };
    const { compareJobId: _compareJob, compareRevision: _compareRevision, expectedVersion: _version, revision: _revision, ...pinnedScope } = previousOptions;
    const options = { ...pinnedScope, sourceJobId: job!.id, page };
    const value = await request<StudioJobView>(
      `${base}/storyboard`,
      "POST",
      options,
    );
    if (
      value.inspection?.origin.contentHash !== origin.contentHash ||
      value.inspection?.compareOrigin?.contentHash !==
        job?.inspection?.compareOrigin?.contentHash
    )
      throw Error(
        "Медиа или документ изменились. Соберите новую раскадровку с первой страницы.",
      );
    acceptJob(value, options);
  }
  async function loadReview(
    cursor = 0,
    append = false,
    deep = false,
    targetVersion = version,
  ) {
    const jobOrigin = job?.inspection?.origin;
    const pinnedSource = jobOrigin && (revision ? jobOrigin.revision === Number(revision) : jobOrigin.version === targetVersion) ? job?.id : undefined;
    const value = await request<Report>(`${base}/review`, "POST", {
      ...(pinnedSource ? { sourceJobId: pinnedSource } : revision
        ? { revision: Number(revision) }
        : { expectedVersion: targetVersion }),
      mode: deep ? "deep" : "quick",
      cursor,
      limit: 20,
    });
    setReport((old) =>
      append && old?.reportId === value.reportId
        ? {
            ...value,
            issues: [...old.issues, ...value.issues],
            suggestions: [
              ...old.suggestions,
              ...value.suggestions.filter(
                (s) => !old.suggestions.some((old) => old.id === s.id),
              ),
            ],
          }
        : value,
    );
    if (!append) setSelected([]);
    return value;
  }
  function seek(frame: number) {
    if (!playerMatches) return;
    player.current?.seekTo(frame);
    player.current?.pause();
    playerSection.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
  async function reviewMoment(issue: Report["issues"][number]) {
    if (!report) return;
    const focused = await request<Report>(`${base}/review`, "POST", {
      ...(report.sourceJobId ? { sourceJobId: report.sourceJobId } : report.origin.revision ? { revision: report.origin.revision } : { expectedVersion: report.origin.version }),
      mode: "deep", sceneId: issue.sceneId, segmentId: issue.segmentId, frame: issue.frame,
    });
    setReport(old => old && old.reportId === focused.reportId ? { ...old, deep: focused.deep } : focused);
    setNotice("Клип запрошен для выбранной сцены и указанного момента. Результат появится в разделе движения и звука ниже.");
  }
  async function apply() {
    if (!report || !selected.length) return;
    const before =
      job?.status === "done" &&
      job.inspection?.origin.contentHash === report.origin.contentHash
        ? job.id
        : null;
    if (!before)
      throw Error(
        "Сначала соберите раскадровку этой версии: она нужна для проверяемого сравнения до и после.",
      );
    const project = await request<{ version: number; draftBackupId?: string }>(
      `${base}/review-apply`,
      "POST",
      {
        expectedVersion: version,
        reportId: report.reportId,
        suggestionIds: selected,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setVersion(project.version);
    if (project.draftBackupId) {
      setDraftBackupId(project.draftBackupId);
      try { sessionStorage.setItem(`${storageKey}:review-backup`, project.draftBackupId); } catch {}
    }
    setSelected([]);
    setBaselineJob(before);
    setComparisonSource("job");
    setTab("compare");
    setNotice(
      `Правки применены к черновику v${project.version}. Повторная проверка и сравнение готовятся.`,
    );
    await Promise.all([
      readPlan(project.version),
      loadReview(0, false, false, project.version),
    ]);
    const options = {
      expectedVersion: project.version,
      mode: "compare",
      compareJobId: before,
      pageSize,
    };
    const next = await request<StudioJobView>(
      `${base}/storyboard`,
      "POST",
      options,
    );
    acceptJob(next, options);
    setNotice(
      "Выбранные правки применены к черновику. Проверка повторена; сравнение до и после готовится в очереди.",
    );
  }
  async function restoreBeforeReview() {
    if (!draftBackupId) return;
    const backup = await request<{ document: unknown }>(`${base}/review-backups/${encodeURIComponent(draftBackupId)}`);
    const restored = await request<{ version: number }>(`${base}/draft`, "PUT", {
      expectedVersion: version, document: backup.document, idempotencyKey: crypto.randomUUID(),
    });
    setVersion(restored.version); setDraftBackupId(""); setReport(null); setSelected([]); setRevision("");
    try { sessionStorage.removeItem(`${storageKey}:review-backup`); } catch {}
    await readPlan(restored.version);
    setNotice("Состояние до исправлений возвращено в серверный черновик. Проверьте его перед сохранением ревизии.");
  }
  return (
    <>
      <nav className="sb-breadcrumb">
        <a
          href={`/studio/${encodeURIComponent(initial.id)}`}
          target="_blank"
          rel="noopener"
        >
          ← Открыть редактор
        </a>
        <a
          href={`/studio/recipes?project=${encodeURIComponent(initial.id)}`}
          target="_blank"
          rel="noopener"
        >
          Выбрать оформление →
        </a>
      </nav>
      <header className="sb-heading">
        <p className="sb-eyebrow">DOUGA / РАСКАДРОВКА</p>
        <h1>{initial.title || "Моё видео"}</h1>
        <p>
          Весь ролик по смысловым кадрам. Разверните сцену, проверьте подписи и
          сравните выбранные правки.
        </p>
        <p className="muted">
          Показывается сохранённый на сервере документ. Локальный текст в другой
          вкладке редактора остаётся в ней.
        </p>
      </header>
      <div className="sb-tabs" role="tablist" aria-label="Режим просмотра">
        {(
          [
            ["video", "Весь ролик"],
            ["issues", "Замечания"],
            ["compare", "До / после"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="sb-alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="sb-alert" role="status">
          {notice}
        </p>
      )}
      <section className="panel sb-controls" aria-label="Выбор версии и сцен">
        <div className="sb-filter-row">
          <label>
            Документ
            <select
              value={revision}
              onChange={(e) => {
                setRevision(e.target.value);
                setScene("");
                setSegment("");
                setReport(null);
                void run(async () => {
                  await readPlan(
                    e.target.value ? undefined : version,
                    e.target.value ? Number(e.target.value) : undefined,
                  );
                });
              }}
            >
              <option value="">Черновик v{version}</option>
              {Array.from(
                { length: Math.min(initial.revision, 50) },
                (_, i) => initial.revision - i,
              ).map((r) => (
                <option key={r} value={r}>
                  Ревизия r{r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Сегмент
            <select
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value);
                setScene("");
              }}
            >
              <option value="">Все сегменты</option>
              {planView?.plan.segments?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Детализация
            <select value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">По одному кадру на сцену</option>
              {scenes.map((s, i) => (
                <option key={`${s.segmentId}:${s.id}`} value={s.id}>
                  Сцена {i + 1} · {s.roundId ?? s.participantId ?? s.kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Кадров на листе
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[6, 12, 24].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        {tab === "compare" && (
          <div className="sb-filter-row">
            <label><input type="checkbox" checked={pixelDiff} onChange={e => setPixelDiff(e.target.checked)} />Показать пиксельные различия</label>
            <label>
              Сравнить с
              <select
                value={comparisonSource}
                onChange={(e) =>
                  setComparisonSource(e.target.value as "revision" | "job")
                }
              >
                <option value="revision">Сохранённой ревизией</option>
                <option value="job" disabled={!baselineJob}>
                  Запомненной раскадровкой
                </option>
              </select>
            </label>
            {comparisonSource === "revision" ? (
              <label>
                Номер ревизии
                <input
                  type="number"
                  min={1}
                  max={initial.revision}
                  value={compareRevision}
                  onChange={(e) => setCompareRevision(e.target.value)}
                />
              </label>
            ) : (
              <p className="muted">
                Сравнение с сохранённым результатом этого проекта
              </p>
            )}
          </div>
        )}
        <div className="studio-toolbar">
          <button
            className="btn"
            disabled={
              busy ||
              active(job) ||
              (tab === "compare" && comparisonSource === "job" && !baselineJob)
            }
            onClick={() =>
              void run(() =>
                tab === "issues" ? loadReview().then(() => {}) : storyboard(),
              )
            }
          >
            {busy
              ? "Подготовка…"
              : tab === "issues"
                ? "Проверить эту версию"
                : tab === "compare"
                  ? "Собрать сравнение"
                  : scene
                    ? "Развернуть сцену"
                    : "Собрать раскадровку"}
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setRevision("");
                setReport(null);
                await readPlan();
                setNotice(
                  "Загружена текущая версия. Предыдущие изображения сохраняют своё происхождение.",
                );
              })
            }
          >
            Обновить версию
          </button>
          {draftBackupId && <button className="btn ghost" disabled={busy || active(job)} onClick={() => void run(restoreBeforeReview)}>
            Вернуть состояние до исправлений
          </button>}
        </div>
      </section>
      {job && (
        <section className="panel" aria-label="Результат раскадровки">
          {job.inspection?.diagnostic && <p className="sb-alert error">Диагностический просмотр: текст не помещается. Эта картинка помогает исправить документ; обычный рендер ещё не готов.</p>}
          <div className="sb-result-heading">
            <h2>{statusText[job.status]}</h2>
            <span className={`sb-status ${job.status}`}>
              {job.status === "running"
                ? `${Math.round(job.progress * 100)}%`
                : statusText[job.status]}
            </span>
          </div>
          {origin && (
            <p className="muted">
              {originText(origin)} · {origin.format.width} ×{" "}
              {origin.format.height} · {origin.format.fps} кадр/с
              {job.inspection?.compareOrigin && (
                <> · до: {originText(job.inspection.compareOrigin)}</>
              )}
            </p>
          )}
          {stale && (
            <p className="sb-alert">
              Результат закреплён за прежним документом или материалами. Текущий черновик — v
              {version}. Страницы этого снимка доступны; новую раскадровку можно собрать отдельно.
            </p>
          )}
          {selection && (
            <p>
              На странице сцен:{" "}
              <strong>
                {selection.scenesCovered} из {selection.totalScenes}
              </strong>
              . За пределами страницы: {selection.remainingScenes}. Страница{" "}
              {selection.page + 1} из {selection.totalPages}.
            </p>
          )}
          {job.inspection?.comparison && <div className="sb-comparison-summary">
            <h3>Что изменилось</h3>
            <p>Свойств изменено: {job.inspection.comparison.changesTotal}. Замечаний устранено: {job.inspection.comparison.totals.resolved}; новых: {job.inspection.comparison.totals.new}; осталось: {job.inspection.comparison.totals.remaining}.</p>
            {job.inspection.comparison.contentChanged && <p className="muted">Содержание или материалы изменились. Разница изображений ожидаема.</p>}
            <details><summary>Изменения свойств и замечаний</summary>
              <ul>{job.inspection.comparison.changes.map((change, index) => <li key={index}><strong>{change.label}:</strong> {change.before || "—"} → {change.after || "—"}</li>)}</ul>
              {job.inspection.comparison.changesTruncated && <p className="muted">Показаны первые 50 изменений.</p>}
              {job.inspection.comparison.resolvedIssues.length > 0 && <><h4>Устранены</h4><ul>{job.inspection.comparison.resolvedIssues.map(issue => <li key={issue.id}>{issueText[issue.code] ?? issue.message}</li>)}</ul></>}
              {job.inspection.comparison.newIssues.length > 0 && <><h4>Появились</h4><ul>{job.inspection.comparison.newIssues.map(issue => <li key={issue.id}>{issueText[issue.code] ?? issue.message}</li>)}</ul></>}
            </details>
            <p className="muted">Сравнены документ и статические измерения. Движение и звук проверяются отдельно.</p>
          </div>}
          {active(job) && (
            <>
              <progress
                aria-label="Готовность раскадровки"
                value={job.progress}
                max={1}
              />
              <p className="muted">
                Изображения готовит отдельный исполнитель очереди. Эту вкладку
                можно закрыть и вернуться позже.
              </p>
              <div className="studio-toolbar">
                <button
                  className="btn secondary"
                  onClick={() => {
                    setPolling(!polling);
                    setPollNote(
                      polling
                        ? "Автообновление приостановлено; задача продолжает работать."
                        : "",
                    );
                  }}
                >
                  {polling
                    ? "Приостановить обновление"
                    : "Продолжить проверку статуса"}
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const canceled = await request<StudioJobView>(
                        `jobs/${encodeURIComponent(job.id)}/cancel`,
                        "POST",
                      );
                      setPolling(false);
                      setJob(canceled);
                    })
                  }
                >
                  Отменить задачу
                </button>
              </div>
            </>
          )}
          {pollNote && <p role="status">{pollNote}</p>}
          {job.error && (
            <p className="error">{errorText[job.error] ?? job.error}</p>
          )}
          {job.status === "done" && result && (
            <>
              <div className="studio-toolbar">
                <a
                  className="btn secondary"
                  href={`/api/studio/jobs/${encodeURIComponent(job.id)}/result`}
                  target="_blank"
                  rel="noopener"
                >
                  Открыть лист
                </a>
                <a
                  className="btn ghost"
                  href={`/api/studio/jobs/${encodeURIComponent(job.id)}/result?download=1`}
                  download="storyboard.png"
                >
                  Скачать PNG
                </a>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setBaselineJob(job.id);
                    setComparisonSource("job");
                    setNotice("Этот результат запомнен как вариант «до».");
                  }}
                >
                  Запомнить для сравнения
                </button>
              </div>
              {result.partial && (
                <p className="sb-alert error">
                  Часть кадров отсутствует. Этот лист не считается полной
                  проверкой.
                </p>
              )}
              <a
                className="sb-sheet"
                href={`/api/studio/jobs/${encodeURIComponent(job.id)}/result`}
                target="_blank"
                rel="noopener"
              >
                <img
                  src={`/api/studio/jobs/${encodeURIComponent(job.id)}/result`}
                  alt={`Раскадровка: ${selection?.scenesCovered ?? 0} сцен, страница ${(selection?.page ?? 0) + 1}`}
                />
              </a>
              {result.pixelComparisons && <details className="sb-comparison-report">
                <summary>Пиксельные различия: {result.pixelComparisons.length} пар</summary>
                <p className="muted">Точное сравнение RGBA. Изменения содержания и оформления ожидаемо меняют пиксели.</p>
                <ul>{result.pixelComparisons.map((pair, index) => <li key={index}>
                  Кадры {pair.beforeFrame ?? "—"} / {pair.afterFrame ?? "—"}: {pair.status === "identical" ? "совпадают" : pair.status === "different" ? "различаются" : "не сопоставимы"}
                  {pair.metrics && <> · PSNR {typeof pair.metrics.psnr === "number" ? pair.metrics.psnr.toFixed(2) : "∞"} · изменено {(pair.metrics.changedPixelRatio * 100).toFixed(3)}% · максимальная разница {pair.metrics.maxDelta}</>}
                </li>)}</ul>
              </details>}
              <div className="sb-tiles">
                {tiles.map((tile, index) => {
                  const artifact = result.frames.find(
                    (f) =>
                      f.sceneId === tile.sceneId &&
                      f.state === tile.state &&
                      f.side === tile.side,
                  );
                  const url = artifact
                    ? `/api/studio/jobs/${encodeURIComponent(job.id)}/frames/${encodeURIComponent(artifact.id)}`
                    : null;
                  return (
                    <article className="sb-tile" key={tile.id}>
                      <div className="sb-tile-caption">
                        <strong>
                          {tile.side === "before"
                            ? "До · "
                            : tile.side === "after"
                              ? "После · "
                              : tile.side === "diff"
                                ? "Разница · "
                              : ""}
                          {tile.label}
                        </strong>
                        <span>
                          {time(tile.frame, origin?.format.fps ?? 30)}
                        </span>
                      </div>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener">
                          <img
                            src={url}
                            alt={`${tile.label}, ${stateText(tile.state)}`}
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <p className="sb-missing">
                          {tile.missing
                            ? "Сцена отсутствует в этом варианте"
                            : "Кадр недоступен"}
                        </p>
                      )}
                      <p className="muted">
                        {stateText(tile.state)} · кадр {tile.frame}
                      </p>
                      {tile.analysis.limitations.length > 0 && (
                        <p className="muted">
                          {tile.analysis.method === "heuristic"
                            ? "Смысл произвольной сцены определён эвристически. "
                            : ""}
                          {tile.analysis.limitations.includes(
                            "no-stable-window",
                          )
                            ? "Устойчивого окна нет."
                            : ""}
                        </p>
                      )}
                      <div className="studio-toolbar">
                        {url && (
                          <a
                            href={`${url}?download=1`}
                            download={`frame-${index + 1}.png`}
                          >
                            Скачать кадр
                          </a>
                        )}
                        <button
                          className="sb-text-button"
                          disabled={
                            !playerMatches ||
                            tile.side === "before" ||
                            tile.side === "diff" ||
                            tile.missing
                          }
                          onClick={() => seek(tile.frame)}
                        >
                          В плеер
                        </button>
                        <button
                          className="sb-text-button"
                          disabled={busy || active(job)}
                          onClick={() => {
                            setScene(tile.sceneId);
                            setTab(tile.side ? "compare" : "video");
                            setSegment(tile.segmentId ?? "");
                            void run(() =>
                              storyboard(0, {
                                mode: tile.side ? "compare" : "scene",
                                sceneId: tile.sceneId,
                                ...(tile.segmentId ? { segmentId: tile.segmentId } : {}),
                                sourceJobId: job.id,
                              }),
                            );
                          }}
                        >
                          {tile.side ? "Сравнить состояния сцены" : "Состояния сцены"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {selection && (
            <div className="sb-pagination">
              <button
                className="btn secondary"
                disabled={busy || active(job) || selection.page === 0}
                onClick={() => void run(() => nextPage(selection.page - 1))}
              >
                ← Назад
              </button>
              <span>
                {selection.page + 1} / {selection.totalPages}
              </span>
              <button
                className="btn secondary"
                disabled={
                  busy ||
                  active(job) ||
                  selection.page + 1 >= selection.totalPages
                }
                onClick={() => void run(() => nextPage(selection.page + 1))}
              >
                Следующая →
              </button>
            </div>
          )}
          <details>
            <summary>Происхождение и охват</summary>
            <pre className="studio-code">
              {JSON.stringify(
                {
                  origin,
                  compareOrigin: job.inspection?.compareOrigin,
                  jobId: job.id,
                  engineId: job.engineId,
                  page: selection?.page,
                  totalTiles: selection?.totalTiles,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
      {tab === "issues" && (
        <section className="panel">
          <h2>Замечания к видео</h2>
          {!report ? (
            <p className="muted">
              Запустите проверку выбранной версии. Автоматический разбор
              отличает измеренные ошибки от рисков чтения.
            </p>
          ) : (
            <>
              <p>
                {originText(report.origin)} · ошибок: {report.counts.errors},
                предупреждений: {report.counts.warnings}. Показано{" "}
                {report.issues.length} из {report.totalIssues}.
              </p>
              <div className="sb-checks">
                {report.checks.map((check) => (
                  <div key={check.id}>
                    <strong>
                      {(
                        {
                          layout: "Размещение текста",
                          textSafeArea: "Безопасная зона",
                          readableWindow: "Время чтения",
                          motion: "Движение",
                          audio: "Звук",
                          contrast: "Контраст",
                        } as Record<string, string>
                      )[check.code] ?? check.code}
                    </strong>
                    <span>
                      {
                        {
                          passed: "Проверено в плане",
                          warning: "Есть риски",
                          error: "Есть ошибки",
                          notChecked: "Не проверено",
                          notApplicable: "Не применимо",
                        }[check.status]
                      }
                    </span>
                    {check.reason && <small>{check.reason}</small>}
                  </div>
                ))}
              </div>
              <p className="muted">
                Статическая проверка охватила {report.coverage.examinedScenes}{" "}
                из {report.coverage.totalScenes} сцен. Изображения, движение и
                звук требуют просмотра и прослушивания.
              </p>
              {report.issues.length === 0 && (
                <p>Замечаний в статическом плане не найдено.</p>
              )}
              <ul className="sb-issues">
                {report.issues.map((issue) => (
                  <li key={issue.id} className={`sb-issue ${issue.severity}`}>
                    <span className="sb-issue-level">
                      {issue.severity === "error"
                        ? "Ошибка"
                        : issue.severity === "warning"
                          ? "Риск"
                          : "Наблюдение"}
                    </span>
                    <h3>{issueText[issue.code] ?? issue.message}</h3>
                    <p className="muted">
                      {issue.sceneId ? `Сцена ${issue.sceneId}` : "Документ"}
                      {issue.frame !== undefined
                        ? ` · кадр ${issue.frame}`
                        : ""}
                    </p>
                    {issue.frame !== undefined && (
                      <button
                        className="sb-text-button"
                        disabled={
                          !playerMatches ||
                          report.origin.contentHash !==
                            planView?.origin.contentHash
                        }
                        onClick={() => seek(issue.frame!)}
                      >
                        Показать в плеере
                      </button>
                    )}
                    {issue.nextAction?.type === "clip" && <button className="btn ghost" disabled={busy} onClick={() => void run(() => reviewMoment(issue))}>
                      Проверить этот момент в движении
                    </button>}
                    <details>
                      <summary>Измерения и правило</summary>
                      <pre className="studio-code">
                        {JSON.stringify(issue.evidence, null, 2)}
                      </pre>
                    </details>
                    {report.suggestions
                      .filter((s) => s.issueIds.includes(issue.id))
                      .map((fix) => (
                        <label className="sb-fix" key={fix.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(fix.id)}
                            disabled={revision !== "" || busy}
                            onChange={(e) =>
                              setSelected((values) =>
                                e.target.checked
                                  ? [...new Set([...values, fix.id])]
                                  : values.filter((id) => id !== fix.id),
                              )
                            }
                          />
                          <span>
                            <strong>{fix.title}</strong>
                            <small>
                              Низкий риск · {fix.affectedScenes.length} сцен ·{" "}
                              {fix.overrides.length
                                ? "есть явные переопределения оформления"
                                : "локальная правка оформления"}
                            </small>
                          </span>
                        </label>
                      ))}
                    {!report.suggestions.some((s) =>
                      s.issueIds.includes(issue.id),
                    ) && (
                      <p className="muted">
                        {issue.nextAction?.type === "clip"
                          ? "Посмотрите движение сцены в плеере или запросите клип."
                          : "Автоматической правки нет. Откройте указанную сцену и проверьте текст в редакторе."}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="studio-toolbar">
                {report.nextCursor !== null && (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        loadReview(report.nextCursor!, true).then(() => {}),
                      )
                    }
                  >
                    Ещё замечания
                  </button>
                )}
                <button
                  className="btn"
                  disabled={
                    busy ||
                    !selected.length ||
                    revision !== "" ||
                    report.origin.version !== version
                  }
                  onClick={() => void run(apply)}
                >
                  Применить выбранные ({selected.length})
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() => loadReview(0, false, true).then(() => {}))
                  }
                >
                  Подготовить клипы со звуком
                </button>
              </div>
              {revision && (
                <p className="muted">
                  Историческую ревизию можно просматривать. Для правок выберите
                  текущий черновик.
                </p>
              )}
              {report.deep.requested && (
                <div className="sb-deep">
                  <p>{report.deep.assessment}</p>
                  {report.deep.jobs.map((deep) => (
                    <DeepJob key={deep.id} id={deep.id} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
      {planView && playerMatches ? (
        <section ref={playerSection} className="panel">
          <h2>Посмотреть в движении</h2>
          <p className="muted">
            {originText(planView.origin)}. Нажмите «В плеер» на нужном кадре.
          </p>
          <div className="studio-player">
            <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
              ref={player}
              component={StudioVideo}
              inputProps={{ plan: planView.plan, assetMode: "url" }}
              durationInFrames={Math.max(1, planView.plan.durationInFrames)}
              compositionWidth={planView.plan.width}
              compositionHeight={planView.plan.height}
              fps={planView.plan.fps}
              numberOfSharedAudioTags={sharedAudioTagCount(planView.plan)}
              controls
              style={{ width: "100%", maxHeight: "65vh" }}
            />
          </div>
        </section>
      ) : (
        job && (
          <p className="sb-alert">
            Плеер сейчас относится к другой версии или набору медиа. Полные
            кадры листа сохраняют своё происхождение. Обновите версию и соберите
            новый лист для перехода в плеер.
          </p>
        )
      )}
    </>
  );
}
function DeepJob({ id }: { id: string }) {
  const [job, setJob] = useState<StudioJobView | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setJob(await request<StudioJobView>(`jobs/${encodeURIComponent(id)}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [id]);
  return (
    <article className="sb-deep-item">
      <p>
        Клип со звуком · {job ? statusText[job.status] : "Загрузка статуса…"}
      </p>
      {error && <p className="error">{error}</p>}
      {job?.status === "done" ? (
        <video
          controls
          preload="metadata"
          src={`/api/studio/jobs/${encodeURIComponent(id)}/result`}
        />
      ) : (
        <button className="btn secondary" onClick={() => void refresh()}>
          Обновить статус клипа
        </button>
      )}
    </article>
  );
}
