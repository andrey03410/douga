import { OUTRO_FALLBACK, type LoadedProject } from "@/server/projects";
import { unrenderableRounds } from "@/lib/domain/picker-plan";

export interface ProjectSummary {
  id: string;
  title: string;
  kind: string;
  url: string;
  /** Title / final card texts; null = the card is off. */
  intro: string | null;
  outro: string | null;
  /** Project-wide background (rounds may override it); null = plain dark. */
  background: { artId: string; label: string | null; kind: string } | null;
  playlist: { artId: string; label: string | null; durationSec: number | null }[];
  /** Total length of the playlist, to compare against `durationSec`. */
  playlistSec: number;
  /** Planned runtime of the video, when the caller computed the plan. */
  durationSec?: number;
  /**
   * 1-based numbers of rounds that hold cards but cannot render (a single
   * round needs 2+ cards, a group round 2+ non-empty blocks). The render
   * refuses with ROUND_TOO_SMALL and durationSec leaves them out. Absent when
   * every round is fine.
   */
  invalidRounds?: number[];
  rounds: {
    id: string;
    order: number;
    prompt: string | null;
    /** "single" = плитки, "groups" = сравнение блок к блоку. */
    mode: string;
    tiles: SummaryTile[];
    /** Blocks of a group round (empty for a plain one). */
    groups: {
      id: string;
      order: number;
      label: string | null;
      isAnswer: boolean;
      tiles: SummaryTile[];
    }[];
  }[];
}

interface SummaryTile {
  id: string;
  label: string | null;
  isAnswer: boolean;
  artId: string | null;
}

const summaryTile = (t: {
  id: string;
  label: string | null;
  isAnswer: boolean;
  artId: string | null;
}): SummaryTile => ({ id: t.id, label: t.label, isAnswer: t.isAnswer, artId: t.artId });

/** Compact, agent-friendly view of a project for the get_project tool. */
export function projectSummary(
  p: LoadedProject,
  opts: { durationSec?: number } = {},
): ProjectSummary {
  const playlist = p.playlist.map((pl) => ({
    artId: pl.artId,
    label: pl.art.label,
    durationSec: pl.art.durationSec,
  }));
  const invalidRounds = unrenderableRounds(p.rounds);
  return {
    id: p.id,
    title: p.title,
    kind: p.kind,
    url: `/projects/${p.id}`,
    intro: p.introEnabled ? p.introText?.trim() || p.title : null,
    outro: p.outroEnabled ? p.outroText?.trim() || OUTRO_FALLBACK : null,
    background: p.bgArt
      ? { artId: p.bgArt.id, label: p.bgArt.label, kind: p.bgArt.kind }
      : null,
    playlist,
    playlistSec: playlist.reduce((sum, t) => sum + (t.durationSec ?? 0), 0),
    ...(opts.durationSec !== undefined ? { durationSec: opts.durationSec } : {}),
    ...(invalidRounds.length ? { invalidRounds } : {}),
    rounds: p.rounds.map((r) => ({
      id: r.id,
      order: r.order,
      prompt: r.prompt,
      mode: r.mode,
      tiles: r.tiles.filter((t) => !t.groupId).map(summaryTile),
      groups: r.groups.map((g) => ({
        id: g.id,
        order: g.order,
        label: g.label,
        isAnswer: g.isAnswer,
        tiles: g.tiles.map(summaryTile),
      })),
    })),
  };
}
