import { getDb, nowIso } from "../db";
import { decideAnime, sameAnime, type AnimeEvidence } from "../domain/animeDetect";
import { tvmazeShowInfo } from "../providers/tvmaze";
import { tmdbConfigured, tmdbFindByImdb, tmdbOrigin } from "../providers/tmdb";
import { anilistFind } from "../providers/anime";
import { audit } from "../repo/audit";
import { autoMergeDuplicates } from "../repo/duplicates";
import { groupAnimeFranchises } from "../repo/franchise";
import type { MediaType } from "../domain/types";

/**
 * Puts every title in the right place: anime that landed in TV Shows or Movies (Bleach,
 * Monster…) moves to Anime, and animation guessed as anime that isn't moves back. Each
 * title is checked once, in the background. A category you set yourself is never changed.
 */

export interface AnimeCheckState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  checked: number;
  total: number;
  moved: { id: number; title: string; from: MediaType; to: MediaType }[];
  failed: number;
}

interface Candidate {
  id: number;
  type: MediaType;
  title: string;
  year: number | null;
  imdb_id: string | null;
  tvmaze_id: number | null;
  tmdb_id: number | null;
  genres: string;
  source: string | null;
}

const g = globalThis as unknown as { __animeCheck?: AnimeCheckState };
const state = (): AnimeCheckState => (g.__animeCheck ??= { running: false, startedAt: null, finishedAt: null, checked: 0, total: 0, moved: [], failed: 0 });
export const animeCheckState = () => state();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Titles worth checking: animated TV shows and movies (could be anime), and anime that was
 * only guessed on import (could be other animation). Everything else is left alone.
 */
export function animeCandidates(db = getDb(), opts: { all?: boolean } = {}): Candidate[] {
  return db
    .prepare(
      `SELECT m.id, m.type, m.title, m.year, m.imdb_id, m.tvmaze_id, m.tmdb_id, m.genres, r.source FROM media m LEFT JOIN review r ON r.media_id = m.id
       WHERE m.type_locked = 0 ${opts.all ? "" : "AND m.type_checked_at IS NULL"}
         AND ((m.type IN ('tv', 'movie') AND EXISTS (SELECT 1 FROM json_each(m.genres) j WHERE lower(j.value) IN ('animation', 'anime')))
           OR (m.type = 'anime' AND r.source = 'imdb'))
       ORDER BY m.id`,
    )
    .all() as Candidate[];
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if ((e as { status?: number }).status === 429 && attempt < 3) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

async function evidenceFor(c: Candidate): Promise<AnimeEvidence> {
  const movie = c.type === "movie";
  const e: AnimeEvidence = {};
  if (!movie && (c.tvmaze_id || c.imdb_id)) {
    e.tvmaze = await retry(() => tvmazeShowInfo({ tvmazeId: c.tvmaze_id, imdbId: c.imdb_id }));
    await sleep(600); // TVmaze: about 20 requests per 10 seconds
  }
  let decided = decideAnime(e);
  if (decided == null && tmdbConfigured() && (c.tmdb_id || c.imdb_id)) {
    let id = c.tmdb_id;
    let kind: "movie" | "tv" = movie ? "movie" : "tv";
    if (!id && c.imdb_id) {
      const hit = await retry(() => tmdbFindByImdb(c.imdb_id!, kind));
      id = hit?.tmdbId ?? null;
      kind = hit?.kind ?? kind;
    }
    if (id) e.tmdb = await retry(() => tmdbOrigin(kind, id!));
    decided = decideAnime(e);
  }
  // Last resort for things still undecided that might be anime: is it on AniList under this name?
  if (decided == null && c.type !== "anime") {
    const found = await retry(() => anilistFind(c.title));
    e.anilist = found.some((a) => sameAnime(c.title, c.year, a) && (movie ? a.format === "MOVIE" : a.format !== "MOVIE"));
    await sleep(2100); // AniList: about 30 requests a minute
  }
  return e;
}

/** Where a title belongs, given what we found. Null = leave it. */
export function targetType(type: MediaType, decided: "anime" | "other" | null, isMovieLike: boolean): MediaType | null {
  if (decided === "anime" && type !== "anime") return "anime";
  if (decided === "other" && type === "anime") return isMovieLike ? "movie" : "tv";
  return null;
}

export async function runAnimeCheck(opts: { all?: boolean } = {}): Promise<AnimeCheckState> {
  const s = state();
  if (s.running) return s;
  const db = getDb();
  const todo = animeCandidates(db, opts);
  Object.assign(s, { running: true, startedAt: nowIso(), finishedAt: null, checked: 0, total: todo.length, moved: [], failed: 0 });
  const mark = db.prepare(`UPDATE media SET type_checked_at = ? WHERE id = ?`);
  try {
    for (const c of todo) {
      try {
        const decided = decideAnime(await evidenceFor(c));
        const segments = (db.prepare(`SELECT COUNT(*) n FROM segment WHERE media_id = ?`).get(c.id) as { n: number }).n;
        const to = targetType(c.type, decided, segments === 0);
        db.transaction(() => {
          // Still yours to change: skip if you moved it yourself while this was running.
          if (to && db.prepare(`UPDATE media SET type = ?, version = version + 1, updated_at = ? WHERE id = ? AND type = ? AND type_locked = 0`).run(to, nowIso(), c.id, c.type).changes) {
            s.moved.push({ id: c.id, title: c.title, from: c.type, to });
            audit(db, "auto_move_type", "media", c.id, { from: c.type, to });
          }
          mark.run(nowIso(), c.id);
        })();
      } catch {
        s.failed++; // not marked, so it's tried again next time
      }
      s.checked++;
    }
  } finally {
    s.running = false;
    s.finishedAt = nowIso();
  }
  // A title moved to Anime may now meet its twin there (e.g. an anime film from Letterboxd).
  if (s.moved.length) {
    autoMergeDuplicates(db);
    groupAnimeFranchises(db);
  }
  return s;
}

/** For the background scheduler: start a run if anything is unchecked. */
export function startAnimeCheck() {
  if (state().running || !animeCandidates().length) return;
  void runAnimeCheck().catch((e) => console.error("[anime] check failed:", e));
}
