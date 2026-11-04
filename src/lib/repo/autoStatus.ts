import { getDb, nowIso, type DB } from "../db";
import { returningSeason } from "../domain/progress";
import type { SegmentView, WatchStatus } from "../domain/types";
import { audit } from "./audit";
import { getSegments } from "./media";

/**
 * Status follows your progress, for shows and anime:
 *  - 100% watched (of what's out) → Completed
 *  - 1–99% → Currently watching
 *  - nothing watched for 30 days → On hold; for 90 days → Dropped
 *  - nothing watched yet → left as it is (Plan to watch, or no status)
 * A show you finished that has a new season stays Completed until you start it, so it
 * stays in "New seasons". If you pick a status yourself, it holds until you next watch
 * an episode of that show.
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
  status: string | null;
  status_manual_at: string | null;
  total: number;
  watched: number;
  skipped: number;
  unaired: number;
  last_activity: string | null;
}

export function applyAutoStatus(db = getDb(), opts: { mediaIds?: number[]; segmentsOf?: (id: number) => SegmentView[] } = {}): number {
  const only = opts.mediaIds?.length ? `AND m.id IN (${opts.mediaIds.map(() => "?").join(",")})` : "";
  const rows = db
    .prepare(
      `SELECT m.id, r.status, r.status_manual_at,
              COUNT(e.id) AS total,
              SUM(a.state = 'watched') AS watched,
              SUM(COALESCE(a.state, '') = 'skipped') AS skipped,
              SUM(COALESCE(a.state, 'unwatched') = 'unwatched' AND a.rating IS NULL AND (
                e.air_date = 'TBA'
                OR (length(e.air_date) = 4 AND CAST(e.air_date AS INTEGER) >= CAST(strftime('%Y', 'now') AS INTEGER))
                OR (length(e.air_date) >= 10 AND substr(e.air_date, 1, 10) > date('now')))) AS unaired,
              MAX(CASE WHEN a.state = 'watched' OR a.rating IS NOT NULL THEN COALESCE(a.watched_at, a.updated_at) END) AS last_activity
       FROM media m LEFT JOIN review r ON r.media_id = m.id
       JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE m.type IN ('tv', 'anime') ${only}
       GROUP BY m.id`,
    )
    .all(...(opts.mediaIds ?? [])) as Row[];
  const segmentsOf = opts.segmentsOf ?? ((id: number) => getSegments(id, db, { overview: false }));
  const set = db.prepare(`INSERT INTO review (media_id, status, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`);
  let changed = 0;
  const moves: { id: number; from: string | null; to: string }[] = [];
  db.transaction(() => {
    for (const r of rows) {
      if (!r.watched) continue;
      // Your own pick holds until you watch something newer.
      if (r.status_manual_at && (!r.last_activity || r.status_manual_at >= r.last_activity)) continue;
      const denominator = r.total - r.skipped - r.unaired;
      const finishedish = denominator > 0 && r.watched < denominator;
      const returning = finishedish && r.status === "completed" ? Boolean(returningSeason(segmentsOf(r.id))) : false;
      const want = statusFor({ watched: r.watched, denominator, lastActivity: r.last_activity, returning });
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
