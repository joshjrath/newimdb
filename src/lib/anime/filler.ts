import { getDb, nowIso, type DB } from "../db";
import { allEpisodes } from "../domain/progress";
import { getSegments } from "../repo/media";
import { audit } from "../repo/audit";
import { fillerEpisodes, fillerShowIndex, findSlug, slugFrom, type EpisodeKind } from "../providers/animefiller";

/**
 * Marks filler on your anime from animefillerlist.com, in the background. Each episode
 * is marked once: if you un-mark one, it stays un-marked. Only regular seasons and cours
 * are matched (films/OVAs don't have numbers there), in your story order.
 */

export interface FillerNote {
  slug: string | null;
  upto: number;
  filler?: number;
  error?: string;
  /** You pointed it at a specific animefillerlist page. */
  manual?: boolean;
}
type Note = FillerNote;

const RECHECK_DAYS = 7;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const g = globalThis as unknown as { __fillerRunning?: boolean };

/** Apply a filler list to one show. Returns how many episodes were newly marked. */
export function applyFillerList(db: DB, mediaId: number, slug: string, kinds: Map<number, EpisodeKind>): number {
  const prev = readNote(db, mediaId);
  const upto = prev?.slug === slug ? prev.upto : 0;
  const eps = allEpisodes(getSegments(mediaId, db, { overview: false }).filter((s) => s.kind === "season" || s.kind === "cour"));
  // Sanity check: the numbering should be about the same length as yours.
  const theirMax = Math.max(0, ...kinds.keys());
  if (!theirMax || theirMax < eps.length * 0.5 || theirMax > eps.length * 2.5) {
    writeNote(db, mediaId, { slug, upto, error: `animefillerlist has ${theirMax} episodes; you have ${eps.length}, so it wasn't applied.` });
    return 0;
  }
  const mark = db.prepare(
    `INSERT INTO episode_assessment (episode_id, state, filler, updated_at) VALUES (?, 'unwatched', 1, ?) ON CONFLICT(episode_id) DO UPDATE SET filler = 1`,
  );
  let marked = 0;
  let last = upto;
  db.transaction(() => {
    eps.forEach((e, i) => {
      const n = i + 1;
      if (n <= upto || !kinds.has(n)) return;
      last = Math.max(last, n);
      if (kinds.get(n) === "filler" && !e.filler) {
        mark.run(e.id, nowIso());
        marked++;
      }
    });
    writeNote(db, mediaId, { slug, upto: last, filler: (prev?.filler ?? 0) + marked });
    if (marked) audit(db, "mark_filler", "media", mediaId, { slug, marked });
  })();
  return marked;
}

export function readNote(db: DB, mediaId: number): Note | null {
  const r = db.prepare(`SELECT filler_note FROM media WHERE id = ?`).get(mediaId) as { filler_note: string | null } | undefined;
  try {
    return r?.filler_note ? (JSON.parse(r.filler_note) as Note) : null;
  } catch {
    return null;
  }
}
function writeNote(db: DB, mediaId: number, note: Note) {
  db.prepare(`UPDATE media SET filler_note = ?, filler_checked_at = ? WHERE id = ?`).run(JSON.stringify(note), nowIso(), mediaId);
}

/**
 * Check one anime now. Uses the page you chose if you set one, otherwise finds it by name
 * (or by its obvious address when the site's index can't be read).
 */
export async function checkFillerFor(mediaId: number, opts: { slug?: string } = {}, db = getDb()): Promise<{ note: FillerNote | null; marked: number }> {
  const m = db.prepare(`SELECT title, original_title FROM media WHERE id = ?`).get(mediaId) as { title: string; original_title: string | null } | undefined;
  if (!m) return { note: null, marked: 0 };
  const prev = readNote(db, mediaId);
  let slug = opts.slug ?? (prev?.manual ? prev.slug : null);
  const manual = Boolean(opts.slug ?? prev?.manual);
  if (!slug) {
    try {
      slug = findSlug(await fillerShowIndex(), [m.title, m.original_title]);
    } catch {
      slug = null; // index unreachable: fall back to the address the name suggests
    }
    slug ??= slugFrom(m.title);
  }
  if (!slug) {
    writeNote(db, mediaId, { slug: null, upto: 0 });
    return { note: readNote(db, mediaId), marked: 0 };
  }
  try {
    const kinds = await fillerEpisodes(slug);
    if (!kinds.size) {
      writeNote(db, mediaId, { slug: null, upto: 0, error: `animefillerlist.com has no episode list at /shows/${slug}.`, manual });
      return { note: readNote(db, mediaId), marked: 0 };
    }
    const marked = applyFillerList(db, mediaId, slug, kinds);
    if (manual) writeNote(db, mediaId, { ...readNote(db, mediaId)!, manual: true });
    return { note: readNote(db, mediaId), marked };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const why =
      status === 404
        ? `animefillerlist.com has no page at /shows/${slug}. Paste the show's page from the site.`
        : status === 403 || status === 503
          ? "animefillerlist.com refused the request. You can still mark filler yourself: select the episodes, then Filler."
          : (e as Error).message;
    writeNote(db, mediaId, { slug: status === 404 ? null : slug, upto: prev?.slug === slug ? prev.upto : 0, error: why, manual });
    return { note: readNote(db, mediaId), marked: 0 };
  }
}

/** Check anime that are due (never checked, or a week ago). Runs a few at a time. */
export async function runFillerCheck(db = getDb(), limit = 10): Promise<{ checked: number; marked: number }> {
  if (g.__fillerRunning) return { checked: 0, marked: 0 };
  g.__fillerRunning = true;
  const out = { checked: 0, marked: 0 };
  try {
    const due = db
      .prepare(
        `SELECT m.id FROM media m WHERE m.type = 'anime'
           AND EXISTS (SELECT 1 FROM segment s WHERE s.media_id = m.id AND s.kind IN ('season', 'cour'))
           AND (m.filler_checked_at IS NULL OR m.filler_checked_at < ?)
         ORDER BY m.filler_checked_at IS NOT NULL, m.filler_checked_at LIMIT ?`,
      )
      .all(new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString(), limit) as { id: number }[];
    for (const a of due) {
      out.checked++;
      out.marked += (await checkFillerFor(a.id, {}, db)).marked;
      await sleep(2000); // be gentle with a small site
    }
  } finally {
    g.__fillerRunning = false;
  }
  return out;
}
