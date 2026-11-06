"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaPlayer } from "../../MediaPlayer";
import { SchemeChooser } from "../../SchemeChooser";
import { digitIndex, rankClick, tierFromKey, wrapIndex } from "../../compare-state";
import type { Scheme } from "@/lib/domain/types";
import type { SchemeSettings } from "@/lib/domain/scheme-settings";

interface Item {
  id: string;
  title: string;
  artist: string | null;
  kind: "audio" | "video" | "image";
  subtitle: string | null;
  audioUrl: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  durationSec?: number | null;
}
interface Standing {
  trackId: string;
  rank: number;
  title: string;
  artist: string | null;
  score: number;
}
interface NextResponse {
  activeSegmentId: string;
  segmentTitle?: string;
  segmentCount: number;
  blindMode: boolean;
  scheme: Scheme | null;
  schemeLabel: string | null;
  schemeRequired: boolean;
  settings: SchemeSettings;
  tierNames: string[] | null;
  itemCount: number;
  isComplete: boolean;
  canExtend: boolean;
  groupSize: number;
  maxGroupSize: number;
  screens: { completed: number; estimatedTotal: number };
  coverage: { pairs: number; ordered: number; orderedPct: number; contradictory: number };
  standings: Standing[] | null;
  questionKind: "rank" | "pick" | "tier" | null;
  question: Item[] | null;
  preload: string[];
}
type Body = { ranked: string[]; rest: string[] } | { pick: string } | { itemId: string; tier: number };

