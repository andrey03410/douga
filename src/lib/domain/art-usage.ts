// What a pool media is used for. After classic constructors are gone, the only
// references are studio drafts and revisions. Those block deletion.

export interface ArtRelationCounts {
  studioReferences: number;
}

export interface UsageBreakdown {
  studio: number;
  total: number;
}

export function usageBreakdown(counts: ArtRelationCounts): UsageBreakdown {
  const studio = counts.studioReferences;
  return { studio, total: studio };
}

/** Sum the breakdowns of a selection (bulk delete warns about the whole batch). */
export function sumUsage(list: UsageBreakdown[]): UsageBreakdown {
  return list.reduce<UsageBreakdown>(
    (acc, u) => ({
      studio: acc.studio + u.studio,
      total: acc.total + u.total,
    }),
    { studio: 0, total: 0 },
  );
}

/** Russian plural: [one, few, many] — "1 карточка", "3 карточки", "5 карточек". */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Short "what uses it" line for a pool card. */
export function describeUsage(u: UsageBreakdown): string {
  if (!u.total) return "не используется";
  return `${u.studio} ${pluralRu(u.studio, ["ссылка", "ссылки", "ссылок"])} в проектах Studio`;
}

/** What deletion will actually do. Studio references block the delete. */
export function describeDeletion(u: UsageBreakdown): string {
  if (u.studio)
    return "Удаление недоступно: медиа используется в черновиках или версиях Studio";
  return "";
}
