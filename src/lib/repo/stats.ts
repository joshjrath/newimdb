import { getDb, type DB } from "../db";
import type { MediaType } from "../domain/types";

/**
 * Everything the Statistics page shows, from your library. Runtimes come from each
 * title (per episode for shows); when a title has none, a typical length is assumed
 * (movie 110 min, TV episode 40, anime episode 24).
 */

export const DEFAULT_RUNTIME: Record<MediaType, number> = { movie: 110, tv: 40, anime: 24 };
const rt = (type: MediaType) => `COALESCE(NULLIF(m.runtime_min, 0), CASE m.type WHEN 'movie' THEN 110 WHEN 'tv' THEN 40 ELSE 24 END)`;

export interface MonthCount {
  month: string; // YYYY-MM
  movies: number;
  episodes: number;
  minutes: number;
}

export interface TheaterVisit {
  id: number;
  title: string;
  date: string;
  posterUrl: string | null;
  rating: number | null;
}

export interface TimeLeft {
  id: number;
  type: MediaType;
  title: string;
  posterUrl: string | null;
  episodesLeft: number;
  minutesLeft: number;
  percent: number;
}

export interface Stats {
  counts: Record<MediaType, number>;
  moviesWatched: number;
  episodesWatched: Record<"tv" | "anime", number>;
  minutesWatched: Record<MediaType, number>;
  averageRating: number | null;
  ratingHistogram: { rating: number; count: number }[];
  months: MonthCount[];
  people: { id: number; name: string; titles: number; minutes: number }[];
  genres: { name: string; count: number; average: number | null }[];
  theater: TheaterVisit[];
  timeLeft: TimeLeft[];
  topRated: { id: number; type: MediaType; title: string; rating: number; posterUrl: string | null }[];
}

function months(db: DB, back = 24): MonthCount[] {
  const out = new Map<string, MonthCount>();
  const now = new Date();
  for (let i = back - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const k = d.toISOString().slice(0, 7);
    out.set(k, { month: k, movies: 0, episodes: 0, minutes: 0 });
  }
  const first = [...out.keys()][0];
  for (const r of db
    .prepare(`SELECT substr(r.watched_on, 1, 7) k, COUNT(*) n, SUM(${rt("movie")}) mins FROM media m JOIN review r ON r.media_id = m.id WHERE m.type = 'movie' AND r.watched_on >= ? GROUP BY k`)
    .all(first) as { k: string; n: number; mins: number }[]) {
    const m = out.get(r.k);
    if (m) Object.assign(m, { movies: r.n, minutes: m.minutes + r.mins });
  }
  for (const r of db
    .prepare(
      `SELECT substr(a.watched_at, 1, 7) k, COUNT(*) n, SUM(${rt("tv")}) mins FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id JOIN media m ON m.id = s.media_id
       WHERE a.state = 'watched' AND a.watched_at >= ? GROUP BY k`,
    )
    .all(first) as { k: string; n: number; mins: number }[]) {
    const m = out.get(r.k);
    if (m) Object.assign(m, { episodes: r.n, minutes: m.minutes + r.mins });
  }
  return [...out.values()];
}

