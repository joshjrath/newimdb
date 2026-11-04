import { getDb, nowIso, type DB } from "../db";
import { normalizeTitle } from "../domain/text";
import type { MediaType } from "../domain/types";
import { addSeedResults, becauseOf, featuresOf, finalScore, learnTaste, matchPercent, pickSeeds, predictTaste, supporters, tasteProfile, type Candidate, type LibraryTitle, type Seed } from "../domain/recommend";
import { imdbRatings } from "../imdb/datasets";
import { tmdbConfigured, tmdbFindByImdb, tmdbGenreNames, tmdbGenresAndKeywords, tmdbRecommendations, tmdbWatchProviders, type TmdbRec, type WatchOption } from "../providers/tmdb";
import { anilistRecommendations, anilistStreaming, type AniRec } from "../providers/anime";

/**
 * Builds your Recommended page in the background: favourites from your library → each
 * one's "if you liked this" list (TMDB for movies and TV, AniList and TMDB for anime) →
 * scored against your taste → the best per category, with where to watch them.
 * Refreshed daily, and whenever you ask.
 */

export interface Recommendation {
  key: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  genres: string[];
  match: number;
  because: string[];
  audience: { score: number; votes: number; source: string } | null;
  /** IMDb's rating out of 10, when the title is on IMDb. */
  imdb: { id: string; rating: number | null; votes: number | null } | null;
  /** How many of your favourites point here. */
  supporters: number;
  /** The pick itself (shared by "for you" and "with someone" rows). */
  baseKey?: string;
  /** Picked for watching with this person, from the titles you've seen together. */
  person?: { id: number; name: string; shared: number } | null;
  tmdb: { kind: "movie" | "tv"; id: number } | null;
  anilistId: number | null;
  malId: number | null;
  watch: WatchOption[];
}

