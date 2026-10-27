"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { PickerVideo } from "@/remotion/PickerVideo";
import { roundIsRenderable, type PickerPlan } from "@/lib/domain/picker-plan";
import type { ArtCrop, FitMode } from "@/lib/domain/art-crop";
import { artCropStyle } from "@/lib/domain/art-crop";
import { effectiveOrientation, type TileOrientation } from "@/lib/domain/picker-layout";
import {
  ArtGalleryModal,
  type GalleryKind,
  type PickResult,
} from "@/app/tournaments/[id]/render/ArtGalleryModal";
import { FragmentPreview } from "@/app/components/FragmentPreview";

const PlayerComp = PickerVideo as unknown as React.FC<Record<string, unknown>>;

interface ArtDto {
  id: string;
  kind: GalleryKind;
  label: string | null;
  url: string;
  posterUrl: string | null;
  durationSec: number | null;
  hasAudio: boolean;
}
interface TileDto {
  id: string;
  order: number;
  artId: string;
  art: ArtDto | null;
  label: string | null;
  isAnswer: boolean;
  playSound: boolean;
  startSec: number | null;
  crop: ArtCrop | null;
  fitMode: FitMode;
}
interface GroupDto {
  id: string;
  order: number;
  label: string | null;
  isAnswer: boolean;
  tiles: TileDto[];
}
interface RoundDto {
  id: string;
  order: number;
  prompt: string | null;
  showPrompt: boolean;
  labelsMode: "always" | "finale" | "never";
  revealSec: number | null;
  hideAfterReveal: boolean | null;
  timerSec: number | null;
  bgArt: ArtDto | null;
  bgMusicArt: ArtDto | null;
  tiles: TileDto[];
  tileOrientation: TileOrientation | null;
  /** "single" = обычные блоки, "groups" = сравнение блок к блоку. */
  mode: "single" | "groups";
  groups: GroupDto[];
}
interface ProjectDto {
  id: string;
  title: string;
  kind: string;
  revealSec: number;
  hideAfterReveal: boolean;
  timerSec: number;
  tickSound: boolean;
  bgArt: ArtDto | null;
  bgMusicArt: ArtDto | null;
  playlist: ArtDto[];
  rounds: RoundDto[];
  invalidRounds: number[];
  tileOrientation: TileOrientation;
  introEnabled: boolean;
  introText: string | null;
  outroEnabled: boolean;
  outroText: string | null;
}

function roundOrientation(round: RoundDto, project: ProjectDto): TileOrientation {
  return effectiveOrientation(round.tileOrientation, project.tileOrientation);
}

function aspectOf(o: TileOrientation): number {
  return o === "portrait" ? 2 / 3 : 16 / 9;
}
interface JobDto {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
}

type ModalState =
  | { kind: "manage" }
  | { kind: "bg"; roundId: string | null } // null = project default
  | { kind: "music"; roundId: string | null } // roundId=null -> append to the playlist
  | { kind: "tile"; roundId: string; groupId?: string }
  | { kind: "crop"; roundId: string; tileId: string; url: string; mediaKind: "image" | "video"; crop: ArtCrop | null }
  | null;

/** Positional block names shown as placeholders (must match the frame). */
const BLOCK_LETTERS = ["А", "Б", "В"];

/** Total number of cards in the blocks of a group round. */
const groupCards = (round: RoundDto) =>
  round.groups.reduce((sum, g) => sum + g.tiles.length, 0);

