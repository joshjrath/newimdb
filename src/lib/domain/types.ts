/**
 * Single source of truth for every enum in the app. Zod schemas, SQL CHECKs,
 * select options and labels are all derived from these tuples.
 */

export const MEDIA_TYPES = ["movie", "tv", "anime"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export type Category = "movies" | "tv" | "anime";
export const CATEGORY_TO_TYPE: Record<Category, MediaType> = { movies: "movie", tv: "tv", anime: "anime" };
export const TYPE_TO_CATEGORY: Record<MediaType, Category> = { movie: "movies", tv: "tv", anime: "anime" };
export const CATEGORY_LABEL: Record<Category, string> = { movies: "Movies", tv: "TV Shows", anime: "Anime" };
export const TYPE_LABEL: Record<MediaType, string> = { movie: "Movie", tv: "TV Show", anime: "Anime" };
export const typePluralLabel = (t: MediaType) => CATEGORY_LABEL[TYPE_TO_CATEGORY[t]];

export const WATCH_STATUSES = ["watching", "completed", "dropped", "plan", "on_hold"] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];
export const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: "Watching",
  completed: "Completed",
  dropped: "Dropped",
  plan: "Plan to Watch",
  on_hold: "On Hold",
};
/** Default status for a newly added title. */
export const defaultStatus = (t: MediaType): WatchStatus => (t === "movie" ? "completed" : "watching");

export const SEGMENT_KINDS = ["season", "cour", "ova", "movie", "special"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];
export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  season: "Season",
  cour: "Cour",
  ova: "OVA",
  movie: "Movie",
  special: "Special",
};

export const EPISODE_STATES = ["unwatched", "watched", "skipped"] as const;
export type EpisodeState = (typeof EPISODE_STATES)[number];

export const REVIEW_SOURCES = ["manual", "letterboxd", "backup", "imdb"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const PROVIDERS = ["tmdb", "tvmaze", "jikan", "anilist"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** Which media field holds each provider's id. */
export const PROVIDER_ID_FIELD = {
  tmdb: "tmdbId",
  tvmaze: "tvmazeId",
  jikan: "malId",
  anilist: "anilistId",
} as const satisfies Record<ProviderName, keyof MediaView>;

/**
 * Provider routing by media type, in fallback order. An anime is never sent to a
 * TMDB TV endpoint and TMDB/MAL ids are never mixed.
 */
export const PROVIDERS_BY_TYPE: Record<MediaType, readonly ProviderName[]> = {
  movie: ["tmdb"],
  tv: ["tmdb", "tvmaze"],
  anime: ["jikan", "anilist"],
};
/** Providers that can supply episode titles for a single segment. */
export const EPISODE_PROVIDERS_BY_TYPE: Record<MediaType, readonly ProviderName[]> = {
  movie: [],
  tv: ["tmdb", "tvmaze"],
  anime: ["jikan"],
};

/** The one place default segment labels are made ("Season 2", "Season 1 · Cour 2", "Movie 1", "OVA 2", "Specials"). */
export function defaultSegmentLabel(kind: SegmentKind, o: { season?: number | null; cour?: number | null; ordinal?: number } = {}): string {
  const n = o.ordinal ?? 1;
  switch (kind) {
    case "season":
      return o.season === 0 ? "Specials" : `Season ${o.season ?? n}`;
    case "cour":
      return `Season ${o.season ?? 1} · Cour ${o.cour ?? n}`;
    case "movie":
      return `Movie ${n}`;
    case "ova":
      return n > 1 ? `OVA ${n}` : "OVA";
    case "special":
      return n > 1 ? `Special ${n}` : "Specials";
  }
}

export interface EpisodeView {
  id: number;
  segmentId: number;
  number: number;
  title: string | null;
  airDate: string | null;
  overview: string | null;
  state: EpisodeState;
  rating: number | null;
  filler: boolean;
  watchedAt: string | null;
}

export interface SegmentView {
  id: number;
  kind: SegmentKind;
  label: string;
  seasonNumber: number | null;
  courNumber: number | null;
  position: number;
  provider: string | null;
  providerRef: string | null;
  episodes: EpisodeView[];
}

export interface ReviewView {
  rating: number | null;
  ratingLabel: string | null;
  body: string;
  watchedOn: string | null;
  spoiler: boolean;
  status: WatchStatus | null;
  featured: boolean;
  /** Movies: in a theater or streaming at home. */
  watchedIn: "theater" | "streaming" | null;
  visibility: "private";
  source: ReviewSource;
  sourceRef: string | null;
  lastWatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Someone you watched with. */
export interface PersonRef {
  id: number;
  name: string;
}

export interface MediaView {
  id: number;
  uid: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtimeMin: number | null;
  genres: string[];
  tmdbId: number | null;
  imdbId: string | null;
  malId: number | null;
  tvmazeId: number | null;
  anilistId: number | null;
  letterboxdUrl: string | null;
  metadataSource: string | null;
  lockedFields: string[];
  /** YYYY-MM-DD when known (movies: release; shows: premiere). */
  releaseDate?: string | null;
  thirdPartyRating: number | null;
  thirdPartyRatingSource: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  review: ReviewView;
  tags: string[];
  /** Who you watched it with: nobody, one person or several. */
  people: PersonRef[];
  /** IMDb's public rating (out of 10) and vote count, when the title is on IMDb. Not your rating. */
  imdb: { rating: number; votes: number | null } | null;
  /** Your genre filters from Settings that this title is in (auto-tagged or picked by you). */
  genreFilters: GenreRef[];
}

/** One of your genre filters on a title. "auto" came from the rules; "manual" you picked yourself. */
export interface GenreRef {
  id: number;
  name: string;
  state: "auto" | "manual";
}

export interface MediaDetail extends MediaView {
  segments: SegmentView[];
}
