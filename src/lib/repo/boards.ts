import { getDb, nowIso, type DB } from "../db";
import { RepoError } from "../errors";
import { TIER_KEYS, type BoardSource, type BoardSummary, type BoardView, type RankItem, type Tier } from "../domain/rankings";
import { MEDIA_TYPES, TYPE_LABEL, type MediaType } from "../domain/types";
import { audit } from "./audit";

/**
 * Rankings of your own: a name, a source (one of your lists, a genre filter, a kind, or
 * anything you add by hand), and a top list and tier list made only from that source.
 */

const ITEM = `m.id, m.type, m.title, m.year, m.poster_url AS posterUrl, r.rating,
  COALESCE(m.imdb_rating, CASE WHEN m.third_party_rating_source = 'IMDb' THEN m.third_party_rating END) AS imdb`;

interface Row {
  id: number;
  name: string;
  source: BoardSource;
  source_ref: string | null;
  mode: "top" | "tiers";
}

function sourceLabel(db: DB, b: Row): string {
  if (b.source === "list") return `From your list ${(db.prepare(`SELECT name FROM list WHERE id = ?`).get(Number(b.source_ref)) as { name: string } | undefined)?.name ?? "(deleted)"}`;
  if (b.source === "genre") return `Genre: ${(db.prepare(`SELECT name FROM genre WHERE id = ?`).get(Number(b.source_ref)) as { name: string } | undefined)?.name ?? "(deleted)"}`;
  if (b.source === "kind") return TYPE_LABEL[b.source_ref as MediaType] ?? "All";
  return "Anything you add";
}

const summary = (db: DB, b: Row): BoardSummary => ({
  id: b.id,
  name: b.name,
  source: b.source,
  sourceRef: b.source_ref,
  sourceLabel: sourceLabel(db, b),
  mode: b.mode,
  count: (db.prepare(`SELECT COUNT(DISTINCT media_id) n FROM (SELECT media_id FROM board_top WHERE board_id = ? UNION SELECT media_id FROM board_tier WHERE board_id = ?)`).get(b.id, b.id) as { n: number }).n,
});

export function listBoards(db = getDb()): BoardSummary[] {
  return (db.prepare(`SELECT id, name, source, source_ref, mode FROM ranking_board ORDER BY updated_at DESC`).all() as Row[]).map((b) => summary(db, b));
}

function requireBoard(db: DB, id: number): Row {
  const b = db.prepare(`SELECT id, name, source, source_ref, mode FROM ranking_board WHERE id = ?`).get(id) as Row | undefined;
  if (!b) throw new RepoError("not_found", "That ranking no longer exists.");
  return b;
}

/** The titles a ranking draws from (for lists, genres and kinds; "anything" has none). */
function sourceIds(db: DB, b: Row): number[] {
  if (b.source === "list") return (db.prepare(`SELECT media_id FROM list_item WHERE list_id = ? ORDER BY position`).all(Number(b.source_ref)) as { media_id: number }[]).map((r) => r.media_id);
  if (b.source === "genre")
    return (db.prepare(`SELECT media_id FROM media_genre WHERE genre_id = ? AND state != 'excluded'`).all(Number(b.source_ref)) as { media_id: number }[]).map((r) => r.media_id);
  if (b.source === "kind")
    return (db
      .prepare(
        `SELECT m.id FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.type = ?
           AND (r.rating IS NOT NULL OR r.status IN ('completed', 'watching', 'on_hold', 'dropped') OR r.watched_on IS NOT NULL)`,
      )
      .all(b.source_ref) as { id: number }[]).map((r) => r.id);
  // "Anything you add": whatever is on its top list waits in the tray too.
  return (db.prepare(`SELECT media_id FROM board_top WHERE board_id = ? ORDER BY position`).all(b.id) as { media_id: number }[]).map((r) => r.media_id);
}

const items = (db: DB, ids: number[]): Map<number, RankItem> => {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT ${ITEM} FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as RankItem[];
  return new Map(rows.map((r) => [r.id, r]));
};

