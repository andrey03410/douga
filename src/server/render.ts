import "server-only";
import path from "node:path";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath, renderOutputPath, STORAGE_ROOT } from "@/lib/storage";
import {
  clipAudio,
  clipVideo,
  findActiveSnippet,
  probeDurationSec,
  writeSilence,
} from "@/lib/audio";
import {
  assemblePlanItems,
  resolveClipSec,
  type AssembleItem,
  type AssembleVisual,
  type ClipMode,
} from "@/lib/render-assemble";
import { buildVideoPlan, type DisplayOrder } from "@/lib/domain/video-plan";
import { cropFromColumns } from "@/lib/domain/art-crop";
import {
  mediaAudioAvailable,
  resolveFootage,
  type PoolMediaInfo,
} from "@/lib/domain/position-media";
import { renderJobDto, type RenderJobDto } from "@/lib/domain/render-jobs";
import { failStaleRenderJobs } from "@/server/render-jobs";

/**
 * Render jobs of one tournament or project (newest first), as UI DTOs.
 * The constructors use this to restore an in-flight or finished job on mount.
 */
export async function listRenderJobs(
  userId: string,
  owner: { tournamentId: string } | { projectId: string },
  take = 20,
): Promise<RenderJobDto[]> {
  await failStaleRenderJobs(userId);
  const jobs = await prisma.renderJob.findMany({
    where:
      "tournamentId" in owner
        ? { tournamentId: owner.tournamentId, tournament: { userId } }
        : { projectId: owner.projectId, project: { userId } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return jobs.map(renderJobDto);
}

/** Create a default render config + items (top-N) for a completed tournament. */
export async function ensureRenderConfig(userId: string, tournamentId: string) {
  const tournament = await prisma.tournament.findFirst({
    where: { id: tournamentId, userId },
    include: { rankings: { orderBy: { rank: "asc" } }, renderConfig: true },
  });
  if (!tournament) throw new Error("NOT_FOUND");
  if (tournament.status !== "completed") throw new Error("NOT_COMPLETED");
  if (tournament.renderConfig) return tournament.renderConfig.id;

  const topSize = tournament.topSize ?? tournament.rankings.length;
  const top = tournament.rankings.filter((r) => r.rank <= topSize);

  const config = await prisma.renderConfig.create({
    data: {
      tournamentId,
      introText: tournament.title,
      outroText: "Спасибо за просмотр",
      items: {
        create: top.map((r) => ({
          trackId: r.trackId,
          rank: r.rank,
          clipMode: "active_snippet",
          snippetLenSec: 30,
        })),
      },
    },
  });
  return config.id;
}

const CONFIG_INCLUDE = {
  items: {
    orderBy: { rank: "asc" as const },
    include: { track: true, art: true, audioArt: true },
  },
};

export async function getRenderConfig(userId: string, tournamentId: string) {
  return prisma.renderConfig.findFirst({
    where: { tournamentId, tournament: { userId } },
    include: CONFIG_INCLUDE,
  });
}

/** Render config of a standalone "top" project (manual top). */
export async function getProjectRenderConfig(userId: string, projectId: string) {
  return prisma.renderConfig.findFirst({
    where: { projectId, project: { userId } },
    include: CONFIG_INCLUDE,
  });
}

type LoadedConfig = NonNullable<Awaited<ReturnType<typeof getRenderConfig>>>;
type LoadedItem = LoadedConfig["items"][number];

/**
 * The position's own audio source: a tournament track or (manual top) a pool
 * audio/video. `key` is the stable id used for plan items and asset basenames.
 */
export function itemBase(it: LoadedItem) {
  if (it.track) {
    return {
      key: it.trackId!,
      title: it.track.title,
      artist: it.track.artist,
      ownFilePath: it.track.filePath,
      ownDurationSec: it.track.durationSec,
      ownIsVideo: it.track.kind === "video",
      audioUrl: `/api/tracks/${it.trackId}/audio`,
    };
  }
  const a = it.audioArt!;
  return {
    key: it.audioArtId!,
    title: a.label ?? "Без названия",
    artist: null,
    ownFilePath: a.filePath,
    ownDurationSec: a.durationSec,
    ownIsVideo: a.kind === "video",
    audioUrl: `/api/arts/${it.audioArtId}`,
  };
}

/** Which files feed the position: attached media info + the effective audio source. */
function resolveItemSources(it: LoadedItem) {
  const media: PoolMediaInfo | null = it.art
    ? {
        kind: it.art.kind as PoolMediaInfo["kind"],
        durationSec: it.art.durationSec,
        hasAudio: it.art.hasAudio,
      }
    : null;
  const audioFromMedia = it.audioSource === "media" && mediaAudioAvailable(media);
  const base = itemBase(it);
  return {
    media,
    audioFromMedia,
    audioFilePath: audioFromMedia ? it.art!.filePath : base.ownFilePath,
    audioDurationSec: audioFromMedia ? it.art!.durationSec : base.ownDurationSec,
  };
}

/** The position's visual for the in-browser preview (URL asset mode). */
function previewVisual(it: LoadedItem, audioFromMedia: boolean): AssembleVisual | null {
  const crop = cropFromColumns(it.artCropX, it.artCropY, it.artCropW, it.artCropH);
  if (it.art) {
    const ref = `/api/arts/${it.artId}`;
    if (it.art.kind === "video") {
      return {
        kind: "video",
        ref,
        crop,
        startSec: it.mediaStartSec ?? 0,
        footageDurationSec: it.art.durationSec,
        syncedToAudio: audioFromMedia,
      };
    }
    return { kind: "image", ref, crop };
  }
  const base = itemBase(it);
  if (base.ownIsVideo) {
    // A video audio-source shows its own footage, synced to its own audio clip.
    return {
      kind: "video",
      ref: base.audioUrl,
      crop,
      footageDurationSec: base.ownDurationSec,
      syncedToAudio: true,
    };
  }
  return null;
}

/**
 * Ensure each audio source has a known duration, and that active-snippet items
 * have a cached RMS-resolved start. Runs the (cheap-ish) ffmpeg analysis only
 * for rows that still need it, so it's safe to call on every config load.
 */
export async function resolveActiveSnippets(userId: string, tournamentId: string) {
  const config = await getRenderConfig(userId, tournamentId);
  if (!config) return;
  await resolveActiveSnippetsFor(config);
}

export async function resolveActiveSnippetsFor(config: LoadedConfig) {

  for (const it of config.items) {
    const s = resolveItemSources(it);
    const audioAbs = absPath(s.audioFilePath);

    if (s.audioDurationSec == null) {
      const duration = await probeDurationSec(audioAbs);
      if (duration != null) {
        if (s.audioFromMedia) {
          await prisma.art.update({
            where: { id: it.artId! },
            data: { durationSec: duration },
          });
        } else if (it.trackId) {
          await prisma.track.update({
            where: { id: it.trackId },
            data: { durationSec: duration },
          });
        } else if (it.audioArtId) {
          await prisma.art.update({
            where: { id: it.audioArtId },
            data: { durationSec: duration },
          });
        }
      }
    }

    if (it.clipMode === "active_snippet" && it.resolvedStartSec == null) {
      const clipSec = it.snippetLenSec ?? config.defaultClipSec;
      try {
        const snip = await findActiveSnippet(audioAbs, clipSec);
        await prisma.renderItem.update({
          where: { id: it.id },
          data: { resolvedStartSec: snip.startSec },
        });
      } catch {
        // e.g. a soundless video: leave null; playback falls back to start 0
      }
    }
  }
}

/** Build a preview plan (url asset mode) for the in-browser Remotion Player. */
export function buildPreviewPlan(config: LoadedConfig) {
  const items: AssembleItem[] = config.items.map((it) => {
    const s = resolveItemSources(it);
    const base = itemBase(it);
    return {
      trackId: base.key,
      rank: it.rank,
      title: base.title,
      artist: base.artist,
      customLabel: it.customLabel,
      clipMode: it.clipMode as ClipMode,
      clipStartSec: it.clipStartSec,
      clipEndSec: it.clipEndSec,
      snippetLenSec: it.snippetLenSec,
      durationSec: s.audioDurationSec,
      resolvedStartSec: it.resolvedStartSec,
      visual: previewVisual(it, s.audioFromMedia),
      audioRef: s.audioFromMedia ? `/api/arts/${it.artId}` : base.audioUrl,
    };
  });

  const planItems = assemblePlanItems(items, { defaultClipSec: config.defaultClipSec });
  return buildVideoPlan(
    {
      order: config.order as DisplayOrder,
      introEnabled: config.introEnabled,
      introText: config.introText,
      outroEnabled: config.outroEnabled,
      outroText: config.outroText,
    },
    planItems,
  );
}

export async function startRenderJob(userId: string, tournamentId: string) {
  const config = await getRenderConfig(userId, tournamentId);
  if (!config) throw new Error("NO_CONFIG");
  return queueTopRender({ tournamentId });
}

/** Start a render of a standalone "top" project (manual top). */
export async function startProjectRenderJob(userId: string, projectId: string) {
  const config = await getProjectRenderConfig(userId, projectId);
  if (!config) throw new Error("NO_CONFIG");
  if (config.items.length === 0) throw new Error("EMPTY_TOP");
  return queueTopRender({ projectId });
}

/**
 * Human-readable job error; browser-launch failures get an actionable hint
 * (the raw Remotion message is cryptic for users).
 */
export function describeRenderError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  if (/browser|chrome|chromium|executable|headless/i.test(msg)) {
    return (
      msg +
      " — похоже, не найден браузер для рендера: проверьте путь в " +
      "REMOTION_BROWSER_EXECUTABLE в .env (подробности в README, раздел «Рендер видео»)"
    );
  }
  return msg;
}

async function queueTopRender(owner: { tournamentId?: string; projectId?: string }) {
  const job = await prisma.renderJob.create({
    data: { ...owner, status: "queued", progress: 0 },
  });
  // Fire-and-forget: render in the background, report progress via the job row.
  void runRender(job.id).catch(async (err) => {
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "failed", error: describeRenderError(err) },
    });
  });
  return job.id;
}

