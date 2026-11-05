import "server-only";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  realpath,
  stat,
  unlink,
  readFile,
} from "node:fs/promises";
import { extractTrackFromBuffer } from "@/lib/upload";
import { absPath } from "@/lib/storage";
import { createArtFromFile } from "@/server/arts";
import {
  parseMediaDirs,
  resolveInsideDirs,
  localMediaKind,
  type LocalMediaKind,
} from "@/lib/domain/local-media";

// Import media that already sits on the machine's disk (an OST folder, a
// screenshots directory) into the pool. Only paths inside MCP_LOCAL_MEDIA_DIRS
// are readable, and the user's originals are never moved: each file is copied
// into storage/tmp first, because createArtFromFile absorbs (moves) its source.

/** Max files per import call — a guard against a runaway agent, not a quota. */
export const MAX_IMPORT_FILES = 50;

/** Allowlisted roots of this installation (empty = the feature is off). */
export function mediaDirs(): string[] {
  return parseMediaDirs(process.env.MCP_LOCAL_MEDIA_DIRS, { home: homedir() });
}

/**
 * Existing path inside the allowlist, symlinks resolved. Throws
 * LOCAL_MEDIA_DISABLED / PATH_NOT_ALLOWED / NOT_FOUND.
 */
async function allowedPath(target: string): Promise<string> {
  const roots = mediaDirs();
  if (roots.length === 0) throw new Error("LOCAL_MEDIA_DISABLED");
  if (!resolveInsideDirs(target, roots)) throw new Error("PATH_NOT_ALLOWED");
  const real = await realpath(target).catch(() => null);
  if (!real) throw new Error("NOT_FOUND");
  // Re-check after following symlinks (and compare against resolved roots, so a
  // symlinked root itself keeps working).
  const realRoots = await Promise.all(
    roots.map((r) => realpath(r).catch(() => r)),
  );
  if (!resolveInsideDirs(real, realRoots)) throw new Error("PATH_NOT_ALLOWED");
  return real;
}

export interface LocalMediaFile {
  name: string;
  path: string;
  kind: LocalMediaKind;
  sizeBytes: number;
  title?: string;
  artist?: string | null;
  album?: string | null;
  durationSec?: number | null;
  sourceFolder?: string | null;
}

/** Supported media files of one directory (no recursion), sorted by name. */
export async function listLocalMedia(
  dir: string,
): Promise<{ dir: string; files: LocalMediaFile[] }> {
  const real = await allowedPath(dir);
  if (!(await stat(real)).isDirectory()) throw new Error("NOT_A_DIR");

  const entries = await readdir(real, { withFileTypes: true });
  const files: LocalMediaFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const kind = localMediaKind(entry.name);
    if (!kind) continue;
    const full = path.join(real, entry.name);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    const item: LocalMediaFile = {
      name: entry.name,
      path: full,
      kind,
      sizeBytes: info.size,
    };
    // A listed symlink can be visible, but it must never disclose tags from an
    // outside target. Reading always runs the same realpath allowlist check.
    if (kind !== "image")
      try {
        const target = await allowedPath(full);
        const metadata = await import("music-metadata").then((mm) =>
          mm.parseFile(target, { duration: true, skipCovers: true }),
        );
        item.title = metadata.common.title;
        item.artist = metadata.common.artist ?? null;
        item.album = metadata.common.album ?? null;
        item.durationSec = metadata.format.duration ?? null;
        item.sourceFolder = path.dirname(target);
      } catch {
        /* unsupported metadata or disallowed target */
      }
    files.push(item);
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { dir: real, files };
}

export interface ImportedLocalMedia {
  artId: string;
  label: string | null;
  kind: LocalMediaKind;
  durationSec: number | null;
  sizeBytes: number | null;
}

export interface ImportLocalMediaInput {
  paths: string[];
  maxPoolBytes?: number | null;
}

/**
 * Copy each file into the pool. Per-file problems (unsupported extension, path
 * outside the allowlist, quota) land in `failed` so a partially successful
 * batch still reports what got in.
 */
export async function importLocalMedia(
  userId: string,
  { paths, maxPoolBytes }: ImportLocalMediaInput,
): Promise<{
  items: ImportedLocalMedia[];
  failed: { path: string; error: string }[];
}> {
  if (paths.length === 0) throw new Error("NO_FILES");
  if (paths.length > MAX_IMPORT_FILES) throw new Error("TOO_MANY_FILES");

  const items: ImportedLocalMedia[] = [];
  const failed: { path: string; error: string }[] = [];
  const tmpDir = absPath("tmp");

  for (const requested of paths) {
    let tmpPath: string | null = null;
    try {
      const real = await allowedPath(requested);
      const info = await stat(real);
      if (!info.isFile()) throw new Error("NOT_A_FILE");
      const kind = localMediaKind(path.basename(real));
      if (!kind) throw new Error("BAD_EXT");

      await mkdir(tmpDir, { recursive: true });
      tmpPath = path.join(
        tmpDir,
        `local-${randomUUID()}${path.extname(real).toLowerCase()}`,
      );
      await copyFile(real, tmpPath);

      const art = await createArtFromFile(userId, {
        sourcePath: tmpPath,
        fileName: path.basename(real),
        maxPoolBytes: maxPoolBytes ?? null,
      });
      tmpPath = null; // absorbed into the pool
      items.push({
        artId: art.id,
        label: art.label,
        kind: art.kind as LocalMediaKind,
        durationSec: art.durationSec,
        sizeBytes: art.sizeBytes,
      });
    } catch (e) {
      failed.push({ path: requested, error: (e as Error).message });
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
  }
  return { items, failed };
}

/** Tournament imports copy bytes from a checked path; they never move originals. */
export async function readLocalTournamentTrack(
  target: string,
  maxBytes = Infinity,
) {
  const real = await allowedPath(target);
  const info = await stat(real);
  if (!info.isFile()) throw new Error("NOT_A_FILE");
  if (info.size > maxBytes) throw new Error("ARCHIVE_QUOTA");
  return extractTrackFromBuffer(real, await readFile(real));
}
