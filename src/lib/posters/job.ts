import crypto from "node:crypto";
import { fillEmptyMetadata, missingPosterIds } from "../repo/media";
import { tmdbConfigured, tmdbFindByImdb, type ArtworkMatch } from "../providers/tmdb";
import { tvmazeLookupImdb } from "../providers/tvmaze";
import type { MediaType } from "../domain/types";

/**
 * Fills in missing posters for titles that have an IMDb id (e.g. after an IMDb import),
 * in the background. TMDB covers movies, shows and anime; without a TMDB key, TVmaze
 * covers shows. Only empty fields are filled, so nothing you set is overwritten.
 */

export interface PosterJob {
  id: string;
  state: "running" | "done" | "error";
  total: number;
  done: number;
  found: number;
  notFound: number;
  failed: number;
  /** Movies skipped because finding their poster needs a TMDB key. */
  needsKey: number;
  startedAt: number;
  error?: string;
}

const g = globalThis as unknown as { __posterJob?: PosterJob; __posterMisses?: Map<number, number> };
/** Titles with no poster anywhere: not asked again for a day, so the automatic run stays light. */
const misses = () => (g.__posterMisses ??= new Map());
const MISS_RETRY_MS = 24 * 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function currentPosterJob(): PosterJob | null {
  return g.__posterJob ?? null;
}

async function lookup(type: MediaType, imdbId: string): Promise<ArtworkMatch | null | "needs_key"> {
  if (tmdbConfigured()) {
    for (let attempt = 0; ; attempt++) {
      try {
        const m = await tmdbFindByImdb(imdbId, type === "movie" ? "movie" : "tv");
        if (m || type === "movie") return m;
        break; // not on TMDB: a show can still be on TVmaze
      } catch (e) {
        if ((e as { status?: number }).status === 429 && attempt < 3) {
          await sleep(2000 * (attempt + 1)); // TMDB rate limit: back off and retry
          continue;
        }
        if (type === "movie") throw e;
        break;
      }
    }
  }
  if (type === "movie") return "needs_key";
  let t: Awaited<ReturnType<typeof tvmazeLookupImdb>> = null;
  for (let attempt = 0; ; attempt++) {
    try {
      t = await tvmazeLookupImdb(imdbId);
      break;
    } catch (e) {
      if ((e as { status?: number }).status === 429 && attempt < 3) {
        await sleep(5000 * (attempt + 1)); // TVmaze rate limit: wait and retry
        continue;
      }
      throw e;
    }
  }
  return t && { posterUrl: t.posterUrl, backdropUrl: null, overview: t.overview, tvmazeId: t.tvmazeId };
}

/**
 * Start (or return the running) fetch. `quiet` is the automatic background run: it skips
 * titles that found nothing in the last day and movies that need a TMDB key, and does
 * nothing when there's nothing to do.
 */
export function startPosterJob(opts: { quiet?: boolean } = {}): PosterJob | null {
  const running = g.__posterJob;
  if (running?.state === "running") return running;
  const now = Date.now();
  const todo = missingPosterIds().filter((t) => !opts.quiet || ((tmdbConfigured() || t.type !== "movie") && now - (misses().get(t.id) ?? 0) > MISS_RETRY_MS));
  if (opts.quiet && !todo.length) return null;
  const job: PosterJob = { id: crypto.randomBytes(9).toString("hex"), state: "running", total: todo.length, done: 0, found: 0, notFound: 0, failed: 0, needsKey: 0, startedAt: Date.now() };
  g.__posterJob = job;

  // TMDB allows ~40 requests/second; TVmaze ~20 per 10 seconds.
  const workers = tmdbConfigured() ? 4 : 1;
  const gap = tmdbConfigured() ? 0 : 550;
  let next = 0;
  void (async () => {
    await new Promise((r) => setImmediate(r));
    try {
      await Promise.all(
        Array.from({ length: workers }, async () => {
          for (let i = next++; i < todo.length; i = next++) {
            const t = todo[i];
            try {
              const m = await lookup(t.type, t.imdbId);
              if (m === "needs_key") job.needsKey++;
              else if (!m?.posterUrl) {
                job.notFound++;
                misses().set(t.id, Date.now());
              } else {
                fillEmptyMetadata(t.id, { posterUrl: m.posterUrl, backdropUrl: m.backdropUrl, overview: m.overview, tmdbId: m.tmdbId ?? null, tvmazeId: m.tvmazeId ?? null });
                job.found++;
              }
            } catch (e) {
              job.failed++;
              if (job.failed <= 3) console.warn(`[posters] lookup failed for ${t.imdbId}:`, (e as Error).message);
            }
            job.done++;
            if (gap) await sleep(gap);
          }
        }),
      );
      job.state = "done";
    } catch (e) {
      job.state = "error";
      job.error = (e as Error).message;
    }
  })();
  return job;
}
