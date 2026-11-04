import { getDb, nowIso, type DB } from "../db";
import { allEpisodes, hasAired, returningSeason } from "../domain/progress";
import type { EpisodeView, SegmentView, WatchStatus } from "../domain/types";
import { audit } from "./audit";
import { getSegments } from "./media";

/**
 * Status follows your progress, for shows and anime:
 *  - 100% watched (of what's out) → Completed
 *  - 1–99% → Currently watching
 *  - nothing watched for 30 days → On hold; for 90 days → Dropped
 *  - nothing watched yet → left as it is (Plan to watch, or no status)
 * "Out" means aired: episodes that aren't out yet (or have no date and nothing after them
 * has aired) never count against you, and specials/OVAs/films are extras. When a show you
 * finished gets a new episode or season, it goes back to Currently watching (the new
 * episode's air date counts as activity, so the 30/90-day clock starts then). If you pick a status
 * yourself, it holds until you next watch an episode of that show. The inactivity clock
 * counts from when automatic status started, not from old import dates.
 */

export const ON_HOLD_DAYS = 30;
export const DROPPED_DAYS = 90;

export function statusFor(p: { watched: number; denominator: number; lastActivity: string | null; returning: boolean }, now = Date.now()): WatchStatus | null {
  if (p.watched === 0) return null;
  if (p.returning || (p.denominator > 0 && p.watched >= p.denominator)) return "completed";
  const days = p.lastActivity ? (now - Date.parse(p.lastActivity)) / 86_400_000 : 0;
  if (days >= DROPPED_DAYS) return "dropped";
  if (days >= ON_HOLD_DAYS) return "on_hold";
  return "watching";
}

interface Row {
  id: number;
  type: string;
  status: string | null;
  status_manual_at: string | null;
  watched: number;
  last_activity: string | null;
}

const CLOCK = "status-clock-start";

/**
 * The inactivity clock started when automatic status arrived (and was reset once), so
 * nothing is "untouched for 90 days" just because it was imported or rated long ago.
 */
export function statusClockStart(db = getDb()): string {
  const row = db.prepare(`SELECT at FROM app_flag WHERE key = ?`).get(CLOCK) as { at: string } | undefined;
  if (row) return row.at;
  const now = nowIso();
  db.prepare(`INSERT INTO app_flag (key, at) VALUES (?, ?)`).run(CLOCK, now);
  return now;
}

const knownAired = (e: EpisodeView) => Boolean(e.airDate) && hasAired(e.airDate, undefined);

/**
 * Is there anything out that you haven't watched? Only regular seasons and cours count
 * (specials, OVAs and films are extras). An episode with no date counts as out only when
 * a later one is known to have aired (or you've watched one after it); otherwise it's an
 * announced episode that isn't out yet. (A show with no dates at all counts everything.)
 */
export function hasUnwatchedAired(segments: SegmentView[], opts: { ignoreFiller?: boolean } = {}): boolean {
  const eps = allEpisodes(segments.filter((s) => s.kind === "season" || s.kind === "cour"));
  // A show with no dates at all (added by hand): every listed episode counts as out.
  let laterProof = !eps.some((e) => e.airDate);
  for (let i = eps.length - 1; i >= 0; i--) {
    const e = eps[i];
    const unwatched = e.state === "unwatched" && e.rating == null && !(opts.ignoreFiller && e.filler);
    if (unwatched && (knownAired(e) || (!e.airDate && laterProof))) return true;
    if (knownAired(e) || e.state === "watched") laterProof = true;
  }
  return false;
}

/**
 * Undated episodes after the last one known to have aired are announced ones, not out:
 * mark them TBA so progress bars agree (only in shows that have dates at all).
 */
function markUndatedUpcoming(db: DB, segments: SegmentView[]) {
  const eps = allEpisodes(segments.filter((s) => s.kind === "season" || s.kind === "cour"));
  if (!eps.some((e) => e.airDate)) return;
  const ids: number[] = [];
  for (let i = eps.length - 1; i >= 0; i--) {
    const e = eps[i];
    if (knownAired(e) || e.state !== "unwatched" || e.rating != null) break;
    if (!e.airDate) ids.push(e.id);
  }
  if (ids.length) db.prepare(`UPDATE episode SET air_date = 'TBA' WHERE air_date IS NULL AND id IN (${ids.map(() => "?").join(",")})`).run(...ids);
}

