import { fetchJson, ProviderError, yearOf } from "./http";
import { defaultSegmentLabel } from "../domain/types";
import type { DetailsOptions, ProposedSegment, ProviderDetails, SearchResult } from "./types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";

export function tmdbConfigured() {
  return Boolean(process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY);
}

function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!tmdbConfigured()) throw new ProviderError("tmdb", "not configured (set TMDB_READ_TOKEN or TMDB_API_KEY)");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (process.env.TMDB_READ_TOKEN) headers.Authorization = `Bearer ${process.env.TMDB_READ_TOKEN}`;
  else url.searchParams.set("api_key", process.env.TMDB_API_KEY!);
  return fetchJson<T>("tmdb", url.toString(), { headers });
}

const img = (p: string | null | undefined, size = "w500") => (p ? `${IMG}${size}${p}` : null);

interface TmdbSearchItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
}

export async function tmdbSearch(kind: "movie" | "tv", q: string): Promise<SearchResult[]> {
  const r = await get<{ results: TmdbSearchItem[] }>(`/search/${kind}`, { query: q, include_adult: "false" });
  return r.results.slice(0, 12).map((x) => ({
    provider: "tmdb",
    providerId: String(x.id),
    type: kind === "movie" ? "movie" : "tv",
    title: (x.title ?? x.name ?? "").trim(),
    originalTitle: x.original_title ?? x.original_name ?? null,
    year: yearOf(x.release_date ?? x.first_air_date),
    posterUrl: img(x.poster_path, "w342"),
    overview: x.overview || null,
    note: null,
  }));
}

export async function tmdbMovie(id: string): Promise<ProviderDetails> {
  const m = await get<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    runtime: number | null;
    genres: { name: string }[];
    imdb_id: string | null;
    vote_average: number;
  }>(`/movie/${encodeURIComponent(id)}`);
  return {
    provider: "tmdb",
    metadata: {
      title: m.title,
      originalTitle: m.original_title !== m.title ? m.original_title : null,
      year: yearOf(m.release_date),
      releaseDate: m.release_date && /^\d{4}-\d{2}-\d{2}$/.test(m.release_date) ? m.release_date : null,
      overview: m.overview || null,
      posterUrl: img(m.poster_path),
      backdropUrl: img(m.backdrop_path, "w1280"),
      runtimeMin: m.runtime ?? null,
      genres: m.genres.map((g) => g.name),
      tmdbId: m.id,
      imdbId: m.imdb_id || null,
      metadataSource: "tmdb",
      thirdPartyRating: m.vote_average || null,
      thirdPartyRatingSource: m.vote_average ? "TMDB" : null,
    },
    segments: [],
    warnings: [],
  };
}

export async function tmdbSeason(tvId: string, season: number) {
  const s = await get<{ episodes: { id: number; episode_number: number; name: string; air_date: string | null; overview: string }[] }>(
    `/tv/${encodeURIComponent(tvId)}/season/${season}`,
  );
  return s.episodes
    .filter((e) => e.episode_number > 0)
    .map((e) => ({
      number: e.episode_number,
      title: e.name || null,
      airDate: e.air_date || null,
      overview: e.overview || null,
      providerRef: String(e.id),
    }));
}

