import path from "node:path";
import { dataDir, getDb, snapshotSync, type DB } from "../db";
import { normalizeTitle } from "../domain/text";
import type { MediaType, ReviewSource } from "../domain/types";
import { audit } from "./audit";
import { fillEmptyMetadata, getMedia, metadataOf } from "./media";
import { peopleFor, setMediaPeople } from "./people";
import { setMediaTags, tagsFor } from "./tags";

/**
 * The same film or show imported twice (e.g. once from Letterboxd, once from IMDb).
 * Matched by IMDb or TMDB id, or by the same title and year. Merging keeps one entry,
 * preferring Letterboxd, then your own, then IMDb's, and folds the others into it.
 */

export interface DuplicateGroup {
  keep: { id: number; title: string; year: number | null; source: ReviewSource; rating: number | null };
  remove: { id: number; title: string; year: number | null; source: ReviewSource; rating: number | null }[];
}

const RANK: Record<ReviewSource, number> = { letterboxd: 0, manual: 1, backup: 2, imdb: 3 };

interface Row {
  id: number;
  type: MediaType;
  title: string;
  original_title: string | null;
  year: number | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  letterboxd_url: string | null;
  source: ReviewSource | null;
  rating: number | null;
  body: string | null;
}

/** "Godzilla Minus One", "Godzilla: Minus One" and "Godzilla — Minus One" are one title. */
const key = (t: string | null) => (t ? normalizeTitle(t.replace(/^(the|a|an)\s+/i, "")) : "");

