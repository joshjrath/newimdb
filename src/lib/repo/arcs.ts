import { getDb, nowIso } from "../db";
import { RepoError } from "../errors";
import { EPISODE_VIEWS, type Arc, type EpisodeViewKey } from "../domain/episodeViews";

/** How a show's episodes are laid out on its page (remembered per show), and its arcs. */
export function episodeViewOf(mediaId: number, db = getDb()): EpisodeViewKey {
  const v = (db.prepare(`SELECT episode_view FROM media WHERE id = ?`).get(mediaId) as { episode_view: string | null } | undefined)?.episode_view;
  return EPISODE_VIEWS.some((x) => x.key === v) ? (v as EpisodeViewKey) : "story";
}

export function setEpisodeView(mediaId: number, view: EpisodeViewKey, db = getDb()) {
  if (!db.prepare(`UPDATE media SET episode_view = ? WHERE id = ?`).run(view, mediaId).changes) throw new RepoError("not_found", "This entry no longer exists.");
}

export function listArcs(mediaId: number, db = getDb()): Arc[] {
  return db.prepare(`SELECT id, name, first_ep AS firstEp, last_ep AS lastEp FROM arc WHERE media_id = ? ORDER BY first_ep`).all(mediaId) as Arc[];
}

export function addArc(mediaId: number, a: { name: string; firstEp: number; lastEp: number }, db = getDb()): Arc[] {
  const name = a.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new RepoError("invalid", "Give the arc a name.");
  const [first, last] = a.firstEp <= a.lastEp ? [a.firstEp, a.lastEp] : [a.lastEp, a.firstEp];
  const clash = db.prepare(`SELECT name FROM arc WHERE media_id = ? AND first_ep <= ? AND last_ep >= ?`).get(mediaId, last, first) as { name: string } | undefined;
  if (clash) throw new RepoError("conflict", `That overlaps "${clash.name}". Arcs can't overlap.`);
  db.prepare(`INSERT INTO arc (media_id, name, first_ep, last_ep, created_at) VALUES (?, ?, ?, ?, ?)`).run(mediaId, name, first, last, nowIso());
  return listArcs(mediaId, db);
}

export function deleteArc(mediaId: number, arcId: number, db = getDb()): Arc[] {
  db.prepare(`DELETE FROM arc WHERE id = ? AND media_id = ?`).run(arcId, mediaId);
  return listArcs(mediaId, db);
}
