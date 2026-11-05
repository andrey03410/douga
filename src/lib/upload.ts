import AdmZip from "adm-zip";
import {
  AUDIO_EXT,
  VIDEO_EXT,
  isJunkName as isJunk,
} from "@/lib/domain/media-ext";

export { AUDIO_EXT, VIDEO_EXT };

export type TrackKind = "audio" | "video";

/** Pure: is this filename a supported audio file? */
export function isAudioFile(name: string): boolean {
  if (isJunk(name)) return false;
  const lower = name.toLowerCase();
  return AUDIO_EXT.some((ext) => lower.endsWith(ext));
}

/** Pure: is this filename a supported video file? */
export function isVideoFile(name: string): boolean {
  if (isJunk(name)) return false;
  const lower = name.toLowerCase();
  return VIDEO_EXT.some((ext) => lower.endsWith(ext));
}

/** Pure: media kind by filename, or null if unsupported. */
export function mediaKind(name: string): TrackKind | null {
  if (isAudioFile(name)) return "audio";
  if (isVideoFile(name)) return "video";
  return null;
}

/** Pure: pick a display title — ID3 tag wins, else the filename without extension. */
export function deriveTitle(
  filename: string,
  tagTitle?: string | null,
): string {
  const tag = tagTitle?.trim();
  if (tag) return tag;
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.[^.]+$/, "");
}

export interface ExtractedTrack {
  filename: string;
  kind: TrackKind;
  title: string;
  artist: string | null;
  durationSec: number | null;
  data: Buffer;
  album?: string | null;
  sourceFolder?: string | null;
  cover?: { data: Buffer; format: string };
}

/**
 * Extract audio and video entries from a ZIP buffer. Audio titles/artist come
 * from embedded tags (music-metadata) with a filename fallback; video titles
 * always come from the filename (container tags are unreliable), duration is
 * taken from the container when parseable (ffmpeg probes it later otherwise).
 */
export async function extractTracksFromZip(
  zipBuffer: Buffer,
): Promise<ExtractedTrack[]> {
  const zip = new AdmZip(zipBuffer);
  const tracks: ExtractedTrack[] = [];
  for (const entry of zip
    .getEntries()
    .filter((e) => !e.isDirectory && mediaKind(e.entryName) !== null)) {
    tracks.push(await extractTrackFromBuffer(entry.entryName, entry.getData()));
  }
  tracks.sort((a, b) => a.filename.localeCompare(b.filename));
  return tracks;
}

export async function extractTrackFromBuffer(
  filename: string,
  data: Buffer,
): Promise<ExtractedTrack> {
  const kind = mediaKind(filename);
  if (!kind) throw new Error("BAD_EXT");
  const mm = await import("music-metadata");
  let title: string | undefined,
    artist: string | null = null,
    album: string | null = null,
    durationSec: number | null = null,
    cover: ExtractedTrack["cover"];
  try {
    const meta = await mm.parseBuffer(data, undefined, { duration: true });
    if (kind === "audio") {
      title = meta.common.title;
      artist = meta.common.artist ?? null;
      album = meta.common.album ?? null;
      const picture = meta.common.picture?.find((p) =>
        ["image/jpeg", "image/png", "image/webp"].includes(p.format),
      );
      if (picture)
        cover = { data: Buffer.from(picture.data), format: picture.format };
    }
    durationSec = meta.format.duration ?? null;
  } catch {
    /* unreadable tags fall back to filename */
  }
  const normalized = filename.replaceAll("\\", "/");
  const sourceFolder = normalized.includes("/")
    ? normalized.slice(0, normalized.lastIndexOf("/"))
    : null;
  return {
    filename,
    kind,
    title: deriveTitle(filename, title),
    artist,
    album,
    sourceFolder,
    durationSec,
    data,
    cover,
  };
}

/** Remove common archive wrapper folders before deciding the segment folders. */
export function archiveFolders(filenames: string[]): string[] {
  const paths = filenames.map((f) =>
    f.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1),
  );
  while (
    paths.length &&
    paths.every((p) => p.length > 0 && p[0] === paths[0][0])
  )
    for (const p of paths) p.shift();
  return paths.map((p) => p[0] ?? "");
}

export function inspectTrackArchive(zipBuffer: Buffer) {
  const names = new AdmZip(zipBuffer)
    .getEntries()
    .filter((e) => !e.isDirectory && mediaKind(e.entryName) !== null)
    .map((e) => e.entryName);
  return {
    folders: [...new Set(archiveFolders(names).filter(Boolean))].sort(),
    trackCount: names.length,
  };
}

export function groupArchiveTracks(
  tracks: ExtractedTrack[],
  splitFolders: boolean,
  title = "Все треки",
) {
  const folders = archiveFolders(tracks.map((t) => t.filename));
  const groups = new Map<string, number[]>();
  for (const [index] of tracks.entries()) {
    const folder = splitFolders ? folders[index] || "Все треки" : title;
    groups.set(folder, [...(groups.get(folder) ?? []), index]);
  }
  return [...groups].map(([title, trackIndexes]) => ({ title, trackIndexes }));
}
