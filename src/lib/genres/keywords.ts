import { getDb, nowIso } from "../db";
import { tmdbConfigured, tmdbFindByImdb, tmdbGenresAndKeywords } from "../providers/tmdb";
import { anyKeywordGenres, applyGenres } from "../repo/genres";

/**
 * Some genre filters (Superhero, Heist, True Crime…) need TMDB keywords, which IMDb and
 * TVmaze don't have. This fetches them once per title, in the background, then re-tags.
 * Needs a TMDB key; without one, those filters match on genres only.
 */

export interface KeywordJob {
  state: "running" | "done" | "error";
  total: number;
  done: number;
  found: number;
  failed: number;
  startedAt: number;
  error?: string;
}

const g = globalThis as unknown as { __keywordJob?: KeywordJob };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const currentKeywordJob = () => g.__keywordJob ?? null;

interface Todo {
  id: number;
  type: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  genres: string;
}

export function keywordsPending(db = getDb()): number {
  return (db.prepare(`SELECT COUNT(*) n FROM media WHERE keywords_fetched_at IS NULL AND (tmdb_id IS NOT NULL OR imdb_id IS NOT NULL)`).get() as { n: number }).n;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if ((e as { status?: number }).status === 429 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

/** Start (or return the running) keyword fetch. Does nothing without a TMDB key or a keyword-based filter. */
export function startKeywordJob(opts: { quiet?: boolean } = {}): KeywordJob | null {
  const running = g.__keywordJob;
  if (running?.state === "running") return running;
  const db = getDb();
  // Once: fetch again for titles without a full release date (it comes with the keywords).
  if (!db.prepare(`SELECT 1 FROM app_flag WHERE key = 'keywords-v3-dates'`).get()) {
    db.prepare(`UPDATE media SET keywords_fetched_at = NULL WHERE release_date IS NULL`).run();
    db.prepare(`INSERT OR IGNORE INTO app_flag (key, at) VALUES ('keywords-v3-dates', ?)`).run(nowIso());
  }
  // Keywords fetched before studios/franchises were included are fetched again, once.
  if (!db.prepare(`SELECT 1 FROM app_flag WHERE key = 'keywords-v2'`).get()) {
    db.prepare(`UPDATE media SET keywords_fetched_at = NULL WHERE keywords_fetched_at IS NOT NULL`).run();
    db.prepare(`INSERT INTO app_flag (key, at) VALUES ('keywords-v2', ?)`).run(nowIso());
  }
  // Keywords feed genre filters and your recommendations, so they're fetched whenever TMDB is set up.
  if (!tmdbConfigured()) return null;
  const todo = db
    .prepare(`SELECT id, type, tmdb_id, imdb_id, genres FROM media WHERE keywords_fetched_at IS NULL AND (tmdb_id IS NOT NULL OR imdb_id IS NOT NULL) ORDER BY id`)
    .all() as Todo[];
  if (!todo.length && opts.quiet) return null;
  const job: KeywordJob = { state: "running", total: todo.length, done: 0, found: 0, failed: 0, startedAt: Date.now() };
  g.__keywordJob = job;

  const save = db.prepare(`UPDATE media SET keywords = ?, keywords_fetched_at = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?`);
  const saveDate = db.prepare(`UPDATE media SET release_date = ? WHERE id = ? AND release_date IS NULL`);
  const fillGenres = db.prepare(`UPDATE media SET genres = ? WHERE id = ? AND genres = '[]'`);
  const touched: number[] = [];
  let next = 0;
  void (async () => {
    await new Promise((r) => setImmediate(r));
    try {
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let i = next++; i < todo.length; i = next++) {
            const t = todo[i];
            const prefer = t.type === "movie" ? "movie" : "tv";
            try {
              let tmdbId = t.tmdb_id;
              let kind: "movie" | "tv" = prefer;
              if (!tmdbId && t.imdb_id) {
                const hit = await withRetry(() => tmdbFindByImdb(t.imdb_id!, prefer));
                tmdbId = hit?.tmdbId ?? null;
                kind = hit?.kind ?? prefer;
              }
              let keywords: string[] = [];
              if (tmdbId) {
                const r = await withRetry(() => tmdbGenresAndKeywords(kind, tmdbId!));
                keywords = r.keywords;
                if (r.genres.length && t.genres === "[]") fillGenres.run(JSON.stringify(r.genres), t.id);
                if (r.releaseDate) saveDate.run(r.releaseDate, t.id);
                job.found++;
              }
              save.run(JSON.stringify(keywords), nowIso(), tmdbId, t.id);
              touched.push(t.id);
            } catch {
              job.failed++; // left unfetched, so the next run tries again
            }
            job.done++;
            if (touched.length >= 200) applyGenres(db, { mediaIds: touched.splice(0) });
          }
        }),
      );
      if (touched.length) applyGenres(db, { mediaIds: touched.splice(0) });
      job.state = "done";
    } catch (e) {
      job.state = "error";
      job.error = (e as Error).message;
    }
  })();
  return job;
}
