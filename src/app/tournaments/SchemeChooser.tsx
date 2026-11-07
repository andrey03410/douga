"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SCHEMES, type Scheme } from "@/lib/domain/types";
import {
  DEFAULT_TIERS,
  SCHEME_INFO,
  defaultSchemeSettings,
  type SchemeSettings,
} from "@/lib/domain/scheme-settings";
import { pluralRu } from "@/lib/domain/art-usage";
import {
  ACCURACY_LABEL,
  chooserEstimate,
  maxGroupFor,
  parseTierNames,
  recommendedSchemes,
  schemeHint,
  settingsSummary,
} from "./scheme-chooser";

/** Order in the chooser: from exact and small to fast and large. */
const ORDER: Scheme[] = ["round_robin", "merge", "insertion", "top_k", "rating", "tiers", "swiss", "bracket"];

/**
 * Task 33 (P15–P19): the person picks the algorithm of a segment — or the
 * same one for every segment — with settings, group size and the screen
 * estimate the engine computes for the actual field. Answers are kept.
 */
export function SchemeChooser({
  tournamentId,
  segmentId,
  segmentCount,
  itemCount,
  current,
  currentSettings,
  groupSize,
  segmentCompleted,
  initiallyOpen = false,
  onChosen,
}: {
  tournamentId: string;
  segmentId: string;
  segmentCount: number;
  itemCount: number;
  current: Scheme | null;
  currentSettings: SchemeSettings;
  groupSize: number;
  segmentCompleted: boolean;
  initiallyOpen?: boolean;
  onChosen?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen || current === null);
  const [scheme, setScheme] = useState<Scheme>(current ?? recommendedSchemes(itemCount)[0]);
  const [settings, setSettings] = useState<Record<Scheme, SchemeSettings>>(() => {
    const all = Object.fromEntries(SCHEMES.map((s) => [s, defaultSchemeSettings(s)])) as Record<
      Scheme,
      SchemeSettings
    >;
    if (current) all[current] = { ...all[current], ...currentSettings };
    if (!current || current !== "top_k") all.top_k = { k: Math.max(1, Math.min(10, itemCount)) };
    return all;
  });
  const [tierText, setTierText] = useState((settings.tiers.tiers ?? DEFAULT_TIERS).join(", "));
  const [size, setSize] = useState(Math.max(2, groupSize));
  const [allSegments, setAllSegments] = useState(segmentCount > 1 && current === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recommended = recommendedSchemes(itemCount);
  const s = settings[scheme];
  const tierNames = parseTierNames(tierText);
  const effectiveSize = Math.min(size, maxGroupFor(scheme));

  const estimates = useMemo(() => {
    const out = {} as Record<Scheme, number>;
    for (const x of SCHEMES) out[x] = chooserEstimate(x, itemCount, size, settings[x]);
    return out;
  }, [itemCount, size, settings]);

  const patch = (next: SchemeSettings) => setSettings((old) => ({ ...old, [scheme]: { ...old[scheme], ...next } }));

  async function submit() {
    setError("");
    if (scheme === "tiers" && !tierNames) {
      setError("Корзин нужно от 2 до 7, названия разные и короче 20 символов");
      return;
    }
    if (scheme === "top_k" && (!Number.isInteger(s.k) || (s.k ?? 0) < 1)) {
      setError("K — целое число от 1");
      return;
    }
    setBusy(true);
    try {
      const body =
        scheme === "tiers"
          ? { tiers: tierNames!, rankTop: Math.min(s.rankTop ?? 0, tierNames!.length) }
          : scheme === "bracket"
            ? { thirdPlace: Boolean(s.thirdPlace) && effectiveSize === 2 }
            : s;
      const res = await fetch(`/api/tournaments/${tournamentId}/scheme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme, settings: body, segmentId, allSegments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(data.error ?? "Не удалось сменить алгоритм");
      // After the scheme: the group cap depends on the algorithms of the segments.
      if (size !== groupSize) {
        const r = await fetch(`/api/tournaments/${tournamentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupSize: size }),
        });
        if (!r.ok) throw Error("Алгоритм выбран, но размер группы не сохранился");
      }
      setOpen(false);
      if (onChosen) await onChosen();
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <section className="panel scheme-block" id="algorithm">
        <div className="row spread">
          <div>
            <h2 style={{ margin: 0 }}>Алгоритм: {current ? SCHEME_INFO[current].label : "не выбран"}</h2>
            {current ? (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {[SCHEME_INFO[current].result, settingsSummary(current, currentSettings)].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn secondary" onClick={() => setOpen(true)}>
            {current ? "Сменить алгоритм" : "Выбрать алгоритм"}
          </button>
        </div>
      </section>
    );

  return (
    <section className="panel scheme-block" id="algorithm" aria-label="Выбор алгоритма">
      <h2 style={{ marginTop: 0 }}>{current ? "Сменить алгоритм" : "Выберите алгоритм расстановки"}</h2>
      <p className="muted">
        {schemeHint(itemCount)} Ответы сохраняются при любой смене: новый алгоритм дозадаст только то, чего
        ему не хватает.
      </p>
      <div className="scheme-options" role="radiogroup" aria-label="Алгоритм">
        {ORDER.map((x) => {
          const info = SCHEME_INFO[x];
          return (
            <label key={x} className={`scheme-option${scheme === x ? " selected" : ""}`}>
              <input
                type="radio"
                name={`scheme-${segmentId}`}
                value={x}
                checked={scheme === x}
                onChange={() => setScheme(x)}
              />
              <span className="scheme-title">
                <b>{info.label}</b>
                {recommended.includes(x) ? <span className="tag recommend">подходит</span> : null}
                {current === x ? <span className="tag">сейчас</span> : null}
              </span>
              <span className="scheme-estimate">
                ≈ {estimates[x]} {pluralRu(estimates[x], ["экран", "экрана", "экранов"])}
              </span>
              <small>{info.screens}</small>
              <small className="muted">
                {info.result}. {info.when}.
              </small>
            </label>
          );
        })}
      </div>

      <div className="scheme-settings">
        {scheme === "top_k" ? (
          <label>
            Сколько мест определить строго (K)
            <input
              type="number"
              min={1}
              max={Math.max(1, itemCount)}
              value={s.k ?? 10}
              onChange={(e) => patch({ k: Math.floor(Number(e.target.value)) })}
            />
            <small className="muted">Остальные получат «не вошли». K можно увеличить потом — ответы сохранятся.</small>
          </label>
        ) : null}
        {scheme === "tiers" ? (
          <>
            <label>
              Корзины через запятую, от лучшей (2–7)
              <input value={tierText} onChange={(e) => setTierText(e.target.value)} />
            </label>
            <label>
              Упорядочить внутри корзин
              <select
                value={Math.min(s.rankTop ?? 0, tierNames?.length ?? 0)}
                onChange={(e) => patch({ rankTop: Number(e.target.value) })}
              >
                <option value={0}>нет — итог это тир-лист</option>
                {(tierNames ?? []).map((_, i) => (
                  <option key={i} value={i + 1}>
                    {(tierNames ?? []).slice(0, i + 1).join(", ")}
                  </option>
                ))}
              </select>
            </label>
            <small className="muted">
              Экран корзин — один участник и кнопки корзин; 0 — «не участвует». Порядок внутри — вставкой.
            </small>
          </>
        ) : null}
        {scheme === "rating" ? (
          <label>
            Точность
            <select
              value={s.accuracy ?? "normal"}
              onChange={(e) => patch({ accuracy: e.target.value as SchemeSettings["accuracy"] })}
            >
              {(Object.keys(ACCURACY_LABEL) as (keyof typeof ACCURACY_LABEL)[]).map((a) => (
                <option key={a} value={a}>
                  {ACCURACY_LABEL[a]}
                </option>
              ))}
            </select>
            <small className="muted">Чем точнее, тем больше разных соперников у каждого участника.</small>
          </label>
        ) : null}
        {scheme === "bracket" ? (
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(s.thirdPlace)}
              disabled={effectiveSize !== 2}
              onChange={(e) => patch({ thirdPlace: e.target.checked })}
            />
            Матч за 3-е место{effectiveSize !== 2 ? " (только для пар)" : ""}
          </label>
        ) : null}
        {maxGroupFor(scheme) > 2 && scheme !== "tiers" ? (
          <label>
            Участников на экране
            <select value={effectiveSize} onChange={(e) => setSize(Number(e.target.value))}>
              {Array.from({ length: maxGroupFor(scheme) - 1 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n === 2 ? "2 — пара" : `${n} — расставить по местам`}
                </option>
              ))}
            </select>
            {effectiveSize > 5 ? <small className="muted">Больше пяти за раз удержать в голове тяжело.</small> : null}
          </label>
        ) : scheme !== "tiers" ? (
          <p className="muted">Этот алгоритм спрашивает только парами.</p>
        ) : null}
      </div>

      {segmentCount > 1 ? (
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={allSegments} onChange={(e) => setAllSegments(e.target.checked)} />
          Для всех сегментов ({segmentCount})
        </label>
      ) : null}
      {segmentCompleted || (allSegments && segmentCount > 1) ? (
        <p className="muted">
          {allSegments ? "Готовые сегменты" : "Сегмент готов:"} откроются снова — результат пересчитается, ручной
          порядок мест сбросится. Ответы сохранятся.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "Сохраняем…" : `Выбрать: ${SCHEME_INFO[scheme].label}`}
        </button>
        {current ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>
            Отмена
          </button>
        ) : null}
      </div>
    </section>
  );
}
