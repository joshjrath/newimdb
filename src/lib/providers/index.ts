import type { MediaType } from "../domain/types";
import { firstSuccessful, ProviderError } from "./http";
import { anilistDetails, anilistSearch, jikanDetails, jikanEpisodes, jikanSearch } from "./anime";
import { tmdbConfigured, tmdbMovie, tmdbSearch, tmdbSeason, tmdbTv } from "./tmdb";
import { tvmazeSearch, tvmazeSeason, tvmazeShow } from "./tvmaze";
import type { ProviderDetails, ProviderName, SearchResult } from "./types";
import type { ProviderEpisode } from "../schemas";

export * from "./types";

/**
 * Routing is by media type, so an anime can never be sent to a TMDB TV endpoint
 * and TMDB/MAL ids are never mixed (regressions #3 and #4 from the old site).
 *   movie → TMDB
 *   tv    → TMDB, then TVmaze
 *   anime → Jikan (MyAnimeList), then AniList
 */
export async function searchMetadata(type: MediaType, q: string) {
  const query = q.trim().slice(0, 200);
  if (!query) return { results: [] as SearchResult[], provider: null, errors: [] as string[] };
  const attempts: { name: string; run: () => Promise<SearchResult[]> }[] =
    type === "movie"
      ? [{ name: "tmdb", run: () => tmdbSearch("movie", query) }]
      : type === "tv"
        ? [
            ...(tmdbConfigured() ? [{ name: "tmdb", run: () => tmdbSearch("tv", query) }] : []),
            { name: "tvmaze", run: () => tvmazeSearch(query) },
          ]
        : [
            { name: "jikan", run: () => jikanSearch(query) },
            { name: "anilist", run: () => anilistSearch(query) },
          ];
  const r = await firstSuccessful(attempts);
  return { results: r.value.map((x) => ({ ...x, type })), provider: r.provider, errors: r.errors };
}

export async function fetchDetails(type: MediaType, provider: ProviderName, id: string): Promise<ProviderDetails> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new ProviderError(provider, "invalid id");
  switch (`${type}:${provider}`) {
    case "movie:tmdb":
      return tmdbMovie(id);
    case "tv:tmdb":
      return tmdbTv(id);
    case "tv:tvmaze":
      return tvmazeShow(id);
    case "anime:jikan":
      return jikanDetails(id);
    case "anime:anilist":
      return anilistDetails(id);
    default:
      throw new ProviderError(provider, `can't provide ${type} details`);
  }
}

/** Episode list for one segment, using the provider reference stored on it. */
export async function fetchSegmentEpisodes(type: MediaType, provider: string, ref: string): Promise<ProviderEpisode[]> {
  if (type === "anime") {
    if (provider === "jikan") return jikanEpisodes(ref);
    throw new ProviderError(provider, "episode titles are only available from MyAnimeList (Jikan) for anime");
  }
  const [showId, season] = ref.split(":");
  if (!showId || season == null || !/^\d+$/.test(season)) throw new ProviderError(provider, "segment reference should look like showId:season");
  if (provider === "tmdb") return tmdbSeason(showId, Number(season));
  if (provider === "tvmaze") return tvmazeSeason(showId, Number(season));
  throw new ProviderError(provider, "unknown provider");
}

export function providerStatus() {
  return {
    movie: tmdbConfigured() ? ["tmdb"] : [],
    tv: [...(tmdbConfigured() ? ["tmdb"] : []), "tvmaze"],
    anime: ["jikan", "anilist"],
  };
}
