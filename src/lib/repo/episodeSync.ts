import { getDb, nowIso, type DB } from "../db";
import { defaultSegmentLabel, type MediaType, type WatchStatus } from "../domain/types";
import { audit } from "./audit";
import { applyProviderEpisodes } from "./media";

/**
 * Keeping shows up to date: new episodes and seasons from a provider are added to the
 * matching "Season N" (never to seasons you split into cours), titles and air dates are
 * refreshed, and nothing you've rated or watched is ever removed.
 */

export interface DueShow {
  id: number;
  type: MediaType;
  title: string;
  imdbId: string | null;
  tvmazeId: number | null;
  tmdbId: number | null;
  status: WatchStatus | null;
}

const HOUR = 3600_000;
/** Shows you're watching are checked every 6 hours; everything else once a day. */
export const SYNC_EVERY = { watching: 6 * HOUR, other: 24 * HOUR };

export function dueShows(limit: number, db = getDb(), now = Date.now()): DueShow[] {
  return db
    .prepare(
      `SELECT m.id, m.type, m.title, m.imdb_id AS imdbId, m.tvmaze_id AS tvmazeId, m.tmdb_id AS tmdbId, r.status
       FROM media m LEFT JOIN review r ON r.media_id = m.id
       WHERE m.type IN ('tv', 'anime') AND (
         m.episodes_synced_at IS NULL
         OR (r.status = 'watching' AND m.episodes_synced_at < ?)
         OR m.episodes_synced_at < ?)
       ORDER BY m.episodes_synced_at IS NOT NULL, r.status = 'watching' DESC, m.episodes_synced_at
       LIMIT ?`,
    )
    .all(new Date(now - SYNC_EVERY.watching).toISOString(), new Date(now - SYNC_EVERY.other).toISOString(), limit) as DueShow[];
}

export function allShows(db = getDb()): DueShow[] {
  return db
    .prepare(
      `SELECT m.id, m.type, m.title, m.imdb_id AS imdbId, m.tvmaze_id AS tvmazeId, m.tmdb_id AS tmdbId, r.status
       FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.type IN ('tv', 'anime') ORDER BY r.status = 'watching' DESC, m.id`,
    )
    .all() as DueShow[];
}

export function markSynced(mediaId: number, note: string | null, db = getDb()) {
  db.prepare(`UPDATE media SET episodes_synced_at = ?, episodes_sync_note = ? WHERE id = ?`).run(nowIso(), note, mediaId);
}

export interface SyncEpisode {
  number: number;
  title: string | null;
  airDate: string | null;
  overview: string | null;
  providerRef: string | null;
}

/** Merge a provider's episode list (by season) into a show. Returns what changed. */
export function syncShowEpisodes(mediaId: number, bySeason: Map<number, SyncEpisode[]>, source: { provider: string; showRef: string }, db: DB = getDb()) {
  let added = 0;
  let newSeasons = 0;
  db.transaction(() => {
    for (const [season, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      if (season < 1 || !eps.length) continue;
      const segs = db
        .prepare(`SELECT id, kind, season_number, cour_number, position FROM segment WHERE media_id = ? ORDER BY position`)
        .all(mediaId) as { id: number; kind: string; season_number: number | null; cour_number: number | null; position: number }[];
      const same = segs.filter((s) => s.season_number === season && (s.kind === "season" || s.kind === "cour"));
      if (same.some((s) => s.cour_number != null)) continue; // you split this season into cours: leave it alone
      let target = same[0]?.id;
      if (!target) {
        // New season: slot it after the last season numbered below it.
        const before = segs.filter((s) => (s.kind === "season" || s.kind === "cour") && s.season_number != null && s.season_number < season);
        const position = before.length ? Math.max(...before.map((s) => s.position)) + 1 : segs.filter((s) => s.kind !== "special").length;
        db.prepare(`UPDATE segment SET position = position + 1 WHERE media_id = ? AND position >= ?`).run(mediaId, position);
        target = (db
          .prepare(
            `INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, provider, provider_ref, created_at, updated_at)
             VALUES (?, 'season', ?, ?, NULL, ?, ?, ?, ?, ?) RETURNING id`,
          )
          .get(mediaId, defaultSegmentLabel("season", { season }), season, position, source.provider, `${source.showRef}:${season}`, nowIso(), nowIso()) as { id: number }).id;
        newSeasons++;
      }
      added += applyProviderEpisodes(target, eps.map((e) => ({ ...e, filler: false })), { grow: true }, db).added;
    }
    if (added || newSeasons) {
      db.prepare(`UPDATE media SET version = version + 1, updated_at = ? WHERE id = ?`).run(nowIso(), mediaId);
      audit(db, "sync_episodes", "media", mediaId, { added, newSeasons, provider: source.provider });
    }
    markSynced(mediaId, null, db);
  })();
  return { added, newSeasons };
}
