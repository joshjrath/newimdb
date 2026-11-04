import { getDb, nowIso, type DB } from "../db";
import { RepoError } from "../errors";
import type { PersonRef } from "../domain/types";
import { audit } from "./audit";

/**
 * People you watched things with. Managed in Settings, attached to any number of titles,
 * any number per title. Deleting a person only removes them from titles, never the titles.
 */

const placeholders = (n: number) => Array(n).fill("?").join(",");
const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 60);

export interface PersonWithCount extends PersonRef {
  count: number;
}

export function listPeople(db = getDb(), type?: string): PersonWithCount[] {
  return db
    .prepare(
      `SELECT p.id, p.name, COUNT(m.id) AS count FROM person p
       LEFT JOIN media_person mp ON mp.person_id = p.id
       LEFT JOIN media m ON m.id = mp.media_id ${type ? "AND m.type = ?" : ""}
       GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
    )
    .all(...(type ? [type] : [])) as PersonWithCount[];
}

export function createPerson(name: string, db = getDb()): PersonRef {
  const n = cleanName(name);
  if (!n) throw new RepoError("invalid", "Enter a name.");
  const existing = db.prepare(`SELECT id, name FROM person WHERE name = ? COLLATE NOCASE`).get(n) as PersonRef | undefined;
  if (existing) throw new RepoError("conflict", `${existing.name} is already on your list.`, { existingId: existing.id });
  const p = db.prepare(`INSERT INTO person (name, created_at) VALUES (?, ?) RETURNING id, name`).get(n, nowIso()) as PersonRef;
  audit(db, "create", "person", p.id, { name: n });
  return p;
}

/** For backup restore: reuse a person with this name, or add them. */
export function personIdForName(name: string, db = getDb()): number | null {
  const n = cleanName(name);
  if (!n) return null;
  const row = db.prepare(`SELECT id FROM person WHERE name = ? COLLATE NOCASE`).get(n) as { id: number } | undefined;
  return row?.id ?? (db.prepare(`INSERT INTO person (name, created_at) VALUES (?, ?) RETURNING id`).get(n, nowIso()) as { id: number }).id;
}

export function renamePerson(id: number, name: string, db = getDb()): PersonRef {
  const n = cleanName(name);
  if (!n) throw new RepoError("invalid", "Enter a name.");
  const clash = db.prepare(`SELECT id, name FROM person WHERE name = ? COLLATE NOCASE AND id != ?`).get(n, id) as PersonRef | undefined;
  if (clash) throw new RepoError("conflict", `${clash.name} is already on your list.`);
  const p = db.prepare(`UPDATE person SET name = ? WHERE id = ? RETURNING id, name`).get(n, id) as PersonRef | undefined;
  if (!p) throw new RepoError("not_found", "That person isn't on your list any more.");
  audit(db, "rename", "person", id, { name: n });
  return p;
}

export function deletePerson(id: number, db = getDb()): number {
  const titles = (db.prepare(`SELECT COUNT(*) n FROM media_person WHERE person_id = ?`).get(id) as { n: number }).n;
  if (!db.prepare(`DELETE FROM person WHERE id = ?`).run(id).changes) throw new RepoError("not_found", "That person isn't on your list any more.");
  audit(db, "delete", "person", id, { titles });
  return titles;
}

/** People for many titles in one query. */
export function peopleForMany(db: DB, mediaIds: number[]): Map<number, PersonRef[]> {
  const out = new Map<number, PersonRef[]>();
  if (!mediaIds.length) return out;
  const rows = db
    .prepare(
      `SELECT mp.media_id, p.id, p.name FROM media_person mp JOIN person p ON p.id = mp.person_id
       WHERE mp.media_id IN (${placeholders(mediaIds.length)}) ORDER BY p.name COLLATE NOCASE`,
    )
    .all(...mediaIds) as { media_id: number; id: number; name: string }[];
  for (const r of rows) out.set(r.media_id, [...(out.get(r.media_id) ?? []), { id: r.id, name: r.name }]);
  return out;
}

export const peopleFor = (db: DB, mediaId: number) => peopleForMany(db, [mediaId]).get(mediaId) ?? [];

/** Replace who a title was watched with. Unknown ids are an error, so nothing is silently dropped. */
export function setMediaPeople(db: DB, mediaId: number, personIds: number[]) {
  const ids = [...new Set(personIds)];
  if (ids.length) {
    const found = db.prepare(`SELECT COUNT(*) n FROM person WHERE id IN (${placeholders(ids.length)})`).get(...ids) as { n: number };
    if (found.n !== ids.length) throw new RepoError("invalid", "Someone in that list was removed in Settings. Reload and try again.");
  }
  db.prepare(`DELETE FROM media_person WHERE media_id = ?`).run(mediaId);
  for (const pid of ids) db.prepare(`INSERT INTO media_person (media_id, person_id) VALUES (?, ?)`).run(mediaId, pid);
}

export function addPersonTo(db: DB, mediaId: number, personId: number) {
  db.prepare(`INSERT OR IGNORE INTO media_person (media_id, person_id) VALUES (?, ?)`).run(mediaId, personId);
}

export function removePersonFrom(db: DB, mediaId: number, personId: number) {
  db.prepare(`DELETE FROM media_person WHERE media_id = ? AND person_id = ?`).run(mediaId, personId);
}

export function requirePerson(db: DB, id: number): PersonRef {
  const p = db.prepare(`SELECT id, name FROM person WHERE id = ?`).get(id) as PersonRef | undefined;
  if (!p) throw new RepoError("not_found", "That person isn't on your list any more.");
  return p;
}