/** The air date of the newest out-but-unwatched episode, if it has a real date. */
function newestUnwatchedAired(segments: SegmentView[], ignoreFiller: boolean): string | null {
  let newest: string | null = null;
  for (const e of allEpisodes(segments.filter((s) => s.kind === "season" || s.kind === "cour"))) {
    if (e.state !== "unwatched" || e.rating != null || (ignoreFiller && e.filler) || !e.airDate || !/^\d{4}-\d{2}-\d{2}/.test(e.airDate) || !hasAired(e.airDate)) continue;
    const d = `${e.airDate.slice(0, 10)}T12:00:00.000Z`;
    if (!newest || d > newest) newest = d;
  }
  return newest;
}

export function applyAutoStatus(db = getDb(), opts: { mediaIds?: number[]; segmentsOf?: (id: number) => SegmentView[] } = {}): number {
  const only = opts.mediaIds?.length ? `AND m.id IN (${opts.mediaIds.map(() => "?").join(",")})` : "";
  const clock = statusClockStart(db);
  const rows = db
    .prepare(
      `SELECT m.id, m.type, r.status, r.status_manual_at, SUM(a.state = 'watched') AS watched,
              MAX(CASE WHEN a.state = 'watched' OR a.rating IS NOT NULL THEN COALESCE(a.watched_at, a.updated_at) END) AS last_activity
       FROM media m LEFT JOIN review r ON r.media_id = m.id
       JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE m.type IN ('tv', 'anime') ${only}
       GROUP BY m.id HAVING watched > 0`,
    )
    .all(...(opts.mediaIds ?? [])) as Row[];
  const segmentsOf = opts.segmentsOf ?? ((id: number) => getSegments(id, db, { overview: false }));
  const set = db.prepare(`INSERT INTO review (media_id, status, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`);
  let changed = 0;
  const moves: { id: number; from: string | null; to: string }[] = [];
  db.transaction(() => {
    for (const r of rows) {
      const segs = segmentsOf(r.id);
      markUndatedUpcoming(db, segs);
      const caughtUp = !hasUnwatchedAired(segs, { ignoreFiller: r.type === "anime" });
      // 100% is always Completed, whatever was picked before.
      if (caughtUp && r.status !== "completed") {
        set.run(r.id, "completed", nowIso(), nowIso());
        moves.push({ id: r.id, from: r.status, to: "completed" });
        changed++;
        continue;
      }
      // Otherwise your own pick holds until you watch something newer.
      if (r.status_manual_at && (!r.last_activity || r.status_manual_at > r.last_activity)) continue;
      // A new episode coming out counts as activity: a finished show with something new is
      // back to Currently watching (not straight to On hold because you finished it long ago).
      const newest = caughtUp ? null : newestUnwatchedAired(segs, r.type === "anime");
      const lastActivity = [r.last_activity, clock, newest].filter((x): x is string => Boolean(x)).sort().pop() ?? clock;
      const returning = false;
      // Finished everything, and a new season came out that you haven't started: that's
      // between seasons, not abandoned. It stays Currently watching however long it waits.
      const between = !caughtUp && returningSeason(segs, undefined, { ignoreFiller: r.type === "anime" })?.state === "out";
      const want = between ? "watching" : statusFor({ watched: r.watched, denominator: caughtUp ? r.watched : r.watched + 1, lastActivity, returning });
      if (!want || want === r.status) continue;
      set.run(r.id, want, nowIso(), nowIso());
      moves.push({ id: r.id, from: r.status, to: want });
      changed++;
    }
    if (moves.length) audit(db, "auto_status", "media", moves.length === 1 ? moves[0].id : null, { moves: moves.slice(0, 200) });
  })();
  return changed;
}

/** Called when you set a status yourself. */
export function markStatusManual(db: DB, mediaId: number) {
  db.prepare(`UPDATE review SET status_manual_at = ? WHERE media_id = ?`).run(nowIso(), mediaId);
}

const STALE_FLAG = "one-time-drop-6-months";