export interface RecommendState {
  running: boolean;
  step: string;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const g = globalThis as unknown as { __recommend?: RecommendState };
const state = (): RecommendState => (g.__recommend ??= { running: false, step: "", done: 0, total: 0, startedAt: null, finishedAt: null, error: null });
export const recommendState = () => state();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REGION = () => (process.env.WATCH_REGION || "US").toUpperCase();
const PER_TYPE = 24;

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if ((e as { status?: number }).status === 429 && attempt < 3) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

/* ---------------- reads ---------------- */

export interface PersonPicks {
  person: { id: number; name: string; shared: number };
  items: Recommendation[];
}

export function listRecommendations(db = getDb()): { byType: Record<MediaType, Recommendation[]>; byPerson: PersonPicks[]; computedAt: string | null } {
  const rows = db.prepare(`SELECT type, data, person_id, computed_at FROM recommendation ORDER BY score DESC`).all() as { type: MediaType; data: string; person_id: number | null; computed_at: string }[];
  const byType: Record<MediaType, Recommendation[]> = { movie: [], tv: [], anime: [] };
  const people = new Map<number, PersonPicks>();
  for (const r of rows) {
    const rec = JSON.parse(r.data) as Recommendation;
    if (r.person_id == null) byType[r.type].push(rec);
    else if (rec.person) {
      const p = people.get(r.person_id) ?? { person: rec.person, items: [] };
      p.items.push(rec);
      people.set(r.person_id, p);
    }
  }
  return { byType, byPerson: [...people.values()].sort((a, b) => b.person.shared - a.person.shared), computedAt: rows[0]?.computed_at ?? null };
}

export function getRecommendation(key: string, db = getDb()): Recommendation | null {
  const r = db.prepare(`SELECT data FROM recommendation WHERE key = ?`).get(key) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : null;
}

/** "Not interested": gone now, and never suggested again. */
export function dismissRecommendation(key: string, db = getDb()) {
  const rec = getRecommendation(key, db);
  const base = rec?.baseKey ?? key;
  db.prepare(`INSERT OR REPLACE INTO recommendation_dismissed (key, title, dismissed_at) VALUES (?, ?, ?)`).run(base, rec?.title ?? null, nowIso());
  removeRecommendation(key, db);
}

/** Removes a pick everywhere it appears (for you, and with anyone). */
export function removeRecommendation(key: string, db = getDb()) {
  const base = getRecommendation(key, db)?.baseKey ?? key;
  db.prepare(`DELETE FROM recommendation WHERE key = ? OR key = ? OR key LIKE ?`).run(key, base, `p%:${base}`);
}

/* ---------------- building ---------------- */

interface LibRow {
  id: number;
  type: MediaType;
  title: string;
  original_title: string | null;
  year: number | null;
  genres: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  anilist_id: number | null;
  mal_id: number | null;
  rating: number | null;
  status: string | null;
  last_watched_at: string | null;
  keywords: string | null;
}

function loadLibrary(db: DB): LibRow[] {
  return db
    .prepare(
      `SELECT m.id, m.type, m.title, m.original_title, m.year, m.genres, m.keywords, m.tmdb_id, m.imdb_id, m.anilist_id, m.mal_id, r.rating, r.status, r.last_watched_at
       FROM media m LEFT JOIN review r ON r.media_id = m.id`,
    )
    .all() as LibRow[];
}

const parseList = (s: string) => {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

/** Whatever's already in your library (or you said no to) is never recommended. */
function exclusions(lib: LibRow[], db: DB) {
  const tmdb = new Set<string>();
  const ani = new Set<number>();
  const mal = new Set<number>();
  const names = new Map<string, (number | null)[]>();
  for (const m of lib) {
    if (m.tmdb_id) tmdb.add(`${m.type === "movie" ? "movie" : "tv"}:${m.tmdb_id}`);
    if (m.tmdb_id && m.type === "anime") tmdb.add(`movie:${m.tmdb_id}`);
    if (m.anilist_id) ani.add(m.anilist_id);
    if (m.mal_id) mal.add(m.mal_id);
    for (const t of [m.title, m.original_title]) if (t) names.set(normalizeTitle(t), [...(names.get(normalizeTitle(t)) ?? []), m.year]);
  }
  const dismissed = new Set((db.prepare(`SELECT key FROM recommendation_dismissed`).all() as { key: string }[]).map((r) => r.key));
  return (c: { key: string; title: string; originalTitle?: string | null; year: number | null; tmdb?: string | null; anilistId?: number | null; malId?: number | null }) => {
    if (dismissed.has(c.key)) return true;
    if (c.tmdb && tmdb.has(c.tmdb)) return true;
    if (c.anilistId && ani.has(c.anilistId)) return true;
    if (c.malId && mal.has(c.malId)) return true;
    for (const t of [c.title, c.originalTitle]) {
      const years = t ? names.get(normalizeTitle(t)) : undefined;
      if (years?.some((y) => y == null || c.year == null || Math.abs(y - c.year) <= 1)) return true;
    }
    return false;
  };
}

const isAnimeRec = (r: TmdbRec) => r.genreIds.includes(16) && r.language === "ja";
const nameKey = (title: string, year: number | null) => `${normalizeTitle(title)}:${year ?? ""}`;

export async function buildRecommendations(db = getDb()): Promise<{ total: number }> {
  const s = state();
  const lib = loadLibrary(db);
  const library: LibraryTitle[] = lib.map((m) => ({ id: m.id, type: m.type, title: m.title, year: m.year, rating: m.rating, status: m.status, genres: parseList(m.genres), lastWatchedAt: m.last_watched_at }));
  const taste = tasteProfile(library);
  // The taste model learns from every rating you've ever given, not just favourites.
  const model = learnTaste(
    lib.filter((m) => m.rating != null).map((m) => ({ rating: m.rating!, features: featuresOf({ type: m.type, year: m.year, genres: parseList(m.genres), keywords: parseList(m.keywords ?? "[]") }) })),
  );
  const seeds = pickSeeds(library, taste);
  const seedById = new Map<number, Seed>(seeds.map((x) => [x.id, x]));
  const libById = new Map(lib.map((m) => [m.id, m]));
  const excluded = exclusions(lib, db);
  const keyed = tmdbConfigured();
  const genreNames = keyed ? await retry(() => tmdbGenreNames()).catch(() => new Map<number, string>()) : new Map<number, string>();

  const pool = new Map<string, Candidate>();
  const tmdbInfo = new Map<string, TmdbRec>();
  const aniInfo = new Map<string, AniRec>();
  // TMDB and AniList can both suggest the same anime: fold them together by name and year.
  const animeAlias = new Map<string, string>();

  s.total = seeds.length;
  s.done = 0;
  s.step = "Reading your favourites";
  let next = 0;
  // Each library title's "if you liked this" lists, fetched once and reused for people rows.
  type Row = Omit<Candidate, "from">;
  const seedRows = new Map<number, Promise<Row[][]>>();
  const rowsForSeed = (seed: Seed): Promise<Row[][]> => {
    if (!seedRows.has(seed.id)) seedRows.set(seed.id, fetchRows(seed));
    return seedRows.get(seed.id)!;
  };
  const fetchRows = async (seed: Seed): Promise<Row[][]> => {
    const out: Row[][] = [];
    const m = libById.get(seed.id)!;
    try {
        if (keyed && (m.tmdb_id || m.imdb_id)) {
          let kind: "movie" | "tv" = m.type === "movie" ? "movie" : "tv";
          let id = m.tmdb_id;
          if (!id && m.imdb_id) {
            const hit = await retry(() => tmdbFindByImdb(m.imdb_id!, kind));
            id = hit?.tmdbId ?? null;
            kind = hit?.kind ?? kind;
            if (id) db.prepare(`UPDATE media SET tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?`).run(id, m.id);
          }
          if (id) {
            const recs = await retry(() => tmdbRecommendations(kind, id!));
            const rows = recs.map((r) => {
              const type: MediaType = isAnimeRec(r) ? "anime" : r.kind;
              let key = `tmdb:${r.kind}:${r.id}`;
              if (type === "anime") {
                const alias = animeAlias.get(nameKey(r.title, r.year));
                if (alias) key = alias;
                else animeAlias.set(nameKey(r.title, r.year), key);
              }
              tmdbInfo.set(key, r);
              return { key, type, title: r.title, year: r.year, genres: r.genreIds.map((g) => genreNames.get(g)).filter((x): x is string => Boolean(x)), audience: { score: r.voteAverage, votes: r.voteCount } };
            });
            out.push(rows.filter((r) => !excluded({ key: r.key, title: r.title, originalTitle: tmdbInfo.get(r.key)?.originalTitle, year: r.year, tmdb: `${tmdbInfo.get(r.key)!.kind}:${tmdbInfo.get(r.key)!.id}` })));
          }
        }
        if (m.type === "anime") {
          const recs = await retry(() => anilistRecommendations({ anilistId: m.anilist_id, malId: m.mal_id, title: m.anilist_id || m.mal_id ? undefined : m.title }));
          await sleep(2100); // AniList: about 30 requests a minute
          const rows = recs.map((r) => {
            const alias = animeAlias.get(nameKey(r.title, r.year)) ?? (r.originalTitle ? animeAlias.get(nameKey(r.originalTitle, r.year)) : undefined);
            const key = alias ?? `anilist:${r.id}`;
            if (!alias) animeAlias.set(nameKey(r.title, r.year), key);
            aniInfo.set(key, r);
            return { key, type: "anime" as MediaType, title: r.title, year: r.year, genres: r.genres, audience: r.averageScore != null ? { score: r.averageScore / 10, votes: Math.max(r.votes * 20, r.popularity / 50) } : null };
          });
          out.push(rows.filter((r) => !excluded({ key: r.key, title: r.title, originalTitle: aniInfo.get(r.key)?.originalTitle, year: r.year, anilistId: aniInfo.get(r.key)?.id, malId: aniInfo.get(r.key)?.idMal })));
        }
    } catch (e) {
      console.warn(`[recommend] couldn't use ${m.title}:`, (e as Error).message);
    }
    return out;
  };
  const work = async () => {
    for (let i = next++; i < seeds.length; i = next++) {
      for (const rows of await rowsForSeed(seeds[i])) addSeedResults(pool, seeds[i], rows);
      s.done++;
    }
  };
  await Promise.all(Array.from({ length: keyed ? 3 : 1 }, work));

  // First pass: score on what we know (genres, year), keep a shortlist per category.
  s.step = "Matching picks to your taste";
  const featuresFor = new Map<string, string[]>();
  const feat = (c: Candidate, keywords: string[] = []) => featuresOf({ type: c.type, year: c.year, genres: c.genres, keywords });
  for (const c of pool.values()) featuresFor.set(c.key, feat(c, aniInfo.get(c.key)?.tags ?? []));
  const prelim = (["anime", "tv", "movie"] as MediaType[]).flatMap((type) =>
    [...pool.values()]
      .filter((c) => c.type === type)
      .map((c) => ({ c, score: finalScore({ ...c, features: featuresFor.get(c.key) }, taste, model) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_TYPE * 3),
  );
  // Second pass: fetch each shortlisted title's keywords, studios and IMDb id, and re-score.
  const imdbOf = new Map<string, string>();
  s.total = prelim.length;
  s.done = 0;
  next = 0;
  await Promise.all(
    Array.from({ length: keyed ? 4 : 1 }, async () => {
      for (let i = next++; i < prelim.length; i = next++) {
        const { c } = prelim[i];
        const t = tmdbInfo.get(c.key);
        if (t && keyed) {
          try {
            const d = await retry(() => tmdbGenresAndKeywords(t.kind, t.id));
            featuresFor.set(c.key, feat({ ...c, genres: d.genres.length ? d.genres : c.genres }, [...d.keywords, ...(aniInfo.get(c.key)?.tags ?? [])]));
            if (d.imdbId) imdbOf.set(c.key, d.imdbId);
          } catch {}
        }
        s.done++;
      }
    }),
  );
  const rescored = prelim.map(({ c }) => ({ c, score: finalScore({ ...c, features: featuresFor.get(c.key) }, taste, model), n: supporters(c) })).filter((x) => x.score > 0);
  const best = Math.max(0, ...rescored.map((x) => x.score));
  // A pick needs at least two of your favourites behind it. Only if a category would be
  // nearly empty do single-favourite picks that strongly fit your taste fill it.
  const chosen = (["anime", "tv", "movie"] as MediaType[]).flatMap((type) => {
    const mine = rescored.filter((x) => x.c.type === type).sort((a, b) => b.score - a.score);
    const backed = mine.filter((x) => x.n >= 2);
    const fill = backed.length >= 10 ? [] : mine.filter((x) => x.n < 2 && predictTaste(model, featuresFor.get(x.c.key) ?? []) > 0.25);
    return [...backed, ...fill].slice(0, PER_TYPE);
  });
  // Picks for watching with someone: learned only from the titles you've seen together,
  // and your ratings of them (at least 5 rated ones needed).
  s.step = "Picking for the people you watch with";
  type Pick = { c: Candidate; score: number; best: number; seeds: Map<number, Seed>; person: { id: number; name: string; shared: number } | null };
  const picks: Pick[] = chosen.map((x) => ({ c: x.c, score: x.score, best, seeds: seedById, person: null }));
  const together = db.prepare(`SELECT p.id, p.name, mp.media_id FROM person p JOIN media_person mp ON mp.person_id = p.id`).all() as { id: number; name: string; media_id: number }[];
  const byPerson = new Map<number, { name: string; ids: Set<number> }>();
  for (const r of together) {
    const p = byPerson.get(r.id) ?? { name: r.name, ids: new Set<number>() };
    p.ids.add(r.media_id);
    byPerson.set(r.id, p);
  }
  for (const [pid, p] of byPerson) {
    const shared = library.filter((t) => p.ids.has(t.id));
    const rated = lib.filter((m) => p.ids.has(m.id) && m.rating != null);
    if (rated.length < 5) continue;
    const tasteP = tasteProfile(shared);
    const modelP = learnTaste(rated.map((m) => ({ rating: m.rating!, features: featuresOf({ type: m.type, year: m.year, genres: parseList(m.genres), keywords: parseList(m.keywords ?? "[]") }) })));
    const seedsP = pickSeeds(shared, tasteP, 15);
    const poolP = new Map<string, Candidate>();
    for (const seed of seedsP) for (const rows of await rowsForSeed(seed)) addSeedResults(poolP, seed, rows);
    const scoredP = [...poolP.values()]
      .map((c) => {
        if (!featuresFor.has(c.key)) featuresFor.set(c.key, feat(c, aniInfo.get(c.key)?.tags ?? []));
        return { c, score: finalScore({ ...c, features: featuresFor.get(c.key) }, tasteP, modelP), n: supporters(c) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const backed = scoredP.filter((x) => x.n >= 2);
    const fill = backed.length >= 8 ? [] : scoredP.filter((x) => x.n < 2 && predictTaste(modelP, featuresFor.get(x.c.key) ?? []) > 0.25);
    const top = [...backed, ...fill].slice(0, 18);
    const bestP = Math.max(0, ...top.map((x) => x.score));
    const seedMap = new Map<number, Seed>(seedsP.map((x) => [x.id, x]));
    for (const x of top) picks.push({ c: x.c, score: x.score, best: bestP, seeds: seedMap, person: { id: pid, name: p.name, shared: shared.length } });
  }

  s.step = "Finding where to watch";
  s.total = picks.length;
  s.done = 0;
  const out: { rec: Recommendation; score: number; person: number | null }[] = [];
  next = 0;
  // Where to watch, once per title even if it appears in several rows.
  const watchCache = new Map<string, Promise<WatchOption[]>>();
  const watchFor = (key: string): Promise<WatchOption[]> => {
    if (!watchCache.has(key))
      watchCache.set(
        key,
        (async () => {
          const t = tmdbInfo.get(key);
          const a = aniInfo.get(key);
          const watch: WatchOption[] = [];
          try {
            if (t && keyed) watch.push(...(await retry(() => tmdbWatchProviders(t.kind, t.id, REGION()))));
            for (const l of a ? a.streaming : []) {
              if (watch.some((w) => w.name.toLowerCase() === l.site.toLowerCase())) continue;
              watch.push({ name: l.site, logoUrl: l.icon, url: l.url, kind: "stream", color: l.color });
            }
          } catch {}
          return watch;
        })(),
      );
    return watchCache.get(key)!;
  };
  const watchWork = async () => {
    for (let i = next++; i < picks.length; i = next++) {
      const { c, score, best: top, seeds: seedMap, person } = picks[i];
      const t = tmdbInfo.get(c.key);
      const a = aniInfo.get(c.key);
      const watch = await watchFor(c.key);
      s.done++;
      out.push({
        score,
        person: person?.id ?? null,
        rec: {
          key: person ? `p${person.id}:${c.key}` : c.key,
          baseKey: c.key,
          person,
          type: c.type,
          title: a?.title ?? t!.title,
          originalTitle: a?.originalTitle ?? t?.originalTitle ?? null,
          year: c.year,
          posterUrl: t?.posterUrl ?? a?.posterUrl ?? null,
          backdropUrl: t?.backdropUrl ?? a?.backdropUrl ?? null,
          overview: t?.overview ?? a?.overview ?? null,
          genres: [...new Set([...(a?.genres ?? []), ...c.genres])].slice(0, 4),
          match: matchPercent(score, top),
          because: becauseOf(c, seedMap, 3),
          supporters: supporters(c),
          imdb: imdbOf.has(c.key) ? { id: imdbOf.get(c.key)!, rating: null, votes: null } : null,
          audience: t ? { score: t.voteAverage, votes: t.voteCount, source: "TMDB" } : a?.averageScore != null ? { score: a.averageScore / 10, votes: a.popularity, source: "AniList" } : null,
          tmdb: t ? { kind: t.kind, id: t.id } : null,
          anilistId: a?.id ?? null,
          malId: a?.idMal ?? null,
          watch,
        },
      });
    }
  };
  await Promise.all(Array.from({ length: keyed ? 4 : 1 }, watchWork));

  // IMDb's own rating for each pick (from IMDb's public ratings file).
  try {
    s.step = "Adding IMDb ratings";
    const ratings = await imdbRatings(new Set(out.flatMap((o) => (o.rec.imdb ? [o.rec.imdb.id] : []))));
    for (const o of out) {
      const r = o.rec.imdb && ratings.get(o.rec.imdb.id);
      if (r && o.rec.imdb) Object.assign(o.rec.imdb, r);
    }
  } catch (e) {
    console.warn("[recommend] IMDb ratings unavailable:", (e as Error).message);
  }
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`DELETE FROM recommendation`).run();
    const ins = db.prepare(`INSERT OR REPLACE INTO recommendation (key, type, data, score, person_id, computed_at) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const { rec, score, person } of out) ins.run(rec.key, rec.type, JSON.stringify(rec), score, person, now);
  })();
  return { total: out.length };
}

export async function runRecommendations(): Promise<RecommendState> {
  const s = state();
  if (s.running) return s;
  Object.assign(s, { running: true, step: "Starting", done: 0, total: 0, startedAt: nowIso(), finishedAt: null, error: null });
  try {
    await buildRecommendations();
  } catch (e) {
    s.error = (e as Error).message;
    console.error("[recommend] failed:", e);
  } finally {
    s.running = false;
    s.finishedAt = nowIso();
  }
  return s;
}

/** For the scheduler: refresh once a day (or straight away if there are none yet). */
export function startRecommendationsIfStale(db = getDb()) {
  if (state().running) return;
  const last = (db.prepare(`SELECT MAX(computed_at) t FROM recommendation`).get() as { t: string | null }).t ?? state().finishedAt;
  if (last && Date.now() - Date.parse(last) < 24 * 3600_000) return;
  const rated = (db.prepare(`SELECT COUNT(*) n FROM review WHERE rating IS NOT NULL`).get() as { n: number }).n;
  if (!rated) return;
  void runRecommendations();
}

/** Refresh where-to-watch for one pick (used when you open it). */
export async function watchOptionsFor(rec: Recommendation): Promise<WatchOption[]> {
  const out: WatchOption[] = [];
  if (rec.tmdb && tmdbConfigured()) out.push(...(await tmdbWatchProviders(rec.tmdb.kind, rec.tmdb.id, REGION())));
  if (rec.anilistId) for (const l of await anilistStreaming(rec.anilistId)) if (!out.some((w) => w.name.toLowerCase() === l.site.toLowerCase())) out.push({ name: l.site, logoUrl: l.icon, url: l.url, kind: "stream", color: l.color });
  return out;
}
