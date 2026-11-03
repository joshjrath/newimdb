import { z } from "zod";
import { getDb, nowIso, type DB } from "../db";
import type { LetterboxdEntry } from "../domain/letterboxd";
import { audit } from "./audit";
import { createMedia, findByProviderIds, findByTitleYear, getMedia, touchWatched } from "./media";
import { setMediaTags, tagsFor } from "./tags";

export type MatchKind = "new" | "unchanged" | "update" | "conflict" | "duplicate_in_batch";

export interface PreviewRow {
  entry: LetterboxdEntry;
  match: MatchKind;
  mediaId: number | null;
  existingTitle: string | null;
  reason: string;
  /** What will happen if the owner doesn't change it. Imports never publish anything. */
  defaultAction: ImportAction;
}

export type ImportAction = "create" | "update" | "overwrite" | "link" | "skip";

export const letterboxdEntrySchema = z.object({
  externalId: z.string().min(1).max(500),
  kind: z.enum(["review", "watch", "rating"]),
  filmTitle: z.string().min(1).max(300),
  filmYear: z.number().int().nullable(),
  rating: z.number().nullable(),
  watchedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rewatch: z.boolean(),
  reviewText: z.string().max(50000),
  spoiler: z.boolean(),
  link: z.string().max(2000).nullable(),
  tmdbId: z.number().int().nullable(),
  posterUrl: z.string().max(2000).nullable(),
  tags: z.array(z.string().max(40)).max(50),
  contentHash: z.string().max(64),
});

export const commitSchema = z.object({
  items: z
    .array(
      z.object({
        entry: letterboxdEntrySchema,
        action: z.enum(["create", "update", "overwrite", "link", "skip"]),
        mediaId: z.number().int().positive().nullable(),
      }),
    )
    .max(5000),
});

function importRecord(db: DB, externalId: string) {
  return db.prepare(`SELECT * FROM import_record WHERE source = 'letterboxd' AND external_id = ?`).get(externalId) as
    | { media_id: number | null; content_hash: string | null; imported_at: string }
    | undefined;
}

export function previewLetterboxd(entries: LetterboxdEntry[], db = getDb()): PreviewRow[] {
  const seen = new Map<string, number>();
  const rows: PreviewRow[] = [];
  for (const entry of entries) {
    const key = entry.tmdbId ? `tmdb:${entry.tmdbId}` : `t:${entry.filmTitle.toLowerCase()}|${entry.filmYear}`;
    const rec = importRecord(db, entry.externalId);
    const recMedia = rec?.media_id ? getMedia(rec.media_id, db) : null;
    if (rec && recMedia) {
      const ownerEdited = recMedia.review.updatedAt > rec.imported_at && recMedia.review.source !== "letterboxd";
      if (rec.content_hash === entry.contentHash) {
        rows.push({ entry, match: "unchanged", mediaId: recMedia.id, existingTitle: recMedia.title, reason: "Already imported, no changes.", defaultAction: "skip" });
      } else if (ownerEdited) {
        rows.push({ entry, match: "conflict", mediaId: recMedia.id, existingTitle: recMedia.title, reason: "Changed on Letterboxd, but you've also edited it here.", defaultAction: "skip" });
      } else {
        rows.push({ entry, match: "update", mediaId: recMedia.id, existingTitle: recMedia.title, reason: "Changed on Letterboxd since the last import.", defaultAction: "update" });
      }
      seen.set(key, recMedia.id);
      continue;
    }
    if (seen.has(key)) {
      rows.push({ entry, match: "duplicate_in_batch", mediaId: seen.get(key) ?? null, existingTitle: entry.filmTitle, reason: "Another diary entry for the same film (rewatch). Merged into one review.", defaultAction: "update" });
      continue;
    }
    const existing =
      findByProviderIds("movie", { tmdbId: entry.tmdbId }, db) ?? findByTitleYear("movie", entry.filmTitle, entry.filmYear, db);
    if (existing) {
      const m = getMedia(existing, db)!;
      rows.push({
        entry,
        match: "conflict",
        mediaId: existing,
        existingTitle: m.title,
        reason: m.review.source === "manual" ? "You already wrote a review for this film here." : "Already in your library from another source.",
        defaultAction: "link",
      });
      seen.set(key, existing);
      continue;
    }
    seen.set(key, -1);
    rows.push({ entry, match: "new", mediaId: null, existingTitle: null, reason: "New film.", defaultAction: "create" });
  }
  return rows;
}

