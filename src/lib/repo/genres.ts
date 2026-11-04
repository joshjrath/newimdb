import { getDb, nowIso, type DB } from "../db";
import { RepoError } from "../errors";
import { matchesGenre, needsKeywords, rulesForCustom, type GenreRules } from "../domain/genres";
import { audit } from "./audit";
import type { GenreRef } from "../domain/types";

export type { GenreRef };

export interface Genre {
  id: number;
  name: string;
  rules: GenreRules;
}
export interface GenreWithCount extends Genre {
  count: number;
  needsKeywords: boolean;
}

const placeholders = (n: number) => Array(n).fill("?").join(",");
const parse = (s: string): GenreRules => {
  try {
    return JSON.parse(s) as GenreRules;
  } catch {
    return {};
  }
};
const clean = (list?: string[]) => (list ?? []).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30);
const cleanRules = (r: GenreRules): GenreRules => ({ genres: clean(r.genres), allGenres: clean(r.allGenres), keywords: clean(r.keywords).map((k) => k.toLowerCase()) });

export function listGenres(db = getDb(), type?: string): GenreWithCount[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.rules, COUNT(m.id) AS count FROM genre g
       LEFT JOIN media_genre mg ON mg.genre_id = g.id AND mg.state != 'excluded'
       LEFT JOIN media m ON m.id = mg.media_id ${type ? "AND m.type = ?" : ""}
       GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
    )
    .all(...(type ? [type] : [])) as { id: number; name: string; rules: string; count: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, rules: parse(r.rules), count: r.count, needsKeywords: needsKeywords(parse(r.rules)) }));
}

function getGenres(db: DB, ids?: number[]): Genre[] {
  const rows = (ids?.length
    ? db.prepare(`SELECT id, name, rules FROM genre WHERE id IN (${placeholders(ids.length)})`).all(...ids)
    : db.prepare(`SELECT id, name, rules FROM genre`).all()) as { id: number; name: string; rules: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, rules: parse(r.rules) }));
}

/**
 * Recompute automatic genres. Your own choices win: a genre you added stays, and one you
 * removed is never re-added. Limit to some genres and/or titles to keep it quick.
 */
export function applyGenres(db = getDb(), opts: { genreIds?: number[]; mediaIds?: number[] } = {}): number {
  const genres = getGenres(db, opts.genreIds);
  if (!genres.length) return 0;
  const media = (opts.mediaIds?.length
    ? db.prepare(`SELECT id, genres, keywords FROM media WHERE id IN (${placeholders(opts.mediaIds.length)})`).all(...opts.mediaIds)
    : db.prepare(`SELECT id, genres, keywords FROM media`).all()) as { id: number; genres: string; keywords: string | null }[];
  const existing = new Map<string, string>();
  const byMedia = opts.mediaIds?.length ? ` AND media_id IN (${placeholders(opts.mediaIds.length)})` : "";
  for (const r of db
    .prepare(`SELECT media_id, genre_id, state FROM media_genre WHERE genre_id IN (${placeholders(genres.length)})${byMedia}`)
    .all(...genres.map((g) => g.id), ...(opts.mediaIds ?? [])) as {
    media_id: number;
    genre_id: number;
    state: string;
  }[])
    existing.set(`${r.media_id}:${r.genre_id}`, r.state);
  const add = db.prepare(`INSERT INTO media_genre (media_id, genre_id, state) VALUES (?, ?, 'auto')`);
  const drop = db.prepare(`DELETE FROM media_genre WHERE media_id = ? AND genre_id = ? AND state = 'auto'`);
  let tagged = 0;
  db.transaction(() => {
    for (const m of media) {
      const titleGenres = parseList(m.genres);
      const keywords = parseList(m.keywords);
      for (const g of genres) {
        const state = existing.get(`${m.id}:${g.id}`);
        if (state === "manual" || state === "excluded") continue;
        const hit = matchesGenre(g.rules, titleGenres, keywords);
        if (hit && !state) {
          add.run(m.id, g.id);
          tagged++;
        } else if (!hit && state === "auto") drop.run(m.id, g.id);
      }
    }
  })();
  return tagged;
}

