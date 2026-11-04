import crypto from "node:crypto";
import { imdbKind, type ImdbRating } from "../domain/imdb";
import { buildImdbPlan, planSummary, savePlan } from "../repo/imdbImport";
import { lookupEpisodes, type LookupProgress } from "./datasets";

/**
 * Preparing a big IMDb import (downloading and reading IMDb's episode lists) can take
 * minutes, longer than a host lets one request run. So it runs in the background and
 * the page asks for progress. Only one runs at a time, so two downloads never collide.
 */

export interface PreviewJob {
  id: string;
  state: "running" | "done" | "error";
  stage: string;
  fraction: number | null;
  startedAt: number;
  summary?: ReturnType<typeof planSummary>;
  error?: string;
}

const g = globalThis as unknown as { __imdbJobs?: Map<string, PreviewJob> };
const jobs = (g.__imdbJobs ??= new Map());
const KEEP_MS = 60 * 60_000;

function sweep() {
  for (const [id, j] of jobs) if (j.state !== "running" && Date.now() - j.startedAt > KEEP_MS) jobs.delete(id);
}

export function getJob(id: string): PreviewJob | null {
  return jobs.get(id) ?? null;
}

export function startPreviewJob(rows: ImdbRating[], invalid: number, wantLookup: boolean): PreviewJob {
  sweep();
  const running = [...jobs.values()].find((j) => j.state === "running");
  if (running) return running;
  const job: PreviewJob = { id: crypto.randomBytes(9).toString("hex"), state: "running", stage: "Reading your ratings", fraction: null, startedAt: Date.now() };
  jobs.set(job.id, job);

  const progress = (p: LookupProgress) => {
    job.stage = p.stage;
    job.fraction = p.fraction == null ? null : Math.min(1, Math.max(0, p.fraction));
  };

  void (async () => {
    // Let the request that started the job answer first, however quick the work is.
    await new Promise((r) => setImmediate(r));
    try {
      const episodeIds = new Set(rows.filter((r) => imdbKind(r.titleType) === "episode").map((r) => r.imdbId));
      const seriesIds = new Set(rows.filter((r) => imdbKind(r.titleType) === "series").map((r) => r.imdbId));
      let lookup = null;
      let lookupError: string | null = null;
      if (wantLookup && (episodeIds.size || seriesIds.size)) {
        try {
          lookup = await lookupEpisodes(episodeIds, seriesIds, { onProgress: progress });
        } catch (e) {
          lookupError = (e as Error).message;
        }
      }
      progress({ stage: "Sorting into Movies, TV Shows and Anime", fraction: null });
      const plan = buildImdbPlan(rows, invalid, lookup, lookupError);
      savePlan(plan);
      job.summary = planSummary(plan);
      job.state = "done";
    } catch (e) {
      console.error("[imdb] preview failed:", e);
      job.state = "error";
      job.error = (e as Error).message || "Preparing the import failed.";
    }
  })();
  return job;
}
