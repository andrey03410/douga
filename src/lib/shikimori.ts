import "server-only";
import { absoluteImageUrl, isSafeImagePath, isSafePosterUrl } from "@/lib/domain/shikimori";
import {
  nextDelayMs,
  retryDelayMs,
  trimHistory,
  type RateLimitConfig,
} from "@/lib/domain/rate-limit";

const DEFAULT_BASE = "https://shikimori.io";
const TIMEOUT_MS = 10_000;

// Shikimori documents two caps: 5 requests/second AND 90 requests/minute. An
// agent walking a user's list (roles of every anime) blows past the minute cap
// long before the second one, so both are enforced client-side, with a margin.
const API_LIMITS: RateLimitConfig = {
  minIntervalMs: 250,
  windowMs: 60_000,
  maxInWindow: 80,
};
// Static images are not part of the API quota — only the per-second gap applies.
const ASSET_LIMITS: RateLimitConfig = { minIntervalMs: 250, windowMs: 1, maxInWindow: 1 };

// A 429 means the window is already exhausted: waits are seconds, not millis.
const RETRY_SCHEDULE_MS = [2_000, 8_000, 20_000];

/** Test hook: SHIKIMORI_RETRY_MS="10,20" shortens the backoff schedule. */
function retrySchedule(): number[] {
  const raw = process.env.SHIKIMORI_RETRY_MS?.trim();
  if (!raw) return RETRY_SCHEDULE_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : RETRY_SCHEDULE_MS;
}

