/**
 * Task 33 (P08): the create form's draft of participants from Shikimori and
 * the pool, before anything is downloaded. Pure, so the merge rules are tested.
 */

export type DraftSource = { shikimori: { type: "character" | "anime"; id: number } } | { assetId: string };

export interface DraftItem {
  /** Same participant, wherever it came from: shikimori:character:1, art:<id>. */
  sourceKey: string;
  source: DraftSource;
  label: string;
  thumbUrl: string | null;
  /** Title it was added from ("+ главные персонажи" of an anime), if any. */
  group: string | null;
  subtitle?: string | null;
}

export const draftKey = (item: Pick<DraftItem, "sourceKey" | "group">) =>
  `${item.sourceKey}|${item.group ?? ""}`;

/** Add items; the exact same entry (participant and title) is not added twice. */
export function addToDraft(draft: readonly DraftItem[], items: readonly DraftItem[]): DraftItem[] {
  const seen = new Set(draft.map(draftKey));
  const out = [...draft];
  for (const item of items) {
    const key = draftKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export interface FormSource {
  shikimori?: { type: "character" | "anime"; id: number };
  assetId?: string;
  subtitle?: string;
  segment?: string;
}

/**
 * What the form sends. One segment: a participant met in several titles
 * comes once, with the first title as its subtitle (P25). "Каждый тайтл —
 * свой сегмент": the same participant may sit in several segments.
 */
export function draftSources(draft: readonly DraftItem[], splitByTitle: boolean): FormSource[] {
  const seen = new Set<string>();
  const out: FormSource[] = [];
  for (const item of draft) {
    const key = splitByTitle ? draftKey(item) : item.sourceKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...item.source,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      ...(splitByTitle && item.group ? { segment: item.group } : {}),
    });
  }
  return out;
}

/** Titles the draft would split into (for the "каждый тайтл" hint). */
export function draftGroups(draft: readonly DraftItem[]): string[] {
  return [...new Set(draft.map((d) => d.group).filter((g): g is string => Boolean(g)))];
}

export const shikimoriCount = (sources: readonly FormSource[]) =>
  sources.filter((s) => s.shikimori).length;