function recordImport(db: DB, entry: LetterboxdEntry, mediaId: number | null, decision: string) {
  db.prepare(
    `INSERT INTO import_record (source, external_id, media_id, content_hash, decision, payload, imported_at)
     VALUES ('letterboxd', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET media_id=excluded.media_id, content_hash=excluded.content_hash,
       decision=excluded.decision, payload=excluded.payload, imported_at=excluded.imported_at`,
  ).run(entry.externalId, mediaId, entry.contentHash, decision, JSON.stringify(entry), nowIso());
}

function applyEntryToReview(db: DB, mediaId: number, e: LetterboxdEntry, overwrite: boolean) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (e.rating != null || overwrite) {
    sets.push("rating = ?");
    params.push(e.rating);
  }
  // A watch-only diary entry must never blank out existing review prose.
  if (e.reviewText || overwrite) {
    sets.push("body = ?", "spoiler = ?");
    params.push(e.reviewText, e.spoiler ? 1 : 0);
  }
  if (e.watchedDate) {
    sets.push("watched_on = CASE WHEN watched_on IS NULL OR watched_on < ? THEN ? ELSE watched_on END");
    params.push(e.watchedDate, e.watchedDate);
  }
  if (overwrite) sets.push("source = 'letterboxd'");
  sets.push("source_ref = COALESCE(source_ref, ?)", "updated_at = ?");
  params.push(e.link, nowIso());
  db.prepare(`UPDATE review SET ${sets.join(", ")} WHERE media_id = ?`).run(...params, mediaId);
  db.prepare(`UPDATE media SET letterboxd_url = COALESCE(letterboxd_url, ?), tmdb_id = COALESCE(tmdb_id, ?), poster_url = COALESCE(poster_url, ?), version = version + 1 WHERE id = ?`).run(
    e.link,
    e.tmdbId,
    e.posterUrl,
    mediaId,
  );
  if (e.watchedDate) touchWatched(db, mediaId, e.watchedDate);
  if (e.tags.length) setMediaTags(db, mediaId, [...tagsFor(db, mediaId), ...e.tags]);
}

export function commitLetterboxd(items: z.infer<typeof commitSchema>["items"], db = getDb()) {
  const counts = { created: 0, updated: 0, linked: 0, skipped: 0 };
  // Oldest first so the newest watch date / text wins on rewatches.
  const ordered = [...items].sort((a, b) => (a.entry.watchedDate ?? "").localeCompare(b.entry.watchedDate ?? ""));
  db.transaction(() => {
    const createdInBatch = new Map<string, number>();
    for (const { entry, action, mediaId } of ordered) {
      const key = entry.tmdbId ? `tmdb:${entry.tmdbId}` : `t:${entry.filmTitle.toLowerCase()}|${entry.filmYear}`;
      if (action === "skip") {
        counts.skipped++;
        continue;
      }
      const target = mediaId ?? createdInBatch.get(key) ?? null;
      if (action === "create" && target == null) {
        const m = createMedia(
          {
            type: "movie",
            metadata: {
              title: entry.filmTitle,
              year: entry.filmYear,
              tmdbId: entry.tmdbId,
              posterUrl: entry.posterUrl,
              letterboxdUrl: entry.link,
              metadataSource: "letterboxd",
            },
            review: {
              rating: entry.rating,
              body: entry.reviewText,
              spoiler: entry.spoiler,
              watchedOn: entry.watchedDate,
              status: "completed",
              featured: false,
              visibility: "private",
            },
            tags: entry.tags,
          },
          { source: "letterboxd", sourceRef: entry.link },
          db,
        );
        if (entry.watchedDate) db.prepare(`UPDATE review SET last_watched_at = ? WHERE media_id = ?`).run(entry.watchedDate, m.id);
        createdInBatch.set(key, m.id);
        recordImport(db, entry, m.id, "create");
        counts.created++;
      } else if (target != null && getMedia(target, db)) {
        if (action === "link") {
          recordImport(db, entry, target, "link");
          counts.linked++;
        } else {
          applyEntryToReview(db, target, entry, action === "overwrite");
          recordImport(db, entry, target, action);
          counts.updated++;
        }
      } else counts.skipped++;
    }
    audit(db, "import_letterboxd", "import", null, counts);
  })();
  return counts;
}
