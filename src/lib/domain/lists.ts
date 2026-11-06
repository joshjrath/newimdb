import type { MediaType } from "./types";

/** Shared by the Lists pages and the server. */
export const LIST_SORTS = [
  { key: "manual", label: "My order", reverse: "My order, reversed", icon: "☰" },
  { key: "release", label: "Oldest release first", reverse: "Newest release first", icon: "📅" },
  { key: "watched", label: "First watched first", reverse: "Last watched first", icon: "🕒" },
  { key: "rating", label: "My rating: highest", reverse: "My rating: lowest", icon: "★" },
  { key: "imdb", label: "IMDb rating: highest", reverse: "IMDb rating: lowest", icon: "IMDb" },
  { key: "title", label: "Title A → Z", reverse: "Title Z → A", icon: "Aa" },
  { key: "added", label: "Recently added", reverse: "First added", icon: "＋" },
] as const;
export type ListSort = (typeof LIST_SORTS)[number]["key"];

export interface ListItemView {
  mediaId: number;
  position: number;
  type: MediaType;
  title: string;
  year: number | null;
  /** YYYY-MM-DD: release (movies) or premiere (shows), from the title or its first episode. */
  releaseDate: string | null;
  posterUrl: string | null;
  /** IMDb's public rating, out of 10. */
  imdbRating: number | null;
  rating: number | null;
  status: string | null;
  /** 0–1: a movie is 0 or 1, a show is the share of its aired episodes watched. */
  done: number;
  watched: number;
  total: number;
  watchedOn: string | null;
}

export interface ListSummary {
  id: number;
  name: string;
  description: string;
  sort: ListSort;
  count: number;
  /** 0–100 */
  percent: number;
  finished: number;
  posters: (string | null)[];
  updatedAt: string;
}

