"use client";
import React, { useState } from "react";
import { typographyThemes } from "@/video/typography-catalog";
import type { TypographyThemeId } from "@/video/typography-types";
import { studioRequest } from "./StudioWorkspace";

export default function TypographyPanel({
  projectId,
  version,
  disabled,
  onApply,
}: {
  projectId: string;
  version: number;
  disabled: boolean;
  onApply: (
    theme: TypographyThemeId,
    mode: "preserve" | "replace",
  ) => Promise<void>;
}) {
  const [theme, setTheme] = useState<TypographyThemeId>("clean"),
    [replace, setReplace] = useState(false),
    [inspection, setInspection] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect(preview = false) {
    setBusy(true);
    setError("");
    try {
      setInspection(
        await studioRequest(`projects/${projectId}/text`, "POST", {
          expectedVersion: version,
          preview,
          limit: 20,
        }),
      );
    } catch (e) {
      setError(
        (e as Error).message === "VERSION_CONFLICT"
          ? "Проект изменился. Загрузите серверную версию."
          : "Не удалось проверить текст. Сначала исправьте ошибки документа и медиа.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Типографика">
      <h2>Типографика</h2>
      <p>
        Готовое оформление заголовков, имён и таймеров.{" "}
        <a href={`/studio/typography?project=${encodeURIComponent(projectId)}`}>
          Примерить шрифты и темы →
        </a>
      </p>
      <div className="studio-toolbar">
        <label>
          Тема{" "}
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as TypographyThemeId)}
          >
            {typographyThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />{" "}
          Заменить ручное оформление текста
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={disabled || busy}
          onClick={() => void onApply(theme, replace ? "replace" : "preserve")}
        >
          Применить к черновику
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={disabled || busy}
          onClick={() => void inspect()}
        >
          Проверить текст
        </button>
      </div>
      {disabled && (
        <p className="muted">
          Сохраните изменения редактора и разрешите конфликт перед применением
          темы.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {inspection && (
        <div>
          <p>
            Измерения для v{inspection.version}:{" "}
            {inspection.ready ? "текст готов" : "есть ошибки"}. Надписей:{" "}
            {inspection.total}.
          </p>
          {inspection.items.map((n: any) => (
            <p key={n.nodeId}>
              <strong>{n.text}</strong> · {n.layout.fontSize.toFixed(1)} px ·{" "}
              {n.layout.totalLines ?? n.layout.lines.length} стр.
              {n.layout.overflow ? " · переполнение" : ""}
            </p>
          ))}
          {inspection.diagnostics.map((d: any, i: number) => (
            <p key={i}>{d.message}</p>
          ))}
          <button
            type="button"
            className="btn secondary"
            disabled={disabled || busy}
            onClick={() => void inspect(true)}
          >
            Посмотреть диагностический кадр
          </button>
          {inspection.preview && (
            <figure>
              <img
                src={`data:image/png;base64,${inspection.preview.base64}`}
                alt={`Диагностический кадр черновика v${inspection.version}`}
                style={{ maxWidth: "100%" }}
              />
              <figcaption>
                Диагностика черновика v{inspection.version}, без фиксации
                ревизии.
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </section>
  );
}
