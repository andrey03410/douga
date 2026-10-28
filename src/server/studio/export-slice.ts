import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { can } from "@/lib/domain/permissions";
import { absPath } from "@/lib/storage";
import type { CompiledVideo } from "@/video";
import { applySlices, mediaSlices } from "@/watch/model";
import { safeFile } from "./assets";
import { StudioError } from "./errors";
import { studioMimeType } from "./http-media";
import { studioJobLimits } from "./job-types";
import { hash, actor, type Db } from "./shared";
import type { StudioFile } from "./types";

export interface ExportAsset {
  id: string;
  mime: string;
  relativePath: string;
  bytes: number;
}

async function ffmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-800) || `ffmpeg exited ${code}`));
    });
  });
}

function fileFor(files: Record<string, StudioFile>, digest: string) {
  return Object.values(files).find((file) => file.hash === digest) ?? null;
}

async function assertExportRoom(userId: string, additional: number, db: Db = prisma) {
  if (additional <= 0) return;
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

async function placeSlice(input: {
  userId: string;
  projectId: string;
  revisionId: string;
  id: string;
  sourcePath: string;
  kind: "image" | "video" | "audio";
  startFrame: number;
  endFrame: number;
  copyWhole: boolean;
  fps: number;
  ext: string;
}) {
  const key = hash(
    `${input.userId}:${input.revisionId}:${input.id}:${input.kind}:v1`,
  );
  const relative = `studio-exports/${input.userId}/${input.projectId}/${input.revisionId}/${key}${input.ext}`;
  const existing = await prisma.studioExportCache.findUnique({ where: { key } });
  if (existing) {
    await safeFile(existing.relativePath);
    return {
      id: input.id,
      mime: studioMimeType(existing.relativePath),
      relativePath: existing.relativePath,
      bytes: existing.bytes,
      fresh: false,
    };
  }
  await mkdir(path.dirname(absPath(relative)), { recursive: true });
  const partial = relative.replace(/(\.[^.]+)$/, `.${randomUUID()}$1`);
  const source = await safeFile(input.sourcePath);
  if (input.copyWhole || input.kind === "image") await copyFile(source, absPath(partial));
  else {
    const start = input.startFrame / input.fps;
    const duration = Math.max(0.05, (input.endFrame - input.startFrame) / input.fps);
    const args = ["-y", "-i", source, "-ss", String(start), "-t", String(duration)];
    if (input.kind === "audio")
      args.push("-vn", "-c:a", "aac", "-b:a", "160k", absPath(partial));
    else
      args.push(
        "-an",
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
        absPath(partial),
      );
    await ffmpeg(args);
  }
  const bytes = (await stat(absPath(partial))).size;
  return { id: input.id, relative, partial, bytes, fresh: true as const, key };
}

export async function materializeSlices(input: {
  userId: string;
  projectId: string;
  revisionId: string;
  plan: CompiledVideo;
  files: Record<string, StudioFile>;
}): Promise<{ plan: CompiledVideo; assets: ExportAsset[] }> {
  const slices = mediaSlices(input.plan);
  const pending: {
    id: string;
    relative: string;
    partial: string;
    bytes: number;
    key: string;
  }[] = [];
  const assets: ExportAsset[] = [];
  const posterHashes = new Set<string>();
  try {
    for (const slice of slices) {
      const source = fileFor(input.files, slice.hash);
      if (!source) throw new StudioError("ASSET_FILE_MISSING");
      const ext = slice.copyWhole || slice.kind === "image"
        ? path.extname(source.path).toLowerCase() || ".bin"
        : slice.kind === "audio"
          ? ".m4a"
          : ".mp4";
      const placed = await placeSlice({
        userId: input.userId,
        projectId: input.projectId,
        revisionId: input.revisionId,
        id: slice.id,
        sourcePath: source.path,
        kind: slice.kind,
        startFrame: slice.startFrame,
        endFrame: slice.endFrame,
        copyWhole: slice.copyWhole,
        fps: input.plan.fps,
        ext,
      });
      if (placed.fresh) pending.push(placed);
      else assets.push(placed);
      if (source.posterPath && source.posterHash) posterHashes.add(source.hash);
    }
    for (const digest of posterHashes) {
      const source = fileFor(input.files, digest);
      if (!source?.posterPath) continue;
      const placed = await placeSlice({
        userId: input.userId,
        projectId: input.projectId,
        revisionId: input.revisionId,
        id: `poster:${digest}`,
        sourcePath: source.posterPath,
        kind: "image",
        startFrame: 0,
        endFrame: 1,
        copyWhole: true,
        fps: input.plan.fps,
        ext: path.extname(source.posterPath).toLowerCase() || ".jpg",
      });
      if (placed.fresh) pending.push(placed);
      else assets.push(placed);
    }
    await assertExportRoom(
      input.userId,
      pending.reduce((sum, item) => sum + item.bytes, 0),
    );
    for (const item of pending) {
      try {
        await rename(absPath(item.partial), absPath(item.relative));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      let row;
      try {
        row = await prisma.studioExportCache.create({
          data: {
            userId: input.userId,
            projectId: input.projectId,
            revisionId: input.revisionId,
            key: item.key,
            bytes: item.bytes,
            relativePath: item.relative,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        row = await prisma.studioExportCache.findUniqueOrThrow({
          where: { key: item.key },
        });
      }
      await safeFile(row.relativePath);
      assets.push({
        id: item.id,
        mime: studioMimeType(row.relativePath),
        relativePath: row.relativePath,
        bytes: row.bytes,
      });
    }
    const offline = applySlices(input.plan);
    const dumped = JSON.stringify(offline);
    if (/https?:\/\//.test(dumped) || dumped.includes("/api/"))
      throw new StudioError("EXPORT_MEDIA_UNRESOLVED");
    return { plan: offline, assets };
  } catch (error) {
    await Promise.all(
      pending.map((item) => rm(absPath(item.partial), { force: true })),
    );
    throw error;
  }
}