export function findDuplicates(db = getDb()): DuplicateGroup[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.type, m.title, m.original_title, m.year, m.imdb_id, m.tmdb_id, m.letterboxd_url, r.source, r.rating, r.body
       FROM media m LEFT JOIN review r ON r.media_id = m.id ORDER BY m.id`,
    )
    .all() as Row[];
  // Union-find over the ways two entries can be "the same title".
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  // IMDb ids each group already holds: two different IMDb ids are two different titles, whatever the name.
  const imdbOf = new Map(rows.map((r) => [r.id, new Set(r.imdb_id ? [r.imdb_id] : [])]));
  const join = (a: number, b: number, byId = false) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb) return;
    const [ia, ib] = [imdbOf.get(ra)!, imdbOf.get(rb)!];
    if (!byId && ia.size && ib.size && ![...ia].some((x) => ib.has(x))) return;
    parent.set(ra, rb);
    imdbOf.set(rb, new Set([...ia, ...ib]));
  };
  const seen = new Map<string, number>();
  const link = (k: string | null, id: number, byId = false) => {
    if (!k) return;
    const other = seen.get(k);
    if (other != null) join(id, other, byId);
    else seen.set(k, id);
  };
  // A movie can match an anime film, a show can match an anime series, but a movie never matches a show.
  const families: Record<MediaType, string[]> = { movie: ["film"], tv: ["series"], anime: ["film", "series"] };
  for (const r of rows) {
    link(r.imdb_id ? `imdb:${r.imdb_id}` : null, r.id, true);
    // TMDB numbers movies and shows separately, so only compare within the same kind.
    if (r.tmdb_id && r.type !== "anime") link(`tmdb:${r.type}:${r.tmdb_id}`, r.id, true);
    if (r.letterboxd_url) link(`lb:${r.letterboxd_url.replace(/\/+$/, "").toLowerCase()}`, r.id, true);
  }
  // Same name (English or original) and a year at most one apart: Letterboxd and IMDb sometimes
  // disagree on the year by one (festival vs. release). An entry with no year matches a lone namesake.
  const byName = new Map<string, Row[]>();
  for (const r of rows)
    for (const f of families[r.type])
      for (const t of new Set([key(r.title), key(r.original_title)]))
        if (t) byName.set(`${f}:${t}`, [...(byName.get(`${f}:${t}`) ?? []), r]);
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const dated = list.filter((r) => r.year != null);
    for (let i = 0; i < dated.length; i++)
      for (let j = i + 1; j < dated.length; j++) if (Math.abs(dated[i].year! - dated[j].year!) <= 1) join(dated[i].id, dated[j].id);
    const groupsHere = new Set(dated.map((r) => find(r.id)));
    if (groupsHere.size <= 1) for (const r of list) if (r.year == null) join(r.id, (dated[0] ?? list.find((x) => x.id !== r.id))!.id);
  }
  const groups = new Map<number, Row[]>();
  for (const r of rows) groups.set(find(r.id), [...(groups.get(find(r.id)) ?? []), r]);
  const view = (r: Row) => ({ id: r.id, title: r.title, year: r.year, source: (r.source ?? "manual") as ReviewSource, rating: r.rating });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => RANK[(a.source ?? "manual") as ReviewSource] - RANK[(b.source ?? "manual") as ReviewSource] || a.id - b.id);
      return { keep: view(sorted[0]), remove: sorted.slice(1).map(view) };
    });
}

function mergeInto(db: DB, keepId: number, removeId: number) {
  const other = getMedia(removeId, db)!;
  fillEmptyMetadata(keepId, metadataOf(other), db);
  setMediaTags(db, keepId, [...tagsFor(db, keepId), ...tagsFor(db, removeId)]);
  setMediaPeople(db, keepId, [...new Set([...peopleFor(db, keepId), ...peopleFor(db, removeId)].map((p) => p.id))]);
  // The kept review stays; only gaps are filled from the other one.
  db.prepare(
    `UPDATE review SET rating = COALESCE(rating, ?), body = CASE WHEN body = '' THEN ? ELSE body END,
       watched_on = COALESCE(watched_on, ?), last_watched_at = MAX(COALESCE(last_watched_at, ''), COALESCE(?, '')) WHERE media_id = ?`,
  ).run(other.review.rating, other.review.body, other.review.watchedOn, other.review.lastWatchedAt, keepId);
  // Episode ratings live on the other entry's seasons: move them over when the kept one has none.
  const keepHasSeasons = db.prepare(`SELECT 1 FROM segment WHERE media_id = ?`).get(keepId);
  if (!keepHasSeasons) db.prepare(`UPDATE segment SET media_id = ? WHERE media_id = ?`).run(keepId, removeId);
  db.prepare(`UPDATE import_record SET media_id = ? WHERE media_id = ?`).run(keepId, removeId);
  db.prepare(`DELETE FROM media WHERE id = ?`).run(removeId);
  db.prepare(`UPDATE media SET version = version + 1 WHERE id = ?`).run(keepId);
}

/** Merge every duplicate group (a backup is saved first). Returns how many entries were removed. */
export function mergeDuplicates(db = getDb()): { groups: number; removed: number; backup: string | null } {
  const groups = findDuplicates(db);
  if (!groups.length) return { groups: 0, removed: 0, backup: null };
  const backup = snapshotSync(db, process.env.DATABASE_FILE || path.join(dataDir(), "watch.db"), "before-merging-duplicates");
  let removed = 0;
  db.transaction(() => {
    for (const g of groups) for (const r of g.remove) {
      mergeInto(db, g.keep.id, r.id);
      removed++;
    }
    audit(db, "merge_duplicates", "library", null, { groups: groups.length, removed });
  })();
  return { groups: groups.length, removed, backup: backup && path.basename(backup) };
}

/**
 * Runs after every import, on start-up and with the background checks, so the same film or
 * show never stays in the library twice. Letterboxd's review wins, then yours, then IMDb's.
 */
export function autoMergeDuplicates(db = getDb()): number {
  try {
    const r = mergeDuplicates(db);
    if (r.removed) console.log(`[duplicates] merged ${r.removed} duplicate entr${r.removed === 1 ? "y" : "ies"} (backup: ${r.backup ?? "none"})`);
    return r.removed;
  } catch (e) {
    console.error("[duplicates] automatic merge failed:", e);
    return 0;
  }
}
