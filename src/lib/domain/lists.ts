import type { MediaType } from "./types";

/** Shared by the Lists pages and the server. */
export const LIST_SORTS = [
  { key: "manual", label: "My order" },
  { key: "release", label: "Release order" },
  { key: "watched", label: "When I watched" },
  { key: "rating", label: "My rating" },
  { key: "title", label: "Title" },
  { key: "added", label: "Recently added" },
] as const;
export type ListSort = (typeof LIST_SORTS)[number]["key"];

export interface ListItemView {
  mediaId: number;
  position: number;
  type: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
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

