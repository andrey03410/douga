"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CompiledVideo } from "@douga/video";
import type { VideoRecipe } from "@douga/video/recipes";
import type { InspectionOrigin } from "@/server/studio/storyboard-types";
const Preview = dynamic(() => import("../StudioPreview"), {
  ssr: false,
  loading: () => <p className="muted">Загрузка примера…</p>,
});
type Metadata = Omit<VideoRecipe, "preset" | "example">;
type Project = {
  id: string;
  kind: "top" | "picker" | "board";
  version: number;
  revision: number;
  title?: string;
};
type TryResult = {
  recipeId: string;
  origin: InspectionOrigin;
  plan: CompiledVideo;
  ready: boolean;
  diagnostics: { severity: string; code: string; message: string }[];
};
const kinds = { top: "Топ", picker: "Пикер", board: "Доска" };
const formats = {
  wide: "Широкий · 16:9",
  vertical: "Вертикальный · 9:16",
  square: "Квадрат · 1:1",
};
const styles: Record<string, string> = {
  clean: "Чистый",
  cinematic: "Кино и OST",
  "anime-impact": "Аниме-акцент",
  manga: "Манга",
  neon: "Неон",
  "board-clear": "Ясная доска",
};
const errors: Record<string, string> = {
  VERSION_CONFLICT:
    "Проект изменился. Обновите список проектов и повторите примерку.",
  PRESET_INCOMPATIBLE:
    "Этот рецепт не совместим со структурой проекта. Выберите другой рецепт или создайте новое видео.",
  VALIDATION_FAILED:
    "В текущем проекте есть ошибки документа или материалов. Исправьте их в редакторе.",
  RECIPE_CONTENT_UNSUPPORTED:
    "Структура проекта не поддерживает такую примерку. Создайте отдельный проект по рецепту.",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/studio/${path}`, {
    method,
    signal,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error(
      errors[value.error] ?? value.error ?? "Не удалось выполнить запрос",
    );
  return value;
}
export default function RecipeGallery({
  projectId,
  sourceId,
}: {
  projectId?: string;
  sourceId?: string;
}) {
  const [kind, setKind] = useState(""),
    [format, setFormat] = useState("wide"),
    [style, setStyle] = useState(""),
    [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<Metadata[]>([]),
    [selectedId, setSelectedId] = useState("");
  const [recipe, setRecipe] = useState<VideoRecipe | null>(null),
    [sample, setSample] = useState<CompiledVideo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [nextProjectCursor, setNextProjectCursor] = useState<string | null>(null),
    [selectedProject, setSelectedProject] = useState(projectId ?? "");
  const [tryIds, setTryIds] = useState<string[]>([]),
    [tries, setTries] = useState<TryResult[]>([]);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false);
  const [applyMode, setApplyMode] = useState<"preserve" | "replace">("preserve");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [createdProject, setCreatedProject] = useState("");
  const detail = useRef<HTMLElement>(null),
    compareSection = useRef<HTMLDivElement>(null);
  const currentProject = projects.find((p) => p.id === selectedProject);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadProjects(cursor?: string, append = false) {
    const data = await api<{ items: Project[]; nextCursor: string | null }>(
      `projects?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setProjects((old) =>
      append
        ? [...old, ...data.items.filter((p) => !old.some((v) => v.id === p.id))]
        : data.items,
    );
    setNextProjectCursor(data.nextCursor);
  }
  useEffect(() => {
    void loadProjects().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ all: "1", format });
    if (kind) params.set("kind", kind);
    if (style) params.set("style", style);
    if (query.trim()) params.set("query", query.trim());
    const timer = setTimeout(() => {
      void api<{ items: Metadata[] }>(
        `recipes?${params}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((data) => {
          setRecipes(data.items);
          setSelectedId((id) =>
            data.items.some((r) => r.id === id)
              ? id
              : (data.items[0]?.id ?? ""),
          );
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, format, style, query]);
  useEffect(() => {
    setRecipe(null);
    setSample(null);
    setConsent(false);
    if (!selectedId) return;
    const controller = new AbortController();
    setDetailLoading(true);
    void Promise.all([
      api<VideoRecipe>(
        `recipes/${encodeURIComponent(selectedId)}`,
        "GET",
        undefined,
        controller.signal,
      ),
      api<{ plan: CompiledVideo }>(
        `recipes/${encodeURIComponent(selectedId)}/plan`,
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([data, preview]) => {
        setRecipe(data);
        setSample(preview.plan);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);
  async function previewProject() {
    if (!currentProject)
      throw Error(
        "Выберите проект из списка. Если его нет, загрузите следующую страницу списка.",
      );
    const ids = tryIds.length ? tryIds : recipe ? [recipe.id] : [];
    if (!ids.length) return;
    const results = await Promise.all(
      ids.slice(0, 3).map((id) =>
        api<TryResult>(`recipes/${encodeURIComponent(id)}/try`, "POST", {
          projectId: currentProject.id,
          expectedVersion: currentProject.version,
          mode: applyMode,
        }),
      ),
    );
    setTries(results);
    setNotice(
      "Примерка собрана на материалах выбранного проекта. Черновик не изменён.",
    );
    setTimeout(
      () =>
        compareSection.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  }
  async function apply() {
    if (!recipe || !currentProject || !consent) return;
    const value = await api<{ version: number }>(
      `projects/${encodeURIComponent(currentProject.id)}/preset`,
      "POST",
      {
        presetId: recipe.id,
        mode: applyMode,
        expectedVersion: currentProject.version,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setProjects((items) =>
      items.map((p) =>
        p.id === currentProject.id ? { ...p, version: value.version } : p,
      ),
    );
    setTries([]);
    setConsent(false);
    setCreatedProject(currentProject.id);
    setNotice(
      `Оформление применено к серверному черновику v${value.version}. Откройте его отдельно и проверьте раскадровку.`,
    );
  }
  async function create() {
    if (!recipe) return;
    const value = await api<{ id: string }>("projects", "POST", {
      presetId: recipe.id,
      ...(sourceId && recipe.kind === "top" ? { sourceId } : {}),
      title: `${kinds[recipe.kind]} · ${recipe.name}`,
      idempotencyKey: crypto.randomUUID(),
    });
    setCreatedProject(value.id);
    setNotice(
      "Проект создан. Откройте его отдельно, добавьте свои материалы и ответы по форме рецепта.",
    );
    await loadProjects();
  }
  async function copyExample() {
    if (!recipe) return;
    await navigator.clipboard.writeText(
      JSON.stringify(recipe.contentForm.example, null, 2),
    );
    setNotice(
      "Пример заполнения скопирован. Замените участников, материалы и авторские решения своими данными.",
    );
  }
  return (
    <>
      <nav className="sb-breadcrumb">
        <a
          href={
            projectId
              ? `/studio/${encodeURIComponent(projectId)}`
              : "/studio/new"
          }
          target={projectId ? "_blank" : undefined}
          rel={projectId ? "noopener" : undefined}
        >
          ← {projectId ? "Открыть редактор" : "Создать видео"}
        </a>
        <a href="/projects">Мои видео</a>
      </nav>
      <header className="sb-heading recipe-heading">
        <p className="sb-eyebrow">DOUGA / РЕЦЕПТЫ</p>
        <h1>
          Сначала характер.
          <br />
          <span>Потом ваши герои.</span>
        </h1>
        <p>
          Выберите топ, пикер или доску. Посмотрите живой образец и примерьте до
          трёх направлений на своих материалах.
        </p>
      </header>
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
      {createdProject && (
        <div className="studio-toolbar">
          <a
            className="btn"
            href={`/studio/${encodeURIComponent(createdProject)}`}
            target="_blank"
            rel="noopener"
          >
            Открыть проект отдельно ↗
          </a>
          <a
            className="btn secondary"
            href={`/studio/${encodeURIComponent(createdProject)}/storyboard`}
            target="_blank"
            rel="noopener"
          >
            Посмотреть раскадровку ↗
          </a>
        </div>
      )}
      <section className="panel sb-controls" aria-label="Фильтры рецептов">
        <div className="sb-filter-row">
          <label>
            Тип видео
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Все типы</option>
              {Object.entries(kinds).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Формат
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setTryIds([]);
                setTries([]);
              }}
            >
              {Object.entries(formats).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Характер
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="">Все направления</option>
              {Object.entries(styles).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Найти
            <input
              type="search"
              value={query}
              maxLength={500}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Например, длинные имена"
            />
          </label>
        </div>
      </section>
      <section aria-label="Каталог рецептов" aria-busy={loading}>
        {loading && (
          <p className="muted" role="status">
            Загрузка рецептов…
          </p>
        )}
        {!loading && !recipes.length && (
          <p className="panel">
            Подходящих рецептов пока нет. Попробуйте другой тип, формат или
            направление.
          </p>
        )}
        <div className="recipe-grid">
          {recipes.map((item) => (
            <article
              key={item.id}
              className={`recipe-card ${selectedId === item.id ? "selected" : ""}`}
            >
              <button
                className="recipe-card-open"
                aria-pressed={selectedId === item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setTimeout(
                    () =>
                      detail.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      }),
                    50,
                  );
                }}
              >
                <RecipeThumbnail recipe={item} />
                <div className="recipe-card-copy">
                  <span className="sb-eyebrow">
                    {kinds[item.kind]} / {styles[item.style]}
                  </span>
                  <h2>{item.name}</h2>
                  <p>{item.description}</p>
                  <small>
                    {item.motion} · {item.density.recommendedCards} карточек в
                    рекомендованной композиции
                  </small>
                </div>
              </button>
              <label className="recipe-pick">
                <input
                  type="checkbox"
                  checked={tryIds.includes(item.id)}
                  disabled={!tryIds.includes(item.id) && tryIds.length >= 3}
                  onChange={(e) => {
                    setTryIds((ids) =>
                      e.target.checked
                        ? [...ids, item.id]
                        : ids.filter((id) => id !== item.id),
                    );
                    setTries([]);
                  }}
                />
                Сравнить на моём видео
              </label>
            </article>
          ))}
        </div>
      </section>
      <section
        ref={detail}
        className="panel recipe-detail"
        aria-label="Выбранный рецепт"
      >
        {detailLoading ? (
          <p role="status">Готовим живой пример…</p>
        ) : recipe ? (
          <>
            <div className="sb-result-heading">
              <div>
                <p className="sb-eyebrow">ЖИВОЙ ПРИМЕР</p>
                <h2>{styles[recipe.style] ?? recipe.name}</h2>
              </div>
              <span className="sb-status">{formats[recipe.format]}</span>
            </div>
            <p>{recipe.description}</p>
            {sample && <Preview plan={sample} />}
            <p className="muted">
              Образец использует демонстрационные материалы. Для примерки на
              ваших участниках выберите проект ниже.
            </p>
            <div className="recipe-facts">
              <div>
                <small>Читаемая плотность</small>
                <strong>
                  Около {recipe.density.recommendedCards} карточек
                </strong>
              </div>
              <div>
                <small>Длительность</small>
                <strong>Ориентир {recipe.durationSec.recommended} с</strong>
              </div>
              <div>
                <small>Материалы</small>
                <strong>Изображения или видео · звук по желанию</strong>
              </div>
              <div>
                <small>Языки образца</small>
                <strong>{recipe.languages.join(" / ")}</strong>
              </div>
            </div>
            <div className="studio-toolbar">
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run(create)}
              >
                {sourceId && recipe.kind === "top"
                  ? "Создать топ по моему турниру"
                  : "Создать проект по рецепту"}
              </button>
              <a
                href={`/api/studio/recipes/${encodeURIComponent(recipe.id)}/preview?version=${recipe.version}`}
                target="_blank"
                rel="noopener"
              >
                Открыть эталон PNG ↗
              </a>
            </div>
            <details className="recipe-form">
              <summary>Что заполнить в этом рецепте</summary>
              <p>
                Форма сохраняет оформление. Участников, места, ответы и
                распределение по доске задаёте вы.
              </p>
              <dl>
                <dt>Обязательно</dt>
                <dd>
                  {recipe.contentForm.required.join(", ") ||
                    "Нет обязательных полей"}
                </dd>
                <dt>Можно добавить</dt>
                <dd>{recipe.contentForm.optional.join(", ") || "—"}</dd>
              </dl>
              <ul>
                {recipe.contentForm.constraints.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              {recipe.contentForm.slotIds && (
                <p>Доступные слоты: {recipe.contentForm.slotIds.join(", ")}</p>
              )}
              <p className="muted">
                Ниже пример предметных данных для инструмента заполнения видео.
                Замените демонстрационные значения своими.
              </p>
              <pre className="studio-code">
                {JSON.stringify(recipe.contentForm.example, null, 2)}
              </pre>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => void run(copyExample)}
              >
                Скопировать пример заполнения
              </button>
            </details>
          </>
        ) : (
          <p className="muted">Выберите рецепт в каталоге.</p>
        )}
      </section>
      <section className="panel" aria-label="Примерка на проекте">
        <h2>Как это выглядит с вашими героями</h2>
        <p>
          Выберите сохранённый проект. Примерка сохраняет его участников,
          материалы и авторские решения; черновик остаётся прежним.
        </p>
        <div className="sb-filter-row">
          <label>
            Моё видео
            <select
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setTries([]);
                setConsent(false);
                setCreatedProject("");
              }}
            >
              <option value="">Выберите проект</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || `${kinds[p.kind]} · ${p.id.slice(0, 8)}`} · v
                  {p.version}
                </option>
              ))}
            </select>
          </label>
          <label>Локальное оформление
            <select value={applyMode} onChange={event => { setApplyMode(event.target.value as "preserve" | "replace"); setTries([]); setConsent(false); }}>
              <option value="preserve">Сохранить мои настройки</option>
              <option value="replace">Заменить оформление рецептом</option>
            </select>
          </label>
          <div className="studio-toolbar">
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => void run(() => loadProjects())}
            >
              Обновить список
            </button>
            {nextProjectCursor && (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() =>
                  void run(() => loadProjects(nextProjectCursor, true))
                }
              >
                Ещё проекты
              </button>
            )}
          </div>
        </div>
        {selectedProject && !currentProject && (
          <p className="sb-alert">
            Этот проект пока не загружен в список. Загрузите следующие страницы
            или выберите доступный проект.
          </p>
        )}
        <p className="muted">
          Для сравнения отмечено: {tryIds.length} из 3.{" "}
          {tryIds.length
            ? "Будут показаны только отмеченные рецепты."
            : "Будет показан текущий выбранный рецепт."}
        </p>
        <button
          className="btn secondary"
          disabled={busy || !currentProject || (!tryIds.length && !recipe)}
          onClick={() => void run(previewProject)}
        >
          {busy ? "Подготовка…" : "Примерить без изменения проекта"}
        </button>
        <div ref={compareSection} className="recipe-comparisons">
          {tries.map((value) => (
            <article key={value.recipeId}>
              <h3>
                {recipes.find((r) => r.id === value.recipeId)?.name ??
                  value.recipeId}
              </h3>
              <p className="muted">
                Ваш черновик v{value.origin.version} ·{" "}
                {value.origin.format.width} × {value.origin.format.height}
              </p>
              <Preview plan={value.plan} />
              {!value.ready && (
                <p className="sb-alert">
                  Есть замечания к образцу:{" "}
                  {value.diagnostics
                    .slice(0, 3)
                    .map((d) => d.message)
                    .join(" ")}
                </p>
              )}
              <button
                className="sb-text-button"
                onClick={() => {
                  setSelectedId(value.recipeId);
                  detail.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                Выбрать этот рецепт
              </button>
            </article>
          ))}
        </div>
        {recipe && currentProject && (
          <div className="recipe-apply">
            <h3>Применить выбранное оформление</h3>
            <p>
              {styles[recipe.style] ?? recipe.name} →{" "}
              {currentProject.title || kinds[currentProject.kind]} · серверный
              черновик v{currentProject.version}.
            </p>
            <p className="muted">{applyMode === "preserve" ? "Авторские настройки оформления сохранятся." : "Локальные настройки оформления будут заменены."} Сцены, порядок, материалы и длительности сохраняются.</p>
            <label className="sb-fix">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                Я сохранил нужные локальные изменения в редакторе. Понимаю, что
                применение обновит оформление серверного черновика; открытая
                вкладка редактора может показать конфликт версий.
              </span>
            </label>
            <button
              className="btn"
              disabled={busy || !consent || currentProject.kind !== recipe.kind}
              onClick={() => void run(apply)}
            >
              Применить: {styles[recipe.style] ?? recipe.name}
            </button>
            {currentProject.kind !== recipe.kind && (
              <p className="muted">
                Для применения выберите рецепт того же типа видео.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
function RecipeThumbnail({ recipe }: { recipe: Metadata }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <div
      className={`recipe-thumb recipe-${recipe.style}`}
      style={{
        aspectRatio:
          recipe.format === "vertical"
            ? "9 / 12"
            : recipe.format === "square"
              ? "1"
              : "16 / 9",
      }}
    >
      {unavailable ? (
        <div className="recipe-thumb-pending">
          <span>{styles[recipe.style]}</span>
          <small>
            Эталон ещё не подготовлен или недоступен.
            <br />
            Нажмите, чтобы посмотреть живой пример.
          </small>
        </div>
      ) : (
        <img
          src={`/api/studio/recipes/${encodeURIComponent(recipe.id)}/preview?version=${recipe.version}`}
          alt={`Пример оформления ${recipe.name}`}
          loading="lazy"
          onError={() => setUnavailable(true)}
        />
      )}
    </div>
  );
}
