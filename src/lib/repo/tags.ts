import type { DB } from "../db";

export function normalizeTag(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, 40);
}

export function tagsFor(db: DB, mediaId: number): string[] {
  return (
    db
      .prepare(`SELECT t.name FROM media_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.media_id = ? ORDER BY t.name COLLATE NOCASE`)
      .all(mediaId) as { name: string }[]
  ).map((r) => r.name);
}

export function setMediaTags(db: DB, mediaId: number, tags: string[]) {
  const unique = new Map<string, string>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t && !unique.has(t.toLowerCase())) unique.set(t.toLowerCase(), t);
  }
  db.prepare(`DELETE FROM media_tag WHERE media_id = ?`).run(mediaId);
  for (const name of unique.values()) {
    db.prepare(`INSERT OR IGNORE INTO tag (name) VALUES (?)`).run(name);
    const { id } = db.prepare(`SELECT id FROM tag WHERE name = ? COLLATE NOCASE`).get(name) as { id: number };
    db.prepare(`INSERT OR IGNORE INTO media_tag (media_id, tag_id) VALUES (?, ?)`).run(mediaId, id);
  }
  db.prepare(`DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM media_tag)`).run();
}

export function allTags(db: DB, type?: string): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT t.name, COUNT(*) count FROM tag t JOIN media_tag mt ON mt.tag_id = t.id JOIN media m ON m.id = mt.media_id
       ${type ? "WHERE m.type = ?" : ""} GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`,
    )
    .all(...(type ? [type] : [])) as { name: string; count: number }[];
}