export function getStats(db = getDb()): Stats {
  const counts: Record<MediaType, number> = { movie: 0, tv: 0, anime: 0 };
  for (const r of db.prepare(`SELECT type, COUNT(*) n FROM media GROUP BY type`).all() as { type: MediaType; n: number }[]) counts[r.type] = r.n;

  const watchedMovie = `m.type = 'movie' AND (r.rating IS NOT NULL OR r.watched_on IS NOT NULL OR r.status = 'completed')`;
  const mv = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(${rt("movie")}), 0) mins FROM media m JOIN review r ON r.media_id = m.id WHERE ${watchedMovie}`).get() as { n: number; mins: number };
  const eps = db
    .prepare(
      `SELECT m.type, COUNT(*) n, COALESCE(SUM(${rt("tv")}), 0) mins FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id JOIN media m ON m.id = s.media_id
       WHERE a.state = 'watched' AND m.type != 'movie' GROUP BY m.type`,
    )
    .all() as { type: "tv" | "anime"; n: number; mins: number }[];
  const episodesWatched = { tv: 0, anime: 0 };
  const minutesWatched: Record<MediaType, number> = { movie: mv.mins, tv: 0, anime: 0 };
  for (const r of eps) {
    episodesWatched[r.type] = r.n;
    minutesWatched[r.type] = r.mins;
  }

  const ratings = db.prepare(`SELECT rating, COUNT(*) n FROM review WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating`).all() as { rating: number; n: number }[];
  const ratedTotal = ratings.reduce((a, r) => a + r.n, 0);
  const averageRating = ratedTotal ? Math.round((ratings.reduce((a, r) => a + r.rating * r.n, 0) / ratedTotal) * 100) / 100 : null;
  const ratingHistogram = Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((rating) => ({ rating, count: ratings.find((r) => r.rating === rating)?.n ?? 0 }));

  // Who you watch with: titles, and time (movies plus the episodes you've watched of each show).
  const people = db
    .prepare(
      `SELECT p.id, p.name, COUNT(DISTINCT m.id) titles,
              COALESCE(SUM(CASE WHEN m.type = 'movie' THEN ${rt("movie")} ELSE (SELECT COUNT(*) FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id WHERE s.media_id = m.id AND a.state = 'watched') * ${rt("tv")} END), 0) minutes
       FROM person p JOIN media_person mp ON mp.person_id = p.id JOIN media m ON m.id = mp.media_id GROUP BY p.id ORDER BY minutes DESC, titles DESC`,
    )
    .all() as Stats["people"];

  const genres = db
    .prepare(
      `SELECT j.value AS name, COUNT(*) count, ROUND(AVG(r.rating), 2) average FROM media m, json_each(m.genres) j LEFT JOIN review r ON r.media_id = m.id
       GROUP BY lower(j.value) ORDER BY count DESC LIMIT 12`,
    )
    .all() as Stats["genres"];

  const theater = db
    .prepare(
      `SELECT m.id, m.title, r.watched_on AS date, m.poster_url AS posterUrl, r.rating FROM media m JOIN review r ON r.media_id = m.id
       WHERE m.type = 'movie' AND r.watched_in = 'theater' AND r.watched_on IS NOT NULL ORDER BY r.watched_on`,
    )
    .all() as TheaterVisit[];

  return { counts, moviesWatched: mv.n, episodesWatched, minutesWatched, averageRating, ratingHistogram, months: months(db), people, genres, theater, timeLeft: timeLeft(db), topRated: topRated(db) };
}

/** Time left on shows you've started (not dropped): aired episodes you haven't watched or skipped. */
export function timeLeft(db = getDb()): TimeLeft[] {
  return (
    db
      .prepare(
        `SELECT m.id, m.type, m.title, m.poster_url AS posterUrl,
                SUM(a.state = 'watched') AS watched,
                SUM(COALESCE(a.state, 'unwatched') = 'unwatched' AND NOT (
                  e.air_date = 'TBA'
                  OR (length(e.air_date) = 4 AND CAST(e.air_date AS INTEGER) >= CAST(strftime('%Y', 'now') AS INTEGER))
                  OR (length(e.air_date) >= 10 AND substr(e.air_date, 1, 10) > date('now')))) AS episodesLeft,
                ${rt("tv")} AS per
         FROM media m LEFT JOIN review r ON r.media_id = m.id JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id
         WHERE m.type != 'movie' AND COALESCE(r.status, '') != 'dropped'
         GROUP BY m.id HAVING watched > 0 AND episodesLeft > 0`,
      )
      .all() as { id: number; type: MediaType; title: string; posterUrl: string | null; watched: number; episodesLeft: number; per: number }[]
  )
    .map((r) => ({ id: r.id, type: r.type, title: r.title, posterUrl: r.posterUrl, episodesLeft: r.episodesLeft, minutesLeft: r.episodesLeft * r.per, percent: Math.round((r.watched / (r.watched + r.episodesLeft)) * 100) }))
    .sort((a, b) => b.minutesLeft - a.minutesLeft);
}

function topRated(db: DB): Stats["topRated"] {
  return db
    .prepare(`SELECT m.id, m.type, m.title, r.rating, m.poster_url AS posterUrl FROM media m JOIN review r ON r.media_id = m.id WHERE r.rating IS NOT NULL ORDER BY r.rating DESC, r.last_watched_at DESC LIMIT 10`)
    .all() as Stats["topRated"];
}

/** "2 h 15 m", or "45 min" under an hour. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h >= 48) return `${Math.round(min / 60).toLocaleString("en-GB")} h`;
  return m ? `${h} h ${m} m` : `${h} h`;
}
