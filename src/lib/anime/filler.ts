import { getDb, nowIso, type DB } from "../db";
import { allEpisodes } from "../domain/progress";
import { getSegments } from "../repo/media";
import { audit } from "../repo/audit";
import { fillerEpisodes, fillerShowIndex, findSlug, type EpisodeKind } from "../providers/animefiller";

/**
 * Marks filler on your anime from animefillerlist.com, in the background. Each episode
 * is marked once: if you un-mark one, it stays un-marked. Only regular seasons and cours
 * are matched (films/OVAs don't have numbers there), in your story order.
 */

interface Note {
  slug: string | null;
  upto: number;
  filler?: number;
  error?: string;
}

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

function readNote(db: DB, mediaId: number): Note | null {
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

/** Check anime that are due (never checked, or a week ago). Runs a few at a time. */
export async function runFillerCheck(db = getDb(), limit = 10): Promise<{ checked: number; marked: number }> {
  if (g.__fillerRunning) return { checked: 0, marked: 0 };
  g.__fillerRunning = true;
  const out = { checked: 0, marked: 0 };
  try {
    const due = db
      .prepare(
        `SELECT m.id, m.title, m.original_title FROM media m WHERE m.type = 'anime'
           AND EXISTS (SELECT 1 FROM segment s WHERE s.media_id = m.id AND s.kind IN ('season', 'cour'))
           AND (m.filler_checked_at IS NULL OR m.filler_checked_at < ?)
         ORDER BY m.filler_checked_at IS NOT NULL, m.filler_checked_at LIMIT ?`,
      )
      .all(new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString(), limit) as { id: number; title: string; original_title: string | null }[];
    if (!due.length) return out;
    const index = await fillerShowIndex();
    for (const a of due) {
      const slug = findSlug(index, [a.title, a.original_title]);
      out.checked++;
      if (!slug) {
        writeNote(db, a.id, { slug: null, upto: 0 }); // not a show animefillerlist covers (most short anime aren't)
        continue;
      }
      try {
        out.marked += applyFillerList(db, a.id, slug, await fillerEpisodes(slug));
      } catch (e) {
        writeNote(db, a.id, { slug, upto: readNote(db, a.id)?.upto ?? 0, error: (e as Error).message });
      }
      await sleep(2000); // be gentle with a small site
    }
  } finally {
    g.__fillerRunning = false;
  }
  return out;
}