async function setProgress(jobId: string, progress: number) {
  // Progress writes are advisory: a transient DB lock must not surface as an
  // unhandled rejection (callers fire-and-forget) and kill the render.
  await prisma.renderJob
    .update({ where: { id: jobId }, data: { progress } })
    .catch(() => {});
}

async function runRender(jobId: string): Promise<void> {
  const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { status: "running", progress: 0.02 },
  });

  const config = await prisma.renderConfig.findFirst({
    where: job.tournamentId
      ? { tournamentId: job.tournamentId }
      : { projectId: job.projectId! },
    include: CONFIG_INCLUDE,
  });
  if (!config) throw new Error("NO_CONFIG");

  // 1) Prepare assets in a per-job public dir for Remotion's staticFile().
  const publicDir = absPath(path.join("renders", "tmp", jobId, "public"));
  await mkdir(publicDir, { recursive: true });

  const assembleItems: AssembleItem[] = [];
  const n = config.items.length || 1;
  for (let i = 0; i < config.items.length; i++) {
    const it = config.items[i];
    const s = resolveItemSources(it);
    const base = itemBase(it);
    const audioAbs = absPath(s.audioFilePath);
    const mode = it.clipMode as ClipMode;

    // Duration of the audio source: needed for "full" mode and end clamping.
    let audioDuration = s.audioDurationSec;
    if (audioDuration == null) audioDuration = await probeDurationSec(audioAbs);

    let clipSec = resolveClipSec(
      {
        trackId: base.key,
        rank: it.rank,
        title: base.title,
        artist: base.artist,
        customLabel: it.customLabel,
        clipMode: mode,
        clipStartSec: it.clipStartSec,
        clipEndSec: it.clipEndSec,
        snippetLenSec: it.snippetLenSec,
        durationSec: audioDuration,
        visual: null,
        audioRef: "",
      },
      { defaultClipSec: config.defaultClipSec },
    );

    let start = 0;
    if (mode === "manual") start = it.clipStartSec ?? 0;
    else if (mode === "active_snippet") {
      start =
        it.resolvedStartSec ??
        (await findActiveSnippet(audioAbs, clipSec)
          .then((snip) => snip.startSec)
          .catch(() => 0)); // soundless video track -> start at 0
    }
    if (audioDuration != null && audioDuration > 0) {
      clipSec = Math.min(clipSec, Math.max(0.5, audioDuration - start));
    }
    clipSec = Math.max(0.5, clipSec);

    const audioBase = `${base.key}.aac`;
    try {
      await clipAudio(audioAbs, start, clipSec, path.join(publicDir, audioBase));
    } catch {
      // no audio stream (soundless video track) -> silent segment
      await writeSilence(clipSec, path.join(publicDir, audioBase));
    }

    // Visual: image copied as-is; video footage pre-clipped to the used window.
    const crop = cropFromColumns(it.artCropX, it.artCropY, it.artCropW, it.artCropH);
    let visual: AssembleVisual | null = null;
    if (it.art && it.art.kind === "image") {
      const ext = path.extname(it.art.filePath) || ".jpg";
      const artBase = `${it.artId}${ext}`;
      await copyFile(absPath(it.art.filePath), path.join(publicDir, artBase));
      visual = { kind: "image", ref: artBase, crop };
    } else {
      const footageRel = it.art
        ? it.art.filePath
        : base.ownIsVideo
          ? base.ownFilePath
          : null;
      if (footageRel) {
        const footageAbs = absPath(footageRel);
        const visualBase = `${base.key}-visual.mp4`;
        // Footage synced to the audio (same file provides both) plays the exact
        // audio window; a visual-only video plays from its own offset and loops.
        const synced = it.art ? s.audioFromMedia : true;
        if (synced) {
          // +0.5s tail headroom (source permitting): the re-encode may come out
          // a hair shorter than requested, and playing past its EOF flashes black
          // on the segment's last frames.
          await clipVideo(footageAbs, start, clipSec + 0.5, path.join(publicDir, visualBase));
          visual = {
            kind: "video",
            ref: visualBase,
            crop,
            startSec: 0,
            footageDurationSec: clipSec,
          };
        } else {
          let footageDur = it.art!.durationSec;
          if (footageDur == null) footageDur = await probeDurationSec(footageAbs);
          const footage = resolveFootage(it.mediaStartSec ?? 0, footageDur, clipSec);
          const cutLen = footage.loopSec ?? clipSec;
          await clipVideo(footageAbs, footage.startSec, cutLen, path.join(publicDir, visualBase));
          visual = {
            kind: "video",
            ref: visualBase,
            crop,
            startSec: 0,
            footageDurationSec: cutLen,
          };
        }
      }
    }

    // Audio is pre-clipped, so the composition plays it from 0 for clipSec.
    assembleItems.push({
      trackId: base.key,
      rank: it.rank,
      title: base.title,
      artist: base.artist,
      customLabel: it.customLabel,
      clipMode: "manual",
      clipStartSec: 0,
      clipEndSec: clipSec,
      snippetLenSec: null,
      durationSec: clipSec,
      visual,
      audioRef: audioBase,
    });

    await setProgress(jobId, 0.05 + (0.45 * (i + 1)) / n);
  }

  const planItems = assemblePlanItems(assembleItems, {
    defaultClipSec: config.defaultClipSec,
  });
  const plan = buildVideoPlan(
    {
      order: config.order as DisplayOrder,
      introEnabled: config.introEnabled,
      introText: config.introText,
      outroEnabled: config.outroEnabled,
      outroText: config.outroText,
    },
    planItems,
  );

  // 2) Bundle the Remotion project and render.
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

  const inputProps = { plan, assetMode: "static" as const };
  // Launch options: optional system Chrome + "chrome-for-testing" mode so a modern
  // Chrome (which dropped old headless) works without downloading a headless shell.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
  const chromeMode = "chrome-for-testing" as const;
  const composition = await selectComposition({
    serveUrl,
    id: "Top",
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
      void setProgress(jobId, 0.5 + 0.5 * progress);
    },
  });

  const { size } = await stat(outputLocation);
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { status: "done", progress: 1, outputPath: outputRel, outputBytes: size },
  });
}

export { STORAGE_ROOT };
