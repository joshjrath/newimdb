import { parseCsv } from "./csv";
import type { MediaType } from "./types";

/**
 * IMDb's "Your Ratings" export (IMDb → Your ratings → ⋯ → Export).
 * Every row carries IMDb's own id (tt…), which is what makes same-named titles safe:
 * "The Office" (2001) and "The Office" (2005) are different ids.
 */
export interface ImdbRating {
  imdbId: string;
  /** 0.5–5: IMDb's 1–10 halved, exactly (10 → 5, 7 → 3.5, 1 → 0.5). */
  rating: number;
  ratedOn: string | null; // YYYY-MM-DD
  title: string;
  originalTitle: string | null;
  titleType: string;
  year: number | null;
  genres: string[];
  runtimeMin: number | null;
  imdbRating: number | null;
}

export type ImdbKind = "movie" | "series" | "episode" | "skip";

const TYPE_KIND: Record<string, ImdbKind> = {
  "movie": "movie",
  "tv movie": "movie",
  "tvmovie": "movie",
  "short": "movie",
  "tv short": "movie",
  "tvshort": "movie",
  "video": "movie",
  "tv special": "movie",
  "tvspecial": "movie",
  "tv series": "series",
  "tvseries": "series",
  "tv mini series": "series",
  "tv mini-series": "series",
  "tvminiseries": "series",
  "tv episode": "episode",
  "tvepisode": "episode",
};

/** What a row is, from IMDb's Title Type. Games, podcasts and music videos are skipped. */
export function imdbKind(titleType: string): ImdbKind {
  return TYPE_KIND[titleType.trim().toLowerCase()] ?? "skip";
}

const JAPANESE = /[぀-ヿ㐀-鿿]/;
const loose = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * IMDb has no "anime" type, so this is a guess the owner confirms in the preview:
 * animated, and either a Japanese original title or an original title that differs from
 * the English one (e.g. "Shingeki no Kyojin" for "Attack on Titan").
 */
export function guessMediaType(kind: "movie" | "series", genres: string[], title: string, originalTitle: string | null): MediaType {
  const animated = genres.some((g) => g.toLowerCase() === "animation");
  const foreignTitle = Boolean(originalTitle && (JAPANESE.test(originalTitle) || loose(originalTitle) !== loose(title)));
  if (animated && foreignTitle) return "anime";
  return kind === "movie" ? "movie" : "tv";
}

export function isLikelyAnimeCandidate(genres: string[]): boolean {
  return genres.some((g) => g.toLowerCase() === "animation");
}

const num = (v: string | undefined) => {
  const n = Number((v ?? "").trim());
  return v && v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Parse the CSV. Unknown columns are ignored; rows without an id or rating are skipped and counted. */
export function parseImdbRatings(text: string): { rows: ImdbRating[]; invalid: number } {
  const table = parseCsv(text);
  if (table.length < 1) throw new Error("That file is empty.");
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iId = col("const", "tconst");
  const iRating = col("your rating");
  if (iId < 0 || iRating < 0) {
    throw new Error("This doesn't look like an IMDb ratings export (it needs the Const and Your Rating columns).");
  }
  const iDate = col("date rated", "date added", "created");
  const iTitle = col("title", "primary title");
  const iOrig = col("original title");
  const iType = col("title type");
  const iYear = col("year");
  const iGenres = col("genres");
  const iRuntime = col("runtime (mins)");
  const iImdb = col("imdb rating");
  const rows: ImdbRating[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const r of table.slice(1)) {
    const imdbId = r[iId]?.trim() ?? "";
    const ten = num(r[iRating]);
    if (!/^tt\d{5,12}$/.test(imdbId) || ten == null || ten < 1 || ten > 10 || !Number.isInteger(ten)) {
      invalid++;
      continue;
    }
    if (seen.has(imdbId)) continue; // an export never repeats an id, but be safe
    seen.add(imdbId);
    const date = (iDate >= 0 ? r[iDate] : "")?.trim() ?? "";
    const title = (iTitle >= 0 ? r[iTitle] : "")?.trim() || imdbId;
    const orig = (iOrig >= 0 ? r[iOrig] : "")?.trim() || null;
    rows.push({
      imdbId,
      rating: ten / 2,
      ratedOn: /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
      title,
      originalTitle: orig && orig !== title ? orig : null,
      titleType: (iType >= 0 ? r[iType] : "")?.trim() || "Movie",
      year: num(iYear >= 0 ? r[iYear] : undefined),
      genres: (iGenres >= 0 ? r[iGenres] ?? "" : "").split(",").map((g) => g.trim()).filter(Boolean),
      runtimeMin: num(iRuntime >= 0 ? r[iRuntime] : undefined),
      imdbRating: num(iImdb >= 0 ? r[iImdb] : undefined),
    });
  }
  return { rows, invalid };
}
