/** Draft operations preserve the exact track inventory until the server accepts it. */
export interface SegmentDraft {
  id?: string;
  title: string;
  subtitle?: string | null;
  posterArtId?: string | null;
  trackIds: string[];
}
export function moveSelectedTracks<T extends SegmentDraft>(
  segments: T[],
  selected: string[],
  targetId: string,
): T[] {
  if (!segments.some((s) => s.id === targetId)) return segments;
  const inventory = new Set(segments.flatMap((s) => s.trackIds));
  const moving = [...new Set(selected)].filter((id) => inventory.has(id));
  const ids = new Set(moving);
  return segments.map((s) => ({
    ...s,
    trackIds: [
      ...s.trackIds.filter((id) => !ids.has(id)),
      ...(s.id === targetId ? moving : []),
    ],
  }));
}
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  )
    return items;
  const result = [...items];
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}
export function groupTracksByAlbum(
  tracks: { id: string; album?: string | null }[],
): SegmentDraft[] {
  const groups = new Map<string, string[]>();
  for (const t of tracks) {
    const name = t.album?.trim() || "Без альбома";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(t.id);
  }
  return [...groups].map(([title, trackIds], i) => ({
    id: `new:album:${i}`,
    title,
    trackIds,
  }));
}
