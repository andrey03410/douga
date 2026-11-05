// Pool media references in Studio and tournament covers/posters block deletion.

export interface ArtRelationCounts {
  studioReferences: number;
  trackCovers?: number;
  segmentPosters?: number;
}

export interface UsageBreakdown {
  studio: number;
  tournament?: number;
  total: number;
}

export function usageBreakdown(counts: ArtRelationCounts): UsageBreakdown {
  const studio = counts.studioReferences;
  const tournament = (counts.trackCovers ?? 0) + (counts.segmentPosters ?? 0);
  return {
    studio,
    ...(tournament ? { tournament } : {}),
    total: studio + tournament,
  };
}

/** Sum the breakdowns of a selection (bulk delete warns about the whole batch). */
export function sumUsage(list: UsageBreakdown[]): UsageBreakdown {
  return list.reduce<UsageBreakdown>(
    (acc, u) => ({
      studio: acc.studio + u.studio,
      total: acc.total + u.total,
      ...((acc.tournament ?? 0) + (u.tournament ?? 0)
        ? { tournament: (acc.tournament ?? 0) + (u.tournament ?? 0) }
        : {}),
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
  return [
    u.studio
      ? `${u.studio} ${pluralRu(u.studio, ["ссылка", "ссылки", "ссылок"])} в проектах Studio`
      : "",
    u.tournament
      ? `${u.tournament} ${pluralRu(u.tournament, ["ссылка", "ссылки", "ссылок"])} в турнирах`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What deletion will actually do. Studio references block the delete. */
export function describeDeletion(u: UsageBreakdown): string {
  if (u.tournament)
    return "Удаление недоступно: медиа используется как обложка или постер в турнирах";
  if (u.studio)
    return "Удаление недоступно: медиа используется в черновиках или версиях Studio";
  return "";
}
