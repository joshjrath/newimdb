import { norm } from "./genres";
import type { MediaType } from "./types";

/**
 * How recommendations are scored, from every rating you've given:
 *  - Taste model: every genre, keyword, studio, franchise and decade gets a weight learned
 *    from ALL your ratings (how far above or below your own average you rate titles that
 *    have it, shrunk so a single title can't dominate). A pick is scored on its features.
 *  - Neighbours: your favourites (and, against, your lowest-rated titles) each vote for
 *    the titles similar to them, weighted by how much you liked them and how recently.
 *  - Agreement: a pick needs at least two of your favourites pointing at it; more is better.
 *  - Quality: a small nudge from the wider audience score, so obscure flops don't win.
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
export function pickSeeds(library: LibraryTitle[], taste: Taste, perType = 40, now = Date.now()): Seed[] {
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
      .slice(0, Math.ceil(perType / 4));
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

/* ---------------- the taste model: every rating, every feature ---------------- */

/** What a title is made of, for the model: genres, keywords/studios/franchise, decade, kind. */
export function featuresOf(t: { type: MediaType; year: number | null; genres: string[]; keywords?: string[] }): string[] {
  const f = new Set<string>();
  for (const g of t.genres) for (const k of genreKeys(g)) f.add(`g:${k}`);
  for (const k of (t.keywords ?? []).slice(0, 30)) f.add(`k:${norm(k)}`);
  if (t.year) f.add(`d:${Math.floor(t.year / 10) * 10}`);
  f.add(`t:${t.type}`);
  return [...f];
}

export interface TasteModel {
  mean: number;
  weights: Map<string, number>;
  rated: number;
}

/**
 * Learn a weight per feature from all your ratings: the average of (your rating − your
 * mean) over titles with it, shrunk towards zero by 4 "neutral" titles so rare features
 * need real evidence.
 */
export function learnTaste(rated: { rating: number; features: string[] }[]): TasteModel {
  const mean = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : 3.5;
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of rated)
    for (const f of r.features) {
      const c = acc.get(f) ?? { s: 0, n: 0 };
      acc.set(f, { s: c.s + (r.rating - mean), n: c.n + 1 });
    }
  return { mean, rated: rated.length, weights: new Map([...acc].map(([f, { s, n }]) => [f, s / (n + 4)])) };
}

/** How much the model expects you to like something, in stars above/below your average. */
export function predictTaste(model: TasteModel, features: string[]): number {
  const known = features.map((f) => model.weights.get(f)).filter((w): w is number => w != null);
  if (!known.length) return 0;
  return known.reduce((a, b) => a + b, 0) / Math.sqrt(known.length);
}

/** Favourites that point at a pick (positive votes). */
export const supporters = (c: Candidate) => [...c.from.values()].filter((v) => v > 0).length;

export function finalScore(c: Candidate & { features?: string[] }, taste: Taste, model: TasteModel | null): number {
  const base = scoreCandidate(c, taste);
  const predicted = model && c.features ? predictTaste(model, c.features) : 0;
  return base + predicted * 2.2;
}
