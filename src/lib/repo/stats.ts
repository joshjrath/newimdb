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
  /** The watch date, or (marked approximate) when you rated/logged it. Null if neither is known. */
  date: string | null;
  approximate: boolean;
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
  // "Alone": everything you watched with nobody marked.
  const alone = db
    .prepare(
      `SELECT 0 AS id, 'Alone' AS name, COUNT(*) titles,
              COALESCE(SUM(CASE WHEN m.type = 'movie' THEN ${rt("movie")} ELSE (SELECT COUNT(*) FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id WHERE s.media_id = m.id AND a.state = 'watched') * ${rt("tv")} END), 0) minutes
       FROM media m LEFT JOIN review r ON r.media_id = m.id
       WHERE COALESCE(r.status, '') != 'plan' AND NOT EXISTS (SELECT 1 FROM media_person mp WHERE mp.media_id = m.id)
         AND (r.rating IS NOT NULL OR r.watched_on IS NOT NULL OR r.status IS NOT NULL OR EXISTS (SELECT 1 FROM segment s JOIN episode e ON e.segment_id = s.id JOIN episode_assessment a ON a.episode_id = e.id WHERE s.media_id = m.id AND a.state = 'watched'))`,
    )
    .get() as Stats["people"][number];
  if (people.length && alone.titles) people.push(alone);
  people.sort((a, b) => b.minutes - a.minutes);

  const genres = db
    .prepare(
      `SELECT j.value AS name, COUNT(*) count, ROUND(AVG(r.rating), 2) average FROM media m, json_each(m.genres) j LEFT JOIN review r ON r.media_id = m.id
       GROUP BY lower(j.value) ORDER BY count DESC LIMIT 12`,
    )
    .all() as Stats["genres"];

  const theater = db
    .prepare(
      `SELECT m.id, m.title, COALESCE(r.watched_on, substr(r.last_watched_at, 1, 10)) AS date, r.watched_on IS NULL AS approximate,
              m.poster_url AS posterUrl, r.rating
       FROM media m JOIN review r ON r.media_id = m.id
       WHERE m.type = 'movie' AND r.watched_in = 'theater' ORDER BY date IS NULL, date`,
    )
    .all()
    .map((v) => ({ ...(v as TheaterVisit), approximate: Boolean((v as { approximate: number }).approximate) })) as TheaterVisit[];

  return { counts, moviesWatched: mv.n, episodesWatched, minutesWatched, averageRating, ratingHistogram, months: months(db), people, genres, theater, timeLeft: timeLeft(db), topRated: topRated(db) };
}

