import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, renderOutputPath } from "@/lib/storage";
import { clipAudio, clipVideo, writeTick } from "@/lib/audio";
import { cropFromColumns, type FitMode } from "@/lib/domain/art-crop";
import { effectiveOrientation, type TileOrientation } from "@/lib/domain/picker-layout";
import {
  buildPickerPlan,
  roundIsRenderable,
  unrenderableRounds,
  type BookendsInput,
  type LabelsMode,
  type PickerDefaults,
  type PlanRoundInput,
  type PlanTileInput,
  type PlanGroupInput,
  type RoundMode,
} from "@/lib/domain/picker-plan";
import { describeRenderError, renderTmpDir, withRenderJob } from "@/server/render";
import { completeRenderJob, failRenderJob } from "@/server/render-jobs";
import { effectivePlaylist, OUTRO_FALLBACK, type LoadedProject } from "@/server/projects";

// Picker preview plan + headless render pipeline (mirrors render.ts for tops).

type LoadedRound = LoadedProject["rounds"][number];
type LoadedTile = LoadedRound["tiles"][number];
type ArtRef = NonNullable<LoadedRound["bgArt"]>;

export const TICK_REL = path.join("assets", "tick.wav");

/** Generate the countdown tick once; returns the storage-relative path. */
export async function ensureTickAsset(): Promise<string> {
  const abs = absPath(TICK_REL);
  if (!existsSync(abs)) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeTick(abs);
  }
  return TICK_REL;
}

function defaults(project: LoadedProject): PickerDefaults {
  return {
    revealSec: project.revealSec,
    hideAfterReveal: project.hideAfterReveal,
    timerSec: project.timerSec,
    tickSound: project.tickSound,
  };
}

/**
 * Intro / outro cards of the project: blank texts fall back to the project
 * title (intro) and the standard closing line (outro).
 */
export function bookends(project: {
  title: string;
  introEnabled: boolean;
  introText: string | null;
  outroEnabled: boolean;
  outroText: string | null;
}): BookendsInput {
  return {
    intro: project.introEnabled
      ? { text: project.introText?.trim() || project.title }
      : null,
    outro: project.outroEnabled
      ? { text: project.outroText?.trim() || OUTRO_FALLBACK }
      : null,
  };
}

function tileCrop(t: LoadedTile) {
  return cropFromColumns(t.cropX, t.cropY, t.cropW, t.cropH);
}

/** Effective backgrounds of a round (round override -> project default). */
function roundArts(project: LoadedProject, round: LoadedRound) {
  return {
    bgArt: round.bgArt ?? project.bgArt,
    bgMusicArt: round.bgMusicArt ?? project.bgMusicArt,
  };
}

function urlBg(art: ArtRef | null) {
  if (!art || (art.kind !== "image" && art.kind !== "video")) return null;
  return {
    kind: art.kind as "image" | "video",
    ref: `/api/arts/${art.id}`,
    durationSec: art.durationSec,
  };
}

/** One pool card as a plan tile over /api URLs. */
function urlTile(t: LoadedTile): PlanTileInput {
  return {
    media: {
      kind: t.art.kind as "image" | "video",
      ref: `/api/arts/${t.artId}`,
      posterRef: t.art.posterPath ? `/api/arts/${t.artId}?poster=1` : null,
      durationSec: t.art.durationSec,
      hasAudio: t.art.hasAudio,
    },
    crop: tileCrop(t),
    startSec: t.startSec,
    label: t.label,
    isAnswer: t.isAnswer,
    playSound: t.playSound,
    fitMode: t.fitMode as FitMode,
  };
}

