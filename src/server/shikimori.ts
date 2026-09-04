import "server-only";
import {
  mapAnimeResult,
  mapCharacterResult,
  mapUser,
  mapUserRate,
  matchStudios,
  countByStatus,
  extractFavourites,
  extractRoleCharacters,
  selectUserRates,
  pickLabel,
  absoluteImageUrl,
  isSafeImagePath,
  type ShikimoriType,
  type AnimeResult,
  type CharacterResult,
  type FavouriteItem,
  type ShikimoriUser,
  type StudioResult,
  type UserRate,
  type UserRateOrder,
  type UserRateStatus,
  extractCharacterProfile,
  extractAnimeProfile,
} from "@/lib/domain/shikimori";
import {
  shikimoriBase,
  searchAnimesRaw,
  searchCharactersRaw,
  fetchPoster,
  fetchPosterByUrl,
  fetchFreshPosterUrls,
  fetchStudiosRaw,
  fetchStudioAnimesRaw,
  fetchAnimeRolesRaw,
  fetchUserRaw,
  fetchUserAnimeRatesRaw,
  fetchUserFavouritesRaw,
  fetchCharacterRaw,
  fetchAnimeRaw,
  fetchPersonRaw,
  fetchUserHistoryRaw,
} from "@/lib/shikimori";
import { createArt } from "@/server/arts";

const MAX_RESULTS = 8;

export interface SearchDto {
  id: number;
  type: ShikimoriType;
  label: string | null;
  thumbUrl: string | null;
  posterPath: string | null;
  facts: string | null;
}

function animeFacts(kind: string | null, score: number | null, year: number | null): string | null {
  const parts: string[] = [];
  if (year != null) parts.push(String(year));
  if (kind) parts.push(kind.toUpperCase());
  if (score != null) parts.push(`★${score.toFixed(2)}`);
  return parts.length ? parts.join(" · ") : null;
}

const MAX_DISCOVERY = 50;
const clampLimit = (n: number | undefined, def: number) =>
  Math.min(Math.max(1, Math.floor(n ?? def)), MAX_DISCOVERY);

function thumbFor(base: string, previewPath: string | null): string | null {
  return previewPath && isSafeImagePath(previewPath) ? absoluteImageUrl(base, previewPath) : null;
}

function animeToDto(base: string, r: AnimeResult): SearchDto {
  return {
    id: r.id, type: "anime", label: pickLabel(r.russian, r.name),
    thumbUrl: thumbFor(base, r.previewPath), posterPath: r.posterPath,
    facts: animeFacts(r.kind, r.score, r.year),
  };
}

function characterToDto(base: string, r: CharacterResult): SearchDto {
  return {
    id: r.id, type: "character", label: pickLabel(r.russian, r.name),
    thumbUrl: thumbFor(base, r.previewPath), posterPath: r.posterPath,
    facts: r.russian && r.russian !== r.name ? r.name : null,
  };
}

export async function search(type: ShikimoriType, q: string, limit = MAX_RESULTS): Promise<SearchDto[]> {
  const query = q.trim();
  if (!query) return [];
  const base = shikimoriBase();

  if (type === "anime") {
    const raw = await searchAnimesRaw(query, limit);
    return raw.map(mapAnimeResult).filter((r): r is AnimeResult => r != null)
      .slice(0, limit).map((r) => animeToDto(base, r));
  }
  const raw = await searchCharactersRaw(query);
  return raw.map(mapCharacterResult).filter((r): r is CharacterResult => r != null)
    .slice(0, limit).map((r) => characterToDto(base, r));
}

export async function findStudio(query: string, limit = MAX_RESULTS): Promise<StudioResult[]> {
  if (!query.trim()) return [];
  const raw = await fetchStudiosRaw();
  return matchStudios(raw, query, clampLimit(limit, MAX_RESULTS));
}

export async function studioAnimes(
  studioId: number,
  opts: { order?: string; limit?: number } = {},
): Promise<SearchDto[]> {
  const order = opts.order?.trim() || "popularity";
  const limit = clampLimit(opts.limit, 20);
  const base = shikimoriBase();
  const raw = await fetchStudioAnimesRaw(studioId, order, limit);
  return raw.map(mapAnimeResult).filter((r): r is AnimeResult => r != null)
    .slice(0, limit).map((r) => animeToDto(base, r));
}

export interface AnimeProfileDto {
  id: number;
  type: "anime";
  label: string;
  kind: string | null;
  year: number | null;
  score: number | null;
  posterPath: string | null;
  studios: { id: number; name: string }[];
  genres: string[];
  facts: string;
}