export default function ComparePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { segmentId?: string };
}) {
  const segmentId = searchParams.segmentId;
  const segmentQuery = segmentId ? `?segmentId=${encodeURIComponent(segmentId)}` : "";
  const [data, setData] = useState<NextResponse | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Thumbnails of the whole segment load once: every next screen is in cache (T12).
  const preloaded = useRef(new Map<string, HTMLImageElement>());

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/tournaments/${params.id}/next${segmentQuery}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Не удалось загрузить сравнение");
      return;
    }
    const json: NextResponse = await res.json();
    setReveal(false);
    setPicks([]);
    setZoom(null);
    setData(json);
  }, [params.id, segmentQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    for (const url of data?.preload ?? []) {
      if (preloaded.current.has(url)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      preloaded.current.set(url, img);
    }
  }, [data?.preload]);

  const submit = useCallback(
    async (body: Body) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/tournaments/${params.id}/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, segmentId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Ошибка");
        await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, load, params.id, segmentId],
  );

  const act = useCallback(
    async (path: string, body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/tournaments/${params.id}${path}${segmentQuery}`, {
          method: body === undefined ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Ошибка");
        await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load, params.id, segmentQuery],
  );

  /** The one action of a participant card, whatever the screen asks. */
  const choose = useCallback(
    (id: string) => {
      const question = data?.question;
      if (!question || busy) return;
      if (data.questionKind === "pick") {
        void submit({ pick: id });
        return;
      }
      const step = rankClick(
        picks,
        id,
        question.map((t) => t.id),
      );
      if (step.kind === "submit") void submit({ ranked: step.ranked, rest: step.rest });
      else setPicks(step.picks);
    },
    [busy, data, picks, submit],
  );

  // Keys: digits answer, Backspace steps back, arrows and Esc drive the zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const question = data?.question;
      if (!question || !data) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (zoom !== null) {
        if (e.key === "Escape") return setZoom(null);
        if (e.key === "ArrowRight") return setZoom((z) => wrapIndex(z ?? 0, 1, question.length));
        if (e.key === "ArrowLeft") return setZoom((z) => wrapIndex(z ?? 0, -1, question.length));
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (picks.length) setPicks((p) => p.slice(0, -1));
        else if (!busy && data.screens.completed > 0) void act("/undo");
        return;
      }
      if (data.questionKind === "tier") {
        const tier = tierFromKey(e.key, data.tierNames?.length ?? 0);
        if (tier !== null && !busy) void submit({ itemId: question[0].id, tier });
        return;
      }
      const i = digitIndex(e.key, question.length);
      if (i !== null) choose(question[i].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [act, busy, choose, data, picks.length, submit, zoom]);

  if (error && !data) {
    return (
      <div className="container tournament-page">
        <div className="panel">
          <div className="error">{error}</div>
          <button className="btn secondary" onClick={() => load()} style={{ marginTop: 12 }}>
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="container tournament-page">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  const back = `/tournaments/${params.id}${segmentQuery}`;
  const pct = data.screens.estimatedTotal
    ? Math.min(100, Math.round((data.screens.completed / data.screens.estimatedTotal) * 100))
    : 0;
  const showNames = !data.blindMode || reveal;
  const question = data.question ?? [];
  const kind = data.questionKind;

  if (data.schemeRequired) {
    return (
      <div className="container tournament-page">
        <div className="row spread">
          <h1 style={{ margin: 0 }}>Перед первым экраном</h1>
          <a href={back} className="muted">
            ← К турниру
          </a>
        </div>
        {data.segmentTitle && data.segmentCount > 1 ? <p className="muted">{data.segmentTitle}</p> : null}
        <SchemeChooser
          tournamentId={params.id}
          segmentId={data.activeSegmentId}
          segmentCount={data.segmentCount}
          itemCount={data.itemCount}
          current={null}
          currentSettings={{}}
          groupSize={data.groupSize}
          segmentCompleted={false}
          initiallyOpen
          onChosen={load}
        />
      </div>
    );
  }

  const coverage = (
    <span className="coverage">
      Расставлено {data.coverage.orderedPct}% пар
      {data.coverage.contradictory > 0 ? ` · противоречий ${data.coverage.contradictory}` : ""}
    </span>
  );

  // Starting one player pauses the others — a cacophony helps nobody.
  const pauseOthers = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const self = e.currentTarget;
    document.querySelectorAll<HTMLMediaElement>(".compare-screen audio, .compare-screen video").forEach((m) => {
      if (m !== self) m.pause();
    });
  };

  async function markMoment(t: Item, player: HTMLMediaElement | null) {
    setError(null);
    setNotice("");
    try {
      const second = Math.round((player?.currentTime ?? 0) * 10) / 10;
      const res = await fetch(`/api/tracks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bestMomentSec: second }),
      });
      if (!res.ok) throw Error((await res.json()).error ?? "Не удалось сохранить момент");
      setNotice(`Лучший момент: ${second} с. Фрагмент в ролике начнётся отсюда.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Blind mode hides the footage too (it gives the track away): play the file
  // through an <audio> element until names are revealed.
  const player = (t: Item, maxHeight: number) => (
    <div className="comparison-player">
      <MediaPlayer
        key={t.id}
        src={t.audioUrl}
        title={showNames ? t.title : "Скрытый трек"}
        kind={t.kind === "video" && showNames ? "video" : "audio"}
        durationSec={t.durationSec}
        maxHeight={maxHeight}
        onPlay={pauseOthers}
      />
      <button
        type="button"
        className="btn ghost"
        onClick={(e) =>
          void markMoment(t, e.currentTarget.parentElement?.querySelector<HTMLMediaElement>("audio,video") ?? null)
        }
      >
        ★ Лучший момент здесь
      </button>
    </div>
  );

  const caption = (t: Item) =>
    showNames ? (
      <>
        <b>{t.title}</b>
        {t.subtitle || t.artist ? <small>{t.subtitle ?? t.artist}</small> : null}
      </>
    ) : (
      <b>{t.kind === "image" ? "Участник" : "🎧"}</b>
    );

  const sizePicker =
    data.maxGroupSize > 2 && kind !== "tier" ? (
      <label className="row" style={{ gap: 8, marginBottom: 0, fontSize: 13 }}>
        <span className="muted">Сравнивать за раз</span>
        <select
          value={data.groupSize}
          disabled={busy}
          onChange={(e) => void act("", { groupSize: Number(e.target.value) })}
          style={{ marginBottom: 0, width: 70 }}
        >
          {Array.from({ length: data.maxGroupSize - 1 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {data.groupSize > 5 ? (
          <span className="muted" title="Удержать в голове больше пяти за раз почти невозможно">
            ⚠
          </span>
        ) : null}
      </label>
    ) : kind === "tier" ? null : (
      <span className="muted" style={{ fontSize: 13 }}>
        Этот алгоритм спрашивает только парами
      </span>
    );

  const algorithm = (
    <span className="muted" style={{ fontSize: 13 }}>
      {data.schemeLabel} · <a href={`${back}#algorithm`}>сменить</a>
    </span>
  );

  if (data.isComplete) {
    return (
      <div className="container tournament-page">
        <h1>План сегмента пройден</h1>
        <p className="muted">
          Сделано {data.screens.completed} экранов. {coverage}. {algorithm}
        </p>
        {error ? <div className="error">{error}</div> : null}
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            {data.canExtend
              ? `Можно смотреть итог — или добрать точности ещё одним раундом: каждый участник получит ещё ${Math.max(1, data.groupSize - 1)} соперник(ов).`
              : "Можно смотреть итог."}
          </p>
          <div className="row" style={{ gap: 12 }}>
            <a className="btn" href={back}>
              Смотреть итог →
            </a>
            {data.canExtend ? (
              <button className="btn secondary" disabled={busy} onClick={() => void act("/extend")}>
                Ещё раунд
              </button>
            ) : null}
            <button
              className="btn ghost"
              disabled={busy || data.screens.completed === 0}
              onClick={() => void act("/undo")}
            >
              ← Отменить последний ответ
            </button>
          </div>
        </div>
      </div>
    );
  }

  const zoomed = zoom !== null ? question[zoom] : null;
  const rest = question.filter((t) => !picks.includes(t.id));
  const canStopEarly = kind === "rank" && question.length > 2 && rest.length > 1;
  const heading =
    kind === "tier"
      ? "В какую корзину?"
      : kind === "pick"
        ? "Выберите лучшего"
        : question.length > 2
          ? "Расставьте по местам"
          : "Что лучше?";

  return (
    <div className="container tournament-page compare-screen">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>{heading}</h1>
        <a href={back} className="muted">
          Выйти (прогресс сохранён)
        </a>
      </div>
      {data.segmentTitle && data.segmentCount > 1 ? <p className="muted">{data.segmentTitle}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="progressbar" style={{ margin: "16px 0 10px" }}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="compare-bar">
        <span className="coverage">
          {kind === "tier"
            ? `${data.screens.completed + 1} / ${data.screens.estimatedTotal}`
            : `Экран ${data.screens.completed + 1} из ~${data.screens.estimatedTotal}`}{" "}
          · {kind === "tier" ? null : <>{coverage} · </>}
          {algorithm}
        </span>
        {sizePicker}
      </div>
      {kind === "pick" ? (
        <p className="muted pick-hint">Одно нажатие — ответ: выбранный лучше каждого на экране. Остальные между собой не сравниваются.</p>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {kind === "tier" && question[0] ? (
        <TierScreen
          item={question[0]}
          tierNames={data.tierNames ?? []}
          caption={caption(question[0])}
          media={question[0].kind === "image" ? null : player(question[0], 260)}
          busy={busy}
          onTier={(tier) => void submit({ itemId: question[0].id, tier })}
          onZoom={() => setZoom(0)}
        />
      ) : (
        <div className={`compare-grid n${question.length}`}>
          {question.map((t, i) => {
            const place = picks.indexOf(t.id);
            return (
              <ParticipantCard
                key={t.id}
                item={t}
                index={i}
                caption={caption(t)}
                place={place >= 0 ? place + 1 : null}
                media={t.kind === "image" ? null : player(t, question.length === 2 ? 240 : 160)}
                busy={busy}
                actionLabel={
                  kind === "pick"
                    ? `Лучший (${i + 1})`
                    : place >= 0
                      ? `${place + 1} место`
                      : question.length === 2
                        ? `Это лучше (${i + 1})`
                        : `Выбрать (${i + 1})`
                }
                onChoose={() => choose(t.id)}
                onZoom={() => setZoom(i)}
              />
            );
          })}
        </div>
      )}

      <div className="row compare-actions">
        {kind === "rank" && question.length === 2 ? (
          <button
            className="btn secondary"
            onClick={() => void submit({ ranked: [], rest: [question[0].id, question[1].id] })}
            disabled={busy}
          >
            Ничья
          </button>
        ) : null}
        {canStopEarly ? (
          <button
            className="btn secondary"
            onClick={() => void submit({ ranked: picks, rest: rest.map((t) => t.id) })}
            disabled={busy}
          >
            Остальные примерно равны
          </button>
        ) : null}
        {picks.length > 0 ? (
          <button className="btn ghost" onClick={() => setPicks([])} disabled={busy}>
            Сбросить выбор
          </button>
        ) : null}
        <button
          className="btn ghost"
          disabled={busy || data.screens.completed === 0}
          onClick={() => void act("/undo")}
        >
          ← Отменить последний ответ
        </button>
        {data.blindMode ? (
          <button className="btn ghost" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Скрыть названия" : "Показать названия"}
          </button>
        ) : null}
        {data.standings ? (
          <button className="btn ghost" onClick={() => setShowTop((s) => !s)}>
            {showTop ? "Скрыть текущий топ" : "Показать текущий топ"}
          </button>
        ) : null}
      </div>
      <p className="muted keys-hint">
        {kind === "tier"
          ? `Клавиши: 1–${data.tierNames?.length ?? 0} — корзина, 0 — не участвует, Backspace — назад.`
          : "Клавиши: цифры — выбор, Backspace — назад, 🔍 или долгое нажатие — увеличить."}
      </p>

      {zoomed ? (
        <div
          className="zoom-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Увеличенная картинка"
          onClick={(e) => {
            if (e.target === e.currentTarget) setZoom(null);
          }}
        >
          <figure className="zoom-figure">
            {zoomed.imageUrl ? <img src={zoomed.imageUrl} alt={showNames ? zoomed.title : "Участник"} /> : null}
            <figcaption>{caption(zoomed)}</figcaption>
          </figure>
          <div className="zoom-controls">
            {question.length > 1 ? (
              <button
                type="button"
                className="btn secondary"
                aria-label="Предыдущий"
                onClick={() => setZoom((z) => wrapIndex(z ?? 0, -1, question.length))}
              >
                ←
              </button>
            ) : null}
            {kind !== "tier" ? (
              <button
                type="button"
                className="btn"
                disabled={busy || picks.includes(zoomed.id)}
                onClick={() => {
                  setZoom(null);
                  choose(zoomed.id);
                }}
              >
                {kind === "pick" ? "Лучший" : "Выбрать"} ({(zoom ?? 0) + 1})
              </button>
            ) : null}
            {question.length > 1 ? (
              <button
                type="button"
                className="btn secondary"
                aria-label="Следующий"
                onClick={() => setZoom((z) => wrapIndex(z ?? 0, 1, question.length))}
              >
                →
              </button>
            ) : null}
            <button type="button" className="btn ghost" aria-label="Закрыть" onClick={() => setZoom(null)}>
              ✕ Esc
            </button>
          </div>
        </div>
      ) : null}

      {showTop && data.standings ? (
        <div className="panel" style={{ marginTop: 22 }}>
          <h2>Предварительный топ</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            Промежуточные позиции по текущим ответам — будут меняться по ходу сравнений.
          </p>
          {data.standings.map((s) => (
            <div className="rank-row" key={s.trackId}>
              <div className="rank-num">{s.rank}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{s.title}</div>
                {s.artist ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {s.artist}
                  </div>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {s.score} очк.
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Long press opens the zoom on touch screens; the click that follows is swallowed. */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    fired,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") return;
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, 450);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => {
        if (fired.current) e.preventDefault();
      },
    },
  };
}

function ParticipantCard({
  item,
  index,
  caption,
  place,
  media,
  busy,
  actionLabel,
  onChoose,
  onZoom,
}: {
  item: Item;
  index: number;
  caption: React.ReactNode;
  place: number | null;
  media: React.ReactNode;
  busy: boolean;
  actionLabel: string;
  onChoose: () => void;
  onZoom: () => void;
}) {
  const press = useLongPress(onZoom);
  if (item.kind === "image")
    return (
      <div className={`pic-card${place ? " picked" : ""}`}>
        {place ? <span className="place-badge">{place}</span> : null}
        <button
          type="button"
          className="pic-choose"
          disabled={busy || place !== null}
          aria-label={`${actionLabel}: ${item.title}`}
          onClick={() => {
            if (press.fired.current) {
              press.fired.current = false;
              return;
            }
            onChoose();
          }}
          {...press.handlers}
        >
          <span className="pic-frame">
            {item.thumbUrl ? <img src={item.thumbUrl} alt="" draggable={false} /> : <span className="pic-none">?</span>}
            <span className="pic-key">{index + 1}</span>
          </span>
          <span className="pic-caption">{caption}</span>
        </button>
        <button type="button" className="pic-zoom" aria-label={`Увеличить: ${item.title}`} onClick={onZoom}>
          🔍
        </button>
      </div>
    );
  return (
    <div className={`group-card${place ? " picked" : ""}`}>
      {place ? <span className="place-badge">{place}</span> : null}
      <div className="name">{caption}</div>
      {media}
      <button className={`btn rank-pick${place ? " ghost" : ""}`} disabled={busy || place !== null} onClick={onChoose}>
        {actionLabel}
      </button>
    </div>
  );
}

function TierScreen({
  item,
  tierNames,
  caption,
  media,
  busy,
  onTier,
  onZoom,
}: {
  item: Item;
  tierNames: string[];
  caption: React.ReactNode;
  media: React.ReactNode;
  busy: boolean;
  onTier: (tier: number) => void;
  onZoom: () => void;
}) {
  return (
    <div className="tier-screen">
      <div className="tier-subject">
        {item.kind === "image" ? (
          <button type="button" className="tier-picture" onClick={onZoom} aria-label={`Увеличить: ${item.title}`}>
            {item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <span className="pic-none">?</span>}
          </button>
        ) : null}
        <div className="pic-caption">{caption}</div>
        {media}
      </div>
      <div className="tier-buttons">
        {tierNames.map((name, i) => (
          <button key={name} type="button" className="btn tier-button" disabled={busy} onClick={() => onTier(i)}>
            <span className="tier-key">{i + 1}</span> {name}
          </button>
        ))}
        <button type="button" className="btn ghost tier-button" disabled={busy} onClick={() => onTier(-1)}>
          <span className="tier-key">0</span> Не участвует
        </button>
      </div>
    </div>
  );
}
