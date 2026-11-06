"use client";
import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CompiledVideo, Diagnostic } from "@/video";
import type { TypographyFont } from "@/video/font-manifest";
import type {
  TypographyThemeId,
  TypographyStyleId,
  FontId,
} from "@/video/typography-types";
import { studioRequest } from "../StudioWorkspace";
const Preview = dynamic(() => import("../StudioPreview"), { ssr: false });
type Theme = { id: TypographyThemeId; name: string; description: string };
type Style = { id: TypographyStyleId; name: string; description: string };
type Result = {
  plan: CompiledVideo;
  ready: boolean;
  diagnostics: Diagnostic[];
  fragment: object;
};
const sampleText = "残酷な天使のテーゼ — Любимые OST";
const themeColors = [
  "#9ac7c9",
  "#ffc66b",
  "#d8bfa1",
  "#d4a6ff",
  "#e5e5e0",
  "#eeb6cc",
];

export default function TypographyGallery({
  fonts,
  themes,
  styles,
  projectId,
}: {
  fonts: readonly TypographyFont[];
  themes: readonly Theme[];
  styles: readonly Style[];
  projectId?: string;
}) {
  const [category, setCategory] = useState<"theme" | "style" | "font">("theme");
  const [theme, setTheme] = useState<TypographyThemeId>("clean");
  const [preset, setPreset] = useState<TypographyStyleId>("anime-outline");
  const [font, setFont] = useState<FontId>("manrope");
  const [text, setText] = useState(sampleText);
  const [format, setFormat] = useState("wide");
  const [width, setWidth] = useState(0.84),
    [height, setHeight] = useState(0.3);
  const [background, setBackground] = useState("dark");
  const [result, setResult] = useState<Result | null>(null),
    [pinned, setPinned] = useState<Result | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]),
    [selectedProject, setSelectedProject] = useState(projectId ?? "");
  const [scope, setScope] = useState("document"),
    [segments, setSegments] = useState<{ id: string; title: string }[]>([]),
    [replace, setReplace] = useState(false);
  const requestNumber = useRef(0);
  useEffect(() => {
    let active = true;
    const request = ++requestNumber.current;
    const controller = new AbortController();
    setPending(true);
    setError("");
    const timer = setTimeout(() => {
      void fetch("/api/studio/typography/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          format,
          theme,
          width,
          height,
          background,
          sample: category === "theme" ? "theme" : "text",
          ...(category === "style" ? { preset } : {}),
          ...(category === "font" ? { font } : {}),
        }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error ?? "Не удалось подготовить пример");
          return data as Result;
        })
        .then((data) => {
          if (active && request === requestNumber.current) setResult(data);
        })
        .catch((e) => {
          if (active && e.name !== "AbortError")
            setError("Не удалось подготовить пример. Попробуйте ещё раз.");
        })
        .finally(() => {
          if (active) setPending(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, format, theme, preset, font, width, height, background, category]);
  useEffect(() => {
    void studioRequest<{ items: { id: string; title: string }[] }>(
      "projects?limit=100",
    )
      .then((r) => setProjects(r.items))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setSegments([]);
    setScope("document");
    if (!selectedProject) return;
    let active = true;
    void studioRequest<any>(
      `projects/${encodeURIComponent(selectedProject)}?content=code`,
    )
      .then((p) => {
        if (active)
          setSegments((p.draft?.document ?? p.document).segments ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedProject]);
  async function apply() {
    if (!selectedProject) return;
    setNotice("");
    setError("");
    try {
      const p = await studioRequest<{ version: number }>(
        `projects/${encodeURIComponent(selectedProject)}`,
      );
      const response = await studioRequest<{ version: number }>(
        `projects/${encodeURIComponent(selectedProject)}/typography`,
        "POST",
        {
          expectedVersion: p.version,
          theme,
          mode: replace ? "replace" : "preserve",
          scope:
            scope === "document"
              ? { type: "document" }
              : { type: "segment", id: scope },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setNotice(`Тема применена к черновику v${response.version}.`);
    } catch (e) {
      setError(
        (e as Error).message === "VERSION_CONFLICT"
          ? "Проект изменился. Откройте его и повторите применение."
          : "Не удалось применить тему. Проверьте черновик проекта.",
      );
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(result?.fragment ?? {}, null, 2),
      );
      setNotice("Настройки скопированы");
    } catch {
      setNotice("Откройте настройки ниже и скопируйте их.");
    }
  }
  const measured =
    result?.plan.scenes.flatMap((s) => s.nodes).filter((n) => n.textLayout) ??
    [];
  return (
    <div data-typography-gallery>
      <nav className="type-tabs" aria-label="Что примерить">
        {(
          [
            ["theme", "Темы ролика", "6 сочетаний"],
            ["style", "Стили надписи", "12 приёмов"],
            ["font", "Шрифты", "7 гарнитур"],
          ] as const
        ).map(([id, label, note]) => (
          <button
            type="button"
            key={id}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            <strong>{label}</strong>
            <small>{note}</small>
          </button>
        ))}
      </nav>
      {category === "theme" && (
        <div className="type-themes">
          {themes.map((t, i) => (
            <button
              type="button"
              key={t.id}
              style={{ "--type-accent": themeColors[i] } as React.CSSProperties}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              <span className="type-theme-sample">Aa あ</span>
              <strong>{t.name}</strong>
              <small>{t.description}</small>
            </button>
          ))}
        </div>
      )}
      <div className="type-workspace">
        <section className="type-controls" aria-label="Примерка">
          <label htmlFor="type-text">Ваш текст</label>
          <textarea
            id="type-text"
            value={text}
            maxLength={10000}
            rows={4}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="type-text-samples">
            <button type="button" onClick={() => setText(sampleText)}>
              OST
            </button>
            <button type="button" onClick={() => setText("千と千尋の神隠し")}>
              日本語
            </button>
            <button
              type="button"
              onClick={() =>
                setText("Очень длинное название любимой композиции из аниме")
              }
            >
              Длинное имя
            </button>
          </div>
          {category === "style" && (
            <>
              <label htmlFor="type-style">Стиль</label>
              <select
                id="type-style"
                value={preset}
                onChange={(e) => setPreset(e.target.value as TypographyStyleId)}
              >
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="type-note">
                {styles.find((s) => s.id === preset)?.description}
              </p>
            </>
          )}
          {category === "font" && (
            <>
              <label htmlFor="type-font">Гарнитура</label>
              <select
                id="type-font"
                value={font}
                onChange={(e) => setFont(e.target.value as FontId)}
              >
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <p className="type-note">
                {fonts.find((f) => f.id === font)?.languages.join(" / ")} · 400
                / 700
                {fonts.find((f) => f.id === font)?.italic ? " · Курсив" : ""}
              </p>
            </>
          )}
          <label htmlFor="type-format">Формат видео</label>
          <select
            id="type-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="wide">16:9 · Широкий</option>
            <option value="vertical">9:16 · Вертикальный</option>
            <option value="square">1:1 · Квадратный</option>
          </select>
          <label htmlFor="type-width">
            Ширина рамки <span>{Math.round(width * 100)}%</span>
          </label>
          <input
            id="type-width"
            type="range"
            min=".2"
            max=".96"
            step=".01"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <label htmlFor="type-height">
            Высота рамки <span>{Math.round(height * 100)}%</span>
          </label>
          <input
            id="type-height"
            type="range"
            min=".08"
            max=".7"
            step=".01"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
          <label htmlFor="type-background">Подложка</label>
          <select
            id="type-background"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
          >
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
            <option value="busy">Пёстрый фон</option>
          </select>
          <p className="type-note">
            Японские символы подставляются из встроенного Noto. Размер
            подбирается под рамку с сохранением читаемого минимума.
          </p>
        </section>
        <div className="type-preview-area">
          <div className="type-preview-header">
            <span>{pending ? "Подбираем строки…" : "Текущее оформление"}</span>
            <button
              type="button"
              disabled={!result || pending}
              onClick={() => setPinned(result)}
            >
              Закрепить для сравнения
            </button>
          </div>
          {error && (
            <p role="alert" className="type-error">
              {error}
            </p>
          )}
          <div className={`type-comparison${pinned ? " has-pinned" : ""}`}>
            <section
              className="type-preview"
              aria-label="Текущее оформление"
              aria-busy={pending}
            >
              {result && <Preview plan={result.plan} />}
            </section>
            {pinned && (
              <section
                className="type-preview"
                aria-label="Закреплённое оформление"
              >
                <div className="type-preview-header">
                  <span>Закреплённое</span>
                  <button type="button" onClick={() => setPinned(null)}>
                    Убрать
                  </button>
                </div>
                <Preview plan={pinned.plan} />
              </section>
            )}
          </div>
          {result && (
            <div className="type-inspection">
              <div className="type-inspection-heading">
                <strong>
                  {result.ready
                    ? "Текст готов к видео"
                    : "Есть проблема с текстом"}
                </strong>
                <span>{measured.length} надписей</span>
              </div>
              {measured.map((n) => (
                <div className="type-inspection-row" key={n.id}>
                  <span>
                    {n.textLayout!.lines.map((l) => l.text).join(" / ") ||
                      "Пустая строка"}
                  </span>
                  <small>
                    {n.textLayout!.fontSize.toFixed(1)} px ·{" "}
                    {n.textLayout!.lines.length} стр.
                    {n.textLayout!.truncated ? " · сокращено" : ""}
                  </small>
                </div>
              ))}
              {result.diagnostics.map((d, i) => (
                <p className="type-error" key={i}>
                  {d.message}
                </p>
              ))}
            </div>
          )}
          <div className="type-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={!result || pending}
              onClick={() => void copy()}
            >
              Скопировать настройки
            </button>
            <a href="/studio/motion">Добавить движение →</a>
          </div>
          {notice && <p role="status">{notice}</p>}
          <details className="type-code">
            <summary>Настройки для агента</summary>
            <pre>{JSON.stringify(result?.fragment ?? {}, null, 2)}</pre>
          </details>
        </div>
      </div>
      <section className="type-apply" aria-label="Применить тему">
        <div>
          <h2>Продолжить в своём видео</h2>
          <p>
            Тема оформит весь ролик или выбранный сегмент. Результат сохранится
            в черновике.
          </p>
        </div>
        <div className="type-apply-fields">
          <label>
            Проект
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value="">Выберите проект</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тема
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as TypographyThemeId)}
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Где применить
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="document">Весь ролик</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="type-check">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Заменить ручное оформление текста
          </label>
          <button
            type="button"
            className="btn"
            disabled={!selectedProject || pending}
            onClick={() => void apply()}
          >
            Применить тему
          </button>
          {selectedProject && (
            <a href={`/studio/${encodeURIComponent(selectedProject)}`}>
              Открыть проект →
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
