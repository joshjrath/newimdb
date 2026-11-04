/**
 * Telling anime from other animation. IMDb lists Bleach as just "Bleach" with genre
 * Animation, the same as The Legend of Korra, so the title alone can't decide. These
 * signals come from TVmaze (no key), TMDB (when its key is set) and AniList.
 */
export interface AnimeEvidence {
  tvmaze?: { language: string | null; genres: string[]; type: string | null } | null;
  tmdb?: { language: string | null; countries: string[]; genres: string[] } | null;
  /** AniList has an anime with the same title and year. */
  anilist?: boolean;
}

const has = (list: string[], g: string) => list.some((x) => x.toLowerCase() === g.toLowerCase());
/** Chinese and Korean animation: left where it is rather than guessed either way. */
const UNSURE_LANGUAGES = new Set(["zh", "ko", "cn", "chinese", "korean", "mandarin", "cantonese"]);

/** "anime", "other" (definitely not anime), or null when the evidence doesn't say. */
export function decideAnime(e: AnimeEvidence): "anime" | "other" | null {
  const tv = e.tvmaze;
  if (tv) {
    if (has(tv.genres, "Anime")) return "anime";
    if (tv.language === "Japanese" && (tv.type === "Animation" || has(tv.genres, "Anime"))) return "anime";
  }
  const tm = e.tmdb;
  if (tm && has(tm.genres, "Animation")) {
    if (tm.language === "ja" || (tm.countries.includes("JP") && !tm.language)) return "anime";
  }
  if (e.anilist) return "anime";
  // Definitely something else: animation in a known, non-Japanese language with no anime tag.
  if (tv?.language && tv.type === "Animation" && !UNSURE_LANGUAGES.has(tv.language.toLowerCase()) && tv.language !== "Japanese") return "other";
  if (tm?.language && has(tm.genres, "Animation") && tm.language !== "ja" && !UNSURE_LANGUAGES.has(tm.language)) return "other";
  return null;
}

const loose = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Whether an AniList result is the same title (same name, year within one). */
export function sameAnime(title: string, year: number | null, candidate: { titles: string[]; year: number | null }): boolean {
  const t = loose(title);
  if (!t || !candidate.titles.some((x) => loose(x) === t)) return false;
  return year == null || candidate.year == null || Math.abs(candidate.year - year) <= 1;
}