export async function tmdbTv(id: string, opts: DetailsOptions = {}): Promise<ProviderDetails> {
  const t = await get<{
    id: number;
    name: string;
    original_name: string;
    first_air_date: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    episode_run_time: number[];
    genres: { name: string }[];
    vote_average: number;
    seasons: { season_number: number; episode_count: number; name: string }[];
    external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  }>(`/tv/${encodeURIComponent(id)}`, { append_to_response: "external_ids" });
  const warnings: string[] = [];
  // Season 0 (specials) is left out; add specials by hand where they fit in the watch order.
  const seasons = t.seasons.filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number);
  // Episode titles season by season (small concurrency). Failures degrade to counts only.
  const results = new Map<number, Awaited<ReturnType<typeof tmdbSeason>>>();
  if (opts.episodes !== false) {
    const queue = [...seasons];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          try {
            results.set(s.season_number, await tmdbSeason(id, s.season_number));
          } catch (e) {
            warnings.push(`Season ${s.season_number} episode titles unavailable (${(e as Error).message}).`);
          }
        }
      }),
    );
  }
  const segments: ProposedSegment[] = seasons.map((s) => {
    const eps = results.get(s.season_number);
    return {
      kind: "season" as const,
      label: defaultSegmentLabel("season", { season: s.season_number }),
      seasonNumber: s.season_number,
      courNumber: null,
      episodeCount: Math.max(s.episode_count, eps?.length ?? 0),
      provider: "tmdb" as const,
      providerRef: `${t.id}:${s.season_number}`,
      episodes: eps,
    };
  });
  return {
    provider: "tmdb",
    metadata: {
      title: t.name,
      originalTitle: t.original_name !== t.name ? t.original_name : null,
      year: yearOf(t.first_air_date),
      releaseDate: t.first_air_date && /^\d{4}-\d{2}-\d{2}$/.test(t.first_air_date) ? t.first_air_date : null,
      overview: t.overview || null,
      posterUrl: img(t.poster_path),
      backdropUrl: img(t.backdrop_path, "w1280"),
      runtimeMin: t.episode_run_time?.[0] ?? null,
      genres: t.genres.map((g) => g.name),
      tmdbId: t.id,
      imdbId: t.external_ids?.imdb_id || null,
      metadataSource: "tmdb",
      thirdPartyRating: t.vote_average || null,
      thirdPartyRatingSource: t.vote_average ? "TMDB" : null,
    },
    segments,
    warnings,
  };
}

export interface ArtworkMatch {
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  tmdbId?: number;
  tvmazeId?: number;
  /** Whether TMDB knows it as a movie or a show. */
  kind?: "movie" | "tv";
}

