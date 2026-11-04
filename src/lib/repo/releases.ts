import fs from "node:fs";
import path from "node:path";
import { CHANGELOG, type ChangelogEntry } from "../changelog";
import { dataDir, freshDatabases, getDb, nowIso, onSeparateDisk, snapshotSync, type DB } from "../db";

/**
 * Deploys, for the update bell. Each running build has a version id (the commit on
 * Railway, else Next's build id). The first time a version starts, it's recorded with the
 * changelog entries that are new since the previous version, and a backup is taken.
 */

export interface ReleaseView {
  id: string;
  commit: string | null;
  message: string | null;
  deployedAt: string;
  seen: boolean;
  entries: ChangelogEntry[];
}

function buildId(): string | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The running version. "dev" while developing, so local restarts don't announce anything. */
export function currentVersion(): { id: string; commit: string | null; message: string | null } {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || null;
  const id = commit || process.env.RAILWAY_DEPLOYMENT_ID || (process.env.NODE_ENV === "production" ? buildId() : null) || "dev";
  const message = process.env.RAILWAY_GIT_COMMIT_MESSAGE?.split("\n")[0].trim() || null;
  return { id, commit, message };
}

const registered = new WeakSet<DB>();

export function registerRelease(db = getDb()): void {
  if (registered.has(db)) return;
  registered.add(db);
  const v = currentVersion();
  if (v.id === "dev") return;
  if (db.prepare(`SELECT 1 FROM release WHERE id = ?`).get(v.id)) return;

  const earlier = db.prepare(`SELECT changelog FROM release`).all() as { changelog: string }[];
  const announced = new Set(earlier.flatMap((r) => JSON.parse(r.changelog) as string[]));
  const fresh = CHANGELOG.filter((e) => !announced.has(e.id)).map((e) => e.id);
  const now = nowIso();
  // A brand-new install has nothing to announce; an existing library gets told about the update.
  const seenAt = freshDatabases.has(db) && earlier.length === 0 ? now : null;
  db.prepare(`INSERT INTO release (id, commit_sha, message, changelog, deployed_at, seen_at) VALUES (?,?,?,?,?,?)`).run(
    v.id,
    v.commit,
    v.message,
    JSON.stringify(fresh),
    now,
    seenAt,
  );
  if (!freshDatabases.has(db)) {
    try {
      snapshotSync(db, process.env.DATABASE_FILE || path.join(dataDir(), "watch.db"), "after-update");
    } catch (e) {
      console.error("[releases] couldn't take the update backup:", e);
    }
  }
}

const byId = new Map(CHANGELOG.map((e) => [e.id, e]));

export function listReleases(db = getDb(), limit = 10): ReleaseView[] {
  registerRelease(db);
  const rows = db.prepare(`SELECT * FROM release ORDER BY deployed_at DESC LIMIT ?`).all(limit) as {
    id: string;
    commit_sha: string | null;
    message: string | null;
    changelog: string;
    deployed_at: string;
    seen_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    commit: r.commit_sha,
    message: r.message,
    deployedAt: r.deployed_at,
    seen: Boolean(r.seen_at),
    entries: (JSON.parse(r.changelog) as string[]).flatMap((id) => byId.get(id) ?? []),
  }));
}

export function markReleasesSeen(db = getDb()) {
  db.prepare(`UPDATE release SET seen_at = ? WHERE seen_at IS NULL`).run(nowIso());
}

/**
 * Is the library on storage that survives a redeploy? On Railway that means the data
 * folder is on an attached volume, which we check on the disk itself (a volume is a
 * separate filesystem), not only from Railway's variables. Elsewhere we don't guess.
 */
export function storageStatus(): { persistent: boolean | null; warning: string | null } {
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);
  if (!onRailway) return { persistent: null, warning: null };
  const dir = path.resolve(dataDir());
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH) : null;
  const insideMount = mount != null && (dir === mount || dir.startsWith(mount + path.sep));
  if (onSeparateDisk(dir) || insideMount) return { persistent: true, warning: null };

  const seen = [
    `The app is saving to ${dir}, which is not a volume.`,
    mount ? `Railway reports a volume at ${mount}.` : "Railway hasn't told this deployment about any volume.",
    process.env.DATA_DIR ? `DATA_DIR is set to "${process.env.DATA_DIR}"; remove it or set it to the volume's mount path.` : null,
  ].filter(Boolean).join(" ");
  return {
    persistent: false,
    warning: `The next update or restart will erase your library. ${seen} Check that the volume is attached to this same service, then redeploy it.`,
  };
}

export function updatesSummary(db = getDb()) {
  const releases = listReleases(db);
  return { version: currentVersion().id, releases, unseen: releases.filter((r) => !r.seen).length, storage: storageStatus() };
}
export type UpdatesSummary = ReturnType<typeof updatesSummary>;
