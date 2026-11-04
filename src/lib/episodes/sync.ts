import { startKeywordJob } from "../genres/keywords";
import { startPosterJob } from "../posters/job";
import { startAnimeCheck } from "../anime/job";
import { autoMergeDuplicates } from "../repo/duplicates";
import { repairDone, repairInflatedShows } from "./repair";
import { getDb } from "../db";
import { tvmazeEpisodesBySeason, tvmazeLookupImdb } from "../providers/tvmaze";
import { tmdbConfigured, tmdbFindByImdb, tmdbTv } from "../providers/tmdb";
import { fillEmptyMetadata } from "../repo/media";
import { allShows, dueShows, markSynced, syncShowEpisodes, type DueShow, type SyncEpisode } from "../repo/episodeSync";

/**
 * The automatic new-episode check. Runs on the server every 15 minutes, a small batch at a
 * time, so every show is checked at least daily (shows you're watching every 6 hours)
 * without hammering TVmaze (≈20 requests per 10 seconds) or TMDB.
 */

export interface SyncState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  checked: number;
  total: number;
  added: number;
  newSeasons: number;
  /** Shows that got new episodes in the latest run. */
  updated: { id: number; title: string; added: number }[];
  noMatch: number;
  failed: number;
}

const g = globalThis as unknown as { __episodeSync?: SyncState; __episodeTimer?: ReturnType<typeof setInterval> };
const state = (): SyncState =>
  (g.__episodeSync ??= { running: false, startedAt: null, finishedAt: null, checked: 0, total: 0, added: 0, newSeasons: 0, updated: [], noMatch: 0, failed: 0 });

export const syncState = () => state();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TVMAZE_GAP_MS = 600;

async function episodesFor(show: DueShow): Promise<{ bySeason: Map<number, SyncEpisode[]>; provider: string; showRef: string } | null> {
  let tvmazeId = show.tvmazeId;
  if (!tvmazeId && show.imdbId) {
    const hit = await tvmazeLookupImdb(show.imdbId);
    tvmazeId = hit?.tvmazeId ?? null;
    await sleep(TVMAZE_GAP_MS);
    // Fill the poster while we're here (only if it's empty).
    if (hit) fillEmptyMetadata(show.id, { tvmazeId: hit.tvmazeId, posterUrl: hit.posterUrl, overview: hit.overview });
  }
  if (tvmazeId) {
    const bySeason = await tvmazeEpisodesBySeason(tvmazeId);
    await sleep(TVMAZE_GAP_MS);
    return { bySeason, provider: "tvmaze", showRef: String(tvmazeId) };
  }
  if (!tmdbConfigured()) return null;
  let tmdbId = show.tmdbId;
  if (!tmdbId && show.imdbId) {
    const hit = await tmdbFindByImdb(show.imdbId, "tv");
    tmdbId = hit?.tmdbId ?? null;
    if (hit) fillEmptyMetadata(show.id, { tmdbId: hit.tmdbId, posterUrl: hit.posterUrl, backdropUrl: hit.backdropUrl, overview: hit.overview });
  }
  if (!tmdbId) return null;
  const d = await tmdbTv(String(tmdbId));
  const bySeason = new Map<number, SyncEpisode[]>();
  for (const s of d.segments) {
    if (s.seasonNumber == null || !s.episodes) continue;
    bySeason.set(s.seasonNumber, s.episodes.map((e) => ({ ...e, airDate: e.airDate ?? "TBA" })));
  }
  return { bySeason, provider: "tmdb", showRef: String(tmdbId) };
}

/** Check a batch of shows (the ones due, or every show when `all`). One run at a time. */
export async function runEpisodeSync(opts: { limit?: number; all?: boolean } = {}): Promise<SyncState> {
  const s = state();
  if (s.running) return s;
  const shows = opts.all ? allShows() : dueShows(opts.limit ?? 40);
  Object.assign(s, { running: true, startedAt: new Date().toISOString(), finishedAt: null, checked: 0, total: shows.length, added: 0, newSeasons: 0, updated: [], noMatch: 0, failed: 0 });
  try {
    for (const show of shows) {
      try {
        const found = await episodesFor(show);
        if (!found) {
          s.noMatch++;
          markSynced(show.id, "No TVmaze or TMDB match for this show.");
        } else {
          const r = syncShowEpisodes(show.id, found.bySeason, found);
          s.added += r.added;
          s.newSeasons += r.newSeasons;
          if (r.added) s.updated.push({ id: show.id, title: show.title, added: r.added });
        }
      } catch (e) {
        s.failed++;
        markSynced(show.id, `Couldn't check: ${(e as Error).message}`);
      }
      s.checked++;
    }
  } finally {
    s.running = false;
    s.finishedAt = new Date().toISOString();
  }
  return s;
}

/** Start the background schedule (called once at server start). */
export function startEpisodeScheduler() {
  if (g.__episodeTimer || process.env.EPISODE_SYNC === "off") return;
  getDb();
  const tick = () => {
    // Fix shows the old sync inflated before syncing anything else (once).
    if (!repairDone()) {
      void repairInflatedShows().catch((e) => console.error("[repair] failed, will retry:", e));
      return;
    }
    autoMergeDuplicates(); // the same film or show never stays twice
    startAnimeCheck(); // anime filed under TV Shows or Movies moves to Anime
    startPosterJob({ quiet: true }); // any title still missing a poster gets one, without pressing a button
    void runEpisodeSync({ limit: 40 }).catch((e) => console.error("[episodes] sync failed:", e));
    startKeywordJob({ quiet: true }); // newly added titles pick up keyword genres (e.g. Superhero) too
  };
  setTimeout(tick, 30_000);
  g.__episodeTimer = setInterval(tick, 15 * 60_000);
}