/** Time left on shows you've started (not dropped): aired episodes you haven't watched or skipped. */
export function timeLeft(db = getDb()): TimeLeft[] {
  return (
    db
      .prepare(
        `SELECT m.id, m.type, m.title, m.poster_url AS posterUrl,
                SUM(a.state = 'watched') AS watched,
                SUM(COALESCE(a.state, 'unwatched') = 'unwatched' AND NOT (m.type = 'anime' AND COALESCE(a.filler, 0) = 1) AND NOT COALESCE(
                  e.air_date = 'TBA'
                  OR (length(e.air_date) = 4 AND (CAST(e.air_date AS INTEGER) > CAST(strftime('%Y', 'now') AS INTEGER) OR (CAST(e.air_date AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER) AND (e.title IS NULL OR trim(e.title) = '' OR lower(e.title) GLOB 'episode*[0-9]*'))))
                  OR (length(e.air_date) >= 10 AND substr(e.air_date, 1, 10) > date('now')), 0)) AS episodesLeft,
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

/* ---------------- deeper insights ---------------- */

export interface PerfectRun {
  mediaId: number;
  title: string;
  type: MediaType;
  length: number;
  from: string;
  to: string;
}

export interface Insights {
  /** YYYY-MM-DD → things watched that day (last 53 weeks). */
  days: { date: string; episodes: number; movies: number }[];
  streak: { longest: number; longestEnd: string | null; current: number };
  perfectRuns: PerfectRun[];
  bestSeasons: { mediaId: number; title: string; season: string; average: number; rated: number }[];
  bingeDays: { date: string; title: string; mediaId: number; episodes: number }[];
  vsImdb: { compared: number; averageGap: number | null; higher: number; lower: number };
  hotTakes: { loved: HotTake[]; disliked: HotTake[] };
  weekdays: number[];
  decades: { decade: number; count: number }[];
  showStatus: { status: string; count: number }[];
  favorites: { mediaId: number; title: string; type: MediaType; code: string; episodeTitle: string | null; rating: number | null }[];
}

export interface HotTake {
  id: number;
  type: MediaType;
  title: string;
  mine: number; // out of 5
  imdb: number; // out of 10
  gap: number; // in IMDb points (mine × 2 − IMDb)
}

const code = (seasonNumber: number | null, label: string, n: number) => (seasonNumber != null ? `S${seasonNumber}E${n}` : `${label} E${n}`);
const IMDB = `COALESCE(m.imdb_rating, CASE WHEN m.third_party_rating_source = 'IMDb' THEN m.third_party_rating END)`;

export function getInsights(db = getDb(), today = new Date()): Insights {
  // Every day you watched something: episodes by when you watched them, movies by watch date.
  const since = new Date(today.getTime() - 371 * 86_400_000).toISOString().slice(0, 10);
  const byDay = new Map<string, { episodes: number; movies: number }>();
  for (const r of db.prepare(`SELECT substr(watched_at, 1, 10) d, COUNT(*) n FROM episode_assessment WHERE state = 'watched' AND watched_at IS NOT NULL GROUP BY d`).all() as { d: string; n: number }[])
    byDay.set(r.d, { episodes: r.n, movies: 0 });
  for (const r of db.prepare(`SELECT substr(r.watched_on, 1, 10) d, COUNT(*) n FROM media m JOIN review r ON r.media_id = m.id WHERE m.type = 'movie' AND r.watched_on IS NOT NULL GROUP BY d`).all() as { d: string; n: number }[])
    byDay.set(r.d, { episodes: byDay.get(r.d)?.episodes ?? 0, movies: r.n });
  const days = [...byDay].filter(([d]) => d >= since).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));

  // Streaks of consecutive days with something watched.
  const all = [...byDay.keys()].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let longest = 0, longestEnd: string | null = null, run = 0, prev: string | null = null;
  const next = (d: string) => new Date(Date.parse(d + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  for (const d of all) {
    run = prev && next(prev) === d ? run + 1 : 1;
    if (run > longest) [longest, longestEnd] = [run, d];
    prev = d;
  }
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  let current = 0;
  if (byDay.has(todayStr) || byDay.has(yesterday)) {
    let d = byDay.has(todayStr) ? todayStr : yesterday;
    while (byDay.has(d)) {
      current++;
      d = new Date(Date.parse(d + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
    }
  }

  // Longest runs of back-to-back 5/5 episodes, in watch order (an unrated or lower one ends a run).
  const eps = db
    .prepare(
      `SELECT m.id, m.title, m.type, s.season_number, s.label, s.position, e.number, a.rating
       FROM media m JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id LEFT JOIN episode_assessment a ON a.episode_id = e.id
       WHERE m.type != 'movie' AND s.kind IN ('season', 'cour')
       ORDER BY m.id, s.position, s.id, e.number`,
    )
    .all() as { id: number; title: string; type: MediaType; season_number: number | null; label: string; position: number; number: number; rating: number | null }[];
  const runs: PerfectRun[] = [];
  let cur: PerfectRun | null = null;
  let curId = -1;
  const close = () => {
    if (cur && cur.length >= 2) runs.push(cur);
    cur = null;
  };
  for (const e of eps) {
    if (e.id !== curId) {
      close();
      curId = e.id;
    }
    if (e.rating === 5) {
      const c = code(e.season_number, e.label, e.number);
      if (cur) Object.assign(cur, { length: cur.length + 1, to: c });
      else cur = { mediaId: e.id, title: e.title, type: e.type, length: 1, from: c, to: c };
    } else close();
  }
  close();
  runs.sort((a, b) => b.length - a.length);

  const bestSeasons = (db
    .prepare(
      `SELECT m.id AS mediaId, m.title, s.season_number, s.label, ROUND(AVG(a.rating), 2) AS average, COUNT(a.rating) AS rated
       FROM media m JOIN segment s ON s.media_id = m.id JOIN episode e ON e.segment_id = s.id JOIN episode_assessment a ON a.episode_id = e.id
       WHERE m.type != 'movie' AND a.rating IS NOT NULL GROUP BY s.id HAVING rated >= 4 ORDER BY average DESC, rated DESC LIMIT 8`,
    )
    .all() as { mediaId: number; title: string; season_number: number | null; label: string; average: number; rated: number }[]).map((r) => ({
    mediaId: r.mediaId,
    title: r.title,
    season: r.season_number != null ? `Season ${r.season_number}` : r.label,
    average: r.average,
    rated: r.rated,
  }));

  const bingeDays = db
    .prepare(
      `SELECT substr(a.watched_at, 1, 10) AS date, m.title, m.id AS mediaId, COUNT(*) AS episodes
       FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id JOIN media m ON m.id = s.media_id
       WHERE a.state = 'watched' AND a.watched_at IS NOT NULL GROUP BY date, m.id ORDER BY episodes DESC LIMIT 6`,
    )
    .all() as Insights["bingeDays"];

  // You vs IMDb (IMDb is out of 10; yours out of 5, so yours × 2).
  const pairs = db
    .prepare(`SELECT m.id, m.type, m.title, r.rating AS mine, ${IMDB} AS imdb FROM media m JOIN review r ON r.media_id = m.id WHERE r.rating IS NOT NULL AND ${IMDB} IS NOT NULL`)
    .all() as { id: number; type: MediaType; title: string; mine: number; imdb: number }[];
  const takes = pairs.map((p) => ({ ...p, gap: Math.round((p.mine * 2 - p.imdb) * 10) / 10 }));
  const vsImdb = {
    compared: takes.length,
    averageGap: takes.length ? Math.round((takes.reduce((a, t) => a + t.gap, 0) / takes.length) * 100) / 100 : null,
    higher: takes.filter((t) => t.gap > 0.5).length,
    lower: takes.filter((t) => t.gap < -0.5).length,
  };
  const hotTakes = {
    loved: [...takes].filter((t) => t.gap >= 1.5).sort((a, b) => b.gap - a.gap).slice(0, 6),
    disliked: [...takes].filter((t) => t.gap <= -1.5).sort((a, b) => a.gap - b.gap).slice(0, 6),
  };

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const [d, v] of byDay) {
    const w = new Date(d + "T12:00:00Z").getUTCDay();
    if (!Number.isNaN(w)) weekdays[(w + 6) % 7] += v.episodes + v.movies; // Monday first
  }

  const decades = db
    .prepare(
      `SELECT (m.year / 10) * 10 AS decade, COUNT(*) AS count FROM media m LEFT JOIN review r ON r.media_id = m.id
       WHERE m.year IS NOT NULL AND COALESCE(r.status, '') != 'plan' GROUP BY decade ORDER BY decade`,
    )
    .all() as Insights["decades"];

  const showStatus = db
    .prepare(`SELECT COALESCE(r.status, 'none') AS status, COUNT(*) AS count FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.type != 'movie' GROUP BY status ORDER BY count DESC`)
    .all() as Insights["showStatus"];

  const favorites = (db
    .prepare(
      `SELECT m.id AS mediaId, m.title, m.type, s.season_number, s.label, e.number, e.title AS episodeTitle, a.rating
       FROM episode_assessment a JOIN episode e ON e.id = a.episode_id JOIN segment s ON s.id = e.segment_id JOIN media m ON m.id = s.media_id
       WHERE a.favorite = 1 ORDER BY m.title COLLATE NOCASE, s.position, e.number`,
    )
    .all() as { mediaId: number; title: string; type: MediaType; season_number: number | null; label: string; number: number; episodeTitle: string | null; rating: number | null }[]).map((f) => ({
    mediaId: f.mediaId,
    title: f.title,
    type: f.type,
    code: code(f.season_number, f.label, f.number),
    episodeTitle: f.episodeTitle,
    rating: f.rating,
  }));

  return { days, streak: { longest, longestEnd, current }, perfectRuns: runs.slice(0, 10), bestSeasons, bingeDays, vsImdb, hotTakes, weekdays, decades, showStatus, favorites };
}
