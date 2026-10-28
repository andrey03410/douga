import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { can } from "@/lib/domain/permissions";
import { absPath } from "@/lib/storage";
import type { CompiledVideo } from "@/video";
import {
  applySlices,
  mediaSlices,
  offlineMediaUnresolved,
  posterHashes,
  posterSliceId,
  type MediaSlice,
} from "@/watch/offline";
import { safeFile } from "./assets";
import { StudioError } from "./errors";
import { studioMimeType } from "./http-media";
import { studioJobLimits } from "./job-types";
import { actor, hash, type Db } from "./shared";
import type { StudioFile } from "./types";

export interface ExportAsset {
  id: string;
  mime: string;
  relativePath: string;
  bytes: number;
}

/** Part of every cache key: bump it when the encoder settings below change. */
const ENCODER = "v2";
const FFMPEG_TIMEOUT_MS = 120_000;

const ENCODE = {
  audio: { ext: ".m4a", args: ["-vn", "-c:a", "aac", "-b:a", "160k"] },
  visual: {
    ext: ".mp4",
    args: [
      "-an",
      // libx264 with yuv420p needs even dimensions.
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ],
  },
} as const;

type CutRole = keyof typeof ENCODE;

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    proc.stderr.on("data", (chunk) => {
      err = (err + chunk.toString()).slice(-800);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(signal ? `ffmpeg killed by ${signal}` : err || `ffmpeg exited ${code}`));
    });
  });
}

function fileFor(files: Record<string, StudioFile>, digest: string) {
  return Object.values(files).find((file) => file.hash === digest) ?? null;
}

/** Test seam. While set, an export transaction waits here after taking the quota lock. */
export const exportCommitGate: { wait: null | (() => Promise<void>) } = {
  wait: null,
};

async function assertExportRoom(userId: string, additional: number, db: Db = prisma) {
  const user = await actor(userId, db);
  if (can(user.role, "render:run")) return;
  const used = await db.studioExportCache.aggregate({
    where: { userId },
    _sum: { bytes: true },
  });
  if (
    (used._sum.bytes ?? 0) + additional >
    studioJobLimits.maxResultBytesPerAccount
  )
    throw new StudioError("EXPORT_QUOTA_EXCEEDED");
}

async function directAsset(id: string, relativePath: string): Promise<ExportAsset> {
  const file = await safeFile(relativePath);
  return {
    id,
    mime: studioMimeType(relativePath),
    relativePath,
    bytes: (await stat(file)).size,
  };
}

interface CutInput {
  userId: string;
  projectId: string;
  fps: number;
  slice: MediaSlice & { role: CutRole };
  sourcePath: string;
}

type Cut = Omit<ExportAsset, "id">;

const present = (relative: string) =>
  safeFile(relative).then(
    () => true,
    () => false,
  );

async function placeCut(key: string, input: CutInput): Promise<Cut> {
  const { userId, projectId, slice } = input;
  const found = (row: { relativePath: string; bytes: number }): Cut => ({
    mime: studioMimeType(row.relativePath),
    relativePath: row.relativePath,
    bytes: row.bytes,
  });
  const existing = await prisma.studioExportCache.findUnique({ where: { key } });
  if (existing) {
    if (await present(existing.relativePath)) return found(existing);
    await prisma.studioExportCache.deleteMany({ where: { id: existing.id } });
  }
  // An exhausted quota refuses before ffmpeg spends any time.
  await assertExportRoom(userId, 1);
  const { ext, args } = ENCODE[slice.role];
  const relative = `studio-exports/${userId}/${projectId}/${key}${ext}`;
  const partial = `studio-exports/${userId}/${projectId}/${key}.${randomUUID()}${ext}`;
  const source = await safeFile(input.sourcePath);
  await mkdir(path.dirname(absPath(relative)), { recursive: true });
  try {
    const start = slice.startFrame / input.fps;
    const duration = Math.max(0.05, (slice.endFrame - slice.startFrame) / input.fps);
    try {
      // -ss before -i seeks the input; with re-encoding the cut is still frame-exact.
      await ffmpeg([
        "-y",
        "-ss",
        String(start),
        "-t",
        String(duration),
        "-i",
        source,
        ...args,
        absPath(partial),
      ]);
    } catch (error) {
      console.error("Export slice failed", error);
      throw new StudioError("EXPORT_SLICE_FAILED");
    }
    const bytes = (await stat(absPath(partial))).size;
    const row = await prisma.$transaction(async (db) => {
      // A write lock makes a second export wait until this quota check commits.
      const locked = await db.$executeRaw`
        UPDATE "User" SET "id" = "id" WHERE "id" = ${userId}
      `;
      if (locked !== 1) throw new StudioError("NOT_FOUND");
      const stored = await db.studioExportCache.findUnique({ where: { key } });
      if (stored) return stored;
      await assertExportRoom(userId, bytes, db);
      if (exportCommitGate.wait) await exportCommitGate.wait();
      const created = await db.studioExportCache.create({
        data: { userId, projectId, key, bytes, relativePath: relative },
      });
      await rename(absPath(partial), absPath(relative));
      return created;
    });
    return found(row);
  } finally {
    await rm(absPath(partial), { force: true });
  }
}