export function getBoard(id: number, db = getDb()): BoardView {
  const b = requireBoard(db, id);
  const top = (db.prepare(`SELECT media_id FROM board_top WHERE board_id = ? ORDER BY position`).all(id) as { media_id: number }[]).map((r) => r.media_id);
  const tiered = db.prepare(`SELECT media_id, tier FROM board_tier WHERE board_id = ? ORDER BY position`).all(id) as { media_id: number; tier: Tier }[];
  const src = sourceIds(db, b);
  const inTiers = new Set(tiered.map((t) => t.media_id));
  const all = items(db, [...new Set([...top, ...tiered.map((t) => t.media_id), ...src])]);
  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, [] as RankItem[]])) as Record<Tier, RankItem[]>;
  for (const t of tiered) {
    const it = all.get(t.media_id);
    if (it) (tiers[t.tier] ?? tiers.F).push(it);
  }
  const pool = src.filter((x) => !inTiers.has(x)).map((x) => all.get(x)!).filter(Boolean).sort((a, c) => (c.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(c.title));
  return { board: summary(db, b), top: top.map((x) => all.get(x)!).filter(Boolean), tiers, pool };
}

export function createBoard(input: { name: string; source: BoardSource; sourceRef?: string | null; mode?: "top" | "tiers" }, db = getDb()): number {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new RepoError("invalid", "Give the ranking a name.");
  if (input.source === "kind" && !(MEDIA_TYPES as readonly string[]).includes(input.sourceRef ?? "")) throw new RepoError("invalid", "Pick Movies, TV Shows or Anime.");
  if ((input.source === "list" || input.source === "genre") && !Number(input.sourceRef)) throw new RepoError("invalid", "Pick where it comes from.");
  const now = nowIso();
  const { id } = db
    .prepare(`INSERT INTO ranking_board (name, source, source_ref, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(name, input.source, input.source === "any" ? null : String(input.sourceRef), input.mode ?? "tiers", now, now) as { id: number };
  audit(db, "create", "ranking", id, { name, source: input.source });
  return id;
}

export function updateBoard(id: number, patch: { name?: string; mode?: "top" | "tiers" }, db = getDb()) {
  requireBoard(db, id);
  if (patch.name !== undefined) {
    const n = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!n) throw new RepoError("invalid", "Give the ranking a name.");
    db.prepare(`UPDATE ranking_board SET name = ? WHERE id = ?`).run(n, id);
  }
  if (patch.mode) db.prepare(`UPDATE ranking_board SET mode = ? WHERE id = ?`).run(patch.mode, id);
  db.prepare(`UPDATE ranking_board SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
}

export function deleteBoard(id: number, db = getDb()) {
  requireBoard(db, id);
  db.prepare(`DELETE FROM ranking_board WHERE id = ?`).run(id);
  audit(db, "delete", "ranking", id);
}

const existing = (db: DB, ids: number[]) => new Set(items(db, ids).keys());

export function setBoardTop(id: number, mediaIds: number[], db = getDb()) {
  requireBoard(db, id);
  const ok = existing(db, mediaIds);
  db.transaction(() => {
    db.prepare(`DELETE FROM board_top WHERE board_id = ?`).run(id);
    const ins = db.prepare(`INSERT OR IGNORE INTO board_top (board_id, media_id, position) VALUES (?, ?, ?)`);
    [...new Set(mediaIds)].filter((m) => ok.has(m)).forEach((m, i) => ins.run(id, m, i + 1));
    db.prepare(`UPDATE ranking_board SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
  })();
}

export function setBoardTiers(id: number, tiers: Partial<Record<Tier, number[]>>, db = getDb()) {
  requireBoard(db, id);
  const ok = existing(db, Object.values(tiers).flat() as number[]);
  db.transaction(() => {
    db.prepare(`DELETE FROM board_tier WHERE board_id = ?`).run(id);
    const ins = db.prepare(`INSERT OR REPLACE INTO board_tier (board_id, media_id, tier, position) VALUES (?, ?, ?, ?)`);
    for (const k of TIER_KEYS) (tiers[k] ?? []).filter((m) => ok.has(m)).forEach((m, i) => ins.run(id, m, k, i + 1));
    db.prepare(`UPDATE ranking_board SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
  })();
}