/** Find a title on TMDB by its IMDb id. Prefers the result kind that matches, falls back to the other. */
export async function tmdbFindByImdb(imdbId: string, prefer: "movie" | "tv"): Promise<ArtworkMatch | null> {
  const r = await get<{
    movie_results: { id: number; poster_path: string | null; backdrop_path: string | null; overview?: string }[];
    tv_results: { id: number; poster_path: string | null; backdrop_path: string | null; overview?: string }[];
  }>(`/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" });
  const movies = r.movie_results.map((x) => ({ ...x, kind: "movie" as const }));
  const tv = r.tv_results.map((x) => ({ ...x, kind: "tv" as const }));
  const hit = (prefer === "movie" ? [...movies, ...tv] : [...tv, ...movies])[0];
  if (!hit) return null;
  return { posterUrl: img(hit.poster_path), backdropUrl: img(hit.backdrop_path, "w1280"), overview: hit.overview || null, tmdbId: hit.id, kind: hit.kind };
}

/** A title's TMDB genres and keywords (one request). Keywords power filters like Superhero. */
export async function tmdbGenresAndKeywords(kind: "movie" | "tv", id: number): Promise<{ genres: string[]; keywords: string[]; imdbId: string | null; language: string | null; releaseDate: string | null; episodes: number | null }> {
  const r = await get<{
    genres?: { name: string }[];
    keywords?: { keywords?: { name: string }[]; results?: { name: string }[] };
    production_companies?: { name: string }[];
    networks?: { name: string }[];
    belongs_to_collection?: { name: string } | null;
    imdb_id?: string | null;
    external_ids?: { imdb_id?: string | null };
    original_language?: string;
    release_date?: string;
    first_air_date?: string;
    number_of_episodes?: number;
  }>(`/${kind}/${id}`, { append_to_response: "keywords,external_ids" });
  // Studios and franchise count as keywords too, so filters like Marvel, DC or Pixar can match them.
  const extra = [...(r.production_companies ?? []), ...(r.networks ?? []), ...(r.belongs_to_collection ? [r.belongs_to_collection] : [])].map((x) => x.name.toLowerCase());
  return {
    genres: (r.genres ?? []).map((g) => g.name),
    keywords: [...new Set([...(r.keywords?.keywords ?? r.keywords?.results ?? []).map((k) => k.name.toLowerCase()), ...extra])],
    imdbId: r.imdb_id || r.external_ids?.imdb_id || null,
    language: r.original_language ?? null,
    releaseDate: [r.release_date, r.first_air_date].find((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? null,
    episodes: kind === "movie" ? 1 : (r.number_of_episodes ?? null),
  };
}

/** A title's original language, countries and genres on TMDB. */
export async function tmdbOrigin(kind: "movie" | "tv", id: number): Promise<{ language: string | null; countries: string[]; genres: string[] }> {
  const r = await get<{ original_language?: string; origin_country?: string[]; production_countries?: { iso_3166_1: string }[]; genres?: { name: string }[] }>(`/${kind}/${id}`);
  return {
    language: r.original_language ?? null,
    countries: r.origin_country ?? (r.production_countries ?? []).map((c) => c.iso_3166_1),
    genres: (r.genres ?? []).map((g) => g.name),
  };
}

export interface TmdbRec {
  id: number;
  kind: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  genreIds: number[];
  language: string | null;
  voteAverage: number;
  voteCount: number;
  popularity: number;
}

/** TMDB's "if you liked this" list for one title. */
export async function tmdbRecommendations(kind: "movie" | "tv", id: number): Promise<TmdbRec[]> {
  type R = TmdbSearchItem & { genre_ids?: number[]; original_language?: string; vote_average?: number; vote_count?: number; popularity?: number; backdrop_path?: string | null; adult?: boolean };
  const r = await get<{ results: R[] }>(`/${kind}/${id}/recommendations`);
  return r.results
    .filter((x) => !x.adult)
    .map((x) => ({
      id: x.id,
      kind,
      title: x.title ?? x.name ?? "Untitled",
      originalTitle: x.original_title ?? x.original_name ?? null,
      year: yearOf(x.release_date ?? x.first_air_date),
      posterUrl: img(x.poster_path),
      backdropUrl: img(x.backdrop_path, "w1280"),
      overview: x.overview || null,
      genreIds: x.genre_ids ?? [],
      language: x.original_language ?? null,
      voteAverage: x.vote_average ?? 0,
      voteCount: x.vote_count ?? 0,
      popularity: x.popularity ?? 0,
    }));
}

/** TMDB genre ids to names, for both movies and TV. */
export async function tmdbGenreNames(): Promise<Map<number, string>> {
  const [m, t] = await Promise.all([get<{ genres: { id: number; name: string }[] }>("/genre/movie/list"), get<{ genres: { id: number; name: string }[] }>("/genre/tv/list")]);
  return new Map([...m.genres, ...t.genres].map((g) => [g.id, g.name]));
}

export interface WatchOption {
  name: string;
  logoUrl: string | null;
  /** Where clicking the icon goes. */
  url: string | null;
  kind: "stream" | "free" | "ads" | "rent" | "buy";
  color?: string | null;
}

/** Strip TMDB's per-plan variants so "Netflix" and "Netflix basic with Ads" show as one icon. */
export function cleanProviderName(n: string): string {
  return n
    .replace(/\s+(basic|standard)?\s*with ads$/i, "")
    .replace(/\s+(amazon|apple tv|roku premium) channel$/i, "")
    .replace(/^amazon prime video$/i, "Prime Video")
    .replace(/^apple tv plus$/i, "Apple TV+")
    .replace(/^disney plus$/i, "Disney+")
    .replace(/^paramount plus.*$/i, "Paramount+")
    .replace(/^max amazon channel$/i, "Max")
    .trim();
}

/** Where to watch in a region (subscription, free and with-ads first; rent/buy only if nothing else). */
export async function tmdbWatchProviders(kind: "movie" | "tv", id: number, region: string): Promise<WatchOption[]> {
  type P = { provider_name: string; logo_path: string | null; display_priority?: number };
  const r = await get<{ results: Record<string, { link?: string; flatrate?: P[]; free?: P[]; ads?: P[]; rent?: P[]; buy?: P[] }> }>(`/${kind}/${id}/watch/providers`);
  const at = r.results?.[region.toUpperCase()];
  if (!at) return [];
  const out: WatchOption[] = [];
  const seen = new Set<string>();
  const add = (list: P[] | undefined, k: WatchOption["kind"]) => {
    for (const p of [...(list ?? [])].sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))) {
      const name = cleanProviderName(p.provider_name);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, logoUrl: img(p.logo_path, "w92"), url: at.link ?? null, kind: k });
    }
  };
  add(at.flatrate, "stream");
  add(at.free, "free");
  add(at.ads, "ads");
  if (!out.length) {
    add(at.rent, "rent");
    add(at.buy, "buy");
  }
  return out.slice(0, 8);
}
