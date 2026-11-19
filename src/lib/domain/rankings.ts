import type { MediaType } from "./types";

/** The tier list's rows, top to bottom, in the classic tier-list colours. */
export const TIERS = [
  { key: "S", label: "S", color: "#ff7f7f", blurb: "All-time" },
  { key: "A", label: "A", color: "#ffbf7f", blurb: "Great" },
  { key: "B", label: "B", color: "#ffdf7f", blurb: "Good" },
  { key: "C", label: "C", color: "#ffff7f", blurb: "Fine" },
  { key: "D", label: "D", color: "#bfff7f", blurb: "Meh" },
  { key: "F", label: "F", color: "#7fbfff", blurb: "Nope" },
] as const;
export type Tier = (typeof TIERS)[number]["key"];
export const TIER_KEYS = TIERS.map((t) => t.key) as Tier[];

export interface RankItem {
  id: number;
  type: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
  rating: number | null;
  imdb: number | null;
}

export interface RankingsView {
  kind: MediaType;
  top: RankItem[];
  tiers: Record<Tier, RankItem[]>;
  /** Titles of this kind you've watched or rated that aren't in the tier list yet. */
  pool: RankItem[];
}

/** Where your rating would put a title, for "Auto-sort by my ratings". */
export function tierForRating(r: number | null): Tier | null {
  if (r == null) return null;
  if (r >= 5) return "S";
  if (r >= 4.5) return "A";
  if (r >= 4) return "B";
  if (r >= 3) return "C";
  if (r >= 2) return "D";
  return "F";
}

/** Where a ranking of your own gets its titles from. */
export type BoardSource = "list" | "genre" | "kind" | "any";

export interface BoardSummary {
  id: number;
  name: string;
  source: BoardSource;
  sourceRef: string | null;
  /** e.g. "From your list MCU", "Genre: Horror", "Anime", "Anything you add" */
  sourceLabel: string;
  mode: "top" | "tiers";
  count: number;
}

/** A ranking's contents: like RankingsView, but titles can be any kind. */
export interface BoardView extends Omit<RankingsView, "kind"> {
  board: BoardSummary;
}