function cutKey(input: CutInput) {
  const { slice } = input;
  return hash(
    [
      input.projectId,
      slice.hash,
      slice.role,
      slice.startFrame,
      slice.endFrame,
      input.fps,
      ENCODER,
    ].join(":"),
  );
}

/**
 * Keys of cuts an unfinished export still streams. Exports run only in the site
 * process, so an in-memory count is enough.
 */
const reading = new Map<string, number>();

function hold(keys: readonly string[]) {
  for (const key of keys) reading.set(key, (reading.get(key) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    for (const key of keys) {
      const left = (reading.get(key) ?? 1) - 1;
      if (left > 0) reading.set(key, left);
      else reading.delete(key);
    }
  };
}

/** One export of a project prepares at a time, so pruning never races a placement. */
const turns = new Map<string, Promise<void>>();

function inTurn<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const run = (turns.get(projectId) ?? Promise.resolve()).then(work);
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  turns.set(projectId, done);
  void done.then(() => {
    if (turns.get(projectId) === done) turns.delete(projectId);
  });
  return run;
}

/** Drop the project's cuts this export does not use, unless a download still reads them. */
async function pruneCuts(projectId: string, keep: ReadonlySet<string>) {
  const stale = (
    await prisma.studioExportCache.findMany({
      where: { projectId, key: { notIn: [...keep] } },
    })
  ).filter((row) => !reading.has(row.key));
  if (!stale.length) return;
  await prisma.studioExportCache.deleteMany({
    where: { id: { in: stale.map((row) => row.id) } },
  });
  await Promise.all(stale.map((row) => rm(absPath(row.relativePath), { force: true })));
}

/**
 * The files the offline export embeds. Stills and sources used whole are read from
 * the revision itself; only ffmpeg cuts are cached and count against the quota.
 * `release` must be called once the export has read them.
 */
export function materializeSlices(input: {
  userId: string;
  projectId: string;
  plan: CompiledVideo;
  files: Record<string, StudioFile>;
}): Promise<{ plan: CompiledVideo; assets: ExportAsset[]; release: () => void }> {
  return inTurn(input.projectId, async () => {
    const slices = mediaSlices(input.plan).map((slice) => {
      const source = fileFor(input.files, slice.hash);
      if (!source) throw new StudioError("ASSET_FILE_MISSING");
      if (slice.whole || slice.role === "still") return { slice, source, cut: null };
      const cut: CutInput = {
        userId: input.userId,
        projectId: input.projectId,
        fps: input.plan.fps,
        slice: slice as CutInput["slice"],
        sourcePath: source.path,
      };
      return { slice, source, cut: { input: cut, key: cutKey(cut) } };
    });
    const keys = slices.flatMap(({ cut }) => (cut ? [cut.key] : []));
    // Old cuts go first, so they never count against the quota of the new ones.
    await pruneCuts(input.projectId, new Set(keys));
    const release = hold(keys);
    try {
      const assets: ExportAsset[] = [];
      for (const { slice, source, cut } of slices) {
        if (!cut) {
          assets.push(await directAsset(slice.id, source.path));
          continue;
        }
        assets.push({ id: slice.id, ...(await placeCut(cut.key, cut.input)) });
      }
      for (const digest of posterHashes(input.plan)) {
        const posterPath = fileFor(input.files, digest)?.posterPath;
        if (!posterPath) throw new StudioError("ASSET_FILE_MISSING");
        assets.push(await directAsset(posterSliceId(digest), posterPath));
      }
      const offline = applySlices(input.plan);
      if (offlineMediaUnresolved(offline, new Set(assets.map((asset) => asset.id))))
        throw new StudioError("EXPORT_MEDIA_UNRESOLVED");
      return { plan: offline, assets, release };
    } catch (error) {
      release();
      throw error;
    }
  });
}
