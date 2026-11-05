"use client";

import { useCallback, useEffect, useState } from "react";
import { MediaPlayer } from "../../MediaPlayer";
import { useRouter } from "next/navigation";

interface TrackDto {
  id: string;
  title: string;
  artist: string | null;
  kind: "audio" | "video";
  audioUrl: string;
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
  activeSegmentId?: string;
  segmentTitle?: string;
  blindMode: boolean;
  isComplete: boolean;
  canExtend: boolean;
  groupSize: number;
  maxGroupSize: number;
  progress: { completed: number; estimatedTotal: number };
  screens: { completed: number; estimatedTotal: number };
  coverage: {
    pairs: number;
    ordered: number;
    orderedPct: number;
    contradictory: number;
  };
  standings: Standing[] | null;
  question: TrackDto[] | null;
}

export default function ComparePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { segmentId?: string };
}) {
  const segmentId = searchParams.segmentId;
  const segmentQuery = segmentId
    ? `?segmentId=${encodeURIComponent(segmentId)}`
    : "";
  const router = useRouter();
  const [data, setData] = useState<NextResponse | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `/api/tournaments/${params.id}/next${segmentQuery}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      setError("Не удалось загрузить сравнение");
      return;
    }
    const json: NextResponse = await res.json();
    setReveal(false);
    setPicks([]);
    setData(json);
  }, [params.id, segmentQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (ranked: string[], rest: string[]) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/tournaments/${params.id}/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ranked, rest, segmentId }),
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

  /** Click n-th: that track takes the next free place; the last one is implied. */
  const pick = useCallback(
    (id: string) => {
      const question = data?.question;
      if (!question || busy || picks.includes(id)) return;
      const next = [...picks, id];
      if (next.length === question.length - 1) {
        const last = question.find((t) => !next.includes(t.id))!;
        void submit([...next, last.id], []);
        return;
      }
      setPicks(next);
    },
    [busy, data?.question, picks, submit],
  );

  // Number keys rank without aiming the mouse — the point is to be quick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const question = data?.question;
      if (!question) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= question.length)
        pick(question[n - 1].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data?.question, pick]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${params.id}${path}${segmentQuery}`,
        {
          method: body === undefined ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Ошибка");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="container tournament-page">
        <div className="panel">
          <div className="error">{error}</div>
          <button
            className="btn secondary"
            onClick={() => load()}
            style={{ marginTop: 12 }}
          >
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

  const pct = data.screens.estimatedTotal
    ? Math.min(
        100,
        Math.round(
          (data.screens.completed / data.screens.estimatedTotal) * 100,
        ),
      )
    : 0;
  const showNames = !data.blindMode || reveal;
  const question = data.question ?? [];

  const name = (t: TrackDto) =>
    showNames ? (
      <>
        {t.title}
        {t.artist ? (
          <div className="muted" style={{ fontSize: 13 }}>
            {t.artist}
          </div>
        ) : null}
      </>
    ) : (
      "🎧"
    );

  // Starting one player pauses the others — a cacophony helps nobody.
  const pauseOthers = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const self = e.currentTarget;
    document
      .querySelectorAll<HTMLMediaElement>(
        ".versus audio, .versus video, .group-card audio, .group-card video",
      )
      .forEach((m) => {
        if (m !== self) m.pause();
      });
  };

  // Blind mode hides the footage too (it gives the track away): play the file
  // through an <audio> element until names are revealed.
  async function markMoment(t: TrackDto, player: HTMLMediaElement | null) {
    setError(null);
    setNotice("");
    try {
      const second = Math.round((player?.currentTime ?? 0) * 10) / 10;
      const res = await fetch(`/api/tracks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bestMomentSec: second }),
      });
      if (!res.ok)
        throw Error((await res.json()).error ?? "Не удалось сохранить момент");
      setNotice(
        `Лучший момент: ${second} с. Фрагмент в ролике начнётся отсюда.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const player = (t: TrackDto, maxHeight: number) => (
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
          void markMoment(
            t,
            e.currentTarget.parentElement?.querySelector<HTMLMediaElement>(
              "audio,video",
            ) ?? null,
          )
        }
      >
        ★ Лучший момент здесь
      </button>
    </div>
  );

  const coverage = (
    <span className="coverage">
      Расставлено {data.coverage.orderedPct}% пар
      {data.coverage.contradictory > 0
        ? ` · противоречий ${data.coverage.contradictory}`
        : ""}
    </span>
  );

  const sizePicker =
    data.maxGroupSize > 2 ? (
      <label className="row" style={{ gap: 8, marginBottom: 0, fontSize: 13 }}>
        <span className="muted">Сравнивать за раз</span>
        <select
          value={data.groupSize}
          disabled={busy}
          onChange={(e) => void act("", { groupSize: Number(e.target.value) })}
          style={{ marginBottom: 0, width: 70 }}
        >
          {Array.from({ length: data.maxGroupSize - 1 }, (_, i) => i + 2).map(
            (n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ),
          )}
        </select>
        {data.groupSize > 5 ? (
          <span
            className="muted"
            title="Удержать в голове больше пяти треков почти невозможно"
          >
            ⚠
          </span>
        ) : null}
      </label>
    ) : (
      <span className="muted" style={{ fontSize: 13 }}>
        Эта схема спрашивает только парами
      </span>
    );

  if (data.isComplete) {
    return (
      <div className="container tournament-page">
        <h1>План сегмента пройден</h1>
        <p className="muted">
          Сделано {data.screens.completed} экранов. {coverage}.
        </p>
        {error ? <div className="error">{error}</div> : null}
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            Можно смотреть топ — или добрать точности ещё одним раундом: каждый
            трек получит ещё {Math.max(1, data.groupSize - 1)} соперник(ов).
          </p>
          <div className="row" style={{ gap: 12 }}>
            <a
              className="btn"
              href={`/tournaments/${params.id}${segmentQuery}`}
            >
              Смотреть топ →
            </a>
            {data.canExtend ? (
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => void act("/extend")}
              >
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

  const rest = question.filter((t) => !picks.includes(t.id));
  const canStopEarly = question.length > 2 && rest.length > 1;

  return (
    <div className="container tournament-page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>
          {question.length > 2 ? "Расставьте по местам" : "Что лучше?"}
        </h1>
        <a href={`/tournaments/${params.id}${segmentQuery}`} className="muted">
          Выйти (прогресс сохранён)
        </a>
      </div>

      {data.segmentTitle ? <p className="muted">{data.segmentTitle}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="progressbar" style={{ margin: "16px 0 10px" }}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="compare-bar">
        <span className="coverage">
          Экран {data.screens.completed + 1} из ~{data.screens.estimatedTotal} ·{" "}
          {coverage}
        </span>
        {sizePicker}
      </div>

      {error ? <div className="error">{error}</div> : null}

      {question.length === 2 ? (
        <div className="versus">
          <div className="choice">
            <div className="name">{name(question[0])}</div>
            {player(question[0], 240)}
            <button
              className="btn"
              style={{ marginTop: 16 }}
              onClick={() => void submit([question[0].id, question[1].id], [])}
              disabled={busy}
            >
              ← Это лучше
            </button>
          </div>
          <div className="vs">VS</div>
          <div className="choice">
            <div className="name">{name(question[1])}</div>
            {player(question[1], 240)}
            <button
              className="btn"
              style={{ marginTop: 16 }}
              onClick={() => void submit([question[1].id, question[0].id], [])}
              disabled={busy}
            >
              Это лучше →
            </button>
          </div>
        </div>
      ) : (
        <div className="group-grid">
          {question.map((t, i) => {
            const place = picks.indexOf(t.id);
            return (
              <div
                key={t.id}
                className={`group-card${place >= 0 ? " picked" : ""}`}
              >
                {place >= 0 ? (
                  <span className="place-badge">{place + 1}</span>
                ) : null}
                <div className="name">{name(t)}</div>
                {player(t, 160)}
                <button
                  className={`btn rank-pick${place >= 0 ? " ghost" : ""}`}
                  disabled={busy || place >= 0}
                  onClick={() => pick(t.id)}
                >
                  {place >= 0 ? `${place + 1} место` : `Выбрать (${i + 1})`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div
        className="row"
        style={{ justifyContent: "center", marginTop: 22, gap: 14 }}
      >
        {question.length === 2 ? (
          <button
            className="btn secondary"
            onClick={() => void submit([], [question[0].id, question[1].id])}
            disabled={busy}
          >
            Ничья
          </button>
        ) : null}
        {canStopEarly ? (
          <button
            className="btn secondary"
            onClick={() =>
              void submit(
                picks,
                rest.map((t) => t.id),
              )
            }
            disabled={busy}
          >
            Остальные примерно равны
          </button>
        ) : null}
        {picks.length > 0 ? (
          <button
            className="btn ghost"
            onClick={() => setPicks([])}
            disabled={busy}
          >
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

      {showTop && data.standings ? (
        <div className="panel" style={{ marginTop: 22 }}>
          <h2>Предварительный топ</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            Промежуточные позиции по текущим очкам — будут меняться по ходу
            сравнений.
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
