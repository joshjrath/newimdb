import path from "node:path";
import { dataDir, getDb, nowIso, snapshotSync, type DB } from "../db";
import { lookupEpisodes, type LookupOptions } from "../imdb/datasets";
import { audit } from "../repo/audit";

/**
 * One-off repair for shows the old episode sync inflated (Bleach showed ~700 episodes:
 * TVmaze numbers some seasons across the whole show, and those numbers were added as new
 * episodes). Every show the sync touched is put back to IMDb's season structure:
 *  - episodes past IMDb's last episode of a season are removed
 *  - seasons the sync created that IMDb doesn't have are removed
 *  - titles and dates go back to IMDb's (the safe sync then fills in exact dates)
 * Anything you've watched or rated is always kept.
 */

const FLAG = "repair-episode-sync-v1";
const g = globalThis as unknown as { __repairRunning?: boolean };

export function repairDone(db = getDb()) {
  return Boolean(db.prepare(`SELECT 1 FROM app_flag WHERE key = ?`).get(FLAG));
}

function touchedShows(db: DB): { id: number; imdbId: string | null; title: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT m.id, m.imdb_id AS imdbId, m.title FROM audit_event a JOIN media m ON m.id = CAST(a.entity_id AS INTEGER)
       WHERE a.action = 'sync_episodes' AND a.entity = 'media' AND m.type IN ('tv', 'anime')`,
    )
    .all() as { id: number; imdbId: string | null; title: string }[];
}

const KEEP = `EXISTS (SELECT 1 FROM episode_assessment a WHERE a.episode_id = episode.id AND (a.state != 'unwatched' OR a.rating IS NOT NULL))`;

export async function repairInflatedShows(db = getDb(), opts: LookupOptions = {}): Promise<{ shows: number; removedEpisodes: number; removedSeasons: number } | null> {
  if (repairDone(db) || g.__repairRunning) return null;
  g.__repairRunning = true;
  try {
    const shows = touchedShows(db).filter((s) => s.imdbId);
    const result = { shows: 0, removedEpisodes: 0, removedSeasons: 0 };
    if (shows.length) {
      const lookup = await lookupEpisodes(new Set(), new Set(shows.map((s) => s.imdbId!)), opts);
      snapshotSync(db, process.env.DATABASE_FILE || path.join(dataDir(), "watch.db"), "before-episode-repair");
      db.transaction(() => {
        for (const show of shows) {
          const eps = lookup.episodesByParent.get(show.imdbId!) ?? [];
          if (!eps.length) continue; // IMDb has no episode list for it: nothing to compare against
          const bySeason = new Map<number, typeof eps>();
          for (const e of eps) if (e.season != null && e.episode != null) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e]);
          const segs = db.prepare(`SELECT id, kind, season_number, cour_number, provider FROM segment WHERE media_id = ?`).all(show.id) as {
            id: number;
            kind: string;
            season_number: number | null;
            cour_number: number | null;
            provider: string | null;
          }[];
          let changed = false;
          for (const seg of segs) {
            if (seg.season_number == null || seg.cour_number != null || (seg.kind !== "season" && seg.kind !== "special")) continue;
            const imdb = bySeason.get(seg.season_number);
            if (!imdb) {
              if (seg.provider === "tvmaze" || seg.provider === "tmdb") {
                const hasProgress = db.prepare(`SELECT 1 FROM episode WHERE segment_id = ? AND ${KEEP}`).get(seg.id);
                if (!hasProgress) {
                  db.prepare(`DELETE FROM segment WHERE id = ?`).run(seg.id);
                  result.removedSeasons++;
                  changed = true;
                }
              }
              continue;
            }
            // Keep numbering contiguous: never cut below an episode you've watched or rated.
            const kept = (db.prepare(`SELECT COALESCE(MAX(number), 0) n FROM episode WHERE segment_id = ? AND ${KEEP}`).get(seg.id) as { n: number }).n;
            const max = Math.max(kept, ...imdb.map((e) => e.episode!));
            result.removedEpisodes += db.prepare(`DELETE FROM episode WHERE segment_id = ? AND number > ?`).run(seg.id, max).changes;
            const upd = db.prepare(`UPDATE episode SET air_date = ?, title = COALESCE(?, title), provider_ref = ? WHERE segment_id = ? AND number = ?`);
            for (const e of imdb) {
              const b = lookup.basics.get(e.imdbId);
              upd.run(b?.year != null ? String(b.year) : "TBA", b?.title ?? null, e.imdbId, seg.id, e.episode);
            }
            changed = true;
          }
          if (changed) {
            result.shows++;
            db.prepare(`UPDATE media SET episodes_synced_at = NULL, version = version + 1, updated_at = ? WHERE id = ?`).run(nowIso(), show.id);
            audit(db, "repair_episodes", "media", show.id, { from: "imdb" });
          }
        }
      })();
    }
    db.prepare(`INSERT OR REPLACE INTO app_flag (key, at, detail) VALUES (?, ?, ?)`).run(FLAG, nowIso(), JSON.stringify(result));
    if (result.shows) console.log(`[repair] fixed ${result.shows} shows: ${result.removedEpisodes} extra episodes and ${result.removedSeasons} extra seasons removed`);
    return result;
  } finally {
    g.__repairRunning = false;
  }
}
