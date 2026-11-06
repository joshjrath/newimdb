import crypto from "node:crypto";
import { getDb, nowIso, type DB } from "../db";
import { RepoError } from "../errors";
import type { EpisodeState, EpisodeView, GenreRef, MediaDetail, MediaType, MediaView, PersonRef, ReviewSource, ReviewView, SegmentView, WatchStatus } from "../domain/types";
import { METADATA_KEYS, type BulkAssessAction, type BulkMediaAction, type CreateMediaInput, type MetadataInput, type ProviderEpisode, type ReviewInput, type SegmentInput } from "../schemas";
import { resolveAssessment, UNASSESSED, type AssessmentPatch } from "../domain/assessment";
import { activePointer, airingNow, computeProgress, progressFromCounts, returningSeason, upcomingPremiere, type ActivePointer, type Airing, type Progress, type Returning, type Upcoming } from "../domain/progress";
import { normalizeTitle } from "../domain/text";
import { naturalDir, type SortDir, type SortKey } from "../domain/sort";
import { audit } from "./audit";
import { setMediaTags, tagsFor, tagsForMany } from "./tags";
import { applyGenres, genresForMany, setMediaGenre, setMediaGenres } from "./genres";
import { applyAutoStatus, markStatusManual } from "./autoStatus";
import { addPersonTo, peopleFor, peopleForMany, removePersonFrom, requirePerson, setMediaPeople } from "./people";

export { RepoError };

/* ---------------- row mapping ---------------- */

type Row = Record<string, unknown>;
type MediaRow = Row & { id: number };

const placeholders = (n: number) => Array(n).fill("?").join(",");

