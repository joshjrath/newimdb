import crypto from "node:crypto";
import { getDb, nowIso, type DB } from "../db";
import type {
  EpisodeState,
  EpisodeView,
  MediaDetail,
  MediaType,
  MediaView,
  ReviewView,
  SegmentView,
  WatchStatus,
} from "../domain/types";
import type { CreateMediaInput, MetadataInput, ProviderEpisode, ReviewInput, SegmentInput } from "../schemas";
import { audit } from "./audit";
import { setMediaTags, tagsFor } from "./tags";
import { activePointer, computeProgress, type ActivePointer, type Progress } from "../domain/progress";
import { normalizeTitle } from "../domain/text";

export class RepoError extends Error {
  constructor(
    public code: "not_found" | "conflict" | "needs_confirmation" | "invalid",
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/* ---------------- row mapping ---------------- */

type MediaRow = Record<string, unknown> & { id: number };

function parseJsonArray(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

function mapReview(r: Record<string, unknown> | undefined, m: MediaRow): ReviewView {
  return {
    rating: (r?.rating as number | null) ?? null,
    ratingLabel: (r?.rating_label as string | null) ?? null,
    body: (r?.body as string) ?? "",
    watchedOn: (r?.watched_on as string | null) ?? null,
    spoiler: Boolean(r?.spoiler),
    status: (r?.status as WatchStatus | null) ?? null,
    featured: Boolean(r?.featured),
    visibility: "private",
    source: ((r?.source as ReviewView["source"]) ?? "manual") as ReviewView["source"],
    sourceRef: (r?.source_ref as string | null) ?? null,
    lastWatchedAt: (r?.last_watched_at as string | null) ?? null,
    createdAt: (r?.created_at as string) ?? (m.created_at as string),
    updatedAt: (r?.updated_at as string) ?? (m.updated_at as string),
  };
}

function mapMedia(db: DB, m: MediaRow, r?: Record<string, unknown>): MediaView {
  return {
    id: m.id,
    uid: m.uid as string,
    type: m.type as MediaType,
    title: m.title as string,
    originalTitle: (m.original_title as string | null) ?? null,
    year: (m.year as number | null) ?? null,
    overview: (m.overview as string | null) ?? null,
    posterUrl: (m.poster_url as string | null) ?? null,
    backdropUrl: (m.backdrop_url as string | null) ?? null,
    runtimeMin: (m.runtime_min as number | null) ?? null,
    genres: parseJsonArray(m.genres),
    tmdbId: (m.tmdb_id as number | null) ?? null,
    imdbId: (m.imdb_id as string | null) ?? null,
    malId: (m.mal_id as number | null) ?? null,
    tvmazeId: (m.tvmaze_id as number | null) ?? null,
    anilistId: (m.anilist_id as number | null) ?? null,
    letterboxdUrl: (m.letterboxd_url as string | null) ?? null,
    metadataSource: (m.metadata_source as string | null) ?? null,
    lockedFields: parseJsonArray(m.locked_fields),
    thirdPartyRating: (m.third_party_rating as number | null) ?? null,
    thirdPartyRatingSource: (m.third_party_rating_source as string | null) ?? null,
    version: m.version as number,
    createdAt: m.created_at as string,
    updatedAt: m.updated_at as string,
    review: mapReview(r, m),
    tags: tagsFor(db, m.id),
  };
}

const METADATA_COLUMNS: Record<keyof MetadataInput, string> = {
  title: "title",
  originalTitle: "original_title",
  year: "year",
  overview: "overview",
  posterUrl: "poster_url",
  backdropUrl: "backdrop_url",
  runtimeMin: "runtime_min",
  genres: "genres",
  tmdbId: "tmdb_id",
  imdbId: "imdb_id",
  malId: "mal_id",
  tvmazeId: "tvmaze_id",
  anilistId: "anilist_id",
  letterboxdUrl: "letterboxd_url",
  metadataSource: "metadata_source",
  lockedFields: "locked_fields",
  thirdPartyRating: "third_party_rating",
  thirdPartyRatingSource: "third_party_rating_source",
};

const REVIEW_COLUMNS: Record<keyof ReviewInput, string> = {
  rating: "rating",
  ratingLabel: "rating_label",
  body: "body",
  watchedOn: "watched_on",
  spoiler: "spoiler",
  status: "status",
  featured: "featured",
  visibility: "visibility",
};

function toSql(v: unknown): unknown {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined ? null : v;
}

/* ---------------- reads ---------------- */

export function getMedia(id: number, db = getDb()): MediaView | null {
  const m = db.prepare(`SELECT * FROM media WHERE id = ?`).get(id) as MediaRow | undefined;
  if (!m) return null;
  const r = db.prepare(`SELECT * FROM review WHERE media_id = ?`).get(id) as Record<string, unknown> | undefined;
  return mapMedia(db, m, r);
}

export function getSegments(mediaId: number, db = getDb()): SegmentView[] {
  const segs = db
    .prepare(`SELECT * FROM segment WHERE media_id = ? ORDER BY position, id`)
    .all(mediaId) as Record<string, unknown>[];
  const eps = db
    .prepare(
      `SELECT e.*, a.state, a.rating, a.filler, a.watched_at FROM episode e
       JOIN segment s ON s.id = e.segment_id
       LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE s.media_id = ? ORDER BY e.segment_id, e.number`,
    )
    .all(mediaId) as Record<string, unknown>[];
  const bySeg = new Map<number, EpisodeView[]>();
  for (const e of eps) {
    const list = bySeg.get(e.segment_id as number) ?? [];
    list.push({
      id: e.id as number,
      segmentId: e.segment_id as number,
      number: e.number as number,
      title: (e.title as string | null) ?? null,
      airDate: (e.air_date as string | null) ?? null,
      overview: (e.overview as string | null) ?? null,
      state: ((e.state as EpisodeState | null) ?? "unwatched") as EpisodeState,
      rating: (e.rating as number | null) ?? null,
      filler: Boolean(e.filler),
      watchedAt: (e.watched_at as string | null) ?? null,
    });
    bySeg.set(e.segment_id as number, list);
  }
  return segs.map((s) => ({
    id: s.id as number,
    kind: s.kind as SegmentView["kind"],
    label: s.label as string,
    seasonNumber: (s.season_number as number | null) ?? null,
    courNumber: (s.cour_number as number | null) ?? null,
    position: s.position as number,
    provider: (s.provider as string | null) ?? null,
    providerRef: (s.provider_ref as string | null) ?? null,
    episodes: bySeg.get(s.id as number) ?? [],
  }));
}

export function getMediaDetail(id: number, db = getDb()): MediaDetail | null {
  const m = getMedia(id, db);
  if (!m) return null;
  return { ...m, segments: getSegments(id, db) };
}

export type SortKey = "recent" | "rating" | "title" | "year" | "added";

export interface ListQuery {
  type?: MediaType;
  status?: WatchStatus | "none";
  tag?: string;
  q?: string;
  featured?: boolean;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export interface ListItem extends MediaView {
  progress: Progress | null;
}

export function listMedia(query: ListQuery, db = getDb()): { items: ListItem[]; total: number; page: number; pageSize: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.type) {
    where.push(`m.type = ?`);
    params.push(query.type);
  }
  if (query.status === "none") where.push(`r.status IS NULL`);
  else if (query.status) {
    where.push(`r.status = ?`);
    params.push(query.status);
  }
  if (query.featured) where.push(`r.featured = 1`);
  if (query.tag) {
    where.push(`EXISTS (SELECT 1 FROM media_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.media_id = m.id AND t.name = ? COLLATE NOCASE)`);
    params.push(query.tag);
  }
  if (query.q?.trim()) {
    where.push(`(m.title LIKE ? ESCAPE '\\' OR m.original_title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order: Record<SortKey, string> = {
    recent: `COALESCE(r.last_watched_at, r.watched_on, r.created_at) DESC, m.id DESC`,
    rating: `r.rating IS NULL, r.rating DESC, COALESCE(r.last_watched_at, r.watched_on) DESC`,
    title: `m.title COLLATE NOCASE ASC`,
    year: `m.year IS NULL, m.year DESC, m.title COLLATE NOCASE`,
    added: `m.created_at DESC, m.id DESC`,
  };
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const total = (db.prepare(`SELECT COUNT(*) n FROM media m LEFT JOIN review r ON r.media_id = m.id ${whereSql}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT m.*, r.rating, r.rating_label, r.body, r.watched_on, r.spoiler, r.status, r.featured, r.visibility,
              r.source, r.source_ref, r.last_watched_at, r.created_at AS r_created_at, r.updated_at AS r_updated_at
       FROM media m LEFT JOIN review r ON r.media_id = m.id ${whereSql}
       ORDER BY ${order[query.sort ?? "recent"]} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as MediaRow[];
  const progress = progressFor(db, rows.filter((r) => r.type !== "movie").map((r) => r.id));
  const items = rows.map((row) => {
    const review = { ...row, created_at: row.r_created_at, updated_at: row.r_updated_at };
    return { ...mapMedia(db, row, review), progress: progress.get(row.id) ?? null };
  });
  return { items, total, page, pageSize };
}

function progressFor(db: DB, ids: number[]): Map<number, Progress> {
  const out = new Map<number, Progress>();
  if (!ids.length) return out;
  const rows = db
    .prepare(
      `SELECT s.media_id AS id, COUNT(e.id) AS total,
              SUM(CASE WHEN a.state = 'watched' THEN 1 ELSE 0 END) AS watched,
              SUM(CASE WHEN a.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
              SUM(CASE WHEN a.state = 'skipped' THEN 1 ELSE 0 END) AS skipped
       FROM segment s JOIN episode e ON e.segment_id = s.id
       LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE s.media_id IN (${ids.map(() => "?").join(",")}) GROUP BY s.media_id`,
    )
    .all(...ids) as { id: number; total: number; watched: number; rated: number; skipped: number }[];
  for (const r of rows) {
    const denominator = r.total - r.skipped;
    out.set(r.id, {
      total: r.total,
      watched: r.watched,
      rated: r.rated,
      skipped: r.skipped,
      denominator,
      remaining: denominator - r.watched,
      percent: denominator ? Math.round((r.watched / denominator) * 1000) / 10 : 0,
    });
  }
  return out;
}

export interface WatchingItem extends MediaView {
  progress: Progress;
  pointer: ActivePointer;
}

/** The "Currently Watching" strip: status = watching, most recently progressed first. */
export function listWatching(type?: MediaType, db = getDb()): WatchingItem[] {
  const { items } = listMedia({ type, status: "watching", sort: "recent", pageSize: 50 }, db);
  return items.map((m) => {
    const segments = getSegments(m.id, db);
    return { ...m, progress: computeProgress(segments.flatMap((s) => s.episodes)), pointer: activePointer(segments) };
  });
}

export function countMedia(db = getDb()) {
  const rows = db.prepare(`SELECT type, COUNT(*) n FROM media GROUP BY type`).all() as { type: MediaType; n: number }[];
  const by: Record<MediaType, number> = { movie: 0, tv: 0, anime: 0 };
  for (const r of rows) by[r.type] = r.n;
  return { ...by, total: by.movie + by.tv + by.anime };
}

/* ---------------- writes ---------------- */

function bumpVersion(db: DB, id: number) {
  db.prepare(`UPDATE media SET version = version + 1, updated_at = ? WHERE id = ?`).run(nowIso(), id);
}

function checkVersion(db: DB, id: number, expected: number) {
  const row = db.prepare(`SELECT version FROM media WHERE id = ?`).get(id) as { version: number } | undefined;
  if (!row) throw new RepoError("not_found", "This entry no longer exists.");
  if (row.version !== expected) {
    throw new RepoError(
      "conflict",
      "This entry was changed somewhere else since you opened it. Reload to see the latest version — your edits are still in the form.",
      { currentVersion: row.version },
    );
  }
}

function writeMetadata(db: DB, id: number, meta: Partial<MetadataInput>) {
  const keys = Object.keys(meta).filter((k) => k in METADATA_COLUMNS) as (keyof MetadataInput)[];
  if (!keys.length) return;
  db.prepare(`UPDATE media SET ${keys.map((k) => `${METADATA_COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => toSql(meta[k])),
    id,
  );
}

function writeReview(db: DB, id: number, review: Partial<ReviewInput>) {
  const keys = Object.keys(review).filter((k) => k in REVIEW_COLUMNS) as (keyof ReviewInput)[];
  const now = nowIso();
  db.prepare(`INSERT OR IGNORE INTO review (media_id, created_at, updated_at) VALUES (?, ?, ?)`).run(id, now, now);
  if (!keys.length) return;
  db.prepare(
    `UPDATE review SET ${keys.map((k) => `${REVIEW_COLUMNS[k]} = ?`).join(", ")}, updated_at = ? WHERE media_id = ?`,
  ).run(...keys.map((k) => toSql(review[k])), now, id);
  if (review.watchedOn) touchWatched(db, id, review.watchedOn);
}

/** Recently Watched: keep the latest real activity (movie watch date or an episode being watched). */
export function touchWatched(db: DB, mediaId: number, at: string) {
  db.prepare(
    `UPDATE review SET last_watched_at = ? WHERE media_id = ? AND (last_watched_at IS NULL OR last_watched_at < ?)`,
  ).run(at, mediaId, at);
}

export function createMedia(input: CreateMediaInput, opts: { source?: ReviewView["source"]; sourceRef?: string | null; uid?: string } = {}, db = getDb()): MediaView {
  const id = db.transaction(() => {
    const now = nowIso();
    const info = db
      .prepare(`INSERT INTO media (uid, type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(opts.uid ?? crypto.randomUUID(), input.type, input.metadata.title, now, now);
    const id = Number(info.lastInsertRowid);
    writeMetadata(db, id, input.metadata);
    writeReview(db, id, { visibility: "private", ...input.review });
    db.prepare(`UPDATE review SET source = ?, source_ref = ? WHERE media_id = ?`).run(opts.source ?? "manual", opts.sourceRef ?? null, id);
    if (!input.review?.watchedOn) db.prepare(`UPDATE review SET last_watched_at = COALESCE(last_watched_at, ?) WHERE media_id = ?`).run(now, id);
    if (input.tags) setMediaTags(db, id, input.tags);
    (input.segments ?? []).forEach((s, i) => {
      const segId = insertSegment(db, id, s, i);
      if (s.episodes?.length) applyProviderEpisodes(segId, s.episodes, { grow: true }, db);
      else ensureEpisodeCount(db, segId, s.episodeCount);
    });
    audit(db, "create", "media", id, { title: input.metadata.title, type: input.type, source: opts.source ?? "manual" });
    return id;
  })();
  return getMedia(id, db)!;
}

export function updateMedia(
  id: number,
  patch: { version: number; metadata?: Partial<MetadataInput>; review?: Partial<ReviewInput>; tags?: string[] },
  db = getDb(),
): MediaView {
  db.transaction(() => {
    checkVersion(db, id, patch.version);
    if (patch.metadata) writeMetadata(db, id, patch.metadata);
    if (patch.review) writeReview(db, id, patch.review);
    if (patch.tags) setMediaTags(db, id, patch.tags);
    bumpVersion(db, id);
    audit(db, "update", "media", id, {
      metadata: patch.metadata ? Object.keys(patch.metadata) : undefined,
      review: patch.review ? Object.keys(patch.review) : undefined,
      tags: patch.tags,
    });
  })();
  return getMedia(id, db)!;
}

/** Metadata refresh: only touches unlocked metadata fields, never review/ratings/structure. */
export function applyMetadataRefresh(id: number, meta: Partial<MetadataInput>, db = getDb()): MediaView {
  const current = getMedia(id, db);
  if (!current) throw new RepoError("not_found", "Not found.");
  const locked = new Set(current.lockedFields);
  const safe: Partial<MetadataInput> = {};
  for (const [k, v] of Object.entries(meta) as [keyof MetadataInput, unknown][]) {
    if (k === "lockedFields" || locked.has(k)) continue;
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue; // never blank out data
    (safe as Record<string, unknown>)[k] = v;
  }
  db.transaction(() => {
    writeMetadata(db, id, safe);
    bumpVersion(db, id);
    audit(db, "refresh_metadata", "media", id, { fields: Object.keys(safe) });
  })();
  return getMedia(id, db)!;
}

export function deleteMedia(ids: number[], db = getDb()): number {
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      const r = db.prepare(`DELETE FROM media WHERE id = ?`).run(id);
      if (r.changes) {
        n++;
        audit(db, "delete", "media", id);
      }
    }
  })();
  return n;
}

export function bulkUpdate(ids: number[], action: string, opts: { status?: WatchStatus | null; tag?: string }, db = getDb()): number {
  if (action === "delete") return deleteMedia(ids, db);
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      const exists = db.prepare(`SELECT 1 FROM media WHERE id = ?`).get(id);
      if (!exists) continue;
      if (action === "feature" || action === "unfeature") writeReview(db, id, { featured: action === "feature" });
      else if (action === "set_status") writeReview(db, id, { status: opts.status ?? null });
      else if (action === "add_tag" && opts.tag) setMediaTags(db, id, [...tagsFor(db, id), opts.tag]);
      else if (action === "remove_tag" && opts.tag) {
        const t = opts.tag.toLowerCase();
        setMediaTags(db, id, tagsFor(db, id).filter((x) => x.toLowerCase() !== t));
      }
      bumpVersion(db, id);
      n++;
    }
    audit(db, "bulk_" + action, "media", ids.join(","), opts);
  })();
  return n;
}

/* ---------------- structure ---------------- */

function insertSegment(db: DB, mediaId: number, s: Omit<SegmentInput, "id">, position: number): number {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, provider, provider_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(mediaId, s.kind, s.label, s.seasonNumber, s.courNumber, position, s.provider ?? null, s.providerRef ?? null, now, now);
  return Number(info.lastInsertRowid);
}

function ensureEpisodeCount(db: DB, segmentId: number, count: number) {
  const max = (db.prepare(`SELECT COALESCE(MAX(number), 0) n FROM episode WHERE segment_id = ?`).get(segmentId) as { n: number }).n;
  const ins = db.prepare(`INSERT OR IGNORE INTO episode (segment_id, number) VALUES (?, ?)`);
  for (let n = 1; n <= count; n++) if (n > max || !db.prepare(`SELECT 1 FROM episode WHERE segment_id=? AND number=?`).get(segmentId, n)) ins.run(segmentId, n);
}

interface Loss {
  segment: string;
  episodes: number;
  withData: number;
}

function assessedCount(db: DB, segmentId: number, aboveNumber = 0): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM episode e JOIN episode_assessment a ON a.episode_id = e.id
         WHERE e.segment_id = ? AND e.number > ? AND (a.state != 'unwatched' OR a.rating IS NOT NULL OR a.filler = 1)`,
      )
      .get(segmentId, aboveNumber) as { n: number }
  ).n;
}

/**
 * Replace the ordered structure of a show in one transaction.
 * Existing segments keep their ids (and so their episode ratings) when renamed, re-typed or reordered.
 * Anything that would delete owner data (rated/watched/skipped/filler episodes) needs `confirmLoss`.
 */
export function saveStructure(mediaId: number, input: { version: number; segments: SegmentInput[]; confirmLoss?: boolean }, db = getDb()) {
  return db.transaction(() => {
    checkVersion(db, mediaId, input.version);
    const existing = db.prepare(`SELECT id, label FROM segment WHERE media_id = ?`).all(mediaId) as { id: number; label: string }[];
    const existingIds = new Set(existing.map((s) => s.id));
    for (const s of input.segments) {
      if (s.id != null && !existingIds.has(s.id)) throw new RepoError("invalid", `Segment ${s.id} doesn't belong to this entry.`);
    }
    const keep = new Set(input.segments.map((s) => s.id).filter(Boolean) as number[]);
    const losses: Loss[] = [];
    for (const s of existing) {
      if (!keep.has(s.id)) {
        const episodes = (db.prepare(`SELECT COUNT(*) n FROM episode WHERE segment_id = ?`).get(s.id) as { n: number }).n;
        const withData = assessedCount(db, s.id);
        if (withData) losses.push({ segment: s.label, episodes, withData });
      }
    }
    for (const s of input.segments) {
      if (s.id == null) continue;
      const withData = assessedCount(db, s.id, s.episodeCount);
      if (withData) {
        const removed = (db.prepare(`SELECT COUNT(*) n FROM episode WHERE segment_id = ? AND number > ?`).get(s.id, s.episodeCount) as { n: number }).n;
        losses.push({ segment: s.label, episodes: removed, withData });
      }
    }
    if (losses.length && !input.confirmLoss) {
      throw new RepoError("needs_confirmation", "This change would delete episodes that have ratings or watch states.", { losses });
    }
    for (const s of existing) if (!keep.has(s.id)) db.prepare(`DELETE FROM segment WHERE id = ?`).run(s.id);
    const now = nowIso();
    input.segments.forEach((s, position) => {
      let segId = s.id;
      if (segId == null) segId = insertSegment(db, mediaId, s, position);
      else {
        db.prepare(
          `UPDATE segment SET kind=?, label=?, season_number=?, cour_number=?, position=?, updated_at=?,
             provider = COALESCE(?, provider), provider_ref = COALESCE(?, provider_ref) WHERE id = ?`,
        ).run(s.kind, s.label, s.seasonNumber, s.courNumber, position, now, s.provider ?? null, s.providerRef ?? null, segId);
      }
      db.prepare(`DELETE FROM episode WHERE segment_id = ? AND number > ?`).run(segId, s.episodeCount);
      ensureEpisodeCount(db, segId, s.episodeCount);
    });
    bumpVersion(db, mediaId);
    audit(db, "save_structure", "media", mediaId, { segments: input.segments.length, losses });
    return getSegments(mediaId, db);
  })();
}

/**
 * Apply provider episode metadata to a segment: updates titles/dates by episode number,
 * adds missing episodes (when `grow`), and never deletes episodes or touches assessments
 * except to seed the provider's filler flag on episodes the owner hasn't assessed.
 */
export function applyProviderEpisodes(segmentId: number, episodes: ProviderEpisode[], opts: { grow: boolean }, db = getDb()) {
  const upd = db.prepare(
    `UPDATE episode SET title = COALESCE(?, title), air_date = COALESCE(?, air_date), overview = COALESCE(?, overview),
       provider_ref = COALESCE(?, provider_ref) WHERE segment_id = ? AND number = ?`,
  );
  const ins = db.prepare(`INSERT INTO episode (segment_id, number, title, air_date, overview, provider_ref) VALUES (?,?,?,?,?,?)`);
  const seedFiller = db.prepare(
    `INSERT OR IGNORE INTO episode_assessment (episode_id, state, filler, updated_at) VALUES (?, 'unwatched', 1, ?)`,
  );
  let added = 0,
    updated = 0;
  db.transaction(() => {
    for (const e of episodes) {
      const r = upd.run(e.title, e.airDate, e.overview, e.providerRef, segmentId, e.number);
      let epId: number | null = null;
      if (r.changes) {
        updated++;
        epId = (db.prepare(`SELECT id FROM episode WHERE segment_id=? AND number=?`).get(segmentId, e.number) as { id: number }).id;
      } else if (opts.grow) {
        epId = Number(ins.run(segmentId, e.number, e.title, e.airDate, e.overview, e.providerRef).lastInsertRowid);
        added++;
      }
      if (epId && e.filler) seedFiller.run(epId, nowIso());
    }
    if (opts.grow) {
      // Fill gaps so numbering is contiguous (providers sometimes skip numbers).
      const max = (db.prepare(`SELECT COALESCE(MAX(number),0) n FROM episode WHERE segment_id=?`).get(segmentId) as { n: number }).n;
      ensureEpisodeCount(db, segmentId, max);
    }
  })();
  return { added, updated };
}

export function segmentMediaId(segmentId: number, db = getDb()): number | null {
  const r = db.prepare(`SELECT media_id FROM segment WHERE id = ?`).get(segmentId) as { media_id: number } | undefined;
  return r?.media_id ?? null;
}

/* ---------------- episode assessments ---------------- */

export interface AssessmentPatch {
  state?: EpisodeState;
  rating?: number | null;
  filler?: boolean;
  title?: string | null;
}

function episodeBelongs(db: DB, mediaId: number, episodeId: number): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM episode e JOIN segment s ON s.id = e.segment_id WHERE e.id = ? AND s.media_id = ?`).get(episodeId, mediaId),
  );
}

function writeAssessment(db: DB, mediaId: number, episodeId: number, patch: AssessmentPatch, now: string) {
  const cur = db.prepare(`SELECT * FROM episode_assessment WHERE episode_id = ?`).get(episodeId) as
    | { state: EpisodeState; rating: number | null; filler: number; watched_at: string | null }
    | undefined;
  let state: EpisodeState = patch.state ?? cur?.state ?? "unwatched";
  let rating = patch.rating !== undefined ? patch.rating : cur?.rating ?? null;
  // Rating implies watched; leaving "watched" clears the rating. Filler is independent.
  if (patch.rating != null) state = "watched";
  if (state !== "watched") rating = null;
  const filler = patch.filler !== undefined ? patch.filler : Boolean(cur?.filler);
  const becameWatched = state === "watched" && (cur?.state !== "watched" || patch.rating != null);
  const watchedAt = state === "watched" ? (becameWatched ? now : cur?.watched_at ?? now) : null;
  db.prepare(
    `INSERT INTO episode_assessment (episode_id, state, rating, filler, watched_at, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(episode_id) DO UPDATE SET state=excluded.state, rating=excluded.rating, filler=excluded.filler,
       watched_at=excluded.watched_at, updated_at=excluded.updated_at`,
  ).run(episodeId, state, rating, filler ? 1 : 0, watchedAt, now);
  if (patch.title !== undefined) db.prepare(`UPDATE episode SET title = ? WHERE id = ?`).run(patch.title, episodeId);
  if (becameWatched) touchWatched(db, mediaId, now);
}

export function setAssessment(mediaId: number, episodeId: number, patch: AssessmentPatch, db = getDb()) {
  if (!episodeBelongs(db, mediaId, episodeId)) throw new RepoError("not_found", "Episode not found for this show.");
  db.transaction(() => {
    writeAssessment(db, mediaId, episodeId, patch, nowIso());
    audit(db, "assess", "episode", episodeId, patch);
  })();
  return getSegments(mediaId, db);
}

export function bulkAssess(
  mediaId: number,
  episodeIds: number[],
  action: "watched" | "unwatched" | "skipped" | "rate" | "rate_unrated" | "filler_on" | "filler_off",
  rating: number | null | undefined,
  db = getDb(),
) {
  db.transaction(() => {
    const now = nowIso();
    for (const id of episodeIds) {
      if (!episodeBelongs(db, mediaId, id)) throw new RepoError("not_found", `Episode ${id} not found for this show.`);
      const cur = db.prepare(`SELECT rating FROM episode_assessment WHERE episode_id = ?`).get(id) as { rating: number | null } | undefined;
      const patch: AssessmentPatch =
        action === "rate"
          ? { rating: rating ?? null, state: rating == null ? "unwatched" : "watched" }
          : action === "rate_unrated"
            ? cur?.rating != null
              ? {}
              : { rating: rating ?? null }
            : action === "filler_on"
              ? { filler: true }
              : action === "filler_off"
                ? { filler: false }
                : { state: action };
      if (action === "rate_unrated" && (cur?.rating != null || rating == null)) continue;
      writeAssessment(db, mediaId, id, patch, now);
    }
    audit(db, "bulk_assess", "media", mediaId, { action, count: episodeIds.length, rating });
  })();
  return getSegments(mediaId, db);
}

export function applyTextAssignments(
  mediaId: number,
  resolved: { episodeId: number; state: EpisodeState; rating: number | null; filler: boolean | undefined }[],
  db = getDb(),
) {
  db.transaction(() => {
    const now = nowIso();
    for (const r of resolved) writeAssessment(db, mediaId, r.episodeId, { state: r.state, rating: r.rating, filler: r.filler }, now);
    audit(db, "import_text", "media", mediaId, { count: resolved.length });
  })();
  return getSegments(mediaId, db);
}

/* ---------------- dedupe helpers ---------------- */

export function findByProviderIds(
  type: MediaType,
  ids: { tmdbId?: number | null; imdbId?: string | null; malId?: number | null; tvmazeId?: number | null; anilistId?: number | null },
  db = getDb(),
): number | null {
  const tries: [string, unknown][] = [
    ["tmdb_id", ids.tmdbId],
    ["imdb_id", ids.imdbId],
    ["mal_id", ids.malId],
    ["tvmaze_id", ids.tvmazeId],
    ["anilist_id", ids.anilistId],
  ];
  for (const [col, v] of tries) {
    if (v == null || v === "") continue;
    const r = db.prepare(`SELECT id FROM media WHERE type = ? AND ${col} = ?`).get(type, v) as { id: number } | undefined;
    if (r) return r.id;
  }
  return null;
}

export function findByTitleYear(type: MediaType, title: string, year: number | null, db = getDb()): number | null {
  const want = normalizeTitle(title);
  const rows = db.prepare(`SELECT id, title, original_title, year FROM media WHERE type = ?`).all(type) as {
    id: number;
    title: string;
    original_title: string | null;
    year: number | null;
  }[];
  const hit = rows.find(
    (r) =>
      (normalizeTitle(r.title) === want || (r.original_title && normalizeTitle(r.original_title) === want)) &&
      (year == null || r.year == null || Math.abs(r.year - year) <= 1),
  );
  return hit?.id ?? null;
}
