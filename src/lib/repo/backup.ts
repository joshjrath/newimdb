import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir, getDb, nowIso, type DB } from "../db";
import { metadataSchema, reviewSchema } from "../schemas";
import { audit } from "./audit";
import { createMedia, getMediaDetail } from "./media";

export const BACKUP_FORMAT = "specular-watch-backup";

const episodeBackup = z.object({
  number: z.number().int().positive(),
  title: z.string().nullable(),
  airDate: z.string().nullable(),
  overview: z.string().nullable().optional(),
  state: z.enum(["unwatched", "watched", "skipped"]),
  rating: z.number().nullable(),
  filler: z.boolean(),
  watchedAt: z.string().nullable(),
});

const mediaBackup = z.object({
  uid: z.string().min(8).max(64),
  type: z.enum(["movie", "tv", "anime"]),
  metadata: metadataSchema,
  review: reviewSchema.extend({
    source: z.enum(["manual", "letterboxd", "backup"]),
    sourceRef: z.string().nullable(),
    lastWatchedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  tags: z.array(z.string()),
  segments: z.array(
    z.object({
      kind: z.enum(["season", "cour", "ova", "movie", "special"]),
      label: z.string(),
      seasonNumber: z.number().int().nullable(),
      courNumber: z.number().int().nullable(),
      provider: z.string().nullable(),
      providerRef: z.string().nullable(),
      episodes: z.array(episodeBackup),
    }),
  ),
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
        metadata: {
          title: m.title,
          originalTitle: m.originalTitle,
          year: m.year,
          overview: m.overview,
          posterUrl: m.posterUrl,
          backdropUrl: m.backdropUrl,
          runtimeMin: m.runtimeMin,
          genres: m.genres,
          tmdbId: m.tmdbId,
          imdbId: m.imdbId,
          malId: m.malId,
          tvmazeId: m.tvmazeId,
          anilistId: m.anilistId,
          letterboxdUrl: m.letterboxdUrl,
          metadataSource: m.metadataSource,
          lockedFields: m.lockedFields,
          thirdPartyRating: m.thirdPartyRating,
          thirdPartyRatingSource: m.thirdPartyRatingSource,
        },
        review: {
          rating: m.review.rating,
          ratingLabel: m.review.ratingLabel,
          body: m.review.body,
          watchedOn: m.review.watchedOn,
          spoiler: m.review.spoiler,
          status: m.review.status,
          featured: m.review.featured,
          visibility: "private" as const,
          source: m.review.source,
          sourceRef: m.review.sourceRef,
          lastWatchedAt: m.review.lastWatchedAt,
          createdAt: m.review.createdAt,
          updatedAt: m.review.updatedAt,
        },
        tags: m.tags,
        segments: m.segments.map((s) => ({
          kind: s.kind,
          label: s.label,
          seasonNumber: s.seasonNumber,
          courNumber: s.courNumber,
          provider: s.provider,
          providerRef: s.providerRef,
          episodes: s.episodes.map((e) => ({
            number: e.number,
            title: e.title,
            airDate: e.airDate,
            overview: e.overview,
            state: e.state,
            rating: e.rating,
            filler: e.filler,
            watchedAt: e.watchedAt,
          })),
        })),
        createdAt: m.createdAt,
      };
    }),
  };
}

/** File-level SQLite snapshot (consistent even while the app runs). */
export async function snapshotDatabase(label = "manual", db = getDb()): Promise<string> {
  const dir = path.join(dataDir(), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `watch-${nowIso().replace(/[:.]/g, "-")}-${label}.db`);
  await db.backup(file);
  return file;
}

export function summarizeBackup(b: Backup, db = getDb()) {
  const existing = new Set((db.prepare(`SELECT uid FROM media`).all() as { uid: string }[]).map((r) => r.uid));
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
      const prev = db.prepare(`SELECT id FROM media WHERE uid = ?`).get(m.uid) as { id: number } | undefined;
      if (prev) {
        db.prepare(`DELETE FROM media WHERE id = ?`).run(prev.id);
        counts.replaced++;
      } else counts.created++;
      const { source, sourceRef, lastWatchedAt, createdAt, updatedAt, ...review } = m.review;
      const created = createMedia(
        {
          type: m.type,
          metadata: m.metadata,
          review,
          tags: m.tags,
          segments: m.segments.map((s) => ({
            kind: s.kind,
            label: s.label,
            seasonNumber: s.seasonNumber,
            courNumber: s.courNumber,
            provider: s.provider,
            providerRef: s.providerRef,
            episodeCount: s.episodes.length ? Math.max(...s.episodes.map((e) => e.number)) : 0,
            episodes: s.episodes.map((e) => ({ number: e.number, title: e.title, airDate: e.airDate, overview: e.overview ?? null, providerRef: null })),
          })),
        },
        { source, sourceRef, uid: m.uid },
        db,
      );
      db.prepare(`UPDATE review SET last_watched_at = ?, created_at = ?, updated_at = ? WHERE media_id = ?`).run(lastWatchedAt, createdAt, updatedAt, created.id);
      db.prepare(`UPDATE media SET created_at = ? WHERE id = ?`).run(m.createdAt, created.id);
      const segs = db.prepare(`SELECT id FROM segment WHERE media_id = ? ORDER BY position`).all(created.id) as { id: number }[];
      m.segments.forEach((s, i) => {
        for (const e of s.episodes) {
          if (e.state === "unwatched" && e.rating == null && !e.filler) continue;
          const ep = db.prepare(`SELECT id FROM episode WHERE segment_id = ? AND number = ?`).get(segs[i].id, e.number) as { id: number };
          db.prepare(
            `INSERT OR REPLACE INTO episode_assessment (episode_id, state, rating, filler, watched_at, updated_at) VALUES (?,?,?,?,?,?)`,
          ).run(ep.id, e.rating != null ? "watched" : e.state, e.rating, e.filler ? 1 : 0, e.watchedAt, nowIso());
        }
      });
    }
    audit(db, "restore_backup", "library", null, { mode, ...counts, snapshot: path.basename(snapshot) });
  })();
  return { ...counts, snapshot: path.basename(snapshot) };
}
