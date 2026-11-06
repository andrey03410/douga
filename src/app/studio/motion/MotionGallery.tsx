"use client";
import { useMemo, useState } from "react";
import {
  compileVideo,
  createMotionExample,
  motionCatalog,
  type MotionCatalogCategory,
  type MotionCatalogEntry,
  type MotionProfile,
  type MotionIntensity,
} from "@/video";
import StudioPreview from "../StudioPreview";
const categories: { id: MotionCatalogCategory; label: string; note: string }[] =
  [
    { id: "effect", label: "Эффекты", note: "Вход, выход, движение и акцент" },
    {
      id: "choreography",
      label: "Хореографии",
      note: "Согласованное движение сцены",
    },
    { id: "transition", label: "Переходы", note: "Связь двух историй" },
    { id: "backdrop", label: "Фоны", note: "Глубина и атмосфера" },
    { id: "widget", label: "Виджеты", note: "Таймер, VS и акценты" },
  ];
export default function MotionGallery() {
  const [category, setCategory] = useState<MotionCatalogCategory>("effect");
  const [name, setName] = useState("pop");
  const [profile, setProfile] = useState<MotionProfile>("smooth");
  const [intensity, setIntensity] = useState<MotionIntensity>("normal");
  const [variant, setVariant] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const entries = motionCatalog.entries.filter(
    (entry) => entry.category === category,
  );
  const entry: MotionCatalogEntry =
    entries.find((entry) => entry.name === name) ?? entries[0];
  const example = useMemo(
    () =>
      createMotionExample(entry, {
        profile,
        intensity,
        ...(variant ? { variant } : {}),
      }),
    [entry, profile, intensity, variant],
  );
  const compiled = useMemo(
    () => compileVideo(example.document, example.standInManifest),
    [example],
  );
  const json = JSON.stringify(
    { fragmentKind: example.fragmentKind, fragment: example.fragment },
    null,
    2,
  );
  const chooseCategory = (next: MotionCatalogCategory) => {
    setCategory(next);
    setName(
      motionCatalog.entries.find((entry) => entry.category === next)!.name,
    );
    setVariant("");
    setCopyStatus("");
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopyStatus("JSON скопирован");
    } catch {
      setCopyStatus("Не удалось скопировать. Выделите JSON ниже.");
    }
  }
  return (
    <div data-motion-gallery className="motion-gallery">
      <nav className="motion-categories" aria-label="Категория моушена">
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={category === item.id}
            onClick={() => chooseCategory(item.id)}
          >
            <span>{item.label}</span>
            <small>
              {
                motionCatalog.entries.filter(
                  (entry) => entry.category === item.id,
                ).length
              }
            </small>
          </button>
        ))}
      </nav>
      <div className="motion-layout">
        <section
          className="motion-controls panel"
          aria-label="Настройки примера"
        >
          <p className="motion-eyebrow">
            {categories.find((item) => item.id === category)!.note}
          </p>
          <label htmlFor="motion-name">Приём</label>
          <select
            id="motion-name"
            value={entry.name}
            onChange={(event) => {
              setName(event.target.value);
              setVariant("");
              setCopyStatus("");
            }}
          >
            {entries.map((entry) => (
              <option
                key={`${entry.category}:${entry.name}`}
                value={entry.name}
              >
                {entry.name}
              </option>
            ))}
          </select>
          <h2>{entry.name}</h2>
          <p>{entry.description}</p>
          <label htmlFor="motion-profile">Профиль движения</label>
          <select
            id="motion-profile"
            value={profile}
            disabled={!["effect", "choreography"].includes(category)}
            onChange={(event) => {
              setProfile(event.target.value as MotionProfile);
              setCopyStatus("");
            }}
          >
            <option value="smooth">Плавный / smooth</option>
            <option value="snappy">Резкий / snappy</option>
            <option value="bouncy">Пружинящий / bouncy</option>
            <option value="cinematic">Кинематографичный / cinematic</option>
          </select>
          <label htmlFor="motion-intensity">Сила движения</label>
          <select
            id="motion-intensity"
            value={intensity}
            disabled={
              !["effect", "choreography", "backdrop"].includes(category)
            }
            onChange={(event) => {
              setIntensity(event.target.value as MotionIntensity);
              setCopyStatus("");
            }}
          >
            <option value="subtle">Мягко / subtle</option>
            <option value="normal">Обычно / normal</option>
            <option value="bold">Выразительно / bold</option>
          </select>
          {entry.variants && (
            <>
              <label htmlFor="motion-variant">Вариант виджета</label>
              <select
                id="motion-variant"
                value={variant || (entry.name === "timer" ? "ring" : "neon")}
                onChange={(event) => {
                  setVariant(event.target.value);
                  setCopyStatus("");
                }}
              >
                {entry.variants.map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
              </select>
            </>
          )}
          <h3>Параметры</h3>
          <p className="motion-parameters">
            {entry.parameters.map((parameter) => (
              <code key={parameter}>{parameter}</code>
            ))}
          </p>
          {entry.channels.length > 0 && (
            <p className="muted">Каналы: {entry.channels.join(", ")}</p>
          )}
        </section>
        <section className="motion-demo" aria-label="Просмотр примера">
          <div data-motion-preview className="motion-preview">
            {compiled.ready ? (
              <StudioPreview
                key={`${category}:${entry.name}:${profile}:${intensity}:${variant}`}
                plan={compiled.plan}
              />
            ) : (
              <p role="alert">Не удалось собрать пример.</p>
            )}
          </div>
          <div className="motion-demo-caption">
            <span>Локальная синтетическая сцена</span>
            <span>
              {compiled.plan.fps} FPS ·{" "}
              {(compiled.plan.durationInFrames / compiled.plan.fps).toFixed(1)}{" "}
              с
            </span>
          </div>
          <details className="panel motion-json" open>
            <summary>JSON для вашего документа</summary>
            <p className="muted">
              Фрагмент: {example.fragmentKind}. Вставьте его в соответствующий
              узел или настройки. Полные документы: MCP video_examples.
            </p>
            <button className="btn" type="button" onClick={copy}>
              Копировать JSON
            </button>
            <span className="motion-copy-status" role="status">
              {copyStatus}
            </span>
            <pre className="studio-code" tabIndex={0}>
              {json}
            </pre>
          </details>
        </section>
      </div>
    </div>
  );
}
