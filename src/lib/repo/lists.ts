import { getDb, nowIso, type DB } from "../db";
import { RepoError } from "../errors";
import { audit } from "./audit";

/**
 * Your own lists: any mix of movies, shows and anime (an MCU list, "Comfort shows"…),
 * in your own order or sorted by release, when you watched, rating or title. A list's
 * progress counts each movie as watched or not, and each show by how much of it you've seen.
 */

import { LIST_SORTS, type ListItemView, type ListSort, type ListSummary } from "../domain/lists";
export { LIST_SORTS, type ListItemView, type ListSort, type ListSummary };

const UNAIRED = `(COALESCE(a.state, 'unwatched') = 'unwatched' AND a.rating IS NULL AND (
    e.air_date = 'TBA'
    OR (length(e.air_date) = 4 AND CAST(e.air_date AS INTEGER) >= CAST(strftime('%Y', 'now') AS INTEGER))
    OR (length(e.air_date) >= 10 AND substr(e.air_date, 1, 10) > date('now'))))`;

const ORDER: Record<ListSort, (a: ListItemView, b: ListItemView) => number> = {
  manual: (a, b) => a.position - b.position,
  release: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.position - b.position,
  watched: (a, b) => (a.watchedOn ?? "9999").localeCompare(b.watchedOn ?? "9999") || a.position - b.position,
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.position - b.position,
  title: (a, b) => a.title.localeCompare(b.title),
  added: (a, b) => b.position - a.position,
};

function items(db: DB, listId: number): ListItemView[] {
  const rows = db
    .prepare(
      `SELECT li.media_id AS mediaId, li.position, m.type, m.title, m.year, m.poster_url AS posterUrl, r.rating, r.status,
              COALESCE(r.watched_on, r.last_watched_at) AS watchedOn, r.watched_on AS watchedDate,
              (SELECT SUM(a.state = 'watched') FROM segment s JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id WHERE s.media_id = m.id) AS watched,
              (SELECT COUNT(e.id) - SUM(COALESCE(a.state, '') = 'skipped') - SUM(${UNAIRED}) FROM segment s JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id WHERE s.media_id = m.id) AS total
       FROM list_item li JOIN media m ON m.id = li.media_id LEFT JOIN review r ON r.media_id = m.id WHERE li.list_id = ?`,
    )
    .all(listId) as (Omit<ListItemView, "done"> & { watched: number | null; total: number | null; watchedDate: string | null })[];
  return rows.map(({ watchedDate, ...r }) => {
    const movieDone = r.rating != null || r.status === "completed" || Boolean(watchedDate);
    const done = r.type === "movie" || !r.total ? (movieDone ? 1 : 0) : Math.min(1, (r.watched ?? 0) / r.total);
    return { ...r, watched: r.watched ?? 0, total: r.total ?? 0, done };
  });
}

const summaryOf = (l: { id: number; name: string; description: string; sort: ListSort; updated_at: string }, its: ListItemView[]): ListSummary => ({
  id: l.id,
  name: l.name,
  description: l.description,
  sort: l.sort,
  count: its.length,
  percent: its.length ? Math.round((its.reduce((a, i) => a + i.done, 0) / its.length) * 1000) / 10 : 0,
  finished: its.filter((i) => i.done >= 1).length,
  posters: [...its].sort(ORDER[l.sort]).slice(0, 4).map((i) => i.posterUrl),
  updatedAt: l.updated_at,
});

export function listLists(db = getDb()): ListSummary[] {
  const ls = db.prepare(`SELECT id, name, description, sort, updated_at FROM list ORDER BY updated_at DESC`).all() as { id: number; name: string; description: string; sort: ListSort; updated_at: string }[];
  return ls.map((l) => summaryOf(l, items(db, l.id)));
}

