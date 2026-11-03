import { fetchJson, stripHtml, yearOf } from "./http";
import type { ProposedSegment, ProviderDetails, SearchResult } from "./types";

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
    type: show.type === "Animation" && /anime/i.test(show.genres.join(" ")) ? "anime" : "tv",
    title: show.name,
    originalTitle: null,
    year: yearOf(show.premiered),
    posterUrl: show.image?.medium ?? null,
    overview: stripHtml(show.summary),
    note: show.type ?? null,
  }));
}

export function groupTvmazeEpisodes(showId: number, episodes: Episode[]): ProposedSegment[] {
  const bySeason = new Map<number, Episode[]>();
  for (const e of episodes) {
    if (e.number == null) continue; // specials without numbers are skipped; add them manually as Specials
    const list = bySeason.get(e.season) ?? [];
    list.push(e);
    bySeason.set(e.season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      kind: "season" as const,
      label: `Season ${season}`,
      seasonNumber: season,
      courNumber: null,
      episodeCount: Math.max(...eps.map((e) => e.number!)),
      provider: "tvmaze" as const,
      providerRef: `${showId}:${season}`,
      episodes: eps.map((e) => ({
        number: e.number!,
        title: e.name || null,
        airDate: e.airdate || null,
        overview: stripHtml(e.summary),
        providerRef: String(e.id),
      })),
    }));
}

export async function tvmazeShow(id: string): Promise<ProviderDetails> {
  const show = await fetchJson<Show & { _embedded?: { episodes: Episode[] } }>(
    "tvmaze",
    `${BASE}/shows/${encodeURIComponent(id)}?embed=episodes`,
  );
  return {
    provider: "tvmaze",
    metadata: {
      title: show.name,
      year: yearOf(show.premiered),
      overview: stripHtml(show.summary),
      posterUrl: show.image?.original ?? show.image?.medium ?? null,
      runtimeMin: show.averageRuntime ?? show.runtime ?? null,
      genres: show.genres,
      imdbId: show.externals?.imdb || null,
      tvmazeId: show.id,
      metadataSource: "tvmaze",
      thirdPartyRating: show.rating?.average ?? null,
      thirdPartyRatingSource: show.rating?.average ? "TVmaze" : null,
    },
    segments: groupTvmazeEpisodes(show.id, show._embedded?.episodes ?? []),
    warnings: [],
  };
}

export async function tvmazeSeason(showId: string, season: number) {
  const eps = await fetchJson<Episode[]>("tvmaze", `${BASE}/shows/${encodeURIComponent(showId)}/episodes`);
  return groupTvmazeEpisodes(Number(showId), eps).find((s) => s.seasonNumber === season)?.episodes ?? [];
}