/** Warning about the rounds the render refuses (the preview skips them too). */
function invalidRoundsWarning(rounds: number[]): string {
  return rounds.length === 1
    ? `Раунд ${rounds[0]}: нужно минимум 2 блока — он не попадёт в видео и блокирует рендер.`
    : `Раунды ${rounds.join(", ")}: нужно минимум 2 блока — они не попадут в видео и блокируют рендер.`;
}

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Small picked-media chip with a clear button. */
function MediaChip({
  art,
  placeholder,
  onPick,
  onClear,
}: {
  art: ArtDto | null;
  placeholder: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <button className="btn secondary" onClick={onPick}>
        {art
          ? `${art.kind === "audio" ? "🎵" : art.kind === "video" ? "🎬" : "🖼"} ${art.label ?? "без названия"}`
          : placeholder}
      </button>
      {art ? (
        <button className="btn ghost" title="Убрать" onClick={onClear}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function PickerConstructor({
  projectId,
  canRender,
}: {
  projectId: string;
  canRender: boolean;
}) {
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [plan, setPlan] = useState<PickerPlan | null>(null);
  const [tickUrl, setTickUrl] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [previewTileId, setPreviewTileId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Не удалось загрузить проект");
      return;
    }
    const data = await res.json();
    setProject(data.project);
    setPlan(data.previewPlan);
    setTickUrl(data.tickUrl ?? null);
  }, [projectId]);

  // Restore the latest render job after a page reload / navigation: the render
  // keeps running server-side, so pick up its progress (or the finished file).
  const restoreJob = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/render`, { cache: "no-store" });
    if (!res.ok) return;
    const data: { jobs?: JobDto[] } = await res.json();
    const last = data.jobs?.[0];
    if (!last) return;
    setJob(last);
    if (last.status === "queued" || last.status === "running") pollJob(last.id);
  }, [projectId]);

  useEffect(() => {
    void load();
    void restoreJob();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load, restoreJob]);

  async function call(url: string, method: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError((d as { error?: string }).error ?? "Ошибка");
    }
    await load();
    return res.ok;
  }

  const patchProject = (body: Record<string, unknown>) =>
    call(`/api/projects/${projectId}`, "PATCH", body);
  const patchRound = (roundId: string, body: Record<string, unknown>) =>
    call(`/api/rounds/${roundId}`, "PATCH", body);
  const patchTile = (tileId: string, body: Record<string, unknown>) =>
    call(`/api/tiles/${tileId}`, "PATCH", body);

  const savePlaylist = (artIds: string[]) =>
    call(`/api/projects/${projectId}/playlist`, "PUT", { artIds });

  async function moveRound(roundId: string, dir: -1 | 1) {
    if (!project) return;
    const ids = project.rounds.map((r) => r.id);
    const i = ids.indexOf(roundId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await call(`/api/projects/${projectId}/rounds`, "POST", { order: ids });
  }

  const patchGroup = (groupId: string, body: Record<string, unknown>) =>
    call(`/api/groups/${groupId}`, "PATCH", body);

  /** Move a card into another block of the same round. */
  const moveCardToGroup = (tileId: string, groupId: string) =>
    call(`/api/tiles/${tileId}/group`, "POST", { groupId });

  /** Reorder cards inside one block (reveal cascade follows this order). */
  async function moveCardInGroup(group: GroupDto, tileId: string, dir: -1 | 1) {
    const ids = group.tiles.map((t) => t.id);
    const i = ids.indexOf(tileId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await call(`/api/groups/${group.id}/tiles`, "POST", { order: ids });
  }

  async function moveTile(round: RoundDto, tileId: string, dir: -1 | 1) {
    const ids = round.tiles.map((t) => t.id);
    const i = ids.indexOf(tileId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await call(`/api/rounds/${round.id}/tiles`, "POST", { order: ids });
  }

  function pollJob(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/render-jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: JobDto = await res.json();
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 1500);
  }

  async function startRender() {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/render`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось запустить рендер");
      return;
    }
    setJob({ id: data.jobId, status: "queued", progress: 0, error: null, downloadUrl: null });
    pollJob(data.jobId);
  }

  /** One card of a round (or of a block): thumb, label, fit, crop, sound. */
  function renderTile(round: RoundDto, tile: TileDto, extra: React.ReactNode) {
    if (!project) return null;
    return (
      <div className="tile-card" key={tile.id}>
        <div className={`tile-thumb${roundOrientation(round, project) === "portrait" ? " tile-portrait" : ""}`}>
          {tile.art ? (
            tile.art.kind === "video" ? (
              tile.art.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tile.art.posterUrl} alt="" style={artCropStyle(tile.crop, tile.fitMode)} />
              ) : (
                <video src={tile.art.url} muted preload="metadata" style={artCropStyle(tile.crop, tile.fitMode)} />
              )
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tile.art.url} alt="" style={artCropStyle(tile.crop, tile.fitMode)} />
            )
          ) : null}
          {tile.isAnswer && round.mode === "single" ? (
            <span className="tile-answer">✔ ответ</span>
          ) : null}
        </div>
        <input
          placeholder="Подпись…"
          defaultValue={tile.label ?? ""}
          onBlur={(e) => void patchTile(tile.id, { label: e.target.value || null })}
        />
        <select
          value={tile.fitMode}
          onChange={(e) => void patchTile(tile.id, { fitMode: e.target.value })}
        >
          <option value="cover">Обрезка</option>
          <option value="fill">Растянуть</option>
          <option value="contain">Вписать</option>
        </select>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {extra}
          {tile.fitMode === "cover" ? (
            <button
              className="btn ghost"
              title="Обрезка"
              onClick={() =>
                tile.art &&
                setModal({
                  kind: "crop",
                  roundId: round.id,
                  tileId: tile.id,
                  url: tile.art.url,
                  mediaKind: tile.art.kind === "video" ? "video" : "image",
                  crop: tile.crop,
                })
              }
            >
              ✂
            </button>
          ) : null}
          <button
            className="btn ghost"
            title="Убрать блок"
            onClick={() => void call(`/api/tiles/${tile.id}`, "DELETE")}
          >
            ✕
          </button>
        </div>
        {tile.art?.kind === "video" ? (
          <>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {tile.art.hasAudio ? (
                <label className="row" style={{ gap: 5, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={tile.playSound}
                    onChange={(e) => void patchTile(tile.id, { playSound: e.target.checked })}
                  />
                  <span>звук</span>
                </label>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>без звука</span>
              )}
              <input
                type="number"
                min={0}
                step={0.5}
                title="Старт видеоряда (сек)"
                placeholder="старт, с"
                style={{ width: 90, marginBottom: 0 }}
                key={`ss-${tile.id}-${tile.startSec}`}
                defaultValue={tile.startSec ?? ""}
                onBlur={(e) =>
                  void patchTile(tile.id, {
                    startSec: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <button
                className="btn ghost"
                title="Подобрать старт по видео"
                onClick={() =>
                  setPreviewTileId(previewTileId === tile.id ? null : tile.id)
                }
              >
                🎧
              </button>
            </div>
            {previewTileId === tile.id ? (
              <FragmentPreview
                src={tile.art.url}
                kind="video"
                fragmentStartSec={tile.startSec ?? 0}
                fragmentLenSec={round.revealSec ?? project.revealSec}
                onSetStart={(sec) => void patchTile(tile.id, { startSec: sec })}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  async function onModalPick(res: PickResult) {
    if (!modal) return;
    const m = modal;
    setModal(null);
    if (m.kind === "bg") {
      const body = { bgArtId: res.artId };
      await (m.roundId ? patchRound(m.roundId, body) : patchProject(body));
    } else if (m.kind === "music") {
      if (m.roundId) await patchRound(m.roundId, { bgMusicArtId: res.artId });
      else await savePlaylist([...(project?.playlist ?? []).map((a) => a.id), res.artId]);
    } else if (m.kind === "tile") {
      const url = m.groupId
        ? `/api/groups/${m.groupId}/tiles`
        : `/api/rounds/${m.roundId}/tiles`;
      const ok = await call(url, "POST", { artId: res.artId });
      if (ok && res.crop) {
        // the crop chosen during picking belongs to the just-added card
        const fresh = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        const d = await fresh.json();
        const round = (d.project as ProjectDto).rounds.find((r) => r.id === m.roundId);
        const cards = m.groupId
          ? (round?.groups.find((g) => g.id === m.groupId)?.tiles ?? [])
          : (round?.tiles ?? []);
        const tile = cards[cards.length - 1];
        if (tile) await patchTile(tile.id, { crop: res.crop });
      }
    } else if (m.kind === "crop") {
      await patchTile(m.tileId, { crop: res.crop });
    }
  }

  if (error && !project) {
    return <div className="panel"><div className="error">{error}</div></div>;
  }
  if (!project || !plan) return <p className="muted">Загрузка конструктора…</p>;

  return (
    <>
      <div className="panel">
        <h2>Предпросмотр</h2>
        {plan.rounds.length === 0 ? (
          <p className="muted">
            Добавьте блоки в раунд — превью появится автоматически.
          </p>
        ) : (
          <>
            <Player
              component={PlayerComp}
              inputProps={{ plan, assetMode: "url" as const, tickSrc: tickUrl }}
              durationInFrames={Math.max(1, plan.durationInFrames)}
              fps={plan.fps}
              compositionWidth={plan.width}
              compositionHeight={plan.height}
              style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 12 }}
              controls
            />
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Длительность: {fmtDur(plan.durationSec)} · раундов в видео: {plan.rounds.length}
            </p>
          </>
        )}
        {project.invalidRounds.length > 0 ? (
          <div className="error" style={{ marginTop: 8 }}>
            {invalidRoundsWarning(project.invalidRounds)}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h2>Настройки видео</h2>
        <div className="grid-2">
          <div>
            <label>Название</label>
            <input
              defaultValue={project.title}
              onBlur={(e) => void patchProject({ title: e.target.value })}
            />
          </div>
          <div>
            <label>Время показа блока (сек)</label>
            <input
              type="number"
              min={1}
              max={60}
              step={0.5}
              defaultValue={project.revealSec}
              onBlur={(e) => void patchProject({ revealSec: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Таймер в конце раунда (сек)</label>
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              defaultValue={project.timerSec}
              onBlur={(e) => void patchProject({ timerSec: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Звук</label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={project.tickSound}
                onChange={(e) => void patchProject({ tickSound: e.target.checked })}
              />
              <span>Тик-так на таймере</span>
            </label>
          </div>
          <div>
            <label>Ориентация блоков</label>
            <select
              value={project.tileOrientation}
              onChange={(e) => void patchProject({ tileOrientation: e.target.value })}
            >
              <option value="landscape">Горизонтальные</option>
              <option value="portrait">Вертикальные</option>
            </select>
          </div>
        </div>
        <label className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={project.hideAfterReveal}
            onChange={(e) => void patchProject({ hideAfterReveal: e.target.checked })}
          />
          <span>
            Скрывать блок после показа (все блоки снова раскроются на таймере)
          </span>
        </label>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={project.introEnabled}
                onChange={(e) => void patchProject({ introEnabled: e.target.checked })}
              />
              <span>Интро (титульный экран, 3 сек)</span>
            </label>
            <input
              key={`intro-${project.introText ?? ""}`}
              defaultValue={project.introText ?? ""}
              placeholder={project.title}
              onBlur={(e) => void patchProject({ introText: e.target.value })}
            />
          </div>
          <div>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={project.outroEnabled}
                onChange={(e) => void patchProject({ outroEnabled: e.target.checked })}
              />
              <span>Аутро (финальный экран, 3 сек)</span>
            </label>
            <input
              key={`outro-${project.outroText ?? ""}`}
              defaultValue={project.outroText ?? ""}
              placeholder="Спасибо за просмотр"
              onBlur={(e) => void patchProject({ outroText: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div>
            <label>Задний фон (картинка или видео)</label>
            <MediaChip
              art={project.bgArt}
              placeholder="Выбрать фон"
              onPick={() => setModal({ kind: "bg", roundId: null })}
              onClear={() => void patchProject({ bgArtId: null })}
            />
          </div>
          <div>
            <label>Фоновая музыка — плейлист (играет сквозь всё видео, лупится)</label>
            {project.playlist.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: "2px 0 6px" }}>
                Плейлист пуст — раунды идут без фоновой музыки.
              </p>
            ) : (
              project.playlist.map((a, i) => (
                <div className="row" key={`${a.id}-${i}`} style={{ gap: 6, marginBottom: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i + 1}. 🎵 {a.label ?? "без названия"}
                    {a.durationSec ? <span className="muted"> · {fmtDur(a.durationSec)}</span> : null}
                  </span>
                  <button
                    className="btn ghost"
                    title="Выше"
                    disabled={i === 0}
                    onClick={() => {
                      const ids = project.playlist.map((x) => x.id);
                      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                      void savePlaylist(ids);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="btn ghost"
                    title="Ниже"
                    disabled={i === project.playlist.length - 1}
                    onClick={() => {
                      const ids = project.playlist.map((x) => x.id);
                      [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                      void savePlaylist(ids);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="btn ghost"
                    title="Убрать из плейлиста"
                    onClick={() =>
                      void savePlaylist(
                        project.playlist.filter((_, j) => j !== i).map((x) => x.id),
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
            <button
              className="btn secondary"
              onClick={() => setModal({ kind: "music", roundId: null })}
            >
              ➕ Трек в плейлист
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Эти значения — дефолты для всех раундов; каждый раунд может их
          переопределить. Плейлист играет непрерывно через все раунды (треки
          сменяются кроссфейдом, по окончании — луп); видео-блок со звуком
          играет свой звук во время показа, музыка на это время приглушается.
          Если у раунда задана своя музыка — на нём играет она, а плейлист
          продолжается со следующего раунда. Интро и аутро — титульные экраны по
          3 секунды в начале и в конце видео (фоновая музыка на них продолжает
          играть); пустой текст берётся из названия проекта / «Спасибо за
          просмотр».
        </p>
        <button
          className="btn secondary"
          style={{ marginTop: 6 }}
          onClick={() => setModal({ kind: "manage" })}
        >
          🖼 Менеджер медиа
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {project.rounds.map((round, ri) => (
        <div className="panel" key={round.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              Раунд {ri + 1}
              {roundIsRenderable(round) ? null : round.mode === "groups" ? (
                <span className="muted" style={{ fontSize: 14 }}>
                  {" "}· нужно минимум 2 блока, и в каждом хотя бы одна карточка
                </span>
              ) : (
                <span className="muted" style={{ fontSize: 14 }}> · добавьте минимум 2 блока</span>
              )}
            </h2>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost" title="Выше" onClick={() => void moveRound(round.id, -1)}>↑</button>
              <button className="btn ghost" title="Ниже" onClick={() => void moveRound(round.id, 1)}>↓</button>
              <button
                className="btn ghost"
                onClick={() => {
                  if (confirm(`Удалить раунд ${ri + 1} со всеми блоками?`))
                    void call(`/api/rounds/${round.id}`, "DELETE");
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 10 }}>
            <div>
              <label>Правило раунда (надпись сверху)</label>
              <input
                placeholder="Выбери персонажа с белыми волосами…"
                defaultValue={round.prompt ?? ""}
                onBlur={(e) => void patchRound(round.id, { prompt: e.target.value || null })}
              />
              <label className="row" style={{ gap: 8, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={round.showPrompt}
                  onChange={(e) => void patchRound(round.id, { showPrompt: e.target.checked })}
                />
                <span>Показывать надпись</span>
              </label>
            </div>
            <div>
              <label>Подписи блоков</label>
              <select
                value={round.labelsMode}
                onChange={(e) => void patchRound(round.id, { labelsMode: e.target.value })}
              >
                <option value="finale">Только на финальном раскрытии</option>
                <option value="always">Всегда</option>
                <option value="never">Никогда</option>
              </select>
              <label style={{ marginTop: 6, display: "block" }}>Ориентация блоков раунда</label>
              <select
                value={round.tileOrientation ?? ""}
                onChange={(e) =>
                  void patchRound(round.id, {
                    tileOrientation: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">Как у проекта</option>
                <option value="landscape">Горизонтальные</option>
                <option value="portrait">Вертикальные</option>
              </select>
              <div className="row" style={{ gap: 10, marginTop: 6 }}>
                <div style={{ flex: 1 }}>
                  <label>Показ блока, сек</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={0.5}
                    placeholder={String(project.revealSec)}
                    defaultValue={round.revealSec ?? ""}
                    onBlur={(e) =>
                      void patchRound(round.id, {
                        revealSec: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Таймер, сек</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    placeholder={String(project.timerSec)}
                    defaultValue={round.timerSec ?? ""}
                    onBlur={(e) =>
                      void patchRound(round.id, {
                        timerSec: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 8 }}>
            <div>
              <label>Скрывать после показа</label>
              <select
                value={round.hideAfterReveal === null ? "" : round.hideAfterReveal ? "1" : "0"}
                onChange={(e) =>
                  void patchRound(round.id, {
                    hideAfterReveal:
                      e.target.value === "" ? null : e.target.value === "1",
                  })
                }
              >
                <option value="">Как в настройках видео</option>
                <option value="1">Да</option>
                <option value="0">Нет</option>
              </select>
            </div>
            <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
              <div>
                <label>Фон раунда</label>
                <MediaChip
                  art={round.bgArt}
                  placeholder="Как в видео"
                  onPick={() => setModal({ kind: "bg", roundId: round.id })}
                  onClear={() => void patchRound(round.id, { bgArtId: null })}
                />
              </div>
              <div>
                <label>Музыка раунда</label>
                <MediaChip
                  art={round.bgMusicArt}
                  placeholder="Как в видео"
                  onPick={() => setModal({ kind: "music", roundId: round.id })}
                  onClear={() => void patchRound(round.id, { bgMusicArtId: null })}
                />
              </div>
            </div>
          </div>

          <label style={{ marginTop: 12 }}>Режим раунда</label>
          <select
            value={round.mode}
            onChange={(e) => void patchRound(round.id, { mode: e.target.value })}
          >
            <option value="single">Обычный — 2–9 блоков, выбираем один</option>
            <option value="groups">Групповое сравнение — блок к блоку</option>
          </select>

          {round.mode === "groups" ? (
            <>
              <label style={{ marginTop: 12 }}>
                Блоки ({round.groups.length}/3) · карточек {groupCards(round)}/15
              </label>
              {roundOrientation(round, project) === "portrait" && groupCards(round) > 8 ? (
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
                  Карточек много для вертикальной ориентации — в кадре они получатся мелкими.
                </div>
              ) : null}
              <div className="group-grid">
                {round.groups.map((group, gi) => (
                  <div className="group-col" key={group.id}>
                    <div className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        placeholder={`Блок ${BLOCK_LETTERS[gi] ?? gi + 1}`}
                        defaultValue={group.label ?? ""}
                        onBlur={(e) => void patchGroup(group.id, { label: e.target.value || null })}
                      />
                      <button
                        className={`btn ghost${group.isAnswer ? " active" : ""}`}
                        title="Блок-победитель (необязательно)"
                        onClick={() => void patchGroup(group.id, { isAnswer: !group.isAnswer })}
                      >
                        ✔
                      </button>
                      <button
                        className="btn ghost"
                        title="Удалить блок с карточками"
                        onClick={() => {
                          if (confirm("Удалить блок вместе с его карточками?"))
                            void call(`/api/groups/${group.id}`, "DELETE");
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="tile-grid">
                      {group.tiles.map((tile) =>
                        renderTile(
                          round,
                          tile,
                          <>
                            <button className="btn ghost" title="Раньше в блоке" onClick={() => void moveCardInGroup(group, tile.id, -1)}>←</button>
                            <button className="btn ghost" title="Позже в блоке" onClick={() => void moveCardInGroup(group, tile.id, 1)}>→</button>
                            {gi > 0 ? (
                              <button className="btn ghost" title="В предыдущий блок" onClick={() => void moveCardToGroup(tile.id, round.groups[gi - 1].id)}>⇦</button>
                            ) : null}
                            {gi < round.groups.length - 1 ? (
                              <button className="btn ghost" title="В следующий блок" onClick={() => void moveCardToGroup(tile.id, round.groups[gi + 1].id)}>⇨</button>
                            ) : null}
                          </>,
                        ),
                      )}
                      {group.tiles.length < 5 ? (
                        <button
                          className="tile-add"
                          onClick={() => setModal({ kind: "tile", roundId: round.id, groupId: group.id })}
                        >
                          ➕<br />карточка
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {round.groups.length < 3 ? (
                <button
                  className="btn secondary"
                  style={{ marginTop: 10 }}
                  onClick={() => void call(`/api/rounds/${round.id}/groups`, "POST", {})}
                >
                  ➕ Добавить блок
                </button>
              ) : null}
            </>
          ) : (
            <>
              <label style={{ marginTop: 12 }}>Блоки ({round.tiles.length}/9)</label>
              <div className="tile-grid">
                {round.tiles.map((tile) =>
                  renderTile(
                    round,
                    tile,
                    <>
                      <button className="btn ghost" title="Левее" onClick={() => void moveTile(round, tile.id, -1)}>←</button>
                      <button className="btn ghost" title="Правее" onClick={() => void moveTile(round, tile.id, 1)}>→</button>
                      <button
                        className={`btn ghost${tile.isAnswer ? " active" : ""}`}
                        title="Пометить правильным ответом"
                        onClick={() => void patchTile(tile.id, { isAnswer: !tile.isAnswer })}
                      >
                        ✔
                      </button>
                    </>,
                  ),
                )}
                {round.tiles.length < 9 ? (
                  <button
                    className="tile-add"
                    onClick={() => setModal({ kind: "tile", roundId: round.id })}
                  >
                    ➕<br />блок
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="panel">
        <button className="btn secondary" onClick={() => void call(`/api/projects/${projectId}/rounds`, "POST", {})}>
          ➕ Добавить раунд
        </button>
      </div>

      <div className="panel">
        <h2>Рендер</h2>
        {!canRender ? (
          <p className="muted">
            Рендер в MP4 доступен только администратору. Конструктор и живое
            превью выше работают полностью.
          </p>
        ) : (
          <button
            className="btn"
            onClick={startRender}
            disabled={job?.status === "queued" || job?.status === "running"}
          >
            {job?.status === "running" || job?.status === "queued"
              ? "Рендеринг…"
              : "🎬 Рендерить видео"}
          </button>
        )}
        {canRender && project.invalidRounds.length > 0 ? (
          <div className="error" style={{ marginTop: 8 }}>
            {invalidRoundsWarning(project.invalidRounds)}
          </div>
        ) : null}
        {job ? (
          <div style={{ marginTop: 16 }}>
            <div className="progressbar">
              <div style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Статус: {job.status} ({Math.round((job.progress ?? 0) * 100)}%)
            </p>
            {job.error ? <div className="error">{job.error}</div> : null}
            {job.status === "done" && job.downloadUrl ? (
              <a className="btn" href={job.downloadUrl}>⬇ Скачать видео</a>
            ) : null}
          </div>
        ) : null}
      </div>

      {modal ? (
        <ArtGalleryModal
          mode={modal.kind === "manage" ? "manage" : modal.kind === "crop" ? "crop" : "pick"}
          pickKinds={
            modal.kind === "music"
              ? ["audio"]
              : ["image", "video"]
          }
          cropTarget={
            modal.kind === "crop"
              ? { artUrl: modal.url, kind: modal.mediaKind, crop: modal.crop }
              : undefined
          }
          aspect={
            modal.kind === "tile" || modal.kind === "crop"
              ? (() => {
                  const r = project.rounds.find((rd) => rd.id === modal.roundId);
                  return r ? aspectOf(roundOrientation(r, project)) : undefined;
                })()
              : undefined
          }
          onPick={(res) => void onModalPick(res)}
          onClose={() => setModal(null)}
          onPoolChange={() => void load()}
        />
      ) : null}
    </>
  );
}