/** One anime with its production studios — the base of a "studio vs studio" round. */
export async function animeProfile(id: number): Promise<AnimeProfileDto> {
  const raw = await fetchAnimeRaw(id);
  const p = extractAnimeProfile(raw);
  if (!p) throw new Error("ANIME_NOT_FOUND");
  const facts = [p.year, p.kind?.toUpperCase(), p.score ? `★${p.score.toFixed(2)}` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    id: p.id,
    type: "anime",
    label: p.label,
    kind: p.kind,
    year: p.year,
    score: p.score,
    posterPath: p.posterPath && isSafeImagePath(p.posterPath) ? p.posterPath : null,
    studios: p.studios,
    genres: p.genres,
    facts,
  };
}

export interface CharacterProfileDto {
  id: number;
  type: "character";
  label: string;
  /** Source description; may contain Shikimori BBCode and spoilers. */
  description: string | null;
  posterPath: string | null;
  /** Year of the first appearance (null when nothing is datable). */
  debutYear: number | null;
  animes: { id: number; label: string; kind: string | null; year: number }[];
}

/**
 * One character with the anime they appear in, oldest first. `debutYear` is the
 * character's own era — a 2006 heroine stays a 2006 heroine in a 2020 remake.
 */
export async function characterProfile(id: number): Promise<CharacterProfileDto> {
  const raw = await fetchCharacterRaw(id);
  const profile = extractCharacterProfile(raw);
  if (!profile) throw new Error("CHARACTER_NOT_FOUND");
  return {
    id: profile.id,
    type: "character",
    label: profile.label,
    description: sourceDescription(raw),
    posterPath: profile.posterPath && isSafeImagePath(profile.posterPath) ? profile.posterPath : null,
    debutYear: profile.debutYear,
    animes: profile.animes,
  };
}

export async function animeCharacters(
  animeId: number,
  opts: { role?: "Main" | "all" } = {},
): Promise<SearchDto[]> {
  const base = shikimoriBase();
  const raw = await fetchAnimeRolesRaw(animeId);
  return extractRoleCharacters(raw, opts.role ?? "Main").map((r) => characterToDto(base, r));
}

// ---- User list & favourites (phase 13) ----

const MAX_USER_ITEMS = 500;
const DEFAULT_USER_ITEMS = 50;

/** Resolve a nickname (or numeric id) to a profile; USER_NOT_FOUND when absent. */
export async function findUser(ref: string): Promise<ShikimoriUser> {
  const key = ref.trim();
  if (!key) throw new Error("USER_NOT_FOUND");
  let raw: unknown;
  try {
    raw = await fetchUserRaw(key);
  } catch (e) {
    if (/HTTP_404/.test((e as Error).message)) throw new Error("USER_NOT_FOUND");
    throw e;
  }
  const user = mapUser(raw);
  if (!user) throw new Error("USER_NOT_FOUND");
  return user;
}

/** A list entry: the anime DTO plus this user's own rate. */
export interface UserAnimeDto extends SearchDto {
  /** "tv" | "movie" | "ova" | "ona" | "special" | "music" | ... — music/PV
   *  entries have no characters, so callers filter by this before asking. */
  kind: string | null;
  /** The user's score 1..10; null = watched/planned without a score. */
  userScore: number | null;
  status: UserRateStatus;
  episodes: number;
  rewatches: number;
  updatedAt: string | null;
}

export interface UserAnimeListResult {
  user: ShikimoriUser;
  /** Size of the whole list (before status/score filtering). */
  total: number;
  countsByStatus: Record<UserRateStatus, number>;
  /** How many entries matched the filter (before the limit cut). */
  matched: number;
  items: UserAnimeDto[];
}

function rateToDto(base: string, r: UserRate): UserAnimeDto {
  return {
    ...animeToDto(base, r.anime),
    kind: r.anime.kind,
    userScore: r.score,
    status: r.status,
    episodes: r.episodes,
    rewatches: r.rewatches,
    updatedAt: r.updatedAt,
  };
}

/**
 * The user's whole anime list with their scores and statuses. The list is
 * fetched in one request and filtered/ordered locally, so "top by score" is
 * computed over everything, not over one page.
 */
export async function userAnimeList(
  ref: string,
  opts: {
    status?: UserRateStatus | "all";
    minScore?: number;
    order?: UserRateOrder;
    limit?: number;
  } = {},
): Promise<UserAnimeListResult> {
  const user = await findUser(ref);
  const base = shikimoriBase();
  const raw = await fetchUserAnimeRatesRaw(user.id, null);
  const rates = raw.map(mapUserRate).filter((r): r is UserRate => r != null);

  const filtered = selectUserRates(rates, {
    status: opts.status,
    minScore: opts.minScore,
    order: opts.order,
  });
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_USER_ITEMS)), MAX_USER_ITEMS);

  return {
    user,
    total: rates.length,
    countsByStatus: countByStatus(rates),
    matched: filtered.length,
    items: filtered.slice(0, limit).map((r) => rateToDto(base, r)),
  };
}

