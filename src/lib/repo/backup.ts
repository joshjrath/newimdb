import path from "node:path";
import { z } from "zod";
import { dataSubdir, getDb, nowIso, type DB } from "../db";
import { REVIEW_SOURCES } from "../domain/types";
import { backupSegmentSchema, metadataSchema, mediaTypeSchema, reviewSchema } from "../schemas";
import { audit } from "./audit";
import { getMediaDetail, insertMedia, metadataOf, restoreAssessments } from "./media";

export const BACKUP_FORMAT = "specular-watch-backup";

const mediaBackup = z.object({
  uid: z.string().min(8).max(64),
  type: mediaTypeSchema,
  metadata: metadataSchema,
  review: reviewSchema.extend({
    source: z.enum(REVIEW_SOURCES),
    sourceRef: z.string().nullable(),
    lastWatchedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  tags: z.array(z.string()),
  segments: z.array(backupSegmentSchema),
  createdAt: z.string(),
});

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  media: z.array(mediaBackup),
});

export type Backup = z.infer<typeof backupSchema>;

export function exportAll(db = getDb()): Backup {
  const ids = (db.prepare(`SELECT id FROM media ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: nowIso(),
    media: ids.map((id) => {
      const m = getMediaDetail(id, db)!;
      return {
        uid: m.uid,
        type: m.type,
        metadata: metadataOf(m),
        review: m.review,
        tags: m.tags,
        segments: m.segments.map(({ kind, label, seasonNumber, courNumber, provider, providerRef, episodes }) => ({
          kind,
          label,
          seasonNumber,
          courNumber,
          provider,
          providerRef,
          episodes: episodes.map(({ number, title, airDate, overview, state, rating, filler, watchedAt }) => ({ number, title, airDate, overview, state, rating, filler, watchedAt })),
        })),
        createdAt: m.createdAt,
      };
    }),
  };
}

/** File-level SQLite snapshot (consistent even while the app runs). */
export async function snapshotDatabase(label = "manual", db = getDb()): Promise<string> {
  const file = path.join(dataSubdir("backups"), `watch-${nowIso().replace(/[:.]/g, "-")}-${label}.db`);
  await db.backup(file);
  return file;
}

function existingUids(db: DB): Set<string> {
  return new Set((db.prepare(`SELECT uid FROM media`).all() as { uid: string }[]).map((r) => r.uid));
}

export function summarizeBackup(b: Backup, db = getDb()) {
  const existing = existingUids(db);
  const matched = b.media.filter((m) => existing.has(m.uid)).length;
  return {
    entries: b.media.length,
    wouldReplace: matched,
    wouldCreate: b.media.length - matched,
    episodes: b.media.reduce((n, m) => n + m.segments.reduce((k, s) => k + s.episodes.length, 0), 0),
    currentEntries: existing.size,
  };
}

/**
 * Restore. "merge": entries with the same uid are replaced, others added, nothing else removed.
 * "replace": library is emptied first. Either way a DB snapshot is taken beforehand, and it's all one transaction.
 */
export async function restoreBackup(b: Backup, mode: "merge" | "replace", db = getDb()) {
  const snapshot = await snapshotDatabase("pre-restore", db);
  const counts = { created: 0, replaced: 0 };
  db.transaction(() => {
    if (mode === "replace") db.prepare(`DELETE FROM media`).run();
    for (const m of b.media) {
      if (db.prepare(`DELETE FROM media WHERE uid = ?`).run(m.uid).changes) counts.replaced++;
      else counts.created++;
      const { source, sourceRef, lastWatchedAt, createdAt, updatedAt, ...review } = m.review;
      const id = insertMedia(
        {
          type: m.type,
          metadata: m.metadata,
          review,
          tags: m.tags,
          segments: m.segments.map(({ episodes, ...s }) => ({
            ...s,
            episodeCount: Math.max(0, ...episodes.map((e) => e.number)),
            episodes: episodes.map((e) => ({ number: e.number, title: e.title, airDate: e.airDate, overview: e.overview ?? null, providerRef: null })),
          })),
        },
        { source, sourceRef, uid: m.uid },
        db,
      );
      db.prepare(`UPDATE review SET last_watched_at = ?, created_at = ?, updated_at = ? WHERE media_id = ?`).run(lastWatchedAt, createdAt, updatedAt, id);
      db.prepare(`UPDATE media SET created_at = ? WHERE id = ?`).run(m.createdAt, id);
      const segIds = (db.prepare(`SELECT id FROM segment WHERE media_id = ? ORDER BY position`).all(id) as { id: number }[]).map((r) => r.id);
      m.segments.forEach((s, i) => restoreAssessments(db, segIds[i], s.episodes));
    }
    audit(db, "restore_backup", "library", null, { mode, ...counts, snapshot: path.basename(snapshot) });
  })();
  return { ...counts, snapshot: path.basename(snapshot) };
}
