import { getDb, type DB } from "../db";
import { RepoError } from "../errors";
import { TIER_KEYS, type RankItem, type RankingsView, type Tier } from "../domain/rankings";
import type { MediaType } from "../domain/types";
import { audit } from "./audit";

/**
 * Rankings: a numbered top list per kind (your #1 movie, #2 movie…) and a tier list
 * (S/A/B/C/F). Each title can be in both; a title sits in one tier at a time.
 */

const ITEM = `m.id, m.type, m.title, m.year, m.poster_url AS posterUrl, r.rating,
  COALESCE(m.imdb_rating, CASE WHEN m.third_party_rating_source = 'IMDb' THEN m.third_party_rating END) AS imdb`;

export function getRankings(kind: MediaType, db = getDb()): RankingsView {
  const top = db
    .prepare(`SELECT ${ITEM} FROM ranking_item ri JOIN media m ON m.id = ri.media_id LEFT JOIN review r ON r.media_id = m.id WHERE ri.kind = ? ORDER BY ri.position`)
    .all(kind) as RankItem[];
  const tiered = db
    .prepare(`SELECT ${ITEM}, t.tier FROM tier_item t JOIN media m ON m.id = t.media_id LEFT JOIN review r ON r.media_id = m.id WHERE m.type = ? ORDER BY t.position`)
    .all(kind) as (RankItem & { tier: Tier })[];
  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, [] as RankItem[]])) as Record<Tier, RankItem[]>;
  for (const { tier, ...item } of tiered) (tiers[tier] ?? tiers.F).push(item);
  const pool = db
    .prepare(
      `SELECT ${ITEM} FROM media m LEFT JOIN review r ON r.media_id = m.id
       WHERE m.type = ? AND NOT EXISTS (SELECT 1 FROM tier_item t WHERE t.media_id = m.id)
         AND (r.rating IS NOT NULL OR r.status IN ('completed', 'watching', 'on_hold', 'dropped') OR r.watched_on IS NOT NULL)
       ORDER BY r.rating IS NULL, r.rating DESC, m.title COLLATE NOCASE`,
    )
    .all(kind) as RankItem[];
  return { kind, top, tiers, pool };
}

const ofKind = (db: DB, kind: MediaType, ids: number[]) => {
  if (!ids.length) return new Set<number>();
  const rows = db.prepare(`SELECT id FROM media WHERE type = ? AND id IN (${ids.map(() => "?").join(",")})`).all(kind, ...ids) as { id: number }[];
  return new Set(rows.map((r) => r.id));
};

/** Your top list for a kind, in order (replaces it). */
export function setTopList(kind: MediaType, mediaIds: number[], db = getDb()) {
  const ok = ofKind(db, kind, mediaIds);
  const ids = [...new Set(mediaIds)].filter((id) => ok.has(id));
  db.transaction(() => {
    db.prepare(`DELETE FROM ranking_item WHERE kind = ?`).run(kind);
    const ins = db.prepare(`INSERT INTO ranking_item (kind, media_id, position) VALUES (?, ?, ?)`);
    ids.forEach((id, i) => ins.run(kind, id, i + 1));
    audit(db, "set_top_list", "rankings", kind, { count: ids.length });
  })();
}

/** The tier list for a kind (replaces it): tier → titles in order. */
export function setTierList(kind: MediaType, tiers: Partial<Record<Tier, number[]>>, db = getDb()) {
  const all = Object.values(tiers).flat() as number[];
  const ok = ofKind(db, kind, all);
  for (const k of Object.keys(tiers)) if (!TIER_KEYS.includes(k as Tier)) throw new RepoError("invalid", `Unknown tier ${k}.`);
  db.transaction(() => {
    db.prepare(`DELETE FROM tier_item WHERE media_id IN (SELECT id FROM media WHERE type = ?)`).run(kind);
    const ins = db.prepare(`INSERT OR REPLACE INTO tier_item (media_id, tier, position) VALUES (?, ?, ?)`);
    for (const k of TIER_KEYS) (tiers[k] ?? []).filter((id) => ok.has(id)).forEach((id, i) => ins.run(id, k, i + 1));
    audit(db, "set_tier_list", "rankings", kind, { count: all.length });
  })();
}

/* ---------------- backups ---------------- */

export interface RankingsBackup {
  top: { kind: MediaType; uids: string[] }[];
  tiers: { uid: string; tier: Tier; position: number }[];
}

export function exportRankings(db = getDb()): RankingsBackup {
  const top = (["movie", "tv", "anime"] as MediaType[]).map((kind) => ({
    kind,
    uids: (db.prepare(`SELECT m.uid FROM ranking_item ri JOIN media m ON m.id = ri.media_id WHERE ri.kind = ? ORDER BY ri.position`).all(kind) as { uid: string }[]).map((r) => r.uid),
  }));
  const tiers = db.prepare(`SELECT m.uid, t.tier, t.position FROM tier_item t JOIN media m ON m.id = t.media_id`).all() as RankingsBackup["tiers"];
  return { top, tiers };
}

export function restoreRankings(b: RankingsBackup, db = getDb()) {
  const idOf = db.prepare(`SELECT id FROM media WHERE uid = ?`);
  for (const t of b.top) {
    const ids = t.uids.map((u) => (idOf.get(u) as { id: number } | undefined)?.id).filter((x): x is number => x != null);
    if (ids.length) setTopList(t.kind, ids, db);
  }
  const ins = db.prepare(`INSERT OR REPLACE INTO tier_item (media_id, tier, position) VALUES (?, ?, ?)`);
  for (const t of b.tiers) {
    const id = (idOf.get(t.uid) as { id: number } | undefined)?.id;
    if (id && TIER_KEYS.includes(t.tier)) ins.run(id, t.tier, t.position);
  }
}
