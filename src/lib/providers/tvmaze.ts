import { defaultSegmentLabel } from "../domain/types";
import { htmlToTextOrNull } from "../domain/text";
import { fetchJson, yearOf } from "./http";
import type { DetailsOptions, ProposedSegment, ProviderDetails, SearchResult } from "./types";

const BASE = "https://api.tvmaze.com";

interface Show {
  id: number;
  name: string;
  premiered: string | null;
  summary: string | null;
  image: { medium?: string; original?: string } | null;
  genres: string[];
  averageRuntime: number | null;
  runtime: number | null;
  rating: { average: number | null };
  externals: { imdb: string | null; thetvdb: number | null };
  type?: string;
}

interface Episode {
  id: number;
  season: number;
  number: number | null;
  name: string;
  airdate: string;
  summary: string | null;
}

export async function tvmazeSearch(q: string): Promise<SearchResult[]> {
  const r = await fetchJson<{ show: Show }[]>("tvmaze", `${BASE}/search/shows?q=${encodeURIComponent(q)}`);
  return r.slice(0, 12).map(({ show }) => ({
    provider: "tvmaze",
    providerId: String(show.id),
    type: "tv",
    title: show.name,
    originalTitle: null,
    year: yearOf(show.premiered),
    posterUrl: show.image?.medium ?? null,
    overview: htmlToTextOrNull(show.summary),
    note: show.type ?? null,
  }));
}

const toEpisode = (e: Episode & { number: number }) => ({
  number: e.number,
  title: e.name || null,
  airDate: e.airdate || null,
  overview: htmlToTextOrNull(e.summary),
  providerRef: String(e.id),
});

/** One segment per season. Specials without a number are skipped; add them by hand as Specials. */
export function groupTvmazeEpisodes(showId: number, episodes: Episode[]): ProposedSegment[] {
  const bySeason = new Map<number, (Episode & { number: number })[]>();
  for (const e of episodes) {
    if (e.number == null) continue;
    bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e as Episode & { number: number }]);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      kind: "season" as const,
      label: defaultSegmentLabel("season", { season }),
      seasonNumber: season,
      courNumber: null,
      episodeCount: Math.max(...eps.map((e) => e.number)),
      provider: "tvmaze" as const,
      providerRef: `${showId}:${season}`,
      episodes: eps.map(toEpisode),
    }));
}

export async function tvmazeShow(id: string, opts: DetailsOptions = {}): Promise<ProviderDetails> {
  const withEpisodes = opts.episodes !== false;
  const show = await fetchJson<Show & { _embedded?: { episodes: Episode[] } }>(
    "tvmaze",
    `${BASE}/shows/${encodeURIComponent(id)}${withEpisodes ? "?embed=episodes" : ""}`,
  );
  return {
    provider: "tvmaze",
    metadata: {
      title: show.name,
      year: yearOf(show.premiered),
      overview: htmlToTextOrNull(show.summary),
      posterUrl: show.image?.original ?? show.image?.medium ?? null,
      runtimeMin: show.averageRuntime ?? show.runtime ?? null,
      genres: show.genres,
      imdbId: show.externals?.imdb || null,
      tvmazeId: show.id,
      metadataSource: "tvmaze",
      thirdPartyRating: show.rating?.average ?? null,
      thirdPartyRatingSource: show.rating?.average ? "TVmaze" : null,
    },
    segments: withEpisodes ? groupTvmazeEpisodes(show.id, show._embedded?.episodes ?? []) : [],
    warnings: [],
  };
}

export async function tvmazeSeason(showId: string, season: number) {
  const seasons = await fetchJson<{ id: number; number: number }[]>("tvmaze", `${BASE}/shows/${encodeURIComponent(showId)}/seasons`);
  const s = seasons.find((x) => x.number === season);
  if (!s) return [];
  const eps = await fetchJson<Episode[]>("tvmaze", `${BASE}/seasons/${s.id}/episodes`);
  return eps.filter((e): e is Episode & { number: number } => e.number != null).map(toEpisode);
}