export function getList(id: number, db = getDb()): (ListSummary & { items: ListItemView[] }) | null {
  const l = db.prepare(`SELECT id, name, description, sort, updated_at FROM list WHERE id = ?`).get(id) as { id: number; name: string; description: string; sort: ListSort; updated_at: string } | undefined;
  if (!l) return null;
  const its = items(db, id).sort(ORDER[l.sort]);
  return { ...summaryOf(l, its), items: its };
}

const requireList = (db: DB, id: number) => {
  if (!db.prepare(`SELECT 1 FROM list WHERE id = ?`).get(id)) throw new RepoError("not_found", "That list no longer exists.");
};
const touch = (db: DB, id: number) => db.prepare(`UPDATE list SET updated_at = ? WHERE id = ?`).run(nowIso(), id);

export function createList(input: { name: string; description?: string; sort?: ListSort; mediaIds?: number[] }, db = getDb()): number {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new RepoError("invalid", "Give the list a name.");
  const now = nowIso();
  const { id } = db.prepare(`INSERT INTO list (name, description, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id`).get(name, input.description?.trim() ?? "", input.sort ?? "manual", now, now) as { id: number };
  if (input.mediaIds?.length) addToList(id, input.mediaIds, db);
  audit(db, "create", "list", id, { name });
  return id;
}

export function updateList(id: number, patch: { name?: string; description?: string; sort?: ListSort }, db = getDb()) {
  requireList(db, id);
  if (patch.name !== undefined) {
    const n = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!n) throw new RepoError("invalid", "Give the list a name.");
    db.prepare(`UPDATE list SET name = ? WHERE id = ?`).run(n, id);
  }
  if (patch.description !== undefined) db.prepare(`UPDATE list SET description = ? WHERE id = ?`).run(patch.description.trim().slice(0, 2000), id);
  if (patch.sort) db.prepare(`UPDATE list SET sort = ? WHERE id = ?`).run(patch.sort, id);
  touch(db, id);
}

export function deleteList(id: number, db = getDb()) {
  requireList(db, id);
  db.prepare(`DELETE FROM list WHERE id = ?`).run(id);
  audit(db, "delete", "list", id);
}

/** Adds to the end, skipping titles already on the list. Returns how many were added. */
export function addToList(id: number, mediaIds: number[], db = getDb()): number {
  requireList(db, id);
  let pos = (db.prepare(`SELECT COALESCE(MAX(position), 0) n FROM list_item WHERE list_id = ?`).get(id) as { n: number }).n;
  const ins = db.prepare(`INSERT OR IGNORE INTO list_item (list_id, media_id, position, added_at) SELECT ?, id, ?, ? FROM media WHERE id = ?`);
  let added = 0;
  db.transaction(() => {
    for (const m of mediaIds) added += ins.run(id, ++pos, nowIso(), m).changes;
    touch(db, id);
  })();
  return added;
}

export function removeFromList(id: number, mediaIds: number[], db = getDb()): number {
  requireList(db, id);
  const n = db.prepare(`DELETE FROM list_item WHERE list_id = ? AND media_id IN (${mediaIds.map(() => "?").join(",")})`).run(id, ...mediaIds).changes;
  touch(db, id);
  return n;
}

/** Your own order: the ids in the order you want them (switches the list to "My order"). */
export function reorderList(id: number, mediaIds: number[], db = getDb()) {
  requireList(db, id);
  const set = db.prepare(`UPDATE list_item SET position = ? WHERE list_id = ? AND media_id = ?`);
  db.transaction(() => {
    mediaIds.forEach((m, i) => set.run(i + 1, id, m));
    db.prepare(`UPDATE list SET sort = 'manual' WHERE id = ?`).run(id);
    touch(db, id);
  })();
}

/** Which of your lists a title is on (for the "Add to list" menu). */
export function listsFor(mediaId: number, db = getDb()): number[] {
  return (db.prepare(`SELECT list_id FROM list_item WHERE media_id = ?`).all(mediaId) as { list_id: number }[]).map((r) => r.list_id);
}