export interface UserFavouritesResult {
  user: ShikimoriUser;
  animes: SearchDto[];
  characters: SearchDto[];
  people: PersonFavourite[];
  seiyuu: PersonFavourite[];
}

interface PersonFavourite { id: number; label: string; url: string }

function peopleFavourites(value: unknown): PersonFavourite[] {
  return (Array.isArray(value) ? value : []).flatMap(p => {
    if (typeof p?.id !== "number" || typeof p?.name !== "string") return [];
    return [{ id: p.id, label: p.russian || p.name, url: `${shikimoriBase()}/people/${p.id}` }];
  });
}

function sourceDescription(raw: unknown): string | null {
  const value = (raw as { description?: unknown } | null)?.description;
  return typeof value === "string" && value.trim() ? value : null;
}

/** Credits help distinguish an artist preference from a show's overall score. */
export async function personProfile(id: number) {
  const raw = await fetchPersonRaw(id) as {
    id?: number; name?: string; russian?: string; website?: string;
    works?: { anime?: { id: number; name: string; russian?: string }; role?: string }[];
  };
  if (typeof raw?.id !== "number" || typeof raw?.name !== "string") throw new Error("PERSON_NOT_FOUND");
  return {
    id: raw.id, label: raw.russian || raw.name, url: `${shikimoriBase()}/people/${raw.id}`,
    website: raw.website || null,
    works: (Array.isArray(raw.works) ? raw.works : []).filter(w => w.anime).map(w => ({
      animeId: w.anime!.id, label: w.anime!.russian || w.anime!.name, role: w.role ?? null,
    })),
  };
}

/** Public, paginated viewing/rating history. Descriptions are source text. */
export async function userHistory(ref: string, page = 1, limit = 100) {
  const user = await findUser(ref);
  const rows = await fetchUserHistoryRaw(user.id, page, limit);
  return { user, page, nextPage: rows.length >= limit ? page + 1 : null, items: rows.slice(0, limit) };
}

function favouriteToDto(base: string, type: ShikimoriType, f: FavouriteItem): SearchDto {
  return {
    id: f.id,
    type,
    label: pickLabel(f.russian, f.name),
    thumbUrl: thumbFor(base, f.previewPath),
    posterPath: f.posterPath,
    facts: f.russian && f.russian !== f.name ? f.name : null,
  };
}

/** The user's favourites — animes and characters, ready to import as posters. */
export async function userFavourites(ref: string): Promise<UserFavouritesResult> {
  const user = await findUser(ref);
  const base = shikimoriBase();
  const raw = await fetchUserFavouritesRaw(user.id);
  const { animes, characters } = extractFavourites(raw);
  const extra = raw as { people?: unknown; seyu?: unknown } | null;
  return {
    user,
    animes: animes.map((f) => favouriteToDto(base, "anime", f)),
    characters: characters.map((f) => favouriteToDto(base, "character", f)),
    people: peopleFavourites(extra?.people),
    seiyuu: peopleFavourites(extra?.seyu),
  };
}

export interface ImportPosterInput {
  type: ShikimoriType;
  id: number;
  posterPath: string;
  label: string | null;
  maxPoolBytes: number | null;
  /**
   * Current poster URL (GraphQL `poster.originalUrl`) when the caller already
   * resolved it in a batch. Omit and it is resolved per import.
   */
  posterUrl?: string | null;
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
};

/**
 * The poster as the site shows it: /uploads/poster/... in full resolution.
 * The legacy /system path serves an older, 225px-wide copy, so it is only a
 * fallback for when the fresh URL is unavailable.
 */
async function fetchBestPoster(input: ImportPosterInput) {
  const fresh = input.posterUrl ?? (await freshPosterUrl(input.type, input.id));
  if (fresh) {
    try {
      return await fetchPosterByUrl(fresh);
    } catch {
      // fall through to the legacy copy
    }
  }
  return fetchPoster(input.posterPath); // may throw POSTER_FETCH_FAILED
}

/** Current poster URL of one entry; null when Shikimori has none / errors. */
async function freshPosterUrl(type: ShikimoriType, id: number): Promise<string | null> {
  try {
    const urls = await fetchFreshPosterUrls(type, [id]);
    return urls.get(id) ?? null;
  } catch {
    return null;
  }
}

export async function importPoster(userId: string, input: ImportPosterInput): Promise<{ artId: string }> {
  if (!isSafeImagePath(input.posterPath)) throw new Error("BAD_IMAGE_PATH");
  const { data, contentType } = await fetchBestPoster(input);
  const ext = EXT_BY_CONTENT_TYPE[contentType] ?? ".jpg";
  const art = await createArt(userId, {
    fileName: `shikimori-${input.type}-${input.id}${ext}`,
    data,
    label: input.label,
    maxPoolBytes: input.maxPoolBytes,
  });
  return { artId: art.id };
}
