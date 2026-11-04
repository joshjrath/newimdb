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
 * has aired) never count against you, and specials/OVAs/films are extras. A show you
 * finished that has a new season stays Completed until you start it. If you pick a status
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
      // Your own pick holds until you watch something newer.
      if (r.status_manual_at && (!r.last_activity || r.status_manual_at >= r.last_activity)) continue;
      const segs = segmentsOf(r.id);
      markUndatedUpcoming(db, segs);
      const caughtUp = !hasUnwatchedAired(segs, { ignoreFiller: r.type === "anime" });
      const returning = !caughtUp && Boolean(returningSeason(segs));
      const lastActivity = !r.last_activity || r.last_activity < clock ? clock : r.last_activity;
      const want = statusFor({ watched: r.watched, denominator: caughtUp ? r.watched : r.watched + 1, lastActivity, returning });
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