export function shikimoriBase(): string {
  return (process.env.SHIKIMORI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

function userAgent(): string {
  return process.env.SHIKIMORI_USER_AGENT?.trim() || "douga";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let gate: Promise<unknown> = Promise.resolve();
/** Start timestamps of recent API requests (the sliding-window budget). */
let apiHistory: number[] = [];
let lastAssetAt = 0;

/**
 * Serialize outgoing requests and hold each one until both caps allow it.
 * API calls consume the minute budget; static images only respect the gap.
 */
function throttle(kind: "api" | "asset"): Promise<void> {
  const slot = gate.then(async () => {
    if (kind === "asset") {
      const wait = lastAssetAt + ASSET_LIMITS.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAssetAt = Date.now();
      return;
    }
    for (;;) {
      const wait = nextDelayMs(apiHistory, Date.now(), API_LIMITS);
      if (wait <= 0) break;
      await sleep(wait);
    }
    const now = Date.now();
    apiHistory = trimHistory(apiHistory, now, API_LIMITS);
    apiHistory.push(now);
    lastAssetAt = now; // an API call also counts as "just talked to the host"
  });
  gate = slot.catch(() => {});
  return slot;
}

/** A JSON body to POST (GraphQL); without it the request is a plain GET. */
type ApiBody = Record<string, unknown> | undefined;

async function requestOnce(pathAndQuery: string, body: ApiBody): Promise<Response> {
  // Waiting for the minute quota is not network time. Starting the timeout
  // before the gate aborts otherwise healthy requests in large discovery runs.
  await throttle("api");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${shikimoriBase()}${pathAndQuery}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Every API call, REST or GraphQL: one queue, one 429 retry policy. */
async function requestJson(pathAndQuery: string, body?: ApiBody): Promise<unknown> {
  const schedule = retrySchedule();
  for (let attempt = 0; ; attempt++) {
    const res = await requestOnce(pathAndQuery, body);
    if (res.status === 429) {
      // The server's window is exhausted; back off (honouring Retry-After).
      const wait = retryDelayMs(attempt, schedule, res.headers.get("retry-after"));
      if (wait == null) throw new Error("RATE_LIMITED");
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`SHIKIMORI_HTTP_${res.status}`);
    return await res.json();
  }
}

function getJson(pathAndQuery: string): Promise<unknown> {
  return requestJson(pathAndQuery);
}

export async function searchAnimesRaw(q: string, limit: number): Promise<unknown[]> {
  const data = await getJson(`/api/animes?search=${encodeURIComponent(q)}&limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

export async function searchCharactersRaw(q: string): Promise<unknown[]> {
  const data = await getJson(`/api/characters/search?search=${encodeURIComponent(q)}`);
  return Array.isArray(data) ? data : [];
}

/** Anime details (includes the studio list). */
export async function fetchAnimeRaw(id: number): Promise<unknown> {
  return getJson(`/api/animes/${id}`);
}

/** Character details (includes the anime list with airing dates). */
export async function fetchCharacterRaw(id: number): Promise<unknown> {
  return getJson(`/api/characters/${id}`);
}

export async function fetchPersonRaw(id: number): Promise<unknown> {
  return getJson(`/api/people/${id}`);
}

export async function fetchUserHistoryRaw(userId: number, page = 1, limit = 100): Promise<unknown[]> {
  const data = await getJson(`/api/users/${userId}/history?page=${page}&limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchStudiosRaw(): Promise<unknown[]> {
  const data = await getJson(`/api/studios`);
  return Array.isArray(data) ? data : [];
}

export async function fetchStudioAnimesRaw(
  studioId: number,
  order: string,
  limit: number,
): Promise<unknown[]> {
  const data = await getJson(
    `/api/animes?studio=${studioId}&order=${encodeURIComponent(order)}&limit=${limit}`,
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchAnimeRolesRaw(animeId: number): Promise<unknown[]> {
  const data = await getJson(`/api/animes/${animeId}/roles`);
  return Array.isArray(data) ? data : [];
}

/** Profile by nickname (default) or by numeric id. Throws SHIKIMORI_HTTP_404. */
export async function fetchUserRaw(ref: string): Promise<unknown> {
  const key = ref.trim();
  const path = `/api/users/${encodeURIComponent(key)}`;
  return getJson(/^\d+$/.test(key) ? path : `${path}?is_nickname=1`);
}

/**
 * A user's anime list. The API caps `limit` at 5000 per page and lists that
 * long are unheard of, so one page is the whole list.
 */
export async function fetchUserAnimeRatesRaw(
  userId: number,
  status: string | null,
  limit = 5000,
): Promise<unknown[]> {
  const query = status ? `&status=${encodeURIComponent(status)}` : "";
  const data = await getJson(`/api/users/${userId}/anime_rates?limit=${limit}&page=1${query}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchUserFavouritesRaw(userId: number): Promise<unknown> {
  return getJson(`/api/users/${userId}/favourites`);
}

export interface FetchedImage {
  data: Buffer;
  contentType: string;
}

async function fetchImage(url: string): Promise<FetchedImage> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await throttle("asset");
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent() },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("POSTER_FETCH_FAILED");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error("POSTER_FETCH_FAILED");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("POSTER_FETCH_FAILED");
    return { data: buf, contentType };
  } catch {
    throw new Error("POSTER_FETCH_FAILED");
  } finally {
    clearTimeout(t);
  }
}

/** Legacy /system poster (older, downscaled copy — kept as a fallback). */
export async function fetchPoster(posterPath: string): Promise<FetchedImage> {
  if (!isSafeImagePath(posterPath)) throw new Error("BAD_IMAGE_PATH");
  return fetchImage(absoluteImageUrl(shikimoriBase(), posterPath));
}

/** The poster the site itself shows (validated /uploads/poster URL). */
export async function fetchPosterByUrl(url: string): Promise<FetchedImage> {
  if (!isSafePosterUrl(shikimoriBase(), url)) throw new Error("BAD_IMAGE_PATH");
  return fetchImage(url);
}

/** GraphQL shares the REST queue and 429 retries (Retry-After, same budget). */
export async function fetchGraphql(query: string): Promise<unknown> {
  return requestJson("/api/graphql", { query });
}

/** Shikimori's GraphQL caps a page at 50 entries. */
const GRAPHQL_PAGE = 50;

/**
 * Current poster URLs (as on the site) for anime or character ids, in pages of
 * 50. `limit` is mandatory in practice: without it Shikimori answers with just
 * TWO entries and the rest would silently fall back to the legacy poster.
 */
export async function fetchFreshPosterUrls(
  type: "anime" | "character",
  ids: number[],
): Promise<Map<number, string>> {
  const clean = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, string>();
  const field = type === "anime" ? "animes" : "characters";

  for (let i = 0; i < clean.length; i += GRAPHQL_PAGE) {
    const page = clean.slice(i, i + GRAPHQL_PAGE);
    const body = await fetchGraphql(
      `{${field}(ids: "${page.join(",")}", limit: ${page.length}){ id poster { originalUrl } }}`,
    );
    const rows = (body as { data?: Record<string, unknown> })?.data?.[field];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const r = row as { id?: unknown; poster?: { originalUrl?: unknown } | null };
      const id = Number(r?.id);
      const url = r?.poster?.originalUrl;
      if (Number.isInteger(id) && typeof url === "string") out.set(id, url);
    }
  }
  return out;
}
