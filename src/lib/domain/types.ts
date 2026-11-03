export type MediaType = "movie" | "tv" | "anime";
export const MEDIA_TYPES: MediaType[] = ["movie", "tv", "anime"];

export type Category = "movies" | "tv" | "anime";
export const CATEGORY_TO_TYPE: Record<Category, MediaType> = { movies: "movie", tv: "tv", anime: "anime" };
export const TYPE_TO_CATEGORY: Record<MediaType, Category> = { movie: "movies", tv: "tv", anime: "anime" };
export const CATEGORY_LABEL: Record<Category, string> = { movies: "Movies", tv: "TV Shows", anime: "Anime" };
export const TYPE_LABEL: Record<MediaType, string> = { movie: "Movie", tv: "TV Show", anime: "Anime" };

export type WatchStatus = "watching" | "completed" | "dropped" | "plan" | "on_hold";
export const WATCH_STATUSES: WatchStatus[] = ["watching", "completed", "dropped", "plan", "on_hold"];
export const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: "Watching",
  completed: "Completed",
  dropped: "Dropped",
  plan: "Plan to Watch",
  on_hold: "On Hold",
};

export type SegmentKind = "season" | "cour" | "ova" | "movie" | "special";
export const SEGMENT_KINDS: SegmentKind[] = ["season", "cour", "ova", "movie", "special"];
export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  season: "Season",
  cour: "Cour",
  ova: "OVA",
  movie: "Movie",
  special: "Special",
};

export type EpisodeState = "unwatched" | "watched" | "skipped";

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
  visibility: "private";
  source: "manual" | "letterboxd" | "backup";
  sourceRef: string | null;
  lastWatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  thirdPartyRating: number | null;
  thirdPartyRatingSource: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  review: ReviewView;
  tags: string[];
}

export interface MediaDetail extends MediaView {
  segments: SegmentView[];
}