function parseJsonArray(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/** camelCase field → column. Every metadata field the API accepts is listed here. */
const METADATA_COLUMNS: Record<keyof MetadataInput, string> = {
  title: "title",
  originalTitle: "original_title",
  year: "year",
  releaseDate: "release_date",
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
const JSON_COLUMNS = new Set(["genres", "locked_fields"]);
/** A YYYY-MM-DD date, or null. */
export const isoDay = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

const REVIEW_COLUMNS: Record<keyof ReviewInput, string> = {
  rating: "rating",
  ratingLabel: "rating_label",
  body: "body",
  watchedOn: "watched_on",
  spoiler: "spoiler",
  status: "status",
  featured: "featured",
  watchedIn: "watched_in",
  visibility: "visibility",
};

function mapReview(r: Row | undefined, m: MediaRow): ReviewView {
  return {
    rating: (r?.rating as number | null) ?? null,
    ratingLabel: (r?.rating_label as string | null) ?? null,
    body: (r?.body as string) ?? "",
    watchedOn: (r?.watched_on as string | null) ?? null,
    spoiler: Boolean(r?.spoiler),
    status: (r?.status as WatchStatus | null) ?? null,
    featured: Boolean(r?.featured),
    watchedIn: (r?.watched_in as "theater" | "streaming" | null) ?? null,
    visibility: "private",
    source: (r?.source as ReviewSource) ?? "manual",
    sourceRef: (r?.source_ref as string | null) ?? null,
    lastWatchedAt: (r?.last_watched_at as string | null) ?? null,
    createdAt: (r?.created_at as string) ?? (m.created_at as string),
    updatedAt: (r?.updated_at as string) ?? (m.updated_at as string),
  };
}

function mapMedia(m: MediaRow, r: Row | undefined, tags: string[], people: PersonRef[], genreFilters: GenreRef[]): MediaView {
  const meta = Object.fromEntries(
    METADATA_KEYS.map((k) => {
      const col = METADATA_COLUMNS[k];
      return [k, JSON_COLUMNS.has(col) ? parseJsonArray(m[col]) : (m[col] ?? null)];
    }),
  ) as unknown as MetadataInput;
  return {
    ...meta,
    id: m.id,
    uid: m.uid as string,
    type: m.type as MediaType,
    version: m.version as number,
    createdAt: m.created_at as string,
    updatedAt: m.updated_at as string,
    review: mapReview(r, m),
    tags,
    people,
    genreFilters,
    imdb:
      m.imdb_rating != null
        ? { rating: m.imdb_rating as number, votes: (m.imdb_votes as number | null) ?? null }
        : m.third_party_rating != null && m.third_party_rating_source === "IMDb"
          ? { rating: m.third_party_rating as number, votes: null }
          : null,
  };
}

/** The metadata half of an entry, in the same shape the API and backups accept. */
export function metadataOf(m: MediaView): MetadataInput {
  return Object.fromEntries(METADATA_KEYS.map((k) => [k, m[k]])) as unknown as MetadataInput;
}

function toSql(v: unknown): unknown {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined ? null : v;
}

/* ---------------- reads ---------------- */

export function getMedia(id: number, db = getDb()): MediaView | null {
  const m = db.prepare(`SELECT * FROM media WHERE id = ?`).get(id) as MediaRow | undefined;
  if (!m) return null;
  const r = db.prepare(`SELECT * FROM review WHERE media_id = ?`).get(id) as Row | undefined;
  return mapMedia(m, r, tagsFor(db, id), peopleFor(db, id), genresForMany(db, [id]).get(id) ?? []);
}

/** For write paths and routes: the entry must exist. */
export function requireMedia(id: number, db = getDb()): MediaView {
  const m = getMedia(id, db);
  if (!m) throw new RepoError("not_found", "This entry no longer exists.");
  return m;
}

function mapEpisode(e: Row): EpisodeView {
  return {
    id: e.id as number,
    segmentId: e.segment_id as number,
    number: e.number as number,
    title: (e.title as string | null) ?? null,
    airDate: (e.air_date as string | null) ?? null,
    overview: (e.overview as string | null) ?? null,
    state: (e.state as EpisodeState | null) ?? "unwatched",
    rating: (e.rating as number | null) ?? null,
    filler: Boolean(e.filler),
    watchedAt: (e.watched_at as string | null) ?? null,
  };
}

/** Segments (in watch order) with episodes (in number order) for several entries at once. */
function segmentsFor(db: DB, mediaIds: number[], opts: { overview?: boolean } = {}): Map<number, SegmentView[]> {
  const out = new Map<number, SegmentView[]>();
  if (!mediaIds.length) return out;
  const ids = placeholders(mediaIds.length);
  const segs = db.prepare(`SELECT * FROM segment WHERE media_id IN (${ids}) ORDER BY position, id`).all(...mediaIds) as Row[];
  const eps = db
    .prepare(
      `SELECT e.id, e.segment_id, e.number, e.title, e.air_date, ${opts.overview === false ? "NULL AS overview" : "e.overview"},
              a.state, a.rating, a.filler, a.watched_at
       FROM episode e JOIN segment s ON s.id = e.segment_id LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE s.media_id IN (${ids}) ORDER BY e.segment_id, e.number`,
    )
    .all(...mediaIds) as Row[];
  const bySeg = new Map<number, EpisodeView[]>();
  for (const e of eps) {
    const ep = mapEpisode(e);
    bySeg.set(ep.segmentId, [...(bySeg.get(ep.segmentId) ?? []), ep]);
  }
  for (const s of segs) {
    const mediaId = s.media_id as number;
    out.set(mediaId, [
      ...(out.get(mediaId) ?? []),
      {
        id: s.id as number,
        kind: s.kind as SegmentView["kind"],
        label: s.label as string,
        seasonNumber: (s.season_number as number | null) ?? null,
        courNumber: (s.cour_number as number | null) ?? null,
        position: s.position as number,
        provider: (s.provider as string | null) ?? null,
        providerRef: (s.provider_ref as string | null) ?? null,
        episodes: bySeg.get(s.id as number) ?? [],
      },
    ]);
  }
  return out;
}

export function getSegments(mediaId: number, db = getDb(), opts: { overview?: boolean } = {}): SegmentView[] {
  return segmentsFor(db, [mediaId], opts).get(mediaId) ?? [];
}

export function getMediaDetail(id: number, db = getDb(), opts: { overview?: boolean } = {}): MediaDetail | null {
  const m = getMedia(id, db);
  return m && { ...m, segments: getSegments(id, db, opts) };
}

export function getEpisode(episodeId: number, db = getDb()): EpisodeView | null {
  const e = db
    .prepare(
      `SELECT e.*, a.state, a.rating, a.filler, a.watched_at FROM episode e
       LEFT JOIN episode_assessment a ON a.episode_id = e.id WHERE e.id = ?`,
    )
    .get(episodeId) as Row | undefined;
  return e ? mapEpisode(e) : null;
}

export type { SortKey };

/** Not out yet (and not watched or rated): the SQL twin of isUnaired(). Expects `e` (episode) and `a` (assessment). */
const UNAIRED_SQL = `(COALESCE(a.state, 'unwatched') = 'unwatched' AND a.rating IS NULL AND (
    e.air_date = 'TBA'
    OR (length(e.air_date) = 4 AND (CAST(e.air_date AS INTEGER) > CAST(strftime('%Y', 'now') AS INTEGER)
        OR (CAST(e.air_date AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER) AND (e.title IS NULL OR trim(e.title) = '' OR lower(e.title) GLOB 'episode*[0-9]*'))))
    OR (length(e.air_date) >= 10 AND substr(e.air_date, 1, 10) > date('now'))))`;

/** A show's percent watched (null when there's nothing to watch), for sorting by progress. */
/** Anime filler you haven't watched (and that's out): left out of progress. Expects `m`, `e`, `a`. */
const SKIPPABLE_FILLER_SQL = `(m.type = 'anime' AND COALESCE(a.filler, 0) = 1 AND COALESCE(a.state, 'unwatched') = 'unwatched' AND a.rating IS NULL AND NOT COALESCE(${UNAIRED_SQL}, 0))`;

const PERCENT_SQL = `(SELECT 100.0 * SUM(a.state = 'watched') / NULLIF(COUNT(e.id) - SUM(COALESCE(a.state, '') = 'skipped') - SUM(${UNAIRED_SQL}) - SUM(${SKIPPABLE_FILLER_SQL}), 0)
   FROM segment s JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id WHERE s.media_id = m.id)`;

/** Each sort, both ways. The first is the natural direction (what the menu shows first). */
const lastWatched = `COALESCE(r.last_watched_at, r.watched_on, r.created_at)`;
/** IMDb's rating: the refreshed one, else the one saved at import. Not yours. */
const IMDB_SQL = `COALESCE(m.imdb_rating, CASE WHEN m.third_party_rating_source = 'IMDb' THEN m.third_party_rating END)`;
const ORDER_BY: Record<SortKey, Record<SortDir, string>> = {
  recent: { desc: `${lastWatched} DESC, m.id DESC`, asc: `${lastWatched} IS NULL, ${lastWatched} ASC, m.id ASC` },
  rating: { desc: `r.rating IS NULL, r.rating DESC, ${lastWatched} DESC`, asc: `r.rating IS NULL, r.rating ASC, ${lastWatched} DESC` },
  imdb: { desc: `${IMDB_SQL} IS NULL, ${IMDB_SQL} DESC, m.imdb_votes DESC`, asc: `${IMDB_SQL} IS NULL, ${IMDB_SQL} ASC, m.imdb_votes DESC` },
  title: { asc: `m.title COLLATE NOCASE ASC`, desc: `m.title COLLATE NOCASE DESC` },
  year: { desc: `m.year IS NULL, m.year DESC, m.title COLLATE NOCASE`, asc: `m.year IS NULL, m.year ASC, m.title COLLATE NOCASE` },
  added: { desc: `m.created_at DESC, m.id DESC`, asc: `m.created_at ASC, m.id ASC` },
  progress: { desc: `${PERCENT_SQL} IS NULL, ${PERCENT_SQL} DESC, ${lastWatched} DESC`, asc: `${PERCENT_SQL} IS NULL, ${PERCENT_SQL} ASC, ${lastWatched} DESC` },
};

export interface ListQuery {
  type?: MediaType;
  status?: WatchStatus | "none";
  /** Any of these statuses (several picked at once). */
  statuses?: WatchStatus[];
  tag?: string;
  /** Only titles watched with ALL of these people. */
  withPeople?: number[];
  /** Only titles IMDb rates at least this (out of 10). */
  minImdb?: number;
  /** Titles you watched alone: nobody marked in "Watched with" (Plan to watch left out). */
  alone?: boolean;
  /** Movies watched in a theater or streaming. */
  watchedIn?: "theater" | "streaming";
  /** Only titles in this genre filter. */
  genre?: number;
  q?: string;
  featured?: boolean;
  sort?: SortKey;
  /** Reverse a sort (e.g. oldest watched first). Defaults to the sort's natural direction. */
  dir?: SortDir;
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
  else if (query.statuses?.length) {
    where.push(`r.status IN (${placeholders(query.statuses.length)})`);
    params.push(...query.statuses);
  } else if (query.status) {
    where.push(`r.status = ?`);
    params.push(query.status);
  }
  if (query.featured) where.push(`r.featured = 1`);
  if (query.tag) {
    where.push(`EXISTS (SELECT 1 FROM media_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.media_id = m.id AND t.name = ? COLLATE NOCASE)`);
    params.push(query.tag);
  }
  if (query.minImdb) {
    where.push(`${IMDB_SQL} >= ?`);
    params.push(query.minImdb);
  }
  if (query.alone) where.push(`NOT EXISTS (SELECT 1 FROM media_person mp WHERE mp.media_id = m.id) AND COALESCE(r.status, '') != 'plan'`);
  for (const p of query.withPeople ?? []) {
    where.push(`EXISTS (SELECT 1 FROM media_person mp WHERE mp.media_id = m.id AND mp.person_id = ?)`);
    params.push(p);
  }
  if (query.watchedIn) {
    where.push(`r.watched_in = ?`);
    params.push(query.watchedIn);
  }
  if (query.genre) {
    where.push(`EXISTS (SELECT 1 FROM media_genre mg WHERE mg.media_id = m.id AND mg.genre_id = ? AND mg.state != 'excluded')`);
    params.push(query.genre);
  }
  if (query.q?.trim()) {
    where.push(`(m.title LIKE ? ESCAPE '\\' OR m.original_title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    params.push(like, like, like);
  }
  // Sorting by progress lists shows you haven't finished (100% ones are left out).
  if (query.sort === "progress") where.push(`m.type != 'movie' AND COALESCE(${PERCENT_SQL}, 0) < 100`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const total = (db.prepare(`SELECT COUNT(*) n FROM media m LEFT JOIN review r ON r.media_id = m.id ${whereSql}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT m.*, r.rating, r.rating_label, r.body, r.watched_on, r.spoiler, r.status, r.featured, r.visibility,
              r.source, r.source_ref, r.last_watched_at, r.watched_in, r.created_at AS r_created_at, r.updated_at AS r_updated_at
       FROM media m LEFT JOIN review r ON r.media_id = m.id ${whereSql}
       ORDER BY ${ORDER_BY[query.sort ?? "recent"][query.dir ?? naturalDir(query.sort ?? "recent")]} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as MediaRow[];
  const ids = rows.map((r) => r.id);
  const tags = tagsForMany(db, ids);
  const people = peopleForMany(db, ids);
  const genres = genresForMany(db, ids);
  const progress = progressFor(db, rows.filter((r) => r.type !== "movie").map((r) => r.id));
  const items = rows.map((row) => ({
    ...mapMedia(row, { ...row, created_at: row.r_created_at, updated_at: row.r_updated_at }, tags.get(row.id) ?? [], people.get(row.id) ?? [], genres.get(row.id) ?? []),
    progress: progress.get(row.id) ?? null,
  }));
  return { items, total, page, pageSize };
}

function progressFor(db: DB, ids: number[]): Map<number, Progress> {
  if (!ids.length) return new Map();
  const rows = db
    .prepare(
      `SELECT s.media_id AS id, COUNT(e.id) AS total,
              SUM(CASE WHEN a.state = 'watched' THEN 1 ELSE 0 END) AS watched,
              SUM(CASE WHEN a.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
              SUM(CASE WHEN a.state = 'skipped' THEN 1 ELSE 0 END) AS skipped,
              SUM(CASE WHEN ${UNAIRED_SQL} THEN 1 ELSE 0 END) AS unaired,
              SUM(CASE WHEN ${SKIPPABLE_FILLER_SQL} THEN 1 ELSE 0 END) AS filler
       FROM segment s JOIN media m ON m.id = s.media_id JOIN episode e ON e.segment_id = s.id
       LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE s.media_id IN (${placeholders(ids.length)}) GROUP BY s.media_id`,
    )
    .all(...ids) as { id: number; total: number; watched: number; rated: number; skipped: number; unaired: number; filler: number }[];
  return new Map(rows.map(({ id, ...counts }) => [id, progressFromCounts(counts)]));
}

export interface WatchingItem extends ListItem {
  progress: Progress;
  pointer: ActivePointer;
}

/** The "Currently Watching" strip: status = watching, most recently progressed first. */
export function listWatching(type?: MediaType, db = getDb()): WatchingItem[] {
  const { items } = listMedia({ type, status: "watching", sort: "recent", pageSize: 50 }, db);
  const segments = segmentsFor(db, items.map((m) => m.id), { overview: false });
  return items.map((m) => {
    const segs = segments.get(m.id) ?? [];
    return { ...m, progress: m.progress ?? computeProgress([]), pointer: activePointer(segs, { ignoreFiller: m.type === "anime" }) };
  });
}

export interface ReturningItem extends MediaView {
  returning: Returning;
}
export interface AiringItem extends MediaView {
  airing: Airing;
}
export interface UpcomingItem extends MediaView {
  upcoming: Upcoming;
}

/**
 * The TV and Anime strips, worked out from each show's episodes and air dates:
 *  - airing: a season that has started and still has episodes to come
 *  - upcoming: shows you've added that haven't premiered yet
 *  - returning: shows you'd finished that have a new season
 * Dropped shows are left out of all three.
 */
export function listShowSections(type: MediaType, db = getDb()): { airing: AiringItem[]; upcoming: UpcomingItem[]; returning: ReturningItem[] } {
  const rows = db
    .prepare(`SELECT m.id FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.type = ? AND COALESCE(r.status, '') != 'dropped'`)
    .all(type) as { id: number }[];
  const ids = rows.map((r) => r.id);
  const segments = segmentsFor(db, ids, { overview: false });
  const media = new Map<number, MediaView>();
  const view = (id: number) => media.get(id) ?? media.set(id, getMedia(id, db)!).get(id)!;
  const airing: AiringItem[] = [];
  const upcoming: UpcomingItem[] = [];
  const returning: ReturningItem[] = [];
  const year = (id: number) => (db.prepare(`SELECT year FROM media WHERE id = ?`).get(id) as { year: number | null }).year;
  for (const id of ids) {
    const segs = segments.get(id) ?? [];
    const a = airingNow(segs);
    if (a) airing.push({ ...view(id), airing: a });
    const u = a ? null : upcomingPremiere(segs, year(id));
    if (u) upcoming.push({ ...view(id), upcoming: u });
    const r = returningSeason(segs);
    if (r) returning.push({ ...view(id), returning: r });
  }
  const byDate = (x: string | null, y: string | null) => (x ?? "9999").localeCompare(y ?? "9999");
  airing.sort((a, b) => byDate(a.airing.nextAirDate, b.airing.nextAirDate) || a.title.localeCompare(b.title));
  upcoming.sort((a, b) => byDate(a.upcoming.premiere, b.upcoming.premiere) || (a.upcoming.year ?? 9999) - (b.upcoming.year ?? 9999) || a.title.localeCompare(b.title));
  returning.sort(
    (a, b) =>
      (a.returning.state === "out" ? 0 : 1) - (b.returning.state === "out" ? 0 : 1) ||
      byDate(a.returning.nextAirDate, b.returning.nextAirDate) ||
      a.title.localeCompare(b.title),
  );
  return { airing, upcoming, returning };
}

export function countMedia(db = getDb()) {
  const rows = db.prepare(`SELECT type, COUNT(*) n FROM media GROUP BY type`).all() as { type: MediaType; n: number }[];
  const by: Record<MediaType, number> = { movie: 0, tv: 0, anime: 0 };
  for (const r of rows) by[r.type] = r.n;
  return { ...by, total: by.movie + by.tv + by.anime };
}

/* ---------------- writes ---------------- */

function bumpVersion(db: DB, id: number): number {
  return (db.prepare(`UPDATE media SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version`).get(nowIso(), id) as { version: number }).version;
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

function writeColumns(db: DB, table: "media" | "review", key: "id" | "media_id", id: number, cols: [string, unknown][]) {
  if (!cols.length) return;
  db.prepare(`UPDATE ${table} SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE ${key} = ?`).run(...cols.map(([, v]) => toSql(v)), id);
}

function writeMetadata(db: DB, id: number, meta: Partial<MetadataInput>) {
  const keys = (Object.keys(meta) as (keyof MetadataInput)[]).filter((k) => k in METADATA_COLUMNS);
  writeColumns(db, "media", "id", id, keys.map((k) => [METADATA_COLUMNS[k], meta[k]]));
  if (keys.includes("genres")) applyGenres(db, { mediaIds: [id] }); // keep genre filters in step with the title's genres
}

function writeReview(db: DB, id: number, review: Partial<ReviewInput>) {
  const now = nowIso();
  db.prepare(`INSERT OR IGNORE INTO review (media_id, created_at, updated_at) VALUES (?, ?, ?)`).run(id, now, now);
  const keys = (Object.keys(review) as (keyof ReviewInput)[]).filter((k) => k in REVIEW_COLUMNS);
  if (!keys.length) return;
  writeColumns(db, "review", "media_id", id, [...keys.map((k): [string, unknown] => [REVIEW_COLUMNS[k], review[k]]), ["updated_at", now]]);
  if (review.watchedOn) touchWatched(db, id, review.watchedOn);
}

/** Recently Watched: keep the latest real activity (movie watch date or an episode being watched). */
export function touchWatched(db: DB, mediaId: number, at: string) {
  db.prepare(
    `UPDATE review SET last_watched_at = ? WHERE media_id = ? AND (last_watched_at IS NULL OR last_watched_at < ?)`,
  ).run(at, mediaId, at);
}

export interface CreateOptions {
  source?: ReviewSource;
  sourceRef?: string | null;
  uid?: string;
}

/** Insert an entry with its review, tags and structure. Returns the new id. */
export function insertMedia(input: CreateMediaInput, opts: CreateOptions = {}, db = getDb()): number {
  return db.transaction(() => {
    const now = nowIso();
    const { id } = db
      .prepare(`INSERT INTO media (uid, type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id`)
      .get(opts.uid ?? crypto.randomUUID(), input.type, input.metadata.title, now, now) as { id: number };
    writeMetadata(db, id, input.metadata);
    writeReview(db, id, { visibility: "private", ...input.review });
    db.prepare(`UPDATE review SET source = ?, source_ref = ?, last_watched_at = COALESCE(last_watched_at, ?) WHERE media_id = ?`).run(
      opts.source ?? "manual",
      opts.sourceRef ?? null,
      now,
      id,
    );
    if (input.tags) setMediaTags(db, id, input.tags);
    if (input.people?.length) setMediaPeople(db, id, input.people);
    (input.segments ?? []).forEach((s, i) => {
      const segId = insertSegment(db, id, s, i);
      if (s.episodes?.length) applyProviderEpisodes(segId, s.episodes, { grow: true }, db);
      else ensureEpisodeCount(db, segId, s.episodeCount);
    });
    audit(db, "create", "media", id, { title: input.metadata.title, type: input.type, source: opts.source ?? "manual" });
    return id;
  })();
}

export function createMedia(input: CreateMediaInput, opts: CreateOptions = {}, db = getDb()): MediaView {
  return getMedia(insertMedia(input, opts, db), db)!;
}

export function updateMedia(
  id: number,
  patch: { version: number; metadata?: Partial<MetadataInput>; review?: Partial<ReviewInput>; tags?: string[]; people?: number[]; genreFilters?: number[] },
  db = getDb(),
): MediaView {
  db.transaction(() => {
    checkVersion(db, id, patch.version);
    if (patch.metadata) writeMetadata(db, id, patch.metadata);
    const before = (db.prepare(`SELECT status FROM review WHERE media_id = ?`).get(id) as { status: string | null } | undefined)?.status ?? null;
    if (patch.review) writeReview(db, id, patch.review);
    if (patch.review && "status" in patch.review && (patch.review.status ?? null) !== before) markStatusManual(db, id);
    if (patch.tags) setMediaTags(db, id, patch.tags);
    if (patch.people) setMediaPeople(db, id, patch.people);
    if (patch.genreFilters) setMediaGenres(db, id, patch.genreFilters);
    bumpVersion(db, id);
    audit(db, "update", "media", id, {
      metadata: patch.metadata && Object.keys(patch.metadata),
      review: patch.review && Object.keys(patch.review),
      tags: patch.tags,
      people: patch.people,
      genreFilters: patch.genreFilters,
    });
  })();
  return getMedia(id, db)!;
}

/** Metadata refresh: only touches unlocked metadata fields, never review/ratings/structure. */
export function applyMetadataRefresh(id: number, meta: Partial<MetadataInput>, db = getDb()): MediaView {
  const locked = new Set(requireMedia(id, db).lockedFields);
  const safe = Object.fromEntries(
    Object.entries(meta).filter(
      // never blank out data, never override a locked field
      ([k, v]) => k !== "lockedFields" && !locked.has(k) && v != null && !(Array.isArray(v) && v.length === 0),
    ),
  ) as Partial<MetadataInput>;
  db.transaction(() => {
    writeMetadata(db, id, safe);
    bumpVersion(db, id);
    audit(db, "refresh_metadata", "media", id, { fields: Object.keys(safe) });
  })();
  return getMedia(id, db)!;
}

/**
 * Fill only what's empty (poster, backdrop, overview, provider ids) and never a locked field.
 * Used by the background poster fetch, so it never overwrites anything you set yourself.
 */
export function fillEmptyMetadata(id: number, meta: Partial<MetadataInput>, db = getDb()): string[] {
  const cur = getMedia(id, db);
  if (!cur) return [];
  const locked = new Set(cur.lockedFields);
  const fill = Object.fromEntries(
    (Object.entries(meta) as [keyof MetadataInput, unknown][]).filter(([k, v]) => {
      const empty = (x: unknown) => x == null || x === "" || (Array.isArray(x) && x.length === 0);
      return !empty(v) && !locked.has(k) && empty(cur[k]);
    }),
  ) as Partial<MetadataInput>;
  const keys = Object.keys(fill);
  if (!keys.length) return [];
  db.transaction(() => {
    writeMetadata(db, id, fill);
    bumpVersion(db, id); // an edit form open on this title then asks to reload instead of blanking the poster
    audit(db, "fill_metadata", "media", id, { fields: keys });
  })();
  return keys;
}

/** Titles with an IMDb id and no poster, oldest first. */
export function missingPosterIds(db = getDb()): { id: number; type: MediaType; imdbId: string }[] {
  return db
    .prepare(`SELECT id, type, imdb_id AS imdbId FROM media WHERE (poster_url IS NULL OR poster_url = '') AND imdb_id IS NOT NULL AND imdb_id != '' ORDER BY id`)
    .all() as { id: number; type: MediaType; imdbId: string }[];
}

export function deleteMedia(ids: number[], db = getDb()): number {
  return db.transaction(() => {
    let n = 0;
    for (const id of ids) {
      if (db.prepare(`DELETE FROM media WHERE id = ?`).run(id).changes) {
        n++;
        audit(db, "delete", "media", id);
      }
    }
    return n;
  })();
}

export function bulkUpdate(ids: number[], action: BulkMediaAction, opts: { status?: WatchStatus | null; tag?: string; personId?: number; mediaType?: MediaType; watchedIn?: "theater" | "streaming" | null; genreId?: number }, db = getDb()): number {
  if (action === "delete") return deleteMedia(ids, db);
  if (action === "set_type") {
    if (!opts.mediaType) throw new RepoError("invalid", "Pick Movies, TV Shows or Anime.");
    return setMediaType(ids, opts.mediaType, db);
  }
  const tag = opts.tag?.toLowerCase();
  if ((action === "add_person" || action === "remove_person") && !opts.personId) throw new RepoError("invalid", "Pick a person.");
  return db.transaction(() => {
    if (opts.personId) requirePerson(db, opts.personId);
    const existing = (db.prepare(`SELECT id FROM media WHERE id IN (${placeholders(ids.length)})`).all(...ids) as { id: number }[]).map((r) => r.id);
    for (const id of existing) {
      if (action === "feature" || action === "unfeature") writeReview(db, id, { featured: action === "feature" });
      else if (action === "set_status") {
        writeReview(db, id, { status: opts.status ?? null });
        markStatusManual(db, id);
      }
      else if (action === "add_tag" && opts.tag) setMediaTags(db, id, [...tagsFor(db, id), opts.tag]);
      else if (action === "remove_tag" && tag) setMediaTags(db, id, tagsFor(db, id).filter((x) => x.toLowerCase() !== tag));
      else if ((action === "add_genre" || action === "remove_genre") && opts.genreId) setMediaGenre(db, id, opts.genreId, action === "add_genre");
      else if (action === "set_watched_in") writeReview(db, id, { watchedIn: opts.watchedIn ?? null });
      else if (action === "add_person") addPersonTo(db, id, opts.personId!);
      else if (action === "remove_person") removePersonFrom(db, id, opts.personId!);
      bumpVersion(db, id);
    }
    audit(db, "bulk_" + action, "media", ids.join(","), opts);
    return existing.length;
  })();
}

/**
 * Move titles to another category. Your choice is kept: the automatic anime check never
 * moves them again. Reviews, ratings and episodes come along unchanged.
 */
export function setMediaType(ids: number[], type: MediaType, db = getDb()): number {
  if (!ids.length) return 0;
  return db.transaction(() => {
    const n = db
      .prepare(`UPDATE media SET type = ?, type_locked = 1, type_checked_at = ?, version = version + 1, updated_at = ? WHERE id IN (${placeholders(ids.length)})`)
      .run(type, nowIso(), nowIso(), ...ids).changes;
    audit(db, "set_type", "media", ids.join(","), { type });
    return n;
  })();
}

/* ---------------- structure ---------------- */

function insertSegment(db: DB, mediaId: number, s: Omit<SegmentInput, "id">, position: number): number {
  const now = nowIso();
  return (
    db
      .prepare(
        `INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, provider, provider_ref, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      )
      .get(mediaId, s.kind, s.label, s.seasonNumber, s.courNumber, position, s.provider ?? null, s.providerRef ?? null, now, now) as { id: number }
  ).id;
}

/** Make sure episodes 1..count exist (the UNIQUE(segment_id, number) constraint skips existing ones). */
function ensureEpisodeCount(db: DB, segmentId: number, count: number) {
  const ins = db.prepare(`INSERT OR IGNORE INTO episode (segment_id, number) VALUES (?, ?)`);
  for (let n = 1; n <= count; n++) ins.run(segmentId, n);
}

/** Episodes in a segment that carry owner data (rating, watch state or filler), optionally only above a number. */
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

const episodeCount = (db: DB, segmentId: number, aboveNumber = 0) =>
  (db.prepare(`SELECT COUNT(*) n FROM episode WHERE segment_id = ? AND number > ?`).get(segmentId, aboveNumber) as { n: number }).n;

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
    const bad = input.segments.find((s) => s.id != null && !existingIds.has(s.id));
    if (bad) throw new RepoError("invalid", `Segment ${bad.id} doesn't belong to this entry.`);

    const keep = new Set(input.segments.flatMap((s) => (s.id ? [s.id] : [])));
    const removed = existing.filter((s) => !keep.has(s.id));
    const losses = [
      ...removed.map((s) => ({ segment: s.label, episodes: episodeCount(db, s.id), withData: assessedCount(db, s.id) })),
      ...input.segments.flatMap((s) =>
        s.id == null ? [] : [{ segment: s.label, episodes: episodeCount(db, s.id, s.episodeCount), withData: assessedCount(db, s.id, s.episodeCount) }],
      ),
    ].filter((l) => l.withData > 0);
    if (losses.length && !input.confirmLoss) {
      throw new RepoError("needs_confirmation", "This change would delete episodes that have ratings or watch states.", { losses });
    }

    for (const s of removed) db.prepare(`DELETE FROM segment WHERE id = ?`).run(s.id);
    const now = nowIso();
    input.segments.forEach((s, position) => {
      const segId = s.id ?? insertSegment(db, mediaId, s, position);
      if (s.id != null) {
        db.prepare(
          `UPDATE segment SET kind=?, label=?, season_number=?, cour_number=?, position=?, updated_at=?,
             provider = COALESCE(?, provider), provider_ref = COALESCE(?, provider_ref) WHERE id = ?`,
        ).run(s.kind, s.label, s.seasonNumber, s.courNumber, position, now, s.provider ?? null, s.providerRef ?? null, segId);
      }
      db.prepare(`DELETE FROM episode WHERE segment_id = ? AND number > ?`).run(segId, s.episodeCount);
      ensureEpisodeCount(db, segId, s.episodeCount);
    });
    const version = bumpVersion(db, mediaId);
    audit(db, "save_structure", "media", mediaId, { segments: input.segments.length, losses });
    return { segments: getSegments(mediaId, db), version };
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
       provider_ref = COALESCE(?, provider_ref) WHERE segment_id = ? AND number = ? RETURNING id`,
  );
  const ins = db.prepare(`INSERT INTO episode (segment_id, number, title, air_date, overview, provider_ref) VALUES (?,?,?,?,?,?) RETURNING id`);
  const seedFiller = db.prepare(`INSERT OR IGNORE INTO episode_assessment (episode_id, state, filler, updated_at) VALUES (?, 'unwatched', 1, ?)`);
  const now = nowIso();
  let added = 0,
    updated = 0;
  db.transaction(() => {
    for (const e of episodes) {
      let row = upd.get(e.title, e.airDate, e.overview, e.providerRef, segmentId, e.number) as { id: number } | undefined;
      if (row) updated++;
      else if (opts.grow) {
        row = ins.get(segmentId, e.number, e.title, e.airDate, e.overview, e.providerRef) as { id: number };
        added++;
      }
      if (row && e.filler) seedFiller.run(row.id, now);
    }
    if (opts.grow) {
      // Fill gaps so numbering is contiguous (providers sometimes skip numbers).
      const max = (db.prepare(`SELECT COALESCE(MAX(number),0) n FROM episode WHERE segment_id=?`).get(segmentId) as { n: number }).n;
      ensureEpisodeCount(db, segmentId, max);
    }
  })();
  return { added, updated };
}

/** A segment's stored provider reference, checking it belongs to the entry. */
export function segmentProvider(mediaId: number, segmentId: number, db = getDb()): { provider: string | null; providerRef: string | null } {
  const s = db.prepare(`SELECT provider, provider_ref FROM segment WHERE id = ? AND media_id = ?`).get(segmentId, mediaId) as
    | { provider: string | null; provider_ref: string | null }
    | undefined;
  if (!s) throw new RepoError("not_found", "Segment not found.");
  return { provider: s.provider, providerRef: s.provider_ref };
}

/** Store a segment's provider reference and merge fetched episodes into it, atomically and audited. */
export function importSegmentEpisodes(mediaId: number, segmentId: number, provider: string, providerRef: string, episodes: ProviderEpisode[], db = getDb()) {
  segmentProvider(mediaId, segmentId, db);
  return db.transaction(() => {
    db.prepare(`UPDATE segment SET provider = ?, provider_ref = ?, updated_at = ? WHERE id = ?`).run(provider, providerRef, nowIso(), segmentId);
    const result = applyProviderEpisodes(segmentId, episodes, { grow: true }, db);
    bumpVersion(db, mediaId);
    audit(db, "fetch_episodes", "segment", segmentId, { provider, providerRef, ...result });
    return { ...result, segments: getSegments(mediaId, db) };
  })();
}

/* ---------------- episode assessments ---------------- */

/** Episode ids out of `episodeIds` that belong to the entry. */
function ownedEpisodes(db: DB, mediaId: number, episodeIds: number[]): Set<number> {
  const rows = db
    .prepare(`SELECT e.id FROM episode e JOIN segment s ON s.id = e.segment_id WHERE s.media_id = ? AND e.id IN (${placeholders(episodeIds.length)})`)
    .all(mediaId, ...episodeIds) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

function assertOwned(db: DB, mediaId: number, episodeIds: number[]) {
  const owned = ownedEpisodes(db, mediaId, episodeIds);
  const missing = episodeIds.find((id) => !owned.has(id));
  if (missing != null) throw new RepoError("not_found", `Episode ${missing} not found for this show.`);
}

/** Write one assessment using the shared rules. Returns true if the episode became watched. */
function writeAssessment(db: DB, episodeId: number, patch: AssessmentPatch, now: string): boolean {
  const cur = db.prepare(`SELECT state, rating, filler, watched_at FROM episode_assessment WHERE episode_id = ?`).get(episodeId) as
    | { state: EpisodeState; rating: number | null; filler: number; watched_at: string | null }
    | undefined;
  const before = cur ? { state: cur.state, rating: cur.rating, filler: Boolean(cur.filler) } : UNASSESSED;
  const next = resolveAssessment(before, patch);
  const becameWatched = next.state === "watched" && (before.state !== "watched" || patch.rating != null);
  const watchedAt = next.state !== "watched" ? null : becameWatched ? now : (cur?.watched_at ?? now);
  db.prepare(
    `INSERT INTO episode_assessment (episode_id, state, rating, filler, watched_at, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(episode_id) DO UPDATE SET state=excluded.state, rating=excluded.rating, filler=excluded.filler,
       watched_at=excluded.watched_at, updated_at=excluded.updated_at`,
  ).run(episodeId, next.state, next.rating, next.filler ? 1 : 0, watchedAt, now);
  return becameWatched;
}

/** Apply many assessments in one transaction; Recently Watched is touched once. */
function writeAssessments(db: DB, mediaId: number, items: { episodeId: number; patch: AssessmentPatch }[], action: string) {
  db.transaction(() => {
    const now = nowIso();
    let watched = false;
    for (const { episodeId, patch } of items) watched = writeAssessment(db, episodeId, patch, now) || watched;
    if (watched) touchWatched(db, mediaId, now);
    audit(db, action, "media", mediaId, { count: items.length });
    applyAutoStatus(db, { mediaIds: [mediaId] }); // e.g. the last episode moves it to Completed
  })();
}

/** One episode. Returns just that episode so the client doesn't re-download the whole show. */
export function setAssessment(mediaId: number, episodeId: number, patch: AssessmentPatch & { title?: string | null }, db = getDb()): EpisodeView {
  assertOwned(db, mediaId, [episodeId]);
  const { title, ...assessment } = patch;
  db.transaction(() => {
    writeAssessments(db, mediaId, [{ episodeId, patch: assessment }], "assess");
    if (title !== undefined) db.prepare(`UPDATE episode SET title = ? WHERE id = ?`).run(title, episodeId);
  })();
  return getEpisode(episodeId, db)!;
}

const BULK_PATCH: Record<Exclude<BulkAssessAction, "rate_unrated">, (rating: number | null) => AssessmentPatch> = {
  watched: () => ({ state: "watched" }),
  unwatched: () => ({ state: "unwatched" }),
  skipped: () => ({ state: "skipped" }),
  rate: (rating) => ({ rating, state: rating == null ? "unwatched" : "watched" }),
  filler_on: () => ({ filler: true }),
  filler_off: () => ({ filler: false }),
};

export function bulkAssess(mediaId: number, episodeIds: number[], action: BulkAssessAction, rating: number | null | undefined, db = getDb()) {
  assertOwned(db, mediaId, episodeIds);
  let targets = episodeIds;
  if (action === "rate_unrated") {
    if (rating == null) return getSegments(mediaId, db);
    const rated = new Set(
      (db.prepare(`SELECT episode_id FROM episode_assessment WHERE rating IS NOT NULL AND episode_id IN (${placeholders(episodeIds.length)})`).all(...episodeIds) as { episode_id: number }[]).map(
        (r) => r.episode_id,
      ),
    );
    targets = episodeIds.filter((id) => !rated.has(id));
  }
  const patch = action === "rate_unrated" ? { rating } : BULK_PATCH[action](rating ?? null);
  writeAssessments(db, mediaId, targets.map((episodeId) => ({ episodeId, patch })), `bulk_${action}`);
  return getSegments(mediaId, db);
}

export function applyTextAssignments(mediaId: number, resolved: { episodeId: number; state: EpisodeState; rating: number | null; filler: boolean | undefined }[], db = getDb()) {
  writeAssessments(db, mediaId, resolved.map(({ episodeId, ...patch }) => ({ episodeId, patch })), "import_text");
  return getSegments(mediaId, db);
}

/** Restore exact assessments (backup), still validated through the shared rules. */
export function restoreAssessments(db: DB, segmentId: number, episodes: { number: number; state: EpisodeState; rating: number | null; filler: boolean; watchedAt: string | null }[]) {
  const now = nowIso();
  for (const e of episodes) {
    if (e.state === "unwatched" && e.rating == null && !e.filler) continue;
    const a = resolveAssessment(UNASSESSED, e);
    db.prepare(
      `INSERT OR REPLACE INTO episode_assessment (episode_id, state, rating, filler, watched_at, updated_at)
       SELECT id, ?, ?, ?, ?, ? FROM episode WHERE segment_id = ? AND number = ?`,
    ).run(a.state, a.rating, a.filler ? 1 : 0, a.state === "watched" ? e.watchedAt : null, now, segmentId, e.number);
  }
}

/* ---------------- dedupe helpers ---------------- */

const PROVIDER_COLUMNS = [
  ["tmdbId", "tmdb_id"],
  ["imdbId", "imdb_id"],
  ["malId", "mal_id"],
  ["tvmazeId", "tvmaze_id"],
  ["anilistId", "anilist_id"],
] as const;

export function findByProviderIds(type: MediaType, ids: Partial<Pick<MediaView, (typeof PROVIDER_COLUMNS)[number][0]>>, db = getDb()): number | null {
  for (const [field, col] of PROVIDER_COLUMNS) {
    const v = ids[field];
    if (v == null || v === "") continue;
    const r = db.prepare(`SELECT id FROM media WHERE type = ? AND ${col} = ?`).get(type, v) as { id: number } | undefined;
    if (r) return r.id;
  }
  return null;
}

/**
 * Title + year matcher for imports. Loads the library once and indexes it by normalized
 * title, instead of scanning every row per imported entry.
 */
export function titleMatcher(type: MediaType, db = getDb()): (title: string, year: number | null) => number | null {
  const rows = db.prepare(`SELECT id, title, original_title, year FROM media WHERE type = ?`).all(type) as {
    id: number;
    title: string;
    original_title: string | null;
    year: number | null;
  }[];
  const index = new Map<string, { id: number; year: number | null }[]>();
  const add = (t: string | null, r: (typeof rows)[number]) => {
    if (!t) return;
    const k = normalizeTitle(t);
    index.set(k, [...(index.get(k) ?? []), { id: r.id, year: r.year }]);
  };
  for (const r of rows) {
    add(r.title, r);
    add(r.original_title, r);
  }
  return (title, year) =>
    index.get(normalizeTitle(title))?.find((r) => year == null || r.year == null || Math.abs(r.year - year) <= 1)?.id ?? null;
}
