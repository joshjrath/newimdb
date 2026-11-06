import { getDb, nowIso } from "../db";
import { imdbRatings, type LookupOptions } from "./datasets";

/**
 * IMDb's public rating for every title with an IMDb id, from IMDb's ratings file (a small
 * daily download, cached). Refreshed every few days in the background.
 */
const EVERY_DAYS = 3;
const g = globalThis as unknown as { __imdbRatingsRunning?: boolean };

export async function refreshImdbRatings(db = getDb(), opts: { force?: boolean; lookup?: LookupOptions } = {}): Promise<number> {
  if (g.__imdbRatingsRunning) return 0;
  const last = (db.prepare(`SELECT at FROM app_flag WHERE key = 'imdb-ratings'`).get() as { at: string } | undefined)?.at;
  const missing = (db.prepare(`SELECT COUNT(*) n FROM media WHERE imdb_id IS NOT NULL AND imdb_id != '' AND imdb_rating IS NULL AND imdb_rating_at IS NULL`).get() as { n: number }).n;
  if (!opts.force && last && Date.now() - Date.parse(last) < EVERY_DAYS * 86_400_000 && !missing) return 0;
  g.__imdbRatingsRunning = true;
  try {
    const rows = db.prepare(`SELECT id, imdb_id FROM media WHERE imdb_id IS NOT NULL AND imdb_id != ''`).all() as { id: number; imdb_id: string }[];
    if (!rows.length) return 0;
    const ratings = await imdbRatings(new Set(rows.map((r) => r.imdb_id)), opts.lookup);
    const now = nowIso();
    const set = db.prepare(`UPDATE media SET imdb_rating = ?, imdb_votes = ?, imdb_rating_at = ? WHERE id = ?`);
    let n = 0;
    db.transaction(() => {
      for (const r of rows) {
        const x = ratings.get(r.imdb_id);
        set.run(x?.rating ?? null, x?.votes ?? null, now, r.id); // checked, even when IMDb has no rating yet
        if (x) n++;
      }
      db.prepare(`INSERT OR REPLACE INTO app_flag (key, at, detail) VALUES ('imdb-ratings', ?, ?)`).run(now, JSON.stringify({ rated: n }));
    })();
    return n;
  } finally {
    g.__imdbRatingsRunning = false;
  }
}
