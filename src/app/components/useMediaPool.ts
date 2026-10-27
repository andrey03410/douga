"use client";

import { poolBulkDeleteOutcome } from "@/lib/domain/bulk-delete";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeDeletion, sumUsage, pluralRu, type UsageBreakdown } from "@/lib/domain/art-usage";

// The media pool as data: paging, search, kind filter, selection, rename and
// delete. Shared by the media manager modal and the personal cabinet so the two
// cannot drift apart (phase 17).

export type PoolKind = "image" | "video" | "audio";

export interface PoolArt {
  id: string;
  label: string | null;
  kind: PoolKind;
  url: string;
  posterUrl: string | null;
  durationSec: number | null;
  hasAudio: boolean;
  sizeBytes: number | null;
  usage: UsageBreakdown;
  usageCount: number;
}

const PAGE_SIZE = 40;

async function fetchArts(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/arts?${qs}`, { cache: "no-store" });
  if (!res.ok) return { arts: [] as PoolArt[], nextCursor: null as string | null };
  return (await res.json()) as { arts: PoolArt[]; nextCursor: string | null };
}

export interface UseMediaPoolOptions {
  /** Don't load anything until asked (the cabinet list starts collapsed). */
  enabled?: boolean;
  /** Also load the "recently used" block. */
  withRecent?: boolean;
  pageSize?: number;
  /** Called after the pool changed, so a parent can refresh its own view. */
  onChange?: () => void;
}

export function useMediaPool({
  enabled = true,
  withRecent = false,
  pageSize = PAGE_SIZE,
  onChange,
}: UseMediaPoolOptions = {}) {
  const [arts, setArts] = useState<PoolArt[]>([]);
  const [recent, setRecent] = useState<PoolArt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | PoolKind>("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const lastPickedRef = useRef<number | null>(null);

  const reload = useCallback(
    async (q = query, k = kind) => {
      if (!enabled) return;
      const data = await fetchArts({
        limit: String(pageSize),
        ...(q ? { q } : {}),
        ...(k ? { kind: k } : {}),
      });
      setArts(data.arts);
      setNextCursor(data.nextCursor);
    },
    [enabled, pageSize, query, kind],
  );

  // First page + the recent block; re-runs (debounced) on search/filter change.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      void (async () => {
        const data = await fetchArts({
          limit: String(pageSize),
          ...(query ? { q: query } : {}),
          ...(kind ? { kind } : {}),
        });
        setArts(data.arts);
        setNextCursor(data.nextCursor);
      })();
    }, query || kind ? 300 : 0);
    return () => clearTimeout(t);
  }, [enabled, query, kind, pageSize]);

  useEffect(() => {
    if (!enabled || !withRecent) return;
    void fetchArts({ recent: "1" }).then((d) => setRecent(d.arts));
  }, [enabled, withRecent]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const data = await fetchArts({
        limit: String(pageSize),
        cursor: nextCursor,
        ...(query ? { q: query } : {}),
        ...(kind ? { kind } : {}),
      });
      setArts((prev) => [...prev, ...data.arts]);
      setNextCursor(data.nextCursor);
    } finally {
      loadingRef.current = false;
    }
  }, [nextCursor, pageSize, query, kind]);

  const forget = useCallback((ids: Set<string>) => {
    setArts((prev) => prev.filter((a) => !ids.has(a.id)));
    setRecent((prev) => prev.filter((a) => !ids.has(a.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const rename = useCallback(
    async (art: PoolArt, next: string | null) => {
      const res = await fetch(`/api/arts/${art.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Не удалось переименовать");
      }
      const patch = (list: PoolArt[]) =>
        list.map((a) => (a.id === art.id ? { ...a, label: next } : a));
      setArts(patch);
      setRecent(patch);
    },
    [],
  );

  const remove = useCallback(
    async (art: PoolArt) => {
      // Say what deletion actually does: cards, playlist entries and manual-top
      // positions that sound with the media go with it (cascade), other top
      // positions are only freed.
      const consequences = describeDeletion(art.usage);
      if (
        !confirm(
          `Удалить «${art.label ?? "без названия"}»?${
            consequences ? ` ${consequences}.` : ""
          } Действие необратимо.`,
        )
      )
        return;
      const res = await fetch(`/api/arts/${art.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Не удалось удалить");
        return;
      }
      forget(new Set([art.id]));
      onChange?.();
    },
    [forget, onChange],
  );

  /** Click toggles one card; Shift-click extends the selection to a range. */
  const toggleSelected = useCallback(
    (index: number, id: string, shift: boolean) => {
      setError(null);
      // The range is resolved here, not inside the updater: React runs the
      // updater at render time, when the anchor already points at this click.
      const anchor = lastPickedRef.current;
      const range =
        shift && anchor !== null && index >= 0
          ? arts.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((a) => a.id)
          : null;
      setSelected((prev) => {
        const next = new Set(prev);
        if (range) {
          for (const rangeId of range) next.add(rangeId);
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastPickedRef.current = index;
    },
    [arts],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    lastPickedRef.current = null;
  }, []);

  const removeSelected = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const chosen = arts.filter((a) => selected.has(a.id));
    const consequences = describeDeletion(sumUsage(chosen.map((a) => a.usage)));
    const what = `${ids.length} ${pluralRu(ids.length, ["файл", "файла", "файлов"])}`;
    if (
      !confirm(
        `Удалить ${what} из пула?${consequences ? ` ${consequences}.` : ""} Действие необратимо.`,
      )
    )
      return;

    const res = await fetch("/api/arts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    const outcome=poolBulkDeleteOutcome(res.status,data);
    forget(new Set(outcome.deleted));
    if(outcome.failedIds.length)setSelected(new Set(outcome.failedIds));
    else if(res.ok)clearSelection();
    if(outcome.deleted.length)onChange?.();
    setError(outcome.error);
  }, [arts, selected, forget, clearSelection, onChange]);

  return {
    arts,
    recent,
    nextCursor,
    query,
    setQuery,
    kind,
    setKind,
    error,
    setError,
    selected,
    toggleSelected,
    clearSelection,
    removeSelected,
    rename,
    remove,
    reload,
    loadMore,
  };
}

export type MediaPool = ReturnType<typeof useMediaPool>;
