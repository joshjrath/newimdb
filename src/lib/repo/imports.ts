import { z } from "zod";
import { getDb, nowIso, type DB } from "../db";
import type { LetterboxdEntry } from "../domain/letterboxd";
import { audit } from "./audit";
import { aliasFor } from "./franchise";
import { findByProviderIds, getMedia, insertMedia, titleMatcher, touchWatched } from "./media";
import { setMediaTags, tagsFor } from "./tags";

export type MatchKind = "new" | "unchanged" | "update" | "conflict" | "duplicate_in_batch";

export const IMPORT_ACTIONS = ["create", "update", "overwrite", "link", "skip"] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export interface PreviewRow {
  entry: LetterboxdEntry;
  match: MatchKind;
  mediaId: number | null;
  existingTitle: string | null;
  reason: string;
  /** What will happen if the owner doesn't change it. Imports never publish anything. */
  defaultAction: ImportAction;
}

const letterboxdEntrySchema = z.object({
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
}) satisfies z.ZodType<LetterboxdEntry>;

export const commitSchema = z.object({
  items: z
    .array(z.object({ entry: letterboxdEntrySchema, action: z.enum(IMPORT_ACTIONS), mediaId: z.number().int().positive().nullable() }))
    .max(5000),
});

/** Same film across diary entries (rewatches): TMDB id when known, else title + year. */
const filmKey = (e: LetterboxdEntry) => (e.tmdbId ? `tmdb:${e.tmdbId}` : `t:${e.filmTitle.toLowerCase()}|${e.filmYear}`);

const mediaExists = (db: DB, id: number) => Boolean(db.prepare(`SELECT 1 FROM media WHERE id = ?`).get(id));

function importRecord(db: DB, externalId: string) {
  return db.prepare(`SELECT * FROM import_record WHERE source = 'letterboxd' AND external_id = ?`).get(externalId) as
    | { media_id: number | null; content_hash: string | null; imported_at: string }
    | undefined;
}

export function previewLetterboxd(entries: LetterboxdEntry[], db = getDb()): PreviewRow[] {
  const seen = new Map<string, number | null>();
  const matchMovie = titleMatcher("movie", db);
  const matchAnime = titleMatcher("anime", db); // anime films live under Anime
  const matchTitle = (t: string, y: number | null) => matchMovie(t, y) ?? matchAnime(t, y);
  return entries.map((entry): PreviewRow => {
    const key = filmKey(entry);
    const row = (match: MatchKind, mediaId: number | null, existingTitle: string | null, reason: string, defaultAction: ImportAction) => {
      if (!seen.has(key)) seen.set(key, mediaId);
      return { entry, match, mediaId, existingTitle, reason, defaultAction };
    };

    const rec = importRecord(db, entry.externalId);
    const recMedia = rec?.media_id ? getMedia(rec.media_id, db) : null;
    if (rec && recMedia) {
      const ownerEdited = recMedia.review.updatedAt > rec.imported_at && recMedia.review.source !== "letterboxd";
      if (rec.content_hash === entry.contentHash) return row("unchanged", recMedia.id, recMedia.title, "Already imported, no changes.", "skip");
      if (ownerEdited) return row("conflict", recMedia.id, recMedia.title, "Changed on Letterboxd, but you've also edited it here.", "skip");
      return row("update", recMedia.id, recMedia.title, "Changed on Letterboxd since the last import.", "update");
    }
    if (seen.has(key)) {
      return { entry, match: "duplicate_in_batch", mediaId: seen.get(key) ?? null, existingTitle: entry.filmTitle, reason: "Another diary entry for the same film (rewatch). Merged into one review.", defaultAction: "update" };
    }
    const alias = aliasFor(db, { tmdbId: entry.tmdbId, title: entry.filmTitle, year: entry.filmYear });
    if (alias) {
      const host = getMedia(alias.mediaId, db);
      if (host) return row("conflict", host.id, host.title, `Part of ${host.title} in your library now (grouped with its series).`, "skip");
    }
    const existing = findByProviderIds("movie", { tmdbId: entry.tmdbId }, db) ?? findByProviderIds("anime", { tmdbId: entry.tmdbId }, db) ?? matchTitle(entry.filmTitle, entry.filmYear);
    if (existing) {
      const m = getMedia(existing, db)!;
      // Letterboxd wins over IMDb: replace an IMDb-imported rating with this review.
      if (m.review.source === "imdb") return row("conflict", existing, m.title, "Already here from IMDb. Letterboxd's rating and review will replace it.", "overwrite");
      const reason = m.review.source === "manual" ? "You already wrote a review for this film here." : "Already in your library from another source.";
      return row("conflict", existing, m.title, reason, "link");
    }
    return row("new", null, null, "New film.", "create");
  });
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
  db.prepare(
    `UPDATE media SET letterboxd_url = COALESCE(letterboxd_url, ?), tmdb_id = COALESCE(tmdb_id, ?), poster_url = COALESCE(poster_url, ?), version = version + 1 WHERE id = ?`,
  ).run(e.link, e.tmdbId, e.posterUrl, mediaId);
  if (e.watchedDate) touchWatched(db, mediaId, e.watchedDate);
  if (e.tags.length) setMediaTags(db, mediaId, [...tagsFor(db, mediaId), ...e.tags]);
}

function createFromEntry(db: DB, entry: LetterboxdEntry): number {
  const id = insertMedia(
    {
      type: "movie",
      metadata: { title: entry.filmTitle, year: entry.filmYear, tmdbId: entry.tmdbId, posterUrl: entry.posterUrl, letterboxdUrl: entry.link, metadataSource: "letterboxd" },
      review: { rating: entry.rating, body: entry.reviewText, spoiler: entry.spoiler, watchedOn: entry.watchedDate, status: "completed", featured: false, visibility: "private" },
      tags: entry.tags,
    },
    { source: "letterboxd", sourceRef: entry.link },
    db,
  );
  // Imported history sorts by when it was watched, not when it was imported.
  if (entry.watchedDate) db.prepare(`UPDATE review SET last_watched_at = ? WHERE media_id = ?`).run(entry.watchedDate, id);
  return id;
}

export function commitLetterboxd(items: z.infer<typeof commitSchema>["items"], db = getDb()) {
  const counts = { created: 0, updated: 0, linked: 0, skipped: 0 };
  // Oldest first so the newest watch date / text wins on rewatches.
  const ordered = [...items].sort((a, b) => (a.entry.watchedDate ?? "").localeCompare(b.entry.watchedDate ?? ""));
  db.transaction(() => {
    const createdInBatch = new Map<string, number>();
    for (const { entry, action, mediaId } of ordered) {
      const key = filmKey(entry);
      const target = mediaId ?? createdInBatch.get(key) ?? null;
      if (action === "skip") counts.skipped++;
      else if (action === "create" && target == null) {
        const id = createFromEntry(db, entry);
        createdInBatch.set(key, id);
        recordImport(db, entry, id, "create");
        counts.created++;
      } else if (target != null && mediaExists(db, target)) {
        if (action === "link") counts.linked++;
        else {
          applyEntryToReview(db, target, entry, action === "overwrite");
          counts.updated++;
        }
        recordImport(db, entry, target, action);
      } else counts.skipped++;
    }
    audit(db, "import_letterboxd", "import", null, counts);
  })();
  return counts;
}
