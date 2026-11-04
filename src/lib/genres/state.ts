import { listGenres } from "../repo/genres";
import { currentKeywordJob, keywordsPending } from "./keywords";
import { tmdbConfigured } from "../providers/tmdb";

/** What Settings → Genres shows: your filters with counts, and the keyword fetch's progress. */
export const genreState = () => ({ genres: listGenres(), keywords: { job: currentKeywordJob(), pending: keywordsPending(), tmdb: tmdbConfigured() } });
export type GenreState = ReturnType<typeof genreState>;