const parseList = (v: string | null): string[] => {
  try {
    const a = JSON.parse(v ?? "[]");
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

export function createGenre(name: string, rules?: GenreRules, db = getDb()): { genre: Genre; tagged: number } {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!n) throw new RepoError("invalid", "Enter a genre name.");
  if (db.prepare(`SELECT 1 FROM genre WHERE name = ? COLLATE NOCASE`).get(n)) throw new RepoError("conflict", `${n} is already one of your genres.`);
  const r = cleanRules(rules ?? rulesForCustom(n));
  const { id } = db.prepare(`INSERT INTO genre (name, rules, created_at) VALUES (?, ?, ?) RETURNING id`).get(n, JSON.stringify(r), nowIso()) as { id: number };
  const tagged = applyGenres(db, { genreIds: [id] });
  audit(db, "create", "genre", id, { name: n, tagged });
  return { genre: { id, name: n, rules: r }, tagged };
}

export function updateGenre(id: number, patch: { name?: string; rules?: GenreRules }, db = getDb()): { tagged: number } {
  const g = getGenres(db, [id])[0];
  if (!g) throw new RepoError("not_found", "That genre isn't on your list any more.");
  const name = patch.name?.replace(/\s+/g, " ").trim().slice(0, 40) || g.name;
  if (db.prepare(`SELECT 1 FROM genre WHERE name = ? COLLATE NOCASE AND id != ?`).get(name, id)) throw new RepoError("conflict", `${name} is already one of your genres.`);
  db.prepare(`UPDATE genre SET name = ?, rules = ? WHERE id = ?`).run(name, JSON.stringify(cleanRules(patch.rules ?? g.rules)), id);
  return { tagged: applyGenres(db, { genreIds: [id] }) };
}

export function deleteGenre(id: number, db = getDb()) {
  if (!db.prepare(`DELETE FROM genre WHERE id = ?`).run(id).changes) throw new RepoError("not_found", "That genre isn't on your list any more.");
  audit(db, "delete", "genre", id);
}

export function genresForMany(db: DB, mediaIds: number[]): Map<number, GenreRef[]> {
  const out = new Map<number, GenreRef[]>();
  if (!mediaIds.length) return out;
  const rows = db
    .prepare(
      `SELECT mg.media_id, g.id, g.name, mg.state FROM media_genre mg JOIN genre g ON g.id = mg.genre_id
       WHERE mg.state != 'excluded' AND mg.media_id IN (${placeholders(mediaIds.length)}) ORDER BY g.name COLLATE NOCASE`,
    )
    .all(...mediaIds) as { media_id: number; id: number; name: string; state: "auto" | "manual" }[];
  for (const r of rows) out.set(r.media_id, [...(out.get(r.media_id) ?? []), { id: r.id, name: r.name, state: r.state }]);
  return out;
}

/** Your own choice for one title: on (manual) or off (excluded, never auto-added again). */
export function setMediaGenre(db: DB, mediaId: number, genreId: number, on: boolean) {
  db.prepare(
    `INSERT INTO media_genre (media_id, genre_id, state) VALUES (?, ?, ?) ON CONFLICT(media_id, genre_id) DO UPDATE SET state = excluded.state`,
  ).run(mediaId, genreId, on ? "manual" : "excluded");
}

/** Set exactly which of your genres a title has (from the edit page). */
export function setMediaGenres(db: DB, mediaId: number, genreIds: number[]) {
  const want = new Set(genreIds);
  const current = new Set((genresForMany(db, [mediaId]).get(mediaId) ?? []).map((g) => g.id));
  for (const g of getGenres(db)) {
    if (want.has(g.id) && !current.has(g.id)) setMediaGenre(db, mediaId, g.id, true);
    if (!want.has(g.id) && current.has(g.id)) setMediaGenre(db, mediaId, g.id, false);
    if (want.has(g.id) && current.has(g.id)) db.prepare(`UPDATE media_genre SET state = 'manual' WHERE media_id = ? AND genre_id = ? AND state = 'auto'`).run(mediaId, g.id);
  }
}

export const anyKeywordGenres = (db = getDb()) => getGenres(db).some((g) => needsKeywords(g.rules));
