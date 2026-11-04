/**
 * Genre filters. Each one matches a title when:
 *  - any of its `genres` is in the title's genre list (from IMDb / TMDB / TVmaze), or
 *  - all of its `allGenres` are (e.g. True Crime = Documentary + Crime), or
 *  - any of its `keywords` is one of the title's TMDB keywords (e.g. "superhero").
 * Matching ignores case and punctuation.
 */
export interface GenreRules {
  genres?: string[];
  allGenres?: string[];
  keywords?: string[];
}

export interface GenrePreset {
  name: string;
  rules: GenreRules;
}

/** Suggestions shown in Settings. Nothing is added until you pick it. */
export const GENRE_PRESETS: GenrePreset[] = [
  { name: "Action", rules: { genres: ["Action", "Action & Adventure"] } },
  { name: "Adventure", rules: { genres: ["Adventure", "Action & Adventure"] } },
  { name: "Comedy", rules: { genres: ["Comedy"] } },
  { name: "Drama", rules: { genres: ["Drama"] } },
  { name: "Thriller", rules: { genres: ["Thriller"] } },
  { name: "Horror", rules: { genres: ["Horror"] } },
  { name: "Crime", rules: { genres: ["Crime"] } },
  { name: "Mystery", rules: { genres: ["Mystery"] } },
  { name: "Romance", rules: { genres: ["Romance"] } },
  { name: "Sci-Fi", rules: { genres: ["Sci-Fi", "Science Fiction", "Sci-Fi & Fantasy"] } },
  { name: "Fantasy", rules: { genres: ["Fantasy", "Sci-Fi & Fantasy"] } },
  { name: "Documentary", rules: { genres: ["Documentary"] } },
  { name: "Animation", rules: { genres: ["Animation"] } },
  { name: "Family", rules: { genres: ["Family", "Kids"] } },
  { name: "War", rules: { genres: ["War", "War & Politics"] } },
  { name: "History", rules: { genres: ["History", "Biography"] } },
  { name: "Musical", rules: { genres: ["Music", "Musical"] } },
  { name: "Sport", rules: { genres: ["Sport"] } },
  { name: "Western", rules: { genres: ["Western"] } },
  { name: "Reality", rules: { genres: ["Reality-TV", "Reality"] } },
  { name: "True Crime", rules: { allGenres: ["Documentary", "Crime"], keywords: ["true crime", "serial killer documentary", "murder investigation"] } },
  {
    name: "Superhero",
    rules: { keywords: ["superhero", "superhero team", "superheroine", "marvel cinematic universe (mcu)", "dc extended universe (dceu)", "dc universe (dcu)", "superpower", "super power"] },
  },
  { name: "Sitcom", rules: { keywords: ["sitcom", "workplace comedy", "mockumentary"] } },
  { name: "Heist", rules: { keywords: ["heist", "robbery", "bank robbery"] } },
  { name: "Space", rules: { keywords: ["space", "outer space", "space travel", "astronaut"] } },
  { name: "Zombies", rules: { keywords: ["zombie", "zombie apocalypse"] } },
  { name: "Based on a true story", rules: { keywords: ["based on true story", "based on a true story", "biography"] } },
];

/** A genre you type yourself matches a genre or keyword of the same name. */
export function rulesForCustom(name: string): GenreRules {
  const preset = GENRE_PRESETS.find((p) => norm(p.name) === norm(name));
  return preset ? preset.rules : { genres: [name], keywords: [name.toLowerCase()] };
}

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function matchesGenre(rules: GenreRules, titleGenres: string[], keywords: string[]): boolean {
  const g = new Set(titleGenres.map(norm));
  const k = new Set(keywords.map(norm));
  if (rules.genres?.some((x) => g.has(norm(x)))) return true;
  if (rules.allGenres?.length && rules.allGenres.every((x) => g.has(norm(x)))) return true;
  if (rules.keywords?.some((x) => k.has(norm(x)))) return true;
  return false;
}

export const needsKeywords = (r: GenreRules) => Boolean(r.keywords?.length);

export function describeRules(r: GenreRules): string {
  const parts = [
    r.genres?.length ? `genre ${r.genres.join(" or ")}` : null,
    r.allGenres?.length ? `genres ${r.allGenres.join(" + ")}` : null,
    r.keywords?.length ? `keyword ${r.keywords.slice(0, 4).join(", ")}${r.keywords.length > 4 ? "…" : ""}` : null,
  ].filter(Boolean);
  return parts.length ? `Matches ${parts.join(", or ")}` : "Matches nothing yet";
}
