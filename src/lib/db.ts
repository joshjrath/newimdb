import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite storage. One file, WAL mode, foreign keys on.
 * Owner data (reviews, ratings, ordering) lives in tables separate from
 * third-party metadata so a metadata refresh can never erase personal data.
 */

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE media (
    id            INTEGER PRIMARY KEY,
    uid           TEXT NOT NULL UNIQUE,
    type          TEXT NOT NULL CHECK (type IN ('movie','tv','anime')),
    title         TEXT NOT NULL,
    original_title TEXT,
    year          INTEGER,
    overview      TEXT,
    poster_url    TEXT,
    backdrop_url  TEXT,
    runtime_min   INTEGER,
    genres        TEXT NOT NULL DEFAULT '[]',
    tmdb_id       INTEGER,
    imdb_id       TEXT,
    mal_id        INTEGER,
    tvmaze_id     INTEGER,
    anilist_id    INTEGER,
    letterboxd_url TEXT,
    metadata_source TEXT,
    locked_fields TEXT NOT NULL DEFAULT '[]',
    third_party_rating REAL,
    third_party_rating_source TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX media_type ON media(type);
  CREATE INDEX media_tmdb ON media(type, tmdb_id);
  CREATE INDEX media_mal ON media(mal_id);
  CREATE INDEX media_imdb ON media(imdb_id);

  CREATE TABLE review (
    media_id      INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    rating        REAL CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
    rating_label  TEXT,
    body          TEXT NOT NULL DEFAULT '',
    watched_on    TEXT,
    spoiler       INTEGER NOT NULL DEFAULT 0,
    status        TEXT CHECK (status IS NULL OR status IN ('watching','completed','dropped','plan','on_hold')),
    featured      INTEGER NOT NULL DEFAULT 0,
    visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
    source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','letterboxd','backup')),
    source_ref    TEXT,
    last_watched_at TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX review_last_watched ON review(last_watched_at);
  CREATE INDEX review_status ON review(status);

  CREATE TABLE segment (
    id            INTEGER PRIMARY KEY,
    media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('season','cour','ova','movie','special')),
    label         TEXT NOT NULL,
    season_number INTEGER,
    cour_number   INTEGER,
    position      INTEGER NOT NULL,
    provider      TEXT,
    provider_ref  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX segment_media ON segment(media_id, position);

  CREATE TABLE episode (
    id            INTEGER PRIMARY KEY,
    segment_id    INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    number        INTEGER NOT NULL CHECK (number >= 1),
    title         TEXT,
    air_date      TEXT,
    overview      TEXT,
    provider_ref  TEXT,
    UNIQUE (segment_id, number)
  );

  -- The owner's assessment of an episode. Kept apart from metadata on purpose.
  CREATE TABLE episode_assessment (
    episode_id    INTEGER PRIMARY KEY REFERENCES episode(id) ON DELETE CASCADE,
    state         TEXT NOT NULL DEFAULT 'unwatched' CHECK (state IN ('unwatched','watched','skipped')),
    rating        REAL CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
    filler        INTEGER NOT NULL DEFAULT 0,
    watched_at    TEXT,
    updated_at    TEXT NOT NULL,
    CHECK (rating IS NULL OR state = 'watched')
  );

  CREATE TABLE tag (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE media_tag (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
  );

  CREATE TABLE import_record (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    media_id    INTEGER REFERENCES media(id) ON DELETE SET NULL,
    content_hash TEXT,
    decision    TEXT NOT NULL,
    payload     TEXT,
    imported_at TEXT NOT NULL,
    UNIQUE (source, external_id)
  );

  CREATE TABLE audit_event (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL,
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id TEXT,
    detail    TEXT
  );

  CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  `,
  // 2 — reviews can come from an IMDb ratings import
  `
  CREATE TABLE review_v2 (
    media_id      INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    rating        REAL CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
    rating_label  TEXT,
    body          TEXT NOT NULL DEFAULT '',
    watched_on    TEXT,
    spoiler       INTEGER NOT NULL DEFAULT 0,
    status        TEXT CHECK (status IS NULL OR status IN ('watching','completed','dropped','plan','on_hold')),
    featured      INTEGER NOT NULL DEFAULT 0,
    visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
    source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','letterboxd','backup','imdb')),
    source_ref    TEXT,
    last_watched_at TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  INSERT INTO review_v2 SELECT * FROM review;
  DROP TABLE review;
  ALTER TABLE review_v2 RENAME TO review;
  CREATE INDEX review_last_watched ON review(last_watched_at);
  CREATE INDEX review_status ON review(status);
  `,
];

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run();
  while (current < MIGRATIONS.length) {
    const sql = MIGRATIONS[current];
    db.transaction(() => {
      db.exec(sql);
      db.prepare(`UPDATE schema_version SET version = ?`).run(current + 1);
    })();
    current++;
  }
}

const madeDirs = new Set<string>();

function ensureDir(dir: string): string {
  if (!madeDirs.has(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    madeDirs.add(dir);
  }
  return dir;
}

export function dataDir(): string {
  return ensureDir(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data")));
}

/** A private folder under DATA_DIR (uploads, poster cache, backups). Created once. */
export function dataSubdir(name: string): string {
  return ensureDir(path.join(dataDir(), name));
}

const MAX_CACHED_STATEMENTS = 500;

/**
 * better-sqlite3 compiles SQL on every `prepare()`. Repository code prepares inline
 * (often inside loops), so memoize statements per connection by SQL text.
 */
function cachePreparedStatements(db: DB) {
  const prepare = db.prepare.bind(db);
  const cache = new Map<string, Database.Statement>();
  db.prepare = ((sql: string) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = prepare(sql);
      if (cache.size < MAX_CACHED_STATEMENTS) cache.set(sql, stmt);
    }
    return stmt;
  }) as DB["prepare"];
}

export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  cachePreparedStatements(db);
  return db;
}

const g = globalThis as unknown as { __watchDb?: DB; __watchDbFile?: string };

const dbFile = () => process.env.DATABASE_FILE || path.join(dataDir(), "watch.db");

export function getDb(): DB {
  const file = dbFile();
  if (!g.__watchDb || g.__watchDbFile !== file) {
    g.__watchDb = openDatabase(file);
    g.__watchDbFile = file;
  }
  return g.__watchDb;
}

/** For tests: use a fresh database instance. */
export function setDbForTests(db: DB) {
  g.__watchDb = db;
  g.__watchDbFile = dbFile();
}

export const nowIso = () => new Date().toISOString();
