import { norm } from "./genres";
import type { MediaType } from "./types";

/**
 * How recommendations are scored, from everything in your library:
 *  - Seeds: titles you rated above your own average (and shows you're watching). Each
 *    one's "if you liked this" list counts, weighted by how much you liked it and how
 *    recently you watched. Titles you rated low count against what they recommend.
 *  - Taste: genres you rate above your average lift a pick; ones you rate below lower it.
 *  - Quality: a small nudge from the wider audience score, so obscure flops don't win.
 *  - Agreement: a pick recommended by several of your favourites ranks higher.
 */

export interface LibraryTitle {
  id: number;
  type: MediaType;
  title: string;
  year: number | null;
  rating: number | null;
  status: string | null;
  genres: string[];
  lastWatchedAt: string | null;
}

/** TMDB and IMDb name some genres differently; compare them on shared keys. */
export function genreKeys(name: string): string[] {
  const n = norm(name);
  const map: Record<string, string[]> = {
    "science fiction": ["sci fi"],
    "sci fi fantasy": ["sci fi", "fantasy"],
    "action adventure": ["action", "adventure"],
    "war politics": ["war"],
    kids: ["family"],
    "reality tv": ["reality"],
    "tv movie": [],
    music: ["musical"],
    biography: ["history"],
    "slice of life": ["drama"],
    mecha: ["sci fi"],
    psychological: ["thriller"],
    supernatural: ["fantasy"],
    ecchi: [],
    hentai: [],
  };
  return map[n] ?? [n];
}

export interface Taste {
  mean: number;
  /** Genre key → how much more (or less) you like it than your average, in stars. */
  genre: Map<string, number>;
}

export function tasteProfile(library: LibraryTitle[]): Taste {
  const rated = library.filter((t) => t.rating != null);
  const mean = rated.length ? rated.reduce((a, t) => a + t.rating!, 0) / rated.length : 3.5;
  const sums = new Map<string, { s: number; n: number }>();
  for (const t of rated)
    for (const g of new Set(t.genres.flatMap(genreKeys))) {
      const cur = sums.get(g) ?? { s: 0, n: 0 };
      sums.set(g, { s: cur.s + (t.rating! - mean), n: cur.n + 1 });
    }
  // Shrink towards zero so one 5-star western doesn't make every western a must-see.
  return { mean, genre: new Map([...sums].map(([g, { s, n }]) => [g, s / (n + 3)])) };
}

export function genreAffinity(taste: Taste, genres: string[]): number {
  const keys = [...new Set(genres.flatMap(genreKeys))];
  if (!keys.length) return 0;
  const vals = keys.map((k) => taste.genre.get(k) ?? 0);
  return vals.reduce((a, b) => a + b, 0) / Math.sqrt(keys.length);
}

export interface Seed extends LibraryTitle {
  weight: number;
}

/** Your favourites (positive weight) and the ones you didn't like (negative), per category. */
export function pickSeeds(library: LibraryTitle[], taste: Taste, perType = 12, now = Date.now()): Seed[] {
  const out: Seed[] = [];
  for (const type of ["movie", "tv", "anime"] as MediaType[]) {
    const mine = library.filter((t) => t.type === type);
    const recency = (t: LibraryTitle) => (t.lastWatchedAt && now - Date.parse(t.lastWatchedAt) < 365 * 86_400_000 ? 1.2 : 1);
    const liked = mine
      .filter((t) => (t.rating != null && t.rating >= Math.max(3.5, taste.mean)) || (t.rating == null && t.status === "watching"))
      .map((t) => ({ ...t, weight: Math.min(3, Math.max(0.6, 1 + ((t.rating ?? taste.mean + 0.3) - taste.mean) * 1.5)) * recency(t) }))
      .sort((a, b) => b.weight - a.weight || (b.lastWatchedAt ?? "").localeCompare(a.lastWatchedAt ?? ""))
      .slice(0, perType);
    const disliked = mine
      .filter((t) => t.rating != null && t.rating <= Math.min(2, taste.mean - 1))
      .map((t) => ({ ...t, weight: -0.6 * (1 + (taste.mean - t.rating!) / 2) }))
      .slice(0, Math.ceil(perType / 3));
    out.push(...liked, ...disliked);
  }
  return out;
}

export interface Candidate {
  key: string;
  type: MediaType;
  title: string;
  year: number | null;
  genres: string[];
  /** Audience score out of 10, and how many people rated it. */
  audience: { score: number; votes: number } | null;
  /** seed id → contribution */
  from: Map<number, number>;
}

/** Add one seed's recommendation list (best first) to the pool. */
export function addSeedResults(pool: Map<string, Candidate>, seed: Seed, results: Omit<Candidate, "from">[]) {
  results.slice(0, 20).forEach((r, rank) => {
    const c = pool.get(r.key) ?? { ...r, from: new Map() };
    c.from.set(seed.id, (c.from.get(seed.id) ?? 0) + seed.weight * (1 - rank / 30));
    if (!c.audience && r.audience) c.audience = r.audience;
    if (!c.genres.length) c.genres = r.genres;
    pool.set(r.key, c);
  });
}

export function scoreCandidate(c: Candidate, taste: Taste): number {
  const contributions = [...c.from.values()];
  const positive = contributions.filter((x) => x > 0).sort((a, b) => b - a);
  const negative = contributions.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  // Agreement: each extra favourite pointing here adds, with diminishing returns.
  const seedScore = positive.reduce((a, x, i) => a + x / (1 + i * 0.5), 0) + negative;
  const liking = genreAffinity(taste, c.genres) * 1.2;
  const quality = c.audience && c.audience.votes >= 50 ? (c.audience.score - 6.8) * 0.25 : -0.15;
  return seedScore + liking + quality;
}

/** "Because you loved X and Y": the seeds that pushed it up most. */
export function becauseOf(c: Candidate, seeds: Map<number, Seed>, n = 2): string[] {
  return [...c.from.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => seeds.get(id)?.title)
    .filter((t): t is string => Boolean(t));
}

/** A friendly 0–99 match from a score, relative to the best pick. */
export function matchPercent(score: number, best: number): number {
  if (best <= 0) return 70;
  return Math.max(55, Math.min(99, Math.round(62 + 37 * Math.max(0, score) / best)));
}
