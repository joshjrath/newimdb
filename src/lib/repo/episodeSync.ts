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

const yearOf = (d: string | null | undefined) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/**
 * Providers often number a season's episodes across the whole show (TVmaze lists Bleach's
 * second season as episodes 21–41). Put them back to 1, 2, 3… in airing order.
 */
export function renumberSeason(eps: SyncEpisode[]): SyncEpisode[] {
  const sorted = [...eps].sort((a, b) => a.number - b.number);
  return sorted[0]?.number === 1 ? sorted : sorted.map((e, i) => ({ ...e, number: i + 1 }));
}

/**
 * Does the provider's season line up with ours? "same" (same episodes), "extends" (ours
 * plus newer ones), or "mismatch" (fewer, or different dates: it splits seasons differently).
 */
export function compareSeason(ours: { number: number; airDate: string | null }[], theirs: SyncEpisode[]): "same" | "extends" | "mismatch" {
  if (!ours.length) return "extends";
  if (theirs.length < ours.length) return "mismatch";
  const byNum = new Map(theirs.map((e) => [e.number, e]));
  const sorted = [...ours].sort((a, b) => a.number - b.number);
  for (const o of [sorted[0], sorted[sorted.length - 1]]) {
    const t = byNum.get(o.number);
    if (!t) return "mismatch";
    const [a, b] = [yearOf(o.airDate), yearOf(t.airDate)];
    if (a != null && b != null && Math.abs(a - b) > 1) return "mismatch";
  }
  return theirs.length === ours.length ? "same" : "extends";
}

/** Years between seasons after which an anime continuation counts as its own show (Bleach → TYBW). */
const ANIME_SEQUEL_GAP_YEARS = 4;

/**
 * Merge a provider's episode list (by season) into a show, without ever breaking it:
 *  - a season is only touched when it lines up with ours (same episodes, by number and year)
 *  - only the latest season can grow; earlier ones only get titles and dates
 *  - a new season is added only if every season before it lined up, it's the next number,
 *    and (for anime) it isn't a long-gap sequel that IMDb lists as a separate show
 * Nothing you've watched or rated is ever removed.
 */
export function syncShowEpisodes(
  mediaId: number,
  bySeason: Map<number, SyncEpisode[]>,
  source: { provider: string; showRef: string },
  db: DB = getDb(),
): { added: number; newSeasons: number; mismatched: number[] } {
  let added = 0;
  let newSeasons = 0;
  const mismatched: number[] = [];
  const type = (db.prepare(`SELECT type FROM media WHERE id = ?`).get(mediaId) as { type: string } | undefined)?.type;
  db.transaction(() => {
    const segs = () =>
      db.prepare(`SELECT id, kind, season_number, cour_number, position FROM segment WHERE media_id = ? ORDER BY position`).all(mediaId) as {
        id: number;
        kind: string;
        season_number: number | null;
        cour_number: number | null;
        position: number;
      }[];
    const episodesOf = (segmentId: number) => db.prepare(`SELECT number, air_date AS airDate FROM episode WHERE segment_id = ?`).all(segmentId) as { number: number; airDate: string | null }[];
    const initial = segs().filter((x) => (x.kind === "season" || x.kind === "cour") && x.season_number != null);
    let latest = Math.max(0, ...initial.map((x) => x.season_number!));
    let lined = true;
    for (const [season, raw] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      if (season < 1 || !raw.length) continue;
      const eps = renumberSeason(raw);
      const same = segs().filter((x) => x.season_number === season && (x.kind === "season" || x.kind === "cour"));
      if (same.some((x) => x.cour_number != null)) continue; // you split this season into cours: leave it alone
      let target = same[0]?.id;
      if (target) {
        const verdict = compareSeason(episodesOf(target), eps);
        if (verdict === "mismatch" || (verdict === "extends" && season !== latest)) {
          mismatched.push(season);
          lined = false;
          continue;
        }
        added += applyProviderEpisodes(target, eps.map((e) => ({ ...e, filler: false, providerRef: null })), { grow: season === latest }, db).added;
        continue;
      }
      if (!lined || season !== latest + 1) continue;
      if (type === "anime" && latest > 0) {
        const prev = segs().find((x) => x.season_number === latest && (x.kind === "season" || x.kind === "cour"));
        const lastYear = prev ? Math.max(0, ...episodesOf(prev.id).map((e) => yearOf(e.airDate) ?? 0)) : 0;
        const firstYear = Math.min(...eps.map((e) => yearOf(e.airDate) ?? 9999));
        if (lastYear && firstYear !== 9999 && firstYear - lastYear > ANIME_SEQUEL_GAP_YEARS) continue;
      }
      // New season: slot it after the last season numbered below it.
      const all = segs();
      const before = all.filter((x) => (x.kind === "season" || x.kind === "cour") && x.season_number != null && x.season_number < season);
      const position = before.length ? Math.max(...before.map((x) => x.position)) + 1 : all.filter((x) => x.kind !== "special").length;
      db.prepare(`UPDATE segment SET position = position + 1 WHERE media_id = ? AND position >= ?`).run(mediaId, position);
      target = (db
        .prepare(
          `INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, provider, provider_ref, created_at, updated_at)
           VALUES (?, 'season', ?, ?, NULL, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(mediaId, defaultSegmentLabel("season", { season }), season, position, source.provider, `${source.showRef}:${season}`, nowIso(), nowIso()) as { id: number }).id;
      newSeasons++;
      latest = season;
      added += applyProviderEpisodes(target, eps.map((e) => ({ ...e, filler: false })), { grow: true }, db).added;
    }
    if (added || newSeasons) {
      db.prepare(`UPDATE media SET version = version + 1, updated_at = ? WHERE id = ?`).run(nowIso(), mediaId);
      audit(db, "sync_episodes", "media", mediaId, { added, newSeasons, provider: source.provider });
    }
    markSynced(mediaId, mismatched.length ? `${source.provider === "tmdb" ? "TMDB" : "TVmaze"} splits season ${mismatched.join(", ")} differently, so ${mismatched.length === 1 ? "it was" : "they were"} left as ${mismatched.length === 1 ? "it is" : "they are"}.` : null, db);
  })();
  return { added, newSeasons, mismatched };
}
