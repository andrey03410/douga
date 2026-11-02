import "server-only";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

// All user media + render outputs live under storage/ (gitignored). Paths stored
// in the DB are relative to this root so the install is portable.
export const STORAGE_ROOT = path.join(process.cwd(), "storage");

export function absPath(relative: string): string {
  return path.join(STORAGE_ROOT, relative);
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

/** Write a buffer to a storage-relative path, creating parent dirs. Returns the relative path. */
export async function saveFile(relative: string, data: Buffer): Promise<string> {
  const full = absPath(relative);
  await ensureDir(full);
  await writeFile(full, data);
  return relative;
}

/** Best-effort recursive delete of a storage-relative path. */
export async function removePath(relative: string): Promise<void> {
  await rm(absPath(relative), { recursive: true, force: true });
}

export function trackPath(tournamentId: string, trackId: string, ext: string): string {
  return path.join("tournaments", tournamentId, "tracks", `${trackId}${ext}`);
}

export function artPath(userId: string, artId: string, ext: string): string {
  return path.join("arts", userId, `${artId}${ext}`);
}
