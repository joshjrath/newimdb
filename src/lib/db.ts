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
  // 3 — deploys, for the update bell
  `
  CREATE TABLE release (
    id          TEXT PRIMARY KEY,
    commit_sha  TEXT,
    message     TEXT,
    changelog   TEXT NOT NULL DEFAULT '[]',
    deployed_at TEXT NOT NULL,
    seen_at     TEXT
  );
  `,
  // 4 — people you watched with (any number per title)
  `
  CREATE TABLE person (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE media_person (
    media_id  INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, person_id)
  );
  CREATE INDEX media_person_person ON media_person(person_id);
  `,
  // 5 — when each show's episode list was last checked for new episodes
  `
  ALTER TABLE media ADD COLUMN episodes_synced_at TEXT;
  ALTER TABLE media ADD COLUMN episodes_sync_note TEXT;
  `,
  // 6 — genre filters you choose in Settings, applied to titles automatically
  `
  CREATE TABLE genre (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    rules      TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE media_genre (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
    -- auto: matched by the rules; manual: you added it; excluded: you removed it (never re-added)
    state    TEXT NOT NULL CHECK (state IN ('auto', 'manual', 'excluded')),
    PRIMARY KEY (media_id, genre_id)
  );
  CREATE INDEX media_genre_genre ON media_genre(genre_id, state);
  ALTER TABLE media ADD COLUMN keywords TEXT;
  ALTER TABLE media ADD COLUMN keywords_fetched_at TEXT;
  `,
  // 7 — anime detection: when a title's category was checked, and whether you set it yourself
  `
  ALTER TABLE media ADD COLUMN type_checked_at TEXT;
  ALTER TABLE media ADD COLUMN type_locked INTEGER NOT NULL DEFAULT 0;
  `,
];

/** Whether the database was created just now (no earlier data), per connection. */
export const freshDatabases = new WeakSet<DB>();

const MAX_AUTO_SNAPSHOTS = 10;

/**
 * A consistent copy of the whole database, written synchronously (VACUUM INTO).
 * Automatic copies are pruned to the newest few; manual ones are never touched.
 */
export function snapshotSync(db: DB, file: string, label: string): string | null {
  if (file === ":memory:") return null;
  const dir = ensureDir(path.join(path.dirname(path.resolve(file)), "backups"));
  const out = path.join(dir, `watch-${new Date().toISOString().replace(/[:.]/g, "-")}-auto-${label}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const autos = fs.readdirSync(dir).filter((f) => f.includes("-auto-")).sort();
  for (const old of autos.slice(0, Math.max(0, autos.length - MAX_AUTO_SNAPSHOTS))) fs.rmSync(path.join(dir, old), { force: true });
  return out;
}

function migrate(db: DB, file: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run();
  if (current === 0) freshDatabases.add(db);
  // An update that changes the schema first copies the database, so nothing can be lost.
  else if (current < MIGRATIONS.length) snapshotSync(db, file, `before-schema-${current + 1}`);
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

/** True when `dir` is on a different disk from the container's root: an attached volume. */
export function onSeparateDisk(dir: string): boolean {
  try {
    return fs.statSync(dir).dev !== fs.statSync("/").dev;
  } catch {
    return false;
  }
}

/** Where the library lives: DATA_DIR, else an attached volume (Railway's variable, or a disk mounted at /data), else ./data. */
function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (onSeparateDisk("/data")) return "/data";
  return path.join(process.cwd(), "data");
}

export function dataDir(): string {
  return ensureDir(path.resolve(resolveDataDir()));
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
  migrate(db, file);
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