/**
 * Once: every show you started but haven't touched in 6 months (and isn't finished) is
 * set to Dropped. It counts as your own choice, so automatic status leaves it there until
 * you watch an episode of it again.
 */
export function dropStaleOnce(db = getDb(), now = Date.now()): number {
  if (db.prepare(`SELECT 1 FROM app_flag WHERE key = ?`).get(STALE_FLAG)) return 0;
  const cutoff = new Date(now - 182 * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT m.id, m.type, r.status,
              MAX(CASE WHEN a.state = 'watched' OR a.rating IS NOT NULL THEN COALESCE(a.watched_at, a.updated_at) END) AS last
       FROM media m LEFT JOIN review r ON r.media_id = m.id
       JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE m.type IN ('tv', 'anime') GROUP BY m.id HAVING last IS NOT NULL AND last < ?`,
    )
    .all(cutoff) as { id: number; type: string; status: string | null; last: string }[];
  const dropped: number[] = [];
  db.transaction(() => {
    for (const r of rows) {
      if (r.status === "dropped" || r.status === "completed") continue;
      const segs = getSegments(r.id, db, { overview: false });
      if (!hasUnwatchedAired(segs, { ignoreFiller: r.type === "anime" })) continue; // finished what's out
      if (returningSeason(segs, undefined, { ignoreFiller: r.type === "anime" })) continue; // finished, just waiting on / not started a new season
      db.prepare(
        `INSERT INTO review (media_id, status, status_manual_at, created_at, updated_at) VALUES (?, 'dropped', ?, ?, ?)
         ON CONFLICT(media_id) DO UPDATE SET status = 'dropped', status_manual_at = excluded.status_manual_at, updated_at = excluded.updated_at`,
      ).run(r.id, nowIso(), nowIso(), nowIso());
      dropped.push(r.id);
    }
    db.prepare(`INSERT INTO app_flag (key, at, detail) VALUES (?, ?, ?)`).run(STALE_FLAG, nowIso(), JSON.stringify({ dropped: dropped.length }));
    if (dropped.length) audit(db, "drop_stale_once", "library", null, { dropped: dropped.length, ids: dropped.slice(0, 500) });
  })();
  return dropped.length;
}

const UNDO_FLAG = "undo-drop-between-seasons";

/**
 * Once: the 6-month tidy-up also dropped some shows you'd actually finished, where only a
 * newer season was unwatched. Those go back to Currently watching.
 */
export function undoBetweenSeasonDrops(db = getDb()): number {
  if (db.prepare(`SELECT 1 FROM app_flag WHERE key = ?`).get(UNDO_FLAG)) return 0;
  // The shows that tidy-up dropped: set to Dropped by it, at the moment it ran.
  const ran = (db.prepare(`SELECT at FROM app_flag WHERE key = ?`).get(STALE_FLAG) as { at: string } | undefined)?.at;
  const ids = new Set<number>();
  if (ran) {
    const from = new Date(Date.parse(ran) - 5 * 60_000).toISOString();
    for (const r of db.prepare(`SELECT media_id FROM review WHERE status = 'dropped' AND status_manual_at BETWEEN ? AND ?`).all(from, ran) as { media_id: number }[]) ids.add(r.media_id);
  }
  let restored = 0;
  db.transaction(() => {
    for (const id of ids) {
      const m = db.prepare(`SELECT m.type, r.status FROM media m JOIN review r ON r.media_id = m.id WHERE m.id = ?`).get(id) as { type: string; status: string | null } | undefined;
      if (!m || m.status !== "dropped") continue;
      if (!returningSeason(getSegments(id, db, { overview: false }), undefined, { ignoreFiller: m.type === "anime" })) continue;
      db.prepare(`UPDATE review SET status = 'watching', status_manual_at = NULL, updated_at = ? WHERE media_id = ?`).run(nowIso(), id);
      restored++;
    }
    db.prepare(`INSERT INTO app_flag (key, at, detail) VALUES (?, ?, ?)`).run(UNDO_FLAG, nowIso(), JSON.stringify({ restored }));
    if (restored) audit(db, "undo_drop_between_seasons", "library", null, { restored });
  })();
  return restored;
}