/** Preview plan over /api URLs for the in-browser Player. */
export function buildPickerPreviewPlan(project: LoadedProject) {
  const rounds: PlanRoundInput[] = project.rounds.map((round) => {
    const { bgArt, bgMusicArt } = roundArts(project, round);
    return {
      mode: round.mode as RoundMode,
      groups: round.groups.map((g) => ({
        label: g.label,
        isAnswer: g.isAnswer,
        tiles: g.tiles.map(urlTile),
      })),
      prompt: round.prompt,
      showPrompt: round.showPrompt,
      labelsMode: round.labelsMode as LabelsMode,
      revealSec: round.revealSec,
      hideAfterReveal: round.hideAfterReveal,
      timerSec: round.timerSec,
      bg: urlBg(bgArt),
      bgMusic: bgMusicArt
        ? { ref: `/api/arts/${bgMusicArt.id}`, durationSec: bgMusicArt.durationSec }
        : null,
      orientation: effectiveOrientation(
        round.tileOrientation as TileOrientation | null,
        project.tileOrientation as TileOrientation,
      ),
      tiles: round.tiles.filter((t) => !t.groupId).map(urlTile),
    };
  });
  const playlist = effectivePlaylist(project).map((a) => ({
    ref: `/api/arts/${a.id}`,
    durationSec: a.durationSec,
  }));
  return buildPickerPlan(defaults(project), rounds, playlist, bookends(project));
}

/**
 * 1-based numbers of the rounds that hold cards but cannot be rendered (the
 * constructor warns about them; the render refuses with ROUND_TOO_SMALL). The
 * rule itself is `roundIsRenderable` in the domain, shared with the preview.
 */
export function invalidRounds(project: LoadedProject): number[] {
  return unrenderableRounds(project.rounds);
}

export async function startPickerRenderJob(userId: string, projectId: string) {
  const project = await prisma.videoProject.findFirst({
    where: { id: projectId, userId, kind: "picker" },
    include: { rounds: { include: { tiles: true, groups: { include: { tiles: true } } } } },
  });
  if (!project) throw new Error("NOT_FOUND");
  if (project.rounds.length === 0 || project.rounds.every((r) => r.tiles.length === 0))
    throw new Error("EMPTY_PROJECT");
  // Rounds with cards must be renderable (2+ tiles, or 2+ non-empty blocks);
  // the preview skips exactly these rounds, so the video never differs from it.
  if (unrenderableRounds(project.rounds).length > 0) throw new Error("ROUND_TOO_SMALL");

  const job = await prisma.renderJob.create({
    data: { projectId, status: "queued", progress: 0 },
  });
  void runPickerRender(job.id).catch((err) => failRenderJob(job.id, describeRenderError(err)));
  return job.id;
}

async function setProgress(jobId: string, progress: number) {
  // Progress writes are advisory: a transient DB lock must not surface as an
  // unhandled rejection (callers fire-and-forget) and kill the render.
  await prisma.renderJob
    .update({ where: { id: jobId }, data: { progress } })
    .catch(() => {});
}

function runPickerRender(jobId: string): Promise<void> {
  return withRenderJob(jobId, () => renderPicker(jobId));
}

