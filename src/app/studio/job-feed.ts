import type { StudioJobView } from "@/server/studio/job-types";
export type StudioJobPage = {
  items: StudioJobView[];
  nextCursor: string | null;
};
export type StudioJobPageReader = (page: {
  limit: number;
  cursor?: string;
}) => Promise<StudioJobPage>;
/** Re-read the complete requested window; missing rows are deleted, not stale tails. */
export async function readLoadedJobWindow(
  read: StudioJobPageReader,
  count: number,
): Promise<StudioJobPage> {
  const items = new Map<string, StudioJobView>();
  let cursor: string | undefined,
    nextCursor: string | null = null;
  while (items.size < count) {
    const page = await read({
      limit: Math.min(100, count - items.size),
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.items) items.set(item.id, item);
    nextCursor = page.nextCursor;
    if (!nextCursor || nextCursor === cursor || !page.items.length) break;
    cursor = nextCursor;
  }
  return { items: [...items.values()], nextCursor };
}
