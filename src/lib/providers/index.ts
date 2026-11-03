import { EPISODE_PROVIDERS_BY_TYPE, PROVIDERS_BY_TYPE, type MediaType, type ProviderName } from "../domain/types";
import type { ProviderEpisode } from "../schemas";
import { firstSuccessful, ProviderError } from "./http";
import { anilistDetails, anilistSearch, jikanDetails, jikanEpisodes, jikanSearch } from "./anime";
import { tmdbConfigured, tmdbMovie, tmdbSearch, tmdbSeason, tmdbTv } from "./tmdb";
import { tvmazeSearch, tvmazeSeason, tvmazeShow } from "./tvmaze";
import type { DetailsOptions, ProviderDetails, SearchResult } from "./types";

export * from "./types";

/**
 * What each provider can do. Routing order per media type comes from PROVIDERS_BY_TYPE,
 * so an anime is never sent to a TMDB TV endpoint (regressions #3 and #4 of the old site).
 */
interface ProviderImpl {
  configured: () => boolean;
  search: Partial<Record<MediaType, (q: string) => Promise<SearchResult[]>>>;
  details: Partial<Record<MediaType, (id: string, opts: DetailsOptions) => Promise<ProviderDetails>>>;
  /** Episodes for one segment; `ref` is "showId:season" for TV, a MAL id for anime. */
  episodes?: (ref: string) => Promise<ProviderEpisode[]>;
}

function seasonRef(provider: string, ref: string): [string, number] {
  const [showId, season] = ref.split(":");
  if (!showId || !/^\d+$/.test(season ?? "")) throw new ProviderError(provider, "segment reference should look like showId:season");
  return [showId, Number(season)];
}

const PROVIDER_IMPL: Record<ProviderName, ProviderImpl> = {
  tmdb: {
    configured: tmdbConfigured,
    search: { movie: (q) => tmdbSearch("movie", q), tv: (q) => tmdbSearch("tv", q) },
    details: { movie: (id) => tmdbMovie(id), tv: tmdbTv },
    episodes: (ref) => tmdbSeason(...seasonRef("tmdb", ref)),
  },
  tvmaze: {
    configured: () => true,
    search: { tv: tvmazeSearch },
    details: { tv: tvmazeShow },
    episodes: (ref) => tvmazeSeason(...seasonRef("tvmaze", ref)),
  },
  jikan: {
    configured: () => true,
    search: { anime: jikanSearch },
    details: { anime: jikanDetails },
    episodes: jikanEpisodes,
  },
  anilist: {
    configured: () => true,
    search: { anime: anilistSearch },
    details: { anime: (id) => anilistDetails(id) },
  },
};

/** Providers usable right now for a media type, in fallback order. */
export function availableProviders(type: MediaType): ProviderName[] {
  return PROVIDERS_BY_TYPE[type].filter((p) => PROVIDER_IMPL[p].configured());
}

export async function searchMetadata(type: MediaType, q: string) {
  const query = q.trim().slice(0, 200);
  if (!query) return { results: [] as SearchResult[], provider: null, errors: [] as string[] };
  const r = await firstSuccessful(availableProviders(type).map((name) => ({ name, run: () => PROVIDER_IMPL[name].search[type]!(query) })));
  return { results: r.value.map((x) => ({ ...x, type })), provider: r.provider, errors: r.errors };
}

export async function fetchDetails(type: MediaType, provider: ProviderName, id: string, opts: DetailsOptions = {}): Promise<ProviderDetails> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new ProviderError(provider, "invalid id");
  const details = PROVIDER_IMPL[provider]?.details[type];
  if (!details) throw new ProviderError(provider, `can't provide ${type} details`);
  return details(id, opts);
}

/** Episode list for one segment, using the provider reference stored on it. */
export async function fetchSegmentEpisodes(type: MediaType, provider: string, ref: string): Promise<ProviderEpisode[]> {
  const p = provider as ProviderName;
  if (!EPISODE_PROVIDERS_BY_TYPE[type].includes(p)) throw new ProviderError(provider, `can't provide episode titles for ${type}`);
  return PROVIDER_IMPL[p].episodes!(ref);
}

export function providerStatus(): Record<MediaType, ProviderName[]> {
  return { movie: availableProviders("movie"), tv: availableProviders("tv"), anime: availableProviders("anime") };
}
