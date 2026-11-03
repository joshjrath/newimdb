import type { DB } from "../db";

const normalizeTag = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 40);

export function tagsFor(db: DB, mediaId: number): string[] {
  return tagsForMany(db, [mediaId]).get(mediaId) ?? [];
}

/** Tags for many entries in one query (avoids one query per library card). */
export function tagsForMany(db: DB, mediaIds: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (!mediaIds.length) return out;
  const rows = db
    .prepare(
      `SELECT mt.media_id, t.name FROM media_tag mt JOIN tag t ON t.id = mt.tag_id
       WHERE mt.media_id IN (${mediaIds.map(() => "?").join(",")}) ORDER BY t.name COLLATE NOCASE`,
    )
    .all(...mediaIds) as { media_id: number; name: string }[];
  for (const r of rows) out.set(r.media_id, [...(out.get(r.media_id) ?? []), r.name]);
  return out;
}

/** Replace an entry's tags. Case-insensitive dedupe; the first spelling (or the existing tag's) wins. */
export function setMediaTags(db: DB, mediaId: number, tags: string[]) {
  const wanted = new Map<string, string>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t && !wanted.has(t.toLowerCase())) wanted.set(t.toLowerCase(), t);
  }
  const current = tagsFor(db, mediaId);
  const currentKeys = new Set(current.map((t) => t.toLowerCase()));
  if (current.length === wanted.size && [...wanted.keys()].every((k) => currentKeys.has(k))) return;

  db.prepare(`DELETE FROM media_tag WHERE media_id = ?`).run(mediaId);
  for (const name of wanted.values()) {
    const { id } = db
      .prepare(`INSERT INTO tag (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = tag.name RETURNING id`)
      .get(name) as { id: number };
    db.prepare(`INSERT OR IGNORE INTO media_tag (media_id, tag_id) VALUES (?, ?)`).run(mediaId, id);
  }
  // Only tags this entry just dropped can have become orphans.
  const dropped = current.filter((t) => !wanted.has(t.toLowerCase()));
  for (const name of dropped) {
    db.prepare(`DELETE FROM tag WHERE name = ? COLLATE NOCASE AND NOT EXISTS (SELECT 1 FROM media_tag WHERE tag_id = tag.id)`).run(name);
  }
}

export function allTags(db: DB, type?: string): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT t.name, COUNT(*) count FROM tag t JOIN media_tag mt ON mt.tag_id = t.id JOIN media m ON m.id = mt.media_id
       ${type ? "WHERE m.type = ?" : ""} GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`,
    )
    .all(...(type ? [type] : [])) as { name: string; count: number }[];
}