async function renderPicker(jobId: string): Promise<void> {
  const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
  if (!job?.projectId) return;
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { status: "running", progress: 0.02 },
  });

  const project = await prisma.videoProject.findFirst({
    where: { id: job.projectId },
    include: {
      bgArt: true,
      bgMusicArt: true,
      playlist: { orderBy: { order: "asc" }, include: { art: true } },
      rounds: {
        orderBy: { order: "asc" },
        include: {
          bgArt: true,
          bgMusicArt: true,
          tiles: { orderBy: { order: "asc" }, include: { art: true } },
          groups: {
            orderBy: { order: "asc" },
            include: { tiles: { orderBy: { order: "asc" }, include: { art: true } } },
          },
        },
      },
    },
  });
  if (!project) throw new Error("NOT_FOUND");

  const publicDir = absPath(path.join(renderTmpDir(jobId), "public"));
  await mkdir(publicDir, { recursive: true });

  // Tick sample
  const tickRel = await ensureTickAsset();
  await copyFile(absPath(tickRel), path.join(publicDir, "tick.wav"));

  // Pre-render the plan once over original media to learn each tile's exact
  // footage/sound windows, then cut assets and rebuild the plan over basenames.
  // Same rule as the preview: a round that is not renderable is skipped (the
  // start guard already refused such rounds; this covers edits made since).
  const shownRounds = project.rounds.filter(roundIsRenderable);
  const total = shownRounds.reduce((s, r) => s + r.tiles.length, 0) || 1;
  let done = 0;

  const roundInputs: PlanRoundInput[] = [];
  for (let ri = 0; ri < project.rounds.length; ri++) {
    const round = project.rounds[ri];
    if (!roundIsRenderable(round)) continue;
    const revealSec = round.revealSec ?? project.revealSec;
    const { bgArt, bgMusicArt } = roundArts(project as LoadedProject, round);

    // Background: copied as-is (looped in the composition).
    let bg: PlanRoundInput["bg"] = null;
    if (bgArt && (bgArt.kind === "image" || bgArt.kind === "video")) {
      const base = `bg-${ri}${path.extname(bgArt.filePath) || ".jpg"}`;
      await copyFile(absPath(bgArt.filePath), path.join(publicDir, base));
      bg = { kind: bgArt.kind as "image" | "video", ref: base, durationSec: bgArt.durationSec };
    }

    // Round music: clipped to the round's worst-case length, AAC for playback.
    let bgMusic: PlanRoundInput["bgMusic"] = null;
    if (bgMusicArt) {
      const base = `music-${ri}.aac`;
      const roundLen =
        round.tiles.length * revealSec + (round.timerSec ?? project.timerSec) + 10;
      const cut = Math.min(
        roundLen,
        bgMusicArt.durationSec ?? roundLen,
      );
      await clipAudio(absPath(bgMusicArt.filePath), 0, cut, path.join(publicDir, base));
      bgMusic = { ref: base, durationSec: cut };
    }

    // Prepare one card's assets (clip / copy / poster / sound) under a unique
    // basename; shared by plain tiles and the cards of a block.
    const prepareCard = async (
      tile: LoadedTile,
      key: string,
    ): Promise<PlanTileInput> => {
      const art = tile.art;
      let media: PlanTileInput["media"];

      if (art.kind === "image") {
        const base = `${key}${path.extname(art.filePath) || ".jpg"}`;
        await copyFile(absPath(art.filePath), path.join(publicDir, base));
        media = { kind: "image", ref: base, posterRef: null, durationSec: null, hasAudio: false };
      } else {
        // Cut the used footage window [startSec, startSec+min(reveal, available)].
        const start = Math.max(0, tile.startSec ?? 0);
        const availRaw = art.durationSec != null ? art.durationSec - start : revealSec;
        const effStart = availRaw > 0.05 ? start : 0; // stale offset -> whole footage
        const avail =
          art.durationSec != null ? Math.max(0.2, art.durationSec - effStart) : revealSec;
        const cutLen = Math.min(revealSec, avail);
        const base = `${key}.mp4`;
        // Cut with tail headroom where the source allows: a straight-through tile
        // must never seek past the re-encoded file's real EOF (black flash).
        await clipVideo(
          absPath(art.filePath),
          effStart,
          Math.min(avail, cutLen + 0.5),
          path.join(publicDir, base),
        );

        let posterRef: string | null = null;
        if (art.posterPath) {
          posterRef = `${key}-poster.jpg`;
          await copyFile(absPath(art.posterPath), path.join(publicDir, posterRef));
        }
        // The pre-clipped file starts at 0 and lasts cutLen.
        media = {
          kind: "video",
          ref: base,
          posterRef,
          durationSec: cutLen,
          hasAudio: art.hasAudio,
        };
        // Tile sound: a separate AAC clip of the same window (footage is muted).
        if (tile.playSound && art.hasAudio) {
          await clipAudio(
            absPath(art.filePath),
            effStart,
            cutLen,
            path.join(publicDir, `${key}.aac`),
          );
        }
      }

      return {
        media,
        crop: tileCrop(tile),
        startSec: 0, // already applied by the pre-clip
        label: tile.label,
        isAnswer: tile.isAnswer,
        playSound: tile.playSound,
        fitMode: tile.fitMode as FitMode,
      };
    };

    const tiles: PlanTileInput[] = [];
    const groups: PlanGroupInput[] = [];
    if (round.mode === "groups") {
      for (let gi = 0; gi < round.groups.length; gi++) {
        const group = round.groups[gi];
        const cards: PlanTileInput[] = [];
        for (let ti = 0; ti < group.tiles.length; ti++) {
          cards.push(await prepareCard(group.tiles[ti], `tile-${ri}-g${gi}-${ti}`));
          done++;
          await setProgress(jobId, 0.05 + (0.4 * done) / total);
        }
        groups.push({ label: group.label, isAnswer: group.isAnswer, tiles: cards });
      }
    } else {
      for (let ti = 0; ti < round.tiles.length; ti++) {
        tiles.push(await prepareCard(round.tiles[ti], `tile-${ri}-${ti}`));
        done++;
        await setProgress(jobId, 0.05 + (0.4 * done) / total);
      }
    }

    roundInputs.push({
      mode: round.mode as RoundMode,
      groups,
      prompt: round.prompt,
      showPrompt: round.showPrompt,
      labelsMode: round.labelsMode as LabelsMode,
      revealSec: round.revealSec,
      hideAfterReveal: round.hideAfterReveal,
      timerSec: round.timerSec,
      bg,
      bgMusic,
      orientation: effectiveOrientation(
        round.tileOrientation as TileOrientation | null,
        project.tileOrientation as TileOrientation,
      ),
      tiles,
    });
  }

  // Playlist: each unique track transcoded once (near-zero edge fades only —
  // the composition's crossfade envelope does the real fading).
  const playlistArts = effectivePlaylist(project as LoadedProject);
  const playlistTracks = [];
  const prepared = new Map<string, string>();
  for (const art of playlistArts) {
    let base = prepared.get(art.id);
    if (!base) {
      base = `pl-${art.id}.aac`;
      await clipAudio(
        absPath(art.filePath),
        0,
        art.durationSec ?? 600,
        path.join(publicDir, base),
        0.05,
      );
      prepared.set(art.id, base);
    }
    playlistTracks.push({ ref: base, durationSec: art.durationSec });
  }

  const plan = buildPickerPlan(
    defaults(project as LoadedProject),
    roundInputs,
    playlistTracks,
    bookends(project),
  );
  // Swap each sounded card's audio ref to its pre-clipped AAC (blocks included).
  for (const r of plan.rounds) {
    const cards = r.mode === "groups" ? r.groups.flatMap((g) => g.tiles) : r.tiles;
    for (const t of cards) {
      if (t.sound) t.sound = { ...t.sound, ref: t.visual.path!.replace(/\.mp4$/, ".aac"), startSec: 0 };
    }
  }

  const { bundle } = await import("@remotion/bundler");
  const { selectComposition, renderMedia } = await import("@remotion/renderer");

  const serveUrl = await bundle({
    entryPoint: path.join(process.cwd(), "src", "remotion", "index.ts"),
    publicDir,
    webpackOverride: (cfg) => ({
      ...cfg,
      resolve: {
        ...cfg.resolve,
        alias: { ...(cfg.resolve?.alias ?? {}), "@": path.join(process.cwd(), "src") },
      },
    }),
  });

  const inputProps = { plan, assetMode: "static" as const, tickSrc: "tick.wav" };
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
  const chromeMode = "chrome-for-testing" as const;
  const composition = await selectComposition({
    serveUrl,
    id: "Picker",
    inputProps,
    browserExecutable,
    chromeMode,
  });

  const outputRel = renderOutputPath(jobId);
  const outputLocation = absPath(outputRel);
  await mkdir(path.dirname(outputLocation), { recursive: true });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    browserExecutable,
    chromeMode,
    onProgress: ({ progress }) => {
      void setProgress(jobId, 0.45 + 0.55 * progress);
    },
  });

  const { size } = await stat(outputLocation);
  await completeRenderJob(jobId, { outputPath: outputRel, outputBytes: size });
}
