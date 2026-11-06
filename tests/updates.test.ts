import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, setDbForTests, snapshotSync } from "@/lib/db";
import { createMedia, countMedia } from "@/lib/repo/media";
import { listReleases, markReleasesSeen, registerRelease, storageStatus, updatesSummary } from "@/lib/repo/releases";
import { CHANGELOG } from "@/lib/changelog";

const env = process.env as Record<string, string | undefined>;
const keys = ["RAILWAY_GIT_COMMIT_SHA", "RAILWAY_GIT_COMMIT_MESSAGE", "RAILWAY_ENVIRONMENT", "RAILWAY_VOLUME_MOUNT_PATH", "DATA_DIR", "DATABASE_FILE"];
const saved = Object.fromEntries(keys.map((k) => [k, env[k]]));
afterEach(() => {
  for (const k of keys) env[k] = saved[k];
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "watch-upd-"));

describe("updates never lose data", () => {
  it("keeps the library across restarts and backs up before a schema change", () => {
    const dir = tmp();
    const file = path.join(dir, "watch.db");
    let db = openDatabase(file);
    setDbForTests(db);
    createMedia({ type: "movie", metadata: { title: "Kept" } }, {}, db);
    // Undo the newest migration, as if this database came from the previous version.
    db.exec(`ALTER TABLE recommendation DROP COLUMN person_id; ALTER TABLE media DROP COLUMN imdb_rating; ALTER TABLE media DROP COLUMN imdb_votes; ALTER TABLE media DROP COLUMN imdb_rating_at; DROP INDEX list_share_token; ALTER TABLE list DROP COLUMN share_token; ALTER TABLE list DROP COLUMN share_ratings; ALTER TABLE media DROP COLUMN release_date; UPDATE schema_version SET version = 9;`);
    db.close();

    db = openDatabase(file); // "the update"
    expect(countMedia(db).total).toBe(1);
    const backups = fs.readdirSync(path.join(dir, "backups"));
    expect(backups.some((f) => f.includes("before-schema-10"))).toBe(true);
    // The backup is a complete, openable copy.
    const copy = openDatabase(path.join(dir, "backups", backups[0]));
    expect(countMedia(copy).total).toBe(1);
  });

  it("a library from before Lists existed gets the list tables (the crash on Railway)", () => {
    const dir = tmp();
    const file = path.join(dir, "watch.db");
    let db = openDatabase(file);
    createMedia({ type: "movie", metadata: { title: "Kept" } }, {}, db);
    // As it was on Railway: migration 8 ran before list tables were part of it.
    db.exec(`DROP TABLE list_item; DROP TABLE list; ALTER TABLE recommendation DROP COLUMN person_id; ALTER TABLE media DROP COLUMN imdb_rating; ALTER TABLE media DROP COLUMN imdb_votes; ALTER TABLE media DROP COLUMN imdb_rating_at; ALTER TABLE media DROP COLUMN release_date; UPDATE schema_version SET version = 9;`);
    db.close();
    db = openDatabase(file);
    setDbForTests(db);
    expect(db.prepare(`SELECT COUNT(*) n FROM list`).get()).toEqual({ n: 0 });
    expect(countMedia(db).total).toBe(1);
  });

  it("still opens (and updates) your library when a backup can't be written, e.g. a full disk", () => {
    const dir = tmp();
    const file = path.join(dir, "watch.db");
    let db = openDatabase(file);
    createMedia({ type: "movie", metadata: { title: "Kept" } }, {}, db);
    db.exec(`DROP TABLE arc; ALTER TABLE media DROP COLUMN episode_view; ALTER TABLE recommendation DROP COLUMN person_id; ALTER TABLE media DROP COLUMN imdb_rating; ALTER TABLE media DROP COLUMN imdb_votes; ALTER TABLE media DROP COLUMN imdb_rating_at; DROP INDEX list_share_token; ALTER TABLE list DROP COLUMN share_token; ALTER TABLE list DROP COLUMN share_ratings; ALTER TABLE media DROP COLUMN release_date; UPDATE schema_version SET version = 8;`);
    db.close();
    fs.rmSync(path.join(dir, "backups"), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, "backups"), "not a folder"); // the copy will fail
    db = openDatabase(file);
    expect(countMedia(db).total).toBe(1);
    expect((db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version).toBeGreaterThanOrEqual(9);
  });

  it("prunes automatic backups to the newest five", () => {
    const dir = tmp();
    const file = path.join(dir, "watch.db");
    const db = openDatabase(file);
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    fs.writeFileSync(path.join(dir, "backups", "watch-manual.db"), "");
    for (let i = 0; i < 13; i++) snapshotSync(db, file, `n${String(i).padStart(2, "0")}`);
    const files = fs.readdirSync(path.join(dir, "backups"));
    expect(files.filter((f) => f.includes("-auto-"))).toHaveLength(5);
    expect(files).toContain("watch-manual.db");
  });
});

describe("update bell", () => {
  it("records each deploy once, announces it on an existing library, and marks it read", () => {
    const dir = tmp();
    const file = path.join(dir, "watch.db");
    env.DATABASE_FILE = file;
    env.RAILWAY_GIT_COMMIT_SHA = "aaa111";
    let db = openDatabase(file);
    setDbForTests(db);
    registerRelease(db);
    // A brand-new install doesn't announce anything.
    expect(updatesSummary(db).unseen).toBe(0);
    db.close();

    env.RAILWAY_GIT_COMMIT_SHA = "bbb222";
    env.RAILWAY_GIT_COMMIT_MESSAGE = "Add the update bell\n\nlong body";
    db = openDatabase(file);
    setDbForTests(db);
    registerRelease(db);
    registerRelease(db);
    const s = updatesSummary(db);
    expect(s.version).toBe("bbb222");
    expect(s.releases.map((r) => r.id)).toEqual(["bbb222", "aaa111"]);
    expect(s.unseen).toBe(1);
    expect(s.releases[0].message).toBe("Add the update bell");
    // Changelog entries are announced once: the first deploy already carried them.
    expect(s.releases[1].entries.map((e) => e.id)).toEqual(CHANGELOG.map((e) => e.id));
    expect(s.releases[0].entries).toEqual([]);
    expect(fs.readdirSync(path.join(dir, "backups")).some((f) => f.includes("after-update"))).toBe(true);
    markReleasesSeen(db);
    expect(listReleases(db).every((r) => r.seen)).toBe(true);
  });

  it("warns when data on Railway isn't on a volume", () => {
    env.RAILWAY_ENVIRONMENT = "production";
    delete env.RAILWAY_VOLUME_MOUNT_PATH;
    expect(storageStatus()).toMatchObject({ persistent: false });
    expect(storageStatus().warning).toMatch(/hasn't told this deployment about any volume/);
    env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    env.DATA_DIR = tmp();
    expect(storageStatus().persistent).toBe(false); // DATA_DIR outside the volume
    delete env.RAILWAY_ENVIRONMENT;
    expect(storageStatus()).toEqual({ persistent: null, warning: null });
  });
});
