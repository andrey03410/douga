import "server-only";
import { z } from "zod";
import {
  extractTrackFromBuffer,
  extractTracksFromZip,
  groupArchiveTracks,
  type ExtractedTrack,
} from "@/lib/upload";
import { itemSourceSchema, resolveItemSources } from "./tournament-items";
import type { SkippedItem } from "./shikimori";

/**
 * Task 33: what the create form (and "add participants") sends — archives,
 * loose files and a draft of Shikimori/pool sources — read into participants
 * and segment layout. Archives keep their task 27 behaviour.
 */

/** A draft entry: any item source plus the segment it goes to ("каждый тайтл — свой сегмент"). */
export function parseFormSources(raw: unknown) {
  return z
    .array(z.object({ segment: z.string().trim().max(300).optional() }).passthrough())
    .max(2000)
    .parse(raw)
    .map(({ segment, ...rest }) => ({ segment, source: itemSourceSchema.parse(rest) }));
}

export interface ParsedParticipants {
  tracks: ExtractedTrack[];
  segments: { title: string; trackIndexes: number[] }[];
  skipped: SkippedItem[];
}

const isZip = (f: File) => /\.zip$/i.test(f.name);

export async function participantsFromForm(
  userId: string,
  form: FormData,
  maxBytes: number,
): Promise<ParsedParticipants> {
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const splitFolders = String(form.get("splitFolders") ?? "") === "true";
  let segmentTitles: string[] = [];
  const titlesRaw = JSON.parse(String(form.get("segmentTitles") ?? "[]"));
  if (!Array.isArray(titlesRaw) || titlesRaw.some((t) => typeof t !== "string"))
    throw new Error("INVALID_SEGMENTS");
  segmentTitles = titlesRaw;
  const sources = parseFormSources(JSON.parse(String(form.get("sources") ?? "[]")));

  const tracks: ExtractedTrack[] = [];
  const segments: { title: string; trackIndexes: number[] }[] = [];
  const push = (title: string, items: ExtractedTrack[]) => {
    if (!items.length) return;
    const offset = tracks.length;
    tracks.push(...items);
    const existing = segments.find((s) => s.title === title);
    const indexes = items.map((_, i) => offset + i);
    if (existing) existing.trackIndexes.push(...indexes);
    else segments.push({ title, trackIndexes: indexes });
  };

  const zips = files.filter(isZip);
  const loose = files.filter((f) => !isZip(f));
  for (const [i, file] of zips.entries()) {
    const extracted = await extractTracksFromZip(Buffer.from(await file.arrayBuffer()));
    const images = extracted.length > 0 && extracted.every((t) => t.kind === "image");
    const fallback = images ? "Все картинки" : "Все треки";
    const title =
      segmentTitles[i]?.trim() || (zips.length > 1 ? file.name.replace(/\.zip$/i, "") : fallback);
    for (const s of groupArchiveTracks(extracted, zips.length === 1 && splitFolders, title))
      push(s.title, s.trackIndexes.map((x) => extracted[x]));
  }
  const looseTracks: ExtractedTrack[] = [];
  for (const file of loose)
    looseTracks.push(await extractTrackFromBuffer(file.name, Buffer.from(await file.arrayBuffer())));
  push(zips.length ? "Файлы" : "Все участники", looseTracks);

  const resolved = await resolveItemSources(
    userId,
    sources.map((s) => s.source),
    maxBytes,
  );
  sources.forEach((s, i) => {
    const t = resolved.tracks[i];
    if (t) push(s.segment?.trim() || "Все участники", [t]);
  });
  return { tracks, segments, skipped: resolved.skipped };
}
