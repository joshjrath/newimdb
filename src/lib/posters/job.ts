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

const g = globalThis as unknown as { __posterJob?: PosterJob };
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
  const t = await tvmazeLookupImdb(imdbId);
  return t && { posterUrl: t.posterUrl, backdropUrl: null, overview: t.overview, tvmazeId: t.tvmazeId };
}

export function startPosterJob(): PosterJob {
  const running = g.__posterJob;
  if (running?.state === "running") return running;
  const todo = missingPosterIds();
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
              else if (!m?.posterUrl) job.notFound++;
              else {
                fillEmptyMetadata(t.id, { posterUrl: m.posterUrl, backdropUrl: m.backdropUrl, overview: m.overview, tmdbId: m.tmdbId ?? null, tvmazeId: m.tvmazeId ?? null });
                job.found++;
              }
            } catch {
              job.failed++;
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
