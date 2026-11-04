/**
 * Genre filters. Each one matches a title when:
 *  - any of its `genres` is in the title's genre list (from IMDb / TMDB / TVmaze), or
 *  - all of its `allGenres` are (e.g. True Crime = Documentary + Crime), or
 *  - any of its `keywords` appears in the title's TMDB keywords, studios or franchise
 *    (e.g. "superhero", "marvel studios"), as whole words
 *  - the title contains any of its `titles` (e.g. "Spider-Man", "Batman"), as whole words
 * Matching ignores case and punctuation.
 */
export interface GenreRules {
  genres?: string[];
  allGenres?: string[];
  keywords?: string[];
  titles?: string[];
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
  {
    name: "Marvel",
    rules: {
      keywords: ["marvel cinematic universe", "marvel comics", "based on marvel comics", "marvel studios", "marvel entertainment", "marvel television", "marvel animation", "x men", "mcu"],
      titles: [
        "Avengers", "Spider-Man", "Spider-Verse", "Iron Man", "Captain America", "Thor", "Hulk", "Black Panther", "Black Widow", "Guardians of the Galaxy", "Ant-Man",
        "Doctor Strange", "Captain Marvel", "The Marvels", "Shang-Chi", "Eternals", "Deadpool", "Wolverine", "X-Men", "Logan", "Venom", "Morbius", "Kraven", "Madame Web",
        "Fantastic Four", "Thunderbolts", "Daredevil", "Jessica Jones", "Luke Cage", "Iron Fist", "The Defenders", "The Punisher", "Loki", "WandaVision", "Hawkeye",
        "Moon Knight", "Ms. Marvel", "She-Hulk", "Secret Invasion", "Echo", "Agatha All Along", "Ironheart", "Agents of S.H.I.E.L.D.", "Agent Carter", "Runaways",
        "Cloak & Dagger", "Legion", "The Gifted", "What If...?", "X-Men '97", "Your Friendly Neighborhood Spider-Man",
      ],
    },
  },
  {
    name: "DC",
    rules: {
      keywords: ["dc comics", "based on dc comics", "dc extended universe", "dceu", "dc universe", "dcu", "dc studios", "dc films", "dc entertainment", "dc animated universe", "arrowverse", "vertigo comics"],
      titles: [
        "Batman", "Superman", "Wonder Woman", "Justice League", "Aquaman", "The Flash", "Shazam", "Black Adam", "Blue Beetle", "Suicide Squad", "Birds of Prey", "Joker",
        "Man of Steel", "Green Lantern", "Watchmen", "Constantine", "Peacemaker", "The Penguin", "Gotham", "Arrow", "Supergirl", "Titans", "Doom Patrol", "Harley Quinn",
        "Stargirl", "Legends of Tomorrow", "Black Lightning", "Batwoman", "Superman & Lois", "Smallville", "Krypto", "Creature Commandos", "Swamp Thing", "Pennyworth",
        "Lucifer", "The Sandman", "Young Justice", "Teen Titans", "Catwoman", "Steel", "Superman & Lois", "Lois & Clark",
      ],
    },
  },
  { name: "Star Wars", rules: { keywords: ["star wars", "lucasfilm"], titles: ["Star Wars", "The Mandalorian", "Andor", "The Book of Boba Fett", "Obi-Wan Kenobi", "Ahsoka", "The Acolyte", "Skeleton Crew", "The Clone Wars", "The Bad Batch", "Rogue One", "Solo: A Star Wars Story"] } },
  { name: "Pixar", rules: { keywords: ["pixar", "pixar animation studios"] } },
  { name: "Studio Ghibli", rules: { keywords: ["studio ghibli"] } },
  { name: "A24", rules: { keywords: ["a24"] } },
  { name: "Sitcom", rules: { keywords: ["sitcom", "workplace comedy", "mockumentary"] } },
  { name: "Heist", rules: { keywords: ["heist", "robbery", "bank robbery"] } },
  { name: "Space", rules: { keywords: ["space", "outer space", "space travel", "astronaut"] } },
  { name: "Zombies", rules: { keywords: ["zombie", "zombie apocalypse"] } },
  { name: "Based on a true story", rules: { keywords: ["based on true story", "based on a true story", "biography"] } },
];

/** A genre you type yourself matches a genre or keyword of the same name. */
export function rulesForCustom(name: string): GenreRules {
  const preset = GENRE_PRESETS.find((p) => norm(p.name) === norm(name));
  return preset ? preset.rules : { genres: [name], keywords: [name.toLowerCase()], titles: [name] };
}

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whole-word containment: "marvel" is in "marvel cinematic universe mcu", "thor" isn't in "authority". */
const containsWords = (hay: string, needle: string) => needle.length > 0 && ` ${hay} `.includes(` ${needle} `);

export function matchesGenre(rules: GenreRules, titleGenres: string[], keywords: string[], titles: string[] = []): boolean {
  const g = new Set(titleGenres.map(norm));
  const k = keywords.map(norm);
  const t = titles.filter(Boolean).map(norm);
  if (rules.genres?.some((x) => g.has(norm(x)))) return true;
  if (rules.allGenres?.length && rules.allGenres.every((x) => g.has(norm(x)))) return true;
  if (rules.keywords?.some((x) => k.some((kw) => containsWords(kw, norm(x))))) return true;
  if (rules.titles?.some((x) => t.some((tt) => containsWords(tt, norm(x))))) return true;
  return false;
}

export const needsKeywords = (r: GenreRules) => Boolean(r.keywords?.length);

/** What a filter typed by name used to get, before it had a preset: upgraded to the preset. */
export const isPlainCustomRules = (name: string, r: GenreRules) =>
  !r.allGenres?.length && (r.titles ?? []).every((t) => norm(t) === norm(name)) && (r.genres ?? []).length <= 1 && norm(r.genres?.[0] ?? name) === norm(name) && (r.keywords ?? []).every((k) => norm(k) === norm(name));

export function describeRules(r: GenreRules): string {
  const parts = [
    r.genres?.length ? `genre ${r.genres.join(" or ")}` : null,
    r.allGenres?.length ? `genres ${r.allGenres.join(" + ")}` : null,
    r.keywords?.length ? `keyword ${r.keywords.slice(0, 4).join(", ")}${r.keywords.length > 4 ? "…" : ""}` : null,
    r.titles?.length ? `title ${r.titles.slice(0, 4).join(", ")}${r.titles.length > 4 ? ` +${r.titles.length - 4} more` : ""}` : null,
  ].filter(Boolean);
  return parts.length ? `Matches ${parts.join(", or ")}` : "Matches nothing yet";
}
