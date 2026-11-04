import path from "node:path";
import { dataDir, getDb, nowIso, snapshotSync, type DB } from "../db";
import { franchiseMerges, seasonNumberIn, subtitleOf, type FranchiseEntry } from "../domain/franchise";
import { defaultSegmentLabel } from "../domain/types";
import { audit } from "./audit";
import { peopleFor, setMediaPeople } from "./people";
import { setMediaTags, tagsFor } from "./tags";

/**
 * Folds anime films, OVAs and extra-season entries into their series, so Demon Slayer
 * is one entry with its seasons and Mugen Train inside it, not three. Ratings, watch
 * dates, reviews, tags and people all move across. The folded title is remembered, so
 * a later IMDb or Letterboxd import updates it inside the series instead of re-adding it.
 */

interface Row {
  id: number;
  title: string;
  original_title: string | null;
  year: number | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  type_locked: number;
}

export interface GroupedTitle {
  id: number;
  title: string;
  into: string;
  intoId: number;
}

const yearOf = (d: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

function entries(db: DB): (FranchiseEntry & Row)[] {
  const rows = db.prepare(`SELECT id, title, original_title, year, imdb_id, tmdb_id, type_locked FROM media WHERE type = 'anime'`).all() as Row[];
  const segs = db.prepare(`SELECT s.media_id, s.kind, e.air_date FROM segment s LEFT JOIN episode e ON e.segment_id = s.id WHERE s.media_id IN (SELECT id FROM media WHERE type = 'anime')`).all() as {
    media_id: number;
    kind: string;
    air_date: string | null;
  }[];
  const seasons = new Set<number>();
  const last = new Map<number, number>();
  for (const s of segs) {
    if (s.kind === "season" || s.kind === "cour") seasons.add(s.media_id);
    const y = yearOf(s.air_date);
    if (y) last.set(s.media_id, Math.max(last.get(s.media_id) ?? 0, y));
  }
  return rows.map((r) => ({ ...r, originalTitle: r.original_title, standalone: !seasons.has(r.id), lastYear: last.get(r.id) ?? r.year }));
}

/** Plan only: what would be grouped (for Settings and tests). */
export function planFranchiseGroups(db = getDb()): GroupedTitle[] {
  const list = entries(db);
  const byId = new Map(list.map((e) => [e.id, e]));
  return [...franchiseMerges(list)].map(([id, into]) => ({ id, title: byId.get(id)!.title, into: byId.get(into)!.title, intoId: into }));
}

function segmentYear(db: DB, segmentId: number): number | null {
  const r = db.prepare(`SELECT MIN(air_date) d FROM episode WHERE segment_id = ? AND air_date IS NOT NULL AND air_date != 'TBA'`).get(segmentId) as { d: string | null };
  return yearOf(r.d);
}

/** Make room at `position` in a show's list of seasons. */
function openSlot(db: DB, mediaId: number, position: number) {
  db.prepare(`UPDATE segment SET position = position + 1 WHERE media_id = ? AND position >= ?`).run(mediaId, position);
}

/** Where a piece from `year` goes: after the last part of the show that started on or before it. */
function slotFor(db: DB, mediaId: number, year: number | null): number {
  const segs = db.prepare(`SELECT id, position FROM segment WHERE media_id = ? ORDER BY position`).all(mediaId) as { id: number; position: number }[];
  if (year == null) return segs.length ? segs[segs.length - 1].position + 1 : 0;
  let pos = 0;
  for (const s of segs) {
    const y = segmentYear(db, s.id);
    if (y == null || y <= year) pos = s.position + 1;
  }
  return pos;
}

function foldInto(db: DB, hostId: number, e: FranchiseEntry & Row) {
  const review = db.prepare(`SELECT rating, body, watched_on, status, last_watched_at FROM review WHERE media_id = ?`).get(e.id) as
    | { rating: number | null; body: string; watched_on: string | null; status: string | null; last_watched_at: string | null }
    | undefined;
  const now = nowIso();
  const own = db.prepare(`SELECT id, kind, season_number FROM segment WHERE media_id = ? ORDER BY position`).all(e.id) as { id: number; kind: string; season_number: number | null }[];
  let firstSegment: number | null = null;
  if (!e.standalone) {
    // Another season: its seasons become the host's next season numbers.
    const maxSeason = (db.prepare(`SELECT COALESCE(MAX(season_number), 0) n FROM segment WHERE media_id = ? AND kind IN ('season', 'cour')`).get(hostId) as { n: number }).n;
    let n = Math.max(maxSeason + 1, seasonNumberIn(e.title) ?? 0);
    for (const s of own) {
      const pos = slotFor(db, hostId, segmentYear(db, s.id) ?? e.year);
      openSlot(db, hostId, pos);
      const isSeason = s.kind === "season" || s.kind === "cour";
      db.prepare(`UPDATE segment SET media_id = ?, position = ?, season_number = ?, label = ?, updated_at = ? WHERE id = ?`).run(
        hostId,
        pos,
        isSeason ? n : s.season_number,
        isSeason ? defaultSegmentLabel("season", { season: n }) : subtitleOf(e.title),
        now,
        s.id,
      );
      if (isSeason) n++;
      firstSegment ??= s.id;
    }
  } else if (own.length) {
    // A film or OVA that already has its own part (and maybe ratings): move it across.
    for (const s of own) {
      const pos = slotFor(db, hostId, e.year);
      openSlot(db, hostId, pos);
      db.prepare(`UPDATE segment SET media_id = ?, position = ?, label = ?, updated_at = ? WHERE id = ?`).run(hostId, pos, subtitleOf(e.title), now, s.id);
      firstSegment ??= s.id;
    }
  } else {
    // A film with just a rating: it becomes one "Movie" part, watched with that rating.
    const pos = slotFor(db, hostId, e.year);
    openSlot(db, hostId, pos);
    firstSegment = (db
      .prepare(`INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, created_at, updated_at) VALUES (?, 'movie', ?, NULL, NULL, ?, ?, ?) RETURNING id`)
      .get(hostId, subtitleOf(e.title), pos, now, now) as { id: number }).id;
    const ep = (db.prepare(`INSERT INTO episode (segment_id, number, title, air_date) VALUES (?, 1, ?, ?) RETURNING id`).get(firstSegment, e.title, e.year != null ? String(e.year) : null) as { id: number }).id;
    const watched = review && (review.rating != null || review.watched_on || review.status === "completed");
    if (watched) {
      db.prepare(`INSERT INTO episode_assessment (episode_id, state, rating, filler, watched_at, updated_at) VALUES (?, 'watched', ?, 0, ?, ?)`).run(
        ep,
        review!.rating,
        review!.watched_on ?? review!.last_watched_at,
        now,
      );
    }
  }
  // Keep its review text, tags and people on the series.
  if (review?.body.trim()) {
    db.prepare(`UPDATE review SET body = CASE WHEN body = '' THEN ? ELSE body || char(10) || char(10) || ? END WHERE media_id = ?`).run(
      `${e.title}: ${review.body.trim()}`,
      `${e.title}: ${review.body.trim()}`,
      hostId,
    );
  }
  setMediaTags(db, hostId, [...tagsFor(db, hostId), ...tagsFor(db, e.id)]);
  setMediaPeople(db, hostId, [...new Set([...peopleFor(db, hostId), ...peopleFor(db, e.id)].map((p) => p.id))]);
  db.prepare(`INSERT INTO media_alias (media_id, segment_id, imdb_id, tmdb_id, title, year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(hostId, firstSegment, e.imdb_id, e.tmdb_id, e.title, e.year, now);
  db.prepare(`UPDATE media_alias SET media_id = ? WHERE media_id = ?`).run(hostId, e.id);
  db.prepare(`UPDATE import_record SET media_id = ? WHERE media_id = ?`).run(hostId, e.id);
  db.prepare(`DELETE FROM media WHERE id = ?`).run(e.id);
  db.prepare(`UPDATE media SET version = version + 1, updated_at = ? WHERE id = ?`).run(now, hostId);
  audit(db, "group_franchise", "media", hostId, { folded: e.title, id: e.id });
}

const g = globalThis as unknown as { __grouped?: GroupedTitle[] };
export const lastGrouped = () => g.__grouped ?? [];

/** Group every anime that belongs to a series (a backup is taken first). */
export function groupAnimeFranchises(db = getDb()): GroupedTitle[] {
  const list = entries(db);
  const merges = franchiseMerges(list);
  if (!merges.size) return [];
  const byId = new Map(list.map((e) => [e.id, e]));
  snapshotSync(db, process.env.DATABASE_FILE || path.join(dataDir(), "watch.db"), "before-grouping-anime");
  const done: GroupedTitle[] = [];
  db.transaction(() => {
    // Oldest first, so seasons are numbered in order.
    for (const [id, into] of [...merges].sort((a, b) => (byId.get(a[0])!.year ?? 0) - (byId.get(b[0])!.year ?? 0))) {
      const e = byId.get(id)!;
      foldInto(db, into, e);
      done.push({ id, title: e.title, into: byId.get(into)!.title, intoId: into });
    }
  })();
  g.__grouped = [...done, ...(g.__grouped ?? [])].slice(0, 100);
  return done;
}

/** A title folded into a series, found by IMDb id or name and year (for imports). */
export function aliasFor(db: DB, t: { imdbId?: string | null; tmdbId?: number | null; title?: string; year?: number | null }): { mediaId: number; segmentId: number | null } | null {
  const r = (t.imdbId ? db.prepare(`SELECT media_id, segment_id FROM media_alias WHERE imdb_id = ?`).get(t.imdbId) : undefined) ??
    (t.tmdbId ? db.prepare(`SELECT media_id, segment_id FROM media_alias WHERE tmdb_id = ?`).get(t.tmdbId) : undefined) ??
    (t.title ? db.prepare(`SELECT media_id, segment_id FROM media_alias WHERE title = ? COLLATE NOCASE AND (year IS NULL OR ? IS NULL OR abs(year - ?) <= 1)`).get(t.title, t.year ?? null, t.year ?? null) : undefined);
  const row = r as { media_id: number; segment_id: number | null } | undefined;
  return row ? { mediaId: row.media_id, segmentId: row.segment_id } : null;
}
